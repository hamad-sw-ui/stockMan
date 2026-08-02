import { PoolClient } from "pg";
import { query, withTransaction } from "../config/db";
import { getEnv } from "../config/env";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import { AuthUser } from "../middleware/auth";
import {
  decreaseLevel,
  fefoConsume,
  recordMovement,
  restock,
  StockScope,
} from "./stockService";

export interface SaleItemInput {
  productId: string;
  variantId?: string | null;
  unitId?: string | null;
  quantity: number;
  discountPct?: number;
}

export interface CreateSaleInput {
  depotId?: string;
  items: SaleItemInput[];
  paymentMethod: "CASH" | "MTN_MOMO" | "ORANGE_MONEY";
  paymentReference?: string;
  clientSaleId?: string;
  createdAt?: string;
  amountReceived?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Résolution du dépôt effectif : un VENDEUR est confiné à son dépôt
 *  (corrige SEC-11 : impossible de vendre « au nom » d'un autre dépôt). */
export function resolveDepot(user: AuthUser, requested?: string): string {
  const depot =
    user.role === "VENDEUR" ? user.depotId : (requested ?? user.depotId);
  if (!depot)
    throw HttpError.badRequest(
      "DEPOT_REQUIRED",
      "Dépôt requis pour cette opération.",
    );
  if (user.role === "VENDEUR" && requested && requested !== user.depotId) {
    throw HttpError.forbidden(
      "Un vendeur ne peut opérer que sur son propre dépôt.",
      "DEPOT_FORBIDDEN",
    );
  }
  return depot;
}

interface ProductRow {
  id: string;
  name: string;
  selling_price: string;
  unit_id: string | null;
  archived_at: string | null;
  has_variants: boolean;
}

async function loadUnit(client: PoolClient, tenantId: string, unitId: string) {
  const r = await client.query<{
    id: string;
    base_value: string;
    symbol: string;
  }>("SELECT id, base_value, symbol FROM units WHERE id=$1 AND tenant_id=$2", [
    unitId,
    tenantId,
  ]);
  const u = r.rows[0];
  if (!u)
    throw HttpError.badRequest(
      "UNIT_UNKNOWN",
      "Unité inconnue pour ce tenant.",
    );
  return u;
}

async function fullSaleById(
  client: PoolClient,
  tenantId: string,
  saleId: string,
) {
  const s = await client.query(
    `SELECT s.*, u.name AS vendor_name, d.name AS depot_name
       FROM sales s JOIN users u ON u.id = s.vendor_id JOIN depots d ON d.id = s.depot_id
      WHERE s.id=$1 AND s.tenant_id=$2`,
    [saleId, tenantId],
  );
  if (s.rows.length === 0) throw HttpError.notFound("Vente introuvable.");
  const items = await client.query(
    `SELECT si.*, p.name AS product_name, v.name AS variant_name, un.symbol AS unit_symbol
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       LEFT JOIN product_variants v ON v.id = si.variant_id
       LEFT JOIN units un ON un.id = si.unit_id
      WHERE si.sale_id=$1 ORDER BY si.id`,
    [saleId],
  );
  return { ...s.rows[0], items: items.rows };
}

/**
 * Création de vente — autorité serveur (corrige SEC-06/SEC-07) :
 *  - prix et total RECALCULÉS depuis la base ;
 *  - idempotence par `clientSaleId` (retry offline = même vente renvoyée) ;
 *  - FEFO transactionnel + niveaux de stock + mouvements.
 */
export async function createSale(user: AuthUser, input: CreateSaleInput) {
  const depotId = resolveDepot(user, input.depotId);
  const env = getEnv();

  // Idempotence : même clientSaleId → même vente, jamais de doublon.
  if (input.clientSaleId) {
    const dup = await query(
      "SELECT id FROM sales WHERE tenant_id=$1 AND client_sale_id=$2",
      [user.tenantId, input.clientSaleId],
    );
    if (dup.rows[0]) {
      const sale = await withTransaction((c) =>
        fullSaleById(c, user.tenantId, dup.rows[0]!.id),
      );
      return { sale, deduplicated: true };
    }
  }

  // Borne de la date métier (anti antidatation / sync offline)
  if (input.createdAt) {
    const ts = new Date(input.createdAt);
    if (Number.isNaN(ts.getTime()))
      throw HttpError.badRequest("DATE_INVALID", "Date de vente invalide.");
    const ageH = (Date.now() - ts.getTime()) / 3600000;
    if (ageH < -0.25)
      throw HttpError.badRequest(
        "DATE_FUTURE",
        "Une vente ne peut pas être datée dans le futur.",
      );
    if (ageH > env.MAX_SYNC_AGE_HOURS) {
      throw HttpError.badRequest(
        "SALE_TOO_OLD",
        `Vente trop ancienne pour la synchronisation (> ${env.MAX_SYNC_AGE_HOURS} h).`,
      );
    }
  }

  return withTransaction(async (client) => {
    // Dépôt actif obligatoire
    const depotCheck = await client.query(
      "SELECT is_active FROM depots WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
      [depotId, user.tenantId],
    );
    if (!depotCheck.rows[0])
      throw HttpError.badRequest("DEPOT_UNKNOWN", "Dépôt introuvable.");
    if (!depotCheck.rows[0].is_active)
      throw HttpError.badRequest("DEPOT_INACTIVE", "Ce dépôt est désactivé.");

    let total = 0;
    const prepared: Array<{
      product: ProductRow;
      variantId: string | null;
      unitId: string | null;
      unitSymbol: string | null;
      quantity: number;
      baseQty: number;
      unitPrice: number;
      lineTotal: number;
    }> = [];

    for (const item of input.items) {
      const pr = await client.query<ProductRow>(
        `SELECT id, name, selling_price, unit_id, archived_at, has_variants
           FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [item.productId, user.tenantId],
      );
      const product = pr.rows[0];
      if (!product || product.archived_at) {
        throw HttpError.badRequest(
          "PRODUCT_UNKNOWN",
          `Produit introuvable ou archivé (${item.productId}).`,
        );
      }

      let variantId: string | null = null;
      let additional = 0;
      if (item.variantId) {
        const vr = await client.query<{ additional_price: string }>(
          "SELECT additional_price FROM product_variants WHERE id=$1 AND product_id=$2",
          [item.variantId, product.id],
        );
        if (!vr.rows[0])
          throw HttpError.badRequest(
            "VARIANT_UNKNOWN",
            `Variante introuvable pour « ${product.name} ».`,
          );
        variantId = item.variantId;
        additional = parseFloat(vr.rows[0].additional_price);
      }

      // Conversion d'unité : base_qty = qty × (base_value unité de vente / base_value unité produit)
      const productUnitValue = product.unit_id
        ? parseFloat(
            (await loadUnit(client, user.tenantId, product.unit_id)).base_value,
          )
        : 1;
      let unitId: string | null = null;
      let unitSymbol: string | null = null;
      let factor = 1;
      if (item.unitId) {
        const saleUnit = await loadUnit(client, user.tenantId, item.unitId);
        unitId = saleUnit.id;
        unitSymbol = saleUnit.symbol;
        factor = parseFloat(saleUnit.base_value) / productUnitValue;
      }
      const baseQty = round2(item.quantity * factor);
      if (baseQty <= 0)
        throw HttpError.badRequest(
          "QUANTITY_INVALID",
          "Quantité convertie invalide.",
        );

      const discount = Math.min(Math.max(item.discountPct ?? 0, 0), 100);
      const unitPrice = round2(
        (parseFloat(product.selling_price) + additional) *
          factor *
          (1 - discount / 100),
      );
      const lineTotal = round2(
        item.quantity *
          factor *
          (parseFloat(product.selling_price) + additional) *
          (1 - discount / 100),
      );
      total = round2(total + lineTotal);

      prepared.push({
        product,
        variantId,
        unitId,
        unitSymbol,
        quantity: item.quantity,
        baseQty,
        unitPrice,
        lineTotal,
      });
    }

    const saleIns = await client.query<{ id: string }>(
      `INSERT INTO sales (tenant_id, depot_id, vendor_id, total_amount, payment_method, payment_reference, client_sale_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::timestamptz, now())) RETURNING id`,
      [
        user.tenantId,
        depotId,
        user.id,
        total,
        input.paymentMethod,
        input.paymentReference ?? null,
        input.clientSaleId ?? null,
        input.createdAt ?? null,
      ],
    );
    const saleId = saleIns.rows[0]!.id;

    for (const p of prepared) {
      const scope: StockScope = {
        tenantId: user.tenantId,
        depotId,
        productId: p.product.id,
        variantId: p.variantId,
      };
      await fefoConsume(client, scope, p.baseQty); // lots FEFO (si gérés)
      const lvl = await decreaseLevel(client, scope, p.baseQty); // source de vérité

      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, variant_id, unit_id, quantity, base_qty, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          saleId,
          p.product.id,
          p.variantId,
          p.unitId,
          p.quantity,
          p.baseQty,
          p.unitPrice,
          p.lineTotal,
        ],
      );
      await recordMovement(client, {
        ...scope,
        userId: user.id,
        type: "SALE",
        quantity: p.baseQty,
        previousStock: lvl.previous,
        newStock: lvl.next,
        referenceId: saleId,
      });
    }

    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "SALE",
        entity: "sale",
        entityId: saleId,
        depotId,
        newState: {
          total,
          paymentMethod: input.paymentMethod,
          items: prepared.length,
        },
      },
      client,
    );

    const sale = await fullSaleById(client, user.tenantId, saleId);
    return { sale, deduplicated: false };
  });
}

/** Annulation (avoir) : ADMIN uniquement, même jour par défaut. */
export async function voidSale(
  user: AuthUser,
  saleId: string,
  reason?: string,
) {
  return withTransaction(async (client) => {
    const sale = await fullSaleById(client, user.tenantId, saleId);
    if (sale.status === "VOIDED")
      throw HttpError.conflict(
        "ALREADY_VOIDED",
        "Cette vente est déjà annulée.",
      );

    const sameDay =
      new Date(sale.created_at).toDateString() === new Date().toDateString();
    if (!sameDay && user.role !== "SUPER_ADMIN") {
      throw HttpError.forbidden(
        "Annulation limitée au jour même de la vente.",
        "VOID_WINDOW",
      );
    }

    await client.query("UPDATE sales SET status='VOIDED' WHERE id=$1", [
      saleId,
    ]);
    for (const item of sale.items) {
      const scope: StockScope = {
        tenantId: user.tenantId,
        depotId: sale.depot_id,
        productId: item.product_id,
        variantId: item.variant_id,
      };
      const lvl = await restock(client, scope, parseFloat(item.base_qty));
      await recordMovement(client, {
        ...scope,
        userId: user.id,
        type: "VOID",
        quantity: parseFloat(item.base_qty),
        previousStock: lvl.previous,
        newStock: lvl.next,
        reason: reason ?? "Annulation de vente",
        referenceId: saleId,
      });
    }
    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "VOID",
        entity: "sale",
        entityId: saleId,
        depotId: sale.depot_id,
        previousState: { status: "COMPLETED", total: sale.total_amount },
        newState: { status: "VOIDED" },
        details: reason,
      },
      client,
    );
    return fullSaleById(client, user.tenantId, saleId);
  });
}

/** Retour partiel : restocke et journalise, vente conservée. */
export async function returnSaleItems(
  user: AuthUser,
  saleId: string,
  items: Array<{ saleItemId: string; baseQty: number }>,
  reason?: string,
) {
  return withTransaction(async (client) => {
    const sale = await fullSaleById(client, user.tenantId, saleId);
    if (sale.status === "VOIDED")
      throw HttpError.conflict(
        "SALE_VOIDED",
        "Impossible de retourner une vente annulée.",
      );

    // Quantités déjà retournées (aggrégat en 2 requêtes : pas de SUM sur jointure)
    const priorReturns = await client.query<{ id: string }>(
      "SELECT id FROM sale_returns WHERE sale_id=$1",
      [saleId],
    );
    const returnedByProduct = new Map<string, number>();
    if (priorReturns.rows.length > 0) {
      const ph = priorReturns.rows.map((_, i) => `$${i + 1}`).join(",");
      const priorItems = await client.query<{
        product_id: string;
        variant_id: string | null;
        base_qty: string;
      }>(
        `SELECT product_id, variant_id, base_qty FROM sale_return_items WHERE return_id IN (${ph})`,
        priorReturns.rows.map((r) => r.id),
      );
      for (const row of priorItems.rows) {
        const key = `${row.product_id}|${row.variant_id ?? ""}`;
        returnedByProduct.set(
          key,
          (returnedByProduct.get(key) ?? 0) + parseFloat(row.base_qty),
        );
      }
    }

    // 1) VALIDATION INTÉGRALE AVANT TOUTE ÉCRITURE (aucune ligne partielle)
    interface PreparedReturn {
      line: (typeof sale.items)[number];
      baseQty: number;
      unitPrice: number;
    }
    const prepared: PreparedReturn[] = [];
    let refundedTotal = 0;
    for (const it of items) {
      const line = sale.items.find(
        (i: { id: string }) => i.id === it.saleItemId,
      );
      if (!line)
        throw HttpError.badRequest(
          "LINE_UNKNOWN",
          "Ligne de vente introuvable.",
        );
      const key = `${line.product_id}|${line.variant_id ?? ""}`;
      const alreadyReturned = returnedByProduct.get(key) ?? 0;
      if (alreadyReturned + it.baseQty > parseFloat(line.base_qty) + 1e-9) {
        throw HttpError.badRequest(
          "RETURN_EXCEEDS",
          `Retour supérieur à la quantité vendue pour « ${line.product_name} ».`,
        );
      }
      const unitPrice = parseFloat(line.unit_price);
      refundedTotal = round2(refundedTotal + it.baseQty * unitPrice);
      prepared.push({ line, baseQty: it.baseQty, unitPrice });
    }

    // 2) Écritures
    const ret = await client.query<{ id: string }>(
      "INSERT INTO sale_returns (sale_id, reason, created_by) VALUES ($1,$2,$3) RETURNING id",
      [saleId, reason ?? null, user.id],
    );
    const returnId = ret.rows[0]!.id;
    for (const p of prepared) {
      await client.query(
        `INSERT INTO sale_return_items (return_id, product_id, variant_id, base_qty, unit_price)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          returnId,
          p.line.product_id,
          p.line.variant_id,
          p.baseQty,
          p.unitPrice,
        ],
      );
      const scope: StockScope = {
        tenantId: user.tenantId,
        depotId: sale.depot_id,
        productId: p.line.product_id,
        variantId: p.line.variant_id,
      };
      const lvl = await restock(client, scope, p.baseQty);
      await recordMovement(client, {
        ...scope,
        userId: user.id,
        type: "RETURN",
        quantity: p.baseQty,
        previousStock: lvl.previous,
        newStock: lvl.next,
        reason: reason ?? "Retour client",
        referenceId: saleId,
      });
    }
    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "RETURN",
        entity: "sale",
        entityId: saleId,
        depotId: sale.depot_id,
        newState: { returnId, refundedTotal },
      },
      client,
    );
    return {
      returnId,
      refundedTotal,
      sale: await fullSaleById(client, user.tenantId, saleId),
    };
  });
}

/** Données de ticket de caisse (reçu 80 mm / partage WhatsApp). */
export async function receiptData(tenantId: string, saleId: string) {
  const sale = await withTransaction((c) => fullSaleById(c, tenantId, saleId));
  const t = await query(
    "SELECT name, phone, currency FROM tenants WHERE id=$1",
    [tenantId],
  );
  const tenant = t.rows[0]!;
  const lines = sale.items.map(
    (i: {
      product_name: string;
      variant_name: string | null;
      quantity: string;
      unit_symbol: string | null;
      unit_price: string;
      total_price: string;
    }) => ({
      label: i.product_name + (i.variant_name ? ` (${i.variant_name})` : ""),
      qty: parseFloat(i.quantity),
      unit: i.unit_symbol ?? "",
      unitPrice: parseFloat(i.unit_price),
      total: parseFloat(i.total_price),
    }),
  );
  const text = [
    `${tenant.name}`,
    `Ticket #${sale.id.slice(0, 8)} — ${new Date(sale.created_at).toLocaleString("fr-FR")}`,
    `Vendeur : ${sale.vendor_name}`,
    "--------------------------------",
    ...lines.map(
      (l: { label: string; qty: number; unit: string; total: number }) =>
        `${l.label}\n  ${l.qty} ${l.unit}  —  ${l.total.toLocaleString("fr-FR")} ${tenant.currency}`,
    ),
    "--------------------------------",
    `TOTAL : ${parseFloat(sale.total_amount).toLocaleString("fr-FR")} ${tenant.currency}`,
    `Paiement : ${sale.payment_method}${sale.payment_reference ? ` (réf. ${sale.payment_reference})` : ""}`,
    "Merci de votre visite !",
  ].join("\n");
  return { sale, tenant, lines, text };
}
