import { PoolClient } from "pg";
import { AuthUser } from "../middleware/auth";

/**
 * E8 — Politique de prix : grille gros/détail, promotions datées, plafond de
 * remise manuelle encadré par utilisateur/rôle, historique des changements.
 *
 *  Résolution du prix au moment de la vente (prix catalogue = TTC) :
 *   1. prix de GROS si le client est canal WHOLESALE et atteint la quantité
 *      seuil du produit (sinon prix de détail) ;
 *   2. remise PROMOTIONNELLE datée (promo produit prioritaire, sinon promo
 *      globale) — appliquée automatiquement et figée sur la ligne ;
 *   3. remise MANUELLE négociée (discountPct) — plafonnée serveur par
 *      utilisateur (défaut : 10 % vendeur, 100 % admin).
 */

export type PriceSource =
  "DETAIL" | "WHOLESALE" | "PROMO_PRODUCT" | "PROMO_GLOBAL";

export interface ResolvedPrice {
  /** Prix TTC par unité de BASE (avant remise manuelle). */
  unitTtc: number;
  source: PriceSource;
  /** Remise promotionnelle appliquée (0 si aucune). */
  promoPct: number;
  promoName: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Promotion active à l'instant `at` : produit précis d'abord, globale sinon
 *  (à périmètre égal, la plus avantageuse gagne). */
async function activePromo(
  client: PoolClient,
  tenantId: string,
  productId: string,
  at: Date,
): Promise<{
  discount_pct: number;
  name: string;
  product_id: string | null;
} | null> {
  const r = await client.query<{
    discount_pct: number;
    name: string;
    product_id: string | null;
  }>(
    `SELECT discount_pct::float, name, product_id FROM promotions
      WHERE tenant_id=$1 AND is_active
        AND (product_id=$2 OR product_id IS NULL)
        AND starts_at <= $3 AND ends_at >= $3
      ORDER BY discount_pct DESC
      LIMIT 5`,
    [tenantId, productId, at],
  );
  // Produit précis prioritaire (tri JS — portable), sinon promo globale.
  return r.rows.find((x) => x.product_id === productId) ?? r.rows[0] ?? null;
}

export async function resolveLinePrice(
  client: PoolClient,
  args: {
    tenantId: string;
    productId: string;
    /** Prix TTC catalogue par unité de base (selling_price + variante). */
    detailUnitTtc: number;
    wholesalePrice: number | null;
    wholesaleMinQty: number;
    customerChannel: "DETAIL" | "WHOLESALE";
    baseQty: number;
    at?: Date;
  },
): Promise<ResolvedPrice> {
  const at = args.at ?? new Date();
  let unitTtc = args.detailUnitTtc;
  let source: PriceSource = "DETAIL";
  if (
    args.customerChannel === "WHOLESALE" &&
    args.wholesalePrice != null &&
    args.wholesalePrice > 0 &&
    args.baseQty >= args.wholesaleMinQty - 1e-9 &&
    args.wholesaleMinQty >= 0
  ) {
    unitTtc = args.wholesalePrice;
    source = "WHOLESALE";
  }
  const promo = await activePromo(client, args.tenantId, args.productId, at);
  if (promo) {
    unitTtc = round2(unitTtc * (1 - promo.discount_pct / 100));
    source = promo.product_id ? "PROMO_PRODUCT" : "PROMO_GLOBAL";
    return {
      unitTtc,
      source,
      promoPct: promo.discount_pct,
      promoName: promo.name,
    };
  }
  return { unitTtc, source, promoPct: 0, promoName: null };
}

/** Plafond de remise manuelle EFFECTIF de l'utilisateur (NULL = défaut rôle). */
export function effectiveMaxDiscount(user: {
  role: AuthUser["role"];
  maxDiscountPct?: number | null;
}): number {
  if (user.maxDiscountPct != null) return user.maxDiscountPct;
  return user.role === "VENDEUR" ? 10 : 100;
}

/** Lit le plafond personnalisé de l'utilisateur (défaut rôle si NULL). */
export async function loadUserDiscountCap(
  client: PoolClient,
  userId: string,
): Promise<number | null> {
  const r = await client.query<{ m: number | null }>(
    "SELECT max_discount_pct::float AS m FROM users WHERE id=$1",
    [userId],
  );
  return r.rows[0]?.m ?? null;
}

/** Historise un changement de prix (appelé depuis le PATCH produit) —
 *  `newPrice` NULL = grille de gros retirée (champ WHOLESALE uniquement). */
export async function recordPriceChange(
  client: PoolClient,
  args: {
    tenantId: string;
    productId: string;
    field: "DETAIL" | "WHOLESALE";
    oldPrice: number | null;
    newPrice: number | null;
    changedBy: string;
    reason?: string | null;
  },
): Promise<void> {
  if (args.oldPrice == null && args.newPrice == null) return;
  if (
    args.oldPrice != null &&
    args.newPrice != null &&
    Math.abs(args.oldPrice - args.newPrice) < 1e-9
  )
    return; // pas de changement effectif → pas de ligne d'historique
  await client.query(
    `INSERT INTO price_history (tenant_id, product_id, field, old_price, new_price, changed_by, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      args.tenantId,
      args.productId,
      args.field,
      args.oldPrice,
      args.newPrice,
      args.changedBy,
      args.reason ?? null,
    ],
  );
}
