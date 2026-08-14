/**
 * Résolveur de codes-barres (C1) — LE point d'entrée d'identification.
 *
 * Ordre de résolution (compat stricte avec l'ancien GET /barcode/:code qui
 * cherchait produit PUIS variante) :
 *   1. code principal produit  (products.barcode — colonne legacy)
 *   2. code principal variante (product_variants.barcode — legacy)
 *   3. registre product_barcodes (alias, dont conditionnements avec unit_id
 *      → facteur de conversion retourné pour pré-remplir la quantité).
 *
 * Le registre est aussi LE garde-fou d'unicité : toute écriture de code
 * (fiche produit/variante, alias, génération, import) passe par
 * `syncPrimaryBarcode` / l'INSERT alias, protégés par UNIQUE(tenant_id, code).
 */

import { query } from "../config/db";
import { HttpError } from "../lib/errors";
import { ean13ChecksumApi } from "../lib/barcode";

export interface BarcodeResolution {
  matched: "product" | "variant" | "alias";
  productId: string;
  productName: string;
  productBarcode: string | null;
  sellingPrice: number;
  purchasePrice: number;
  taxRate: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number;
  requiresSerial: boolean;
  trackBatch: boolean;
  hasVariants: boolean;
  /** Variante résolue (scan direct variante ou alias de variante). */
  variantId: string | null;
  variantName: string | null;
  additionalPrice: number;
  /** Conditionnement résolu (alias portant unit_id) ; facteur vs unité catalogue. */
  unitId: string | null;
  unitSymbol: string | null;
  unitFactor: number;
  /** Métadonnées registre (alias uniquement). */
  aliasId: string | null;
  symbology: string | null;
}

interface ProductBarcodeRow {
  id: string;
  name: string;
  barcode: string | null;
  selling_price: string | number;
  purchase_price: string | number;
  tax_rate: string | number;
  wholesale_price: string | number | null;
  wholesale_min_qty: string | number;
  has_variants: boolean;
  track_batch: boolean;
  requires_serial: boolean;
  unit_base_value: string | number | null;
}

function baseResolution(
  p: ProductBarcodeRow,
  matched: BarcodeResolution["matched"],
): BarcodeResolution {
  return {
    matched,
    productId: p.id,
    productName: p.name,
    productBarcode: p.barcode,
    sellingPrice: Number(p.selling_price),
    purchasePrice: Number(p.purchase_price),
    taxRate: Number(p.tax_rate),
    wholesalePrice:
      p.wholesale_price == null ? null : Number(p.wholesale_price),
    wholesaleMinQty: Number(p.wholesale_min_qty),
    requiresSerial: p.requires_serial,
    trackBatch: p.track_batch,
    hasVariants: p.has_variants,
    variantId: null,
    variantName: null,
    additionalPrice: 0,
    unitId: null,
    unitSymbol: null,
    unitFactor: 1,
    aliasId: null,
    symbology: null,
  };
}

type VariantBarcodeRow = ProductBarcodeRow & {
  variant_id: string;
  variant_name: string;
  additional_price: number | string | null;
};

type AliasBarcodeRow = ProductBarcodeRow & {
  alias_id: string;
  symbology: string;
  code: string;
  variant_id: string | null;
  variant_name: string | null;
  additional_price: number | string | null;
  cond_unit_id: string | null;
  cond_unit_symbol: string | null;
  cond_unit_base_value: number | string | null;
};

const PRODUCT_SELECT = `
  SELECT p.*, un.symbol AS unit_symbol, un.base_value AS unit_base_value
    FROM products p LEFT JOIN units un ON un.id = p.unit_id`;

/** Résout un code scanné → produit (+ variante/unité éventuelles). 404 sinon. */
export async function resolveBarcode(
  tenantId: string,
  codeRaw: string,
): Promise<BarcodeResolution> {
  const code = codeRaw.trim();
  if (!code)
    throw HttpError.notFound(
      "Aucun produit pour ce code-barres.",
      "BARCODE_UNKNOWN",
    );

  // 1. Code principal produit (héritage)
  const prod = await query<ProductBarcodeRow>(
    `${PRODUCT_SELECT}
     WHERE p.tenant_id=$1 AND p.barcode=$2 AND p.archived_at IS NULL LIMIT 1`,
    [tenantId, code],
  );
  if (prod.rows[0]) return baseResolution(prod.rows[0], "product");

  // 2. Code principal variante (héritage)
  const vari = await query<VariantBarcodeRow>(
    `SELECT p.*, un.symbol AS unit_symbol, un.base_value AS unit_base_value,
            v.id AS variant_id, v.name AS variant_name,
            v.additional_price::float AS additional_price
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN units un ON un.id = p.unit_id
      WHERE p.tenant_id=$1 AND v.barcode=$2 AND p.archived_at IS NULL LIMIT 1`,
    [tenantId, code],
  );
  if (vari.rows[0]) {
    const r = vari.rows[0];
    return {
      ...baseResolution(r, "variant"),
      variantId: r.variant_id,
      variantName: r.variant_name,
      additionalPrice: Number(r.additional_price ?? 0),
    };
  }

  // 3. Registre d'alias (unique par tenant/code → au plus une ligne)
  const alias = await query<AliasBarcodeRow>(
    `SELECT pb.id AS alias_id, pb.symbology, pb.code,
            p.*, un.symbol AS unit_symbol, un.base_value AS unit_base_value,
            v.id AS variant_id, v.name AS variant_name,
            v.additional_price::float AS additional_price,
            cu.id AS cond_unit_id, cu.symbol AS cond_unit_symbol,
            cu.base_value::float AS cond_unit_base_value
       FROM product_barcodes pb
       JOIN products p ON p.id = pb.product_id
       LEFT JOIN units un ON un.id = p.unit_id
       LEFT JOIN product_variants v ON v.id = pb.variant_id
       LEFT JOIN units cu ON cu.id = pb.unit_id
      WHERE pb.tenant_id=$1 AND pb.code=$2 AND p.archived_at IS NULL
      LIMIT 1`,
    [tenantId, code],
  );
  if (alias.rows[0]) {
    const r = alias.rows[0];
    const productUnitBase = Number(r.unit_base_value ?? 1) || 1;
    const factor = r.cond_unit_base_value
      ? Number(r.cond_unit_base_value) / productUnitBase
      : 1;
    return {
      ...baseResolution(r, "alias"),
      variantId: r.variant_id ?? null,
      variantName: r.variant_name ?? null,
      additionalPrice: Number(r.additional_price ?? 0),
      unitId: r.cond_unit_id ?? null,
      unitSymbol: r.cond_unit_symbol ?? null,
      unitFactor: Math.round(factor * 1_000_000) / 1_000_000,
      aliasId: r.alias_id,
      symbology: r.symbology,
    };
  }

  throw HttpError.notFound(
    "Aucun produit pour ce code-barres.",
    "BARCODE_UNKNOWN",
  );
}

// ---------------------------------------------------------------------
// Garde d'unicité : qui détient ce code ? (messages 409 qui NOMMENT le tenant)
// ---------------------------------------------------------------------
export interface BarcodeHolder {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
}

/** Cherche le détenteur d'un code (produit, variante ou alias déjà posé).
 *  `exclude` retire la cible en cours d'édition (sinon elle se conflit elle-
 *  même). SQL branché plutôt que « $n IS NULL OR … » : pg-mem n'évalue pas
 *  les prédicats OR sur les requêtes jointes (« lookups on joins »). */
export async function findBarcodeHolder(
  tenantId: string,
  code: string,
  exclude: { productId?: string; variantId?: string } = {},
): Promise<BarcodeHolder | null> {
  // 1. Colonne legacy produits
  const prod = exclude.productId
    ? await query(
        `SELECT id, name FROM products
          WHERE tenant_id=$1 AND barcode=$2 AND archived_at IS NULL AND id <> $3::uuid
          LIMIT 1`,
        [tenantId, code, exclude.productId],
      )
    : await query(
        `SELECT id, name FROM products
          WHERE tenant_id=$1 AND barcode=$2 AND archived_at IS NULL LIMIT 1`,
        [tenantId, code],
      );
  if (prod.rows[0])
    return {
      productId: prod.rows[0].id,
      productName: prod.rows[0].name,
      variantId: null,
      variantName: null,
    };

  // 2. Colonne legacy variantes
  const vari = exclude.variantId
    ? await query(
        `SELECT p.id AS product_id, p.name AS product_name, v.id AS variant_id, v.name AS variant_name
           FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE p.tenant_id=$1 AND v.barcode=$2 AND p.archived_at IS NULL AND v.id <> $3::uuid
          LIMIT 1`,
        [tenantId, code, exclude.variantId],
      )
    : await query(
        `SELECT p.id AS product_id, p.name AS product_name, v.id AS variant_id, v.name AS variant_name
           FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE p.tenant_id=$1 AND v.barcode=$2 AND p.archived_at IS NULL LIMIT 1`,
        [tenantId, code],
      );
  if (vari.rows[0])
    return {
      productId: vari.rows[0].product_id,
      productName: vari.rows[0].product_name,
      variantId: vari.rows[0].variant_id,
      variantName: vari.rows[0].variant_name,
    };

  // 3. Registre d'alias — l'exclusion vise la cible éditée :
  //    - produit : ses lignes « entières » (variant NULL) uniquement, un code
  //      porté par UNE DE SES variantes reste un conflit ;
  //    - variante : ses propres lignes.
  const aliasBase = `
    SELECT pb.product_id, p.name AS product_name, pb.variant_id, v.name AS variant_name
      FROM product_barcodes pb
      JOIN products p ON p.id = pb.product_id
      LEFT JOIN product_variants v ON v.id = pb.variant_id
     WHERE pb.tenant_id=$1 AND pb.code=$2 AND p.archived_at IS NULL`;
  const alias = exclude.variantId
    ? await query(`${aliasBase} AND NOT (pb.variant_id = $3::uuid) LIMIT 1`, [
        tenantId,
        code,
        exclude.variantId,
      ])
    : exclude.productId
      ? await query(
          `${aliasBase} AND NOT (pb.product_id = $3::uuid AND pb.variant_id IS NULL) LIMIT 1`,
          [tenantId, code, exclude.productId],
        )
      : await query(`${aliasBase} LIMIT 1`, [tenantId, code]);
  if (alias.rows[0])
    return {
      productId: alias.rows[0].product_id,
      productName: alias.rows[0].product_name,
      variantId: alias.rows[0].variant_id,
      variantName: alias.rows[0].variant_name,
    };
  return null;
}

/** 409 homogène et parlant, quel que soit le point d'écriture. */
export function throwBarcodeTaken(holder: BarcodeHolder, code: string): never {
  const v = holder.variantName ? ` (variante « ${holder.variantName} »)` : "";
  throw HttpError.conflict(
    "BARCODE_TAKEN",
    `Code-barres ${code} déjà utilisé par « ${holder.productName} »${v}.`,
    { productId: holder.productId, variantId: holder.variantId },
  );
}

// ---------------------------------------------------------------------
// Write-through colonne legacy ⇄ registre (is_primary)
// ---------------------------------------------------------------------

/** Interface minimale : un client transactionnel (PoolClient) s'y affecte
 *  directement ; le helper `query` module (générique) passe via l'adaptateur
 *  `poolWriter` ci-dessous (import CSV = écritures hors transaction). */
export interface BarcodeWriter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/** Écrivain sur le pool global, pour les flux qui écrivent ligne à ligne
 *  sans transaction englobante (ex. import CSV). */
export const poolWriter: BarcodeWriter = {
  query: (text, params) => query(text, params),
};

/** Synchronise le code principal d'une cible (produit ou variante) dans le
 *  registre : retrait des anciens « is_primary » de cette cible puis pose du
 *  nouveau. Idempotent. À appeler DANS la transaction de l'écriture métier. */
export async function syncPrimaryBarcode(
  client: BarcodeWriter,
  args: {
    tenantId: string;
    productId: string;
    variantId?: string | null;
    code: string;
    symbology: string;
    source?: "REGISTERED" | "IMPORTED" | "GENERATED" | "SUPPLIER";
    userId?: string | null;
  },
): Promise<void> {
  const variantId = args.variantId ?? null;
  // (variant_id IS NULL-safe : pg-mem ne connaît pas « IS NOT DISTINCT FROM »)
  await client.query(
    `DELETE FROM product_barcodes
      WHERE tenant_id=$1 AND product_id=$2 AND is_primary
        AND code <> $3
        AND ((variant_id IS NULL AND $4::uuid IS NULL) OR variant_id = $4::uuid)`,
    [args.tenantId, args.productId, args.code, variantId],
  );
  await client.query(
    `INSERT INTO product_barcodes (tenant_id, product_id, variant_id, code, symbology, source, is_primary, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,true,$7)
     ON CONFLICT (tenant_id, code) DO NOTHING`,
    [
      args.tenantId,
      args.productId,
      variantId,
      args.code,
      args.symbology,
      args.source ?? "REGISTERED",
      args.userId ?? null,
    ],
  );
  // Si le code existait déjà comme alias de la même cible : le promouvoir.
  await client.query(
    `UPDATE product_barcodes SET is_primary=true
      WHERE tenant_id=$1 AND code=$2 AND product_id=$3
        AND ((variant_id IS NULL AND $4::uuid IS NULL) OR variant_id = $4::uuid)`,
    [args.tenantId, args.code, args.productId, variantId],
  );
}

/** Retire du registre le code principal d'une cible (code legacy retiré). */
export async function dropPrimaryBarcode(
  client: BarcodeWriter,
  args: { tenantId: string; productId: string; variantId?: string | null },
): Promise<void> {
  await client.query(
    `DELETE FROM product_barcodes
      WHERE tenant_id=$1 AND product_id=$2 AND is_primary
        AND ((variant_id IS NULL AND $3::uuid IS NULL) OR variant_id = $3::uuid)`,
    [args.tenantId, args.productId, args.variantId ?? null],
  );
}

// ---------------------------------------------------------------------
// C2 — Génération interne EAN-13 (plage GS1 « magasin » 20–29)
// ---------------------------------------------------------------------

/** Préfixe magasin du tenant (config « barcode_internal_prefix », défaut 20). */
export async function tenantBarcodePrefix(tenantId: string): Promise<string> {
  const r = await query<{ value: string }>(
    `SELECT value FROM tenant_configs
      WHERE tenant_id=$1 AND key='barcode_internal_prefix'`,
    [tenantId],
  );
  const v = (r.rows[0]?.value ?? "20").trim();
  return /^2[0-9]$/.test(v) ? v : "20";
}

/** Prochaine valeur de séquence (atomique : ligne verrouillée par l'upsert). */
async function nextSequenceValue(
  client: BarcodeWriter,
  tenantId: string,
  prefix: string,
): Promise<number> {
  const r = await client.query(
    `INSERT INTO barcode_sequences (tenant_id, prefix, next_value)
     VALUES ($1,$2,2)
     ON CONFLICT (tenant_id, prefix)
     DO UPDATE SET next_value = barcode_sequences.next_value + 1
     RETURNING next_value`,
    [tenantId, prefix],
  );
  return Number(r.rows[0]!.next_value) - 1; // valeur effectivement consommée
}

/** Le code PP + 10 chiffres + clé est-il libre PARTOUT pour ce tenant ? */
async function codeFullyFree(
  client: BarcodeWriter,
  tenantId: string,
  code: string,
): Promise<boolean> {
  const tables = [
    "SELECT 1 FROM product_barcodes WHERE tenant_id=$1 AND code=$2 LIMIT 1",
    "SELECT 1 FROM products WHERE tenant_id=$1 AND barcode=$2 LIMIT 1",
    `SELECT 1 FROM product_variants v JOIN products p ON p.id=v.product_id
      WHERE p.tenant_id=$1 AND v.barcode=$2 LIMIT 1`,
  ];
  for (const sql of tables) {
    const r = await client.query(sql, [tenantId, code]);
    if (r.rows[0]) return false;
  }
  return true;
}

/** Tire un EAN-13 interne libre : PP + 10 chiffres de séquence + contrôle ;
 *  re-tirage automatique en cas de collision (données pré-existantes). */
export async function drawInternalBarcode(
  client: BarcodeWriter,
  tenantId: string,
  prefix: string,
): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const n = await nextSequenceValue(client, tenantId, prefix);
    const body = `${prefix}${String(n).padStart(10, "0")}`; // 12 chiffres
    const code = `${body}${ean13ChecksumApi(body)}`;
    if (await codeFullyFree(client, tenantId, code)) return code;
  }
  throw HttpError.conflict(
    "BARCODE_GENERATE_EXHAUSTED",
    "Tirage impossible : modifiez le préfixe magasin (réglages) puis réessayez.",
  );
}
