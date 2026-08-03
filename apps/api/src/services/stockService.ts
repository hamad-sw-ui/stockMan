import { PoolClient } from "pg";
import { HttpError } from "../lib/errors";

/**
 * UUID sentinelle « sans variante » — utilisé UNIQUEMENT pour comparer les lots
 * (stock_batches.variant_id NULL) dans la sélection FEFO. Les niveaux de stock
 * stockent NULL (unicité garantie par l'index d'expression uq_stock_levels).
 */
export const NO_VARIANT = "00000000-0000-0000-0000-000000000000";

export interface StockScope {
  tenantId: string;
  depotId: string;
  productId: string;
  variantId?: string | null;
}

/** Correspondance NULL-safe sur variant_id (IS NOT DISTINCT FROM). */
const VARIANT_MATCH = `(variant_id = $3::uuid OR (variant_id IS NULL AND $3::uuid IS NULL))`;

/** Verrouille et retourne le niveau courant (le crée si absent). */
export async function lockLevel(
  client: PoolClient,
  s: StockScope,
): Promise<number> {
  const variant = s.variantId ?? null;
  await client.query(
    `INSERT INTO stock_levels (product_id, depot_id, variant_id, quantity)
     VALUES ($1,$2,$3,0) ON CONFLICT DO NOTHING`,
    [s.productId, s.depotId, variant],
  );
  const r = await client.query<{ quantity: string }>(
    `SELECT quantity FROM stock_levels
      WHERE product_id=$1 AND depot_id=$2 AND ${VARIANT_MATCH} FOR UPDATE`,
    [s.productId, s.depotId, variant],
  );
  return parseFloat(r.rows[0]?.quantity ?? "0");
}

/** Verrouille la ligne et renvoie quantité + part RÉSERVÉE (E8) — le
 *  disponible à la vente = quantity − reserved_qty (commandes confirmées). */
export async function lockLevelReserved(
  client: PoolClient,
  s: StockScope,
): Promise<{ quantity: number; reserved: number }> {
  const variant = s.variantId ?? null;
  await client.query(
    `INSERT INTO stock_levels (product_id, depot_id, variant_id, quantity)
     VALUES ($1,$2,$3,0) ON CONFLICT DO NOTHING`,
    [s.productId, s.depotId, variant],
  );
  const r = await client.query<{ quantity: string; reserved_qty: string }>(
    `SELECT quantity, reserved_qty FROM stock_levels
      WHERE product_id=$1 AND depot_id=$2 AND ${VARIANT_MATCH} FOR UPDATE`,
    [s.productId, s.depotId, variant],
  );
  return {
    quantity: parseFloat(r.rows[0]?.quantity ?? "0"),
    reserved: parseFloat(r.rows[0]?.reserved_qty ?? "0"),
  };
}

export async function setLevel(
  client: PoolClient,
  s: StockScope,
  newQty: number,
): Promise<void> {
  if (!(newQty >= 0))
    throw HttpError.badRequest(
      "STOCK_NEGATIVE",
      "Le stock ne peut pas devenir négatif.",
    );
  await client.query(
    `UPDATE stock_levels SET quantity=$4, updated_at=now()
      WHERE product_id=$1 AND depot_id=$2 AND ${VARIANT_MATCH}`,
    [s.productId, s.depotId, s.variantId ?? null, newQty],
  );
}

/** Consomme `delta` (sortie) — lève STOCK_INSUFFICIENT si besoin. */
export async function decreaseLevel(
  client: PoolClient,
  s: StockScope,
  delta: number,
) {
  const prev = await lockLevel(client, s);
  const next = prev - delta;
  if (next < -1e-9) {
    throw HttpError.conflict(
      "STOCK_INSUFFICIENT",
      `Stock insuffisant (disponible : ${prev}).`,
      {
        productId: s.productId,
        available: prev,
        requested: delta,
      },
    );
  }
  await setLevel(client, s, Math.max(0, next));
  return { previous: prev, next: Math.max(0, next) };
}

export async function increaseLevel(
  client: PoolClient,
  s: StockScope,
  delta: number,
) {
  const prev = await lockLevel(client, s);
  await setLevel(client, s, prev + delta);
  return { previous: prev, next: prev + delta };
}

export type MovementType =
  | "IN"
  | "OUT"
  | "TRANSFER"
  | "ADJUSTMENT"
  | "SALE"
  | "RETURN"
  | "DAMAGE"
  | "EXPIRED"
  | "VOID"
  | "SUPPLIER_RETURN";

export async function recordMovement(
  client: PoolClient,
  m: StockScope & {
    userId?: string | null;
    type: MovementType;
    quantity: number; // magnitude (unités de base)
    previousStock?: number | null;
    newStock?: number | null;
    reason?: string | null;
    reasonCode?: string | null; // motif codifié d'analyse (E5, ajustements)
    referenceId?: string | null;
    batchId?: string | null; // lot prélevé/crédité (traçabilité E2)
    unitCost?: number | null; // coût/unité de base du flux (valorisation E1)
  },
): Promise<void> {
  await client.query(
    `INSERT INTO stock_movements
       (tenant_id, depot_id, product_id, variant_id, user_id, type, quantity,
        previous_stock, new_stock, reason, reason_code, reference_id, batch_id, unit_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      m.tenantId,
      m.depotId,
      m.productId,
      m.variantId ?? null,
      m.userId ?? null,
      m.type,
      m.quantity,
      m.previousStock ?? null,
      m.newStock ?? null,
      m.reason ?? null,
      m.reasonCode ?? null,
      m.referenceId ?? null,
      m.batchId ?? null,
      m.unitCost ?? null,
    ],
  );
}

/**
 * Consommation FEFO : décrémente les lots en ignorant les lots périmés,
 * ordre : expiration la plus proche d'abord (NULL en dernier), puis réception.
 * Retourne les déductions effectuées (avec coût du lot — base du figeage du
 * coût par ligne de vente) ; lève STOCK_INSUFFICIENT si la somme des lots
 * valides est insuffisante.
 */
export interface FefoDeduction {
  batchId: string;
  batchNumber: string;
  expiryDate: string | null;
  deducted: number;
  unitCost: number;
}

export async function fefoConsume(
  client: PoolClient,
  s: StockScope,
  qtyBase: number,
): Promise<FefoDeduction[]> {
  const r = await client.query<{
    id: string;
    quantity: string;
    batch_number: string;
    expiry_date: string | Date | null;
    unit_cost: number | null;
  }>(
    `SELECT id, quantity, batch_number, expiry_date, unit_cost FROM stock_batches
      WHERE product_id=$1 AND depot_id=$2
        AND COALESCE(variant_id, $3::uuid) = $3::uuid
        AND quantity > 0
      ORDER BY expiry_date ASC NULLS LAST, received_date ASC
      FOR UPDATE`,
    [s.productId, s.depotId, s.variantId ?? NO_VARIANT],
  );
  if (r.rows.length === 0) {
    // Aucun lot géré pour ce produit/dépôt : décrémentation au niveau global.
    return [];
  }
  // Filtrage applicatif des lots valides (portable) : le périmé est exclu,
  // et « tous les lots périmés » est un blocage métier explicite (E2) distinct
  // du cas « produit sans lots ».
  const today = new Date().toISOString().slice(0, 10);
  const valid = r.rows.filter((b) => {
    if (b.expiry_date === null) return true;
    const d =
      b.expiry_date instanceof Date
        ? b.expiry_date
        : new Date(String(b.expiry_date).slice(0, 10));
    return d.toISOString().slice(0, 10) >= today;
  });
  if (valid.length === 0) {
    throw HttpError.conflict(
      "STOCK_BATCHES_EXPIRED",
      "Tous les lots en stock de ce produit sont périmés : vente bloquée. Déclarez la péremption dans la feuille d'inventaire pour remettre le stock à zéro.",
      { productId: s.productId },
    );
  }
  let remaining = qtyBase;
  const deductions: FefoDeduction[] = [];
  for (const batch of valid) {
    if (remaining <= 0) break;
    const available = parseFloat(batch.quantity);
    const take = Math.min(available, remaining);
    await client.query(
      "UPDATE stock_batches SET quantity = quantity - $1 WHERE id=$2",
      [take, batch.id],
    );
    deductions.push({
      batchId: batch.id,
      batchNumber: batch.batch_number,
      expiryDate:
        batch.expiry_date === null
          ? null
          : batch.expiry_date instanceof Date
            ? batch.expiry_date.toISOString().slice(0, 10)
            : String(batch.expiry_date).slice(0, 10),
      deducted: take,
      unitCost: Number(batch.unit_cost) || 0,
    });
    remaining -= take;
  }
  if (remaining > 1e-9) {
    throw HttpError.conflict(
      "STOCK_INSUFFICIENT",
      `Lots insuffisants pour couvrir la demande (manque ${remaining}). Les lots périmés sont exclus de la vente.`,
      { missing: remaining },
    );
  }
  return deductions;
}

/**
 * Remise en stock (retours, annulations) — recrédite le lot d'origine si
 * précisé (traçabilité lot bout-en-bout), puis les niveaux.
 */
export async function restock(
  client: PoolClient,
  s: StockScope,
  qtyBase: number,
  opts: { batchId?: string | null } = {},
) {
  if (opts.batchId) {
    await client.query(
      "UPDATE stock_batches SET quantity = quantity + $2 WHERE id=$1",
      [opts.batchId, qtyBase],
    );
  }
  return increaseLevel(client, s, qtyBase);
}
