import { PoolClient } from "pg";
import { HttpError } from "../lib/errors";
import { increaseLevel, NO_VARIANT, recordMovement } from "./stockService";
import { applyInflowCost } from "./costingService";
import { assertDepotNotFrozen } from "./inventoryService";
import { registerSerials } from "./serialService";

/**
 * Moteur unique d'entrée de marchandises (E1/E2/E4) : utilisé par la
 * réception libre (`/api/stock/receipts`) comme par la réception rattachée
 * à un bon de commande (`/api/purchase-orders/:id/receive`).
 * Garanties : CUMP repondéré AVANT la hausse physique, lot créé/fusionné à
 * coût réel pondéré, mouvement IN tracé, coût d'achat catalogue rafraîchi.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ReceiptLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number; // en unité saisie (convertie via unitId)
  unitId?: string | null;
  unitCost: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
  poItemId?: string | null; // rattachement ligne de commande (E4)
  discrepancyReason?: string | null; // motif d'écart codifié (E4)
  serials?: string[] | null; // E8 — IMEI/n° de série (produit sérialisé)
}

export interface ReceiptLineResult {
  productId: string;
  variantId: string | null;
  baseQty: number;
  inflowCost: number;
  batchId: string | null;
  poItemId: string | null;
}

/** Conversion unité → facteur base (ratio d'unités catalogue). */
export async function unitFactor(
  client: PoolClient,
  tenantId: string,
  productId: string,
  unitId?: string | null,
): Promise<{ factor: number; resolvedUnitId: string | null }> {
  const prod = await client.query<{ unit_id: string | null }>(
    "SELECT unit_id FROM products WHERE id=$1 AND tenant_id=$2",
    [productId, tenantId],
  );
  if (!prod.rows[0])
    throw HttpError.badRequest("PRODUCT_UNKNOWN", "Produit introuvable.");
  if (!unitId || unitId === prod.rows[0].unit_id)
    return { factor: 1, resolvedUnitId: unitId ?? prod.rows[0].unit_id };
  const units = await client.query<{ id: string; base_value: string }>(
    "SELECT id, base_value FROM units WHERE tenant_id=$1 AND (id=$2 OR id=$3)",
    [
      tenantId,
      unitId,
      prod.rows[0].unit_id ?? "00000000-0000-0000-0000-000000000000",
    ],
  );
  const saleU = units.rows.find((r) => r.id === unitId);
  const baseU = units.rows.find((r) => r.id === prod.rows[0]!.unit_id);
  if (!saleU) throw HttpError.badRequest("UNIT_UNKNOWN", "Unité inconnue.");
  const factor = baseU
    ? parseFloat(saleU.base_value) / parseFloat(baseU.base_value)
    : parseFloat(saleU.base_value);
  return { factor, resolvedUnitId: unitId };
}

/** Traite toutes les lignes d'une réception (transaction appelante). */
export async function receiveReceiptItems(
  client: PoolClient,
  args: {
    tenantId: string;
    depotId: string;
    userId: string;
    supplierId?: string | null;
    receiptId: string;
    movementReason: string;
    items: ReceiptLineInput[];
  },
): Promise<{ totalCost: number; lines: ReceiptLineResult[] }> {
  const { tenantId, depotId, userId, receiptId } = args;
  // Gel inventaire (E5) : aucune entrée pendant un comptage « gelé ».
  await assertDepotNotFrozen(client, tenantId, depotId);
  let totalCost = 0;
  const lines: ReceiptLineResult[] = [];

  for (const item of args.items) {
    const { factor } = await unitFactor(
      client,
      tenantId,
      item.productId,
      item.unitId,
    );
    const baseQty = round2(item.quantity * factor);
    if (baseQty <= 0)
      throw HttpError.badRequest(
        "QUANTITY_INVALID",
        "Quantité convertie invalide.",
      );
    totalCost = round2(totalCost + baseQty * item.unitCost);

    // Gestion par lot obligatoire (E2) : un produit tracé exige un numéro
    // de lot à chaque entrée en stock.
    const prod = await client.query<{
      purchase_price: number;
      track_batch: boolean;
      requires_serial: boolean;
    }>(
      "SELECT purchase_price::float, track_batch, requires_serial FROM products WHERE id=$1 AND tenant_id=$2",
      [item.productId, tenantId],
    );
    if (prod.rows[0]?.track_batch && !item.batchNumber) {
      throw HttpError.badRequest(
        "BATCH_REQUIRED",
        "Ce produit est géré par lots : le numéro de lot est obligatoire à la réception.",
        { productId: item.productId },
      );
    }
    // Sérialisation (E8) : réception à l'unité de base, quantité entière,
    // un numéro de série UNIQUE par unité reçue.
    let serials: string[] | null = null;
    if (prod.rows[0]?.requires_serial) {
      if (factor !== 1)
        throw HttpError.badRequest(
          "SERIAL_BASE_UNIT_ONLY",
          "Produit sérialisé : réception à l'unité de base uniquement.",
          { productId: item.productId },
        );
      if (!Number.isInteger(item.quantity))
        throw HttpError.badRequest(
          "SERIAL_QTY_INTEGER",
          "Produit sérialisé : quantité entière attendue (une par numéro).",
        );
      serials = (item.serials ?? []).map((s) => s.trim()).filter(Boolean);
      if (serials.length !== Math.round(baseQty))
        throw HttpError.badRequest(
          "SERIAL_COUNT_MISMATCH",
          `Produit sérialisé : ${Math.round(baseQty)} numéro(s) de série attendu(s), ${serials.length} fourni(s).`,
          { productId: item.productId },
        );
      if (new Set(serials).size !== serials.length)
        throw HttpError.badRequest(
          "SERIAL_DUP_IN_LINE",
          "Un même numéro de série apparaît deux fois dans la ligne.",
        );
    }
    const inflowCost =
      item.unitCost > 0 ? item.unitCost : (prod.rows[0]?.purchase_price ?? 0);

    // CUMP (E1) : repondération AVANT la hausse physique des niveaux.
    await applyInflowCost(
      client,
      tenantId,
      item.productId,
      baseQty,
      inflowCost,
    );

    // Lot : upsert manuel sur (produit, dépôt, numéro, variante) avec coût
    // du lot pondéré (le lot mémorise son coût réel — FEFO facturé).
    let batchId: string | null = null;
    if (item.batchNumber || item.expiryDate) {
      const batchNumber = item.batchNumber ?? `RCV-${receiptId.slice(0, 8)}`;
      const existing = await client.query<{
        id: string;
        quantity: number;
        unit_cost: number;
      }>(
        `SELECT id, quantity::float, unit_cost::float FROM stock_batches
          WHERE product_id=$1 AND depot_id=$2 AND batch_number=$3
            AND COALESCE(variant_id, $4::uuid) = $4::uuid
          FOR UPDATE`,
        [item.productId, depotId, batchNumber, item.variantId ?? NO_VARIANT],
      );
      if (existing.rows[0]) {
        const oldQty = Number(existing.rows[0].quantity) || 0;
        const oldCost = Number(existing.rows[0].unit_cost) || 0;
        const tot = oldQty + baseQty;
        const mergedCost =
          tot > 1e-9
            ? round2((oldQty * oldCost + baseQty * inflowCost) / tot)
            : inflowCost;
        await client.query(
          "UPDATE stock_batches SET quantity = quantity + $2, unit_cost=$3 WHERE id=$1",
          [existing.rows[0].id, baseQty, mergedCost],
        );
        batchId = existing.rows[0].id;
      } else {
        const batch = await client.query<{ id: string }>(
          `INSERT INTO stock_batches (product_id, variant_id, depot_id, supplier_id, batch_number, quantity, expiry_date, unit_cost)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            item.productId,
            item.variantId ?? null,
            depotId,
            args.supplierId ?? null,
            batchNumber,
            baseQty,
            item.expiryDate ?? null,
            inflowCost,
          ],
        );
        batchId = batch.rows[0]!.id;
      }
    }

    await client.query(
      `INSERT INTO stock_receipt_items (receipt_id, product_id, variant_id, batch_id, base_qty, unit_cost, po_item_id, discrepancy_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        receiptId,
        item.productId,
        item.variantId ?? null,
        batchId,
        baseQty,
        item.unitCost,
        item.poItemId ?? null,
        item.discrepancyReason ?? null,
      ],
    );

    const scope = {
      tenantId,
      depotId,
      productId: item.productId,
      variantId: item.variantId ?? null,
    };
    const lvl = await increaseLevel(client, scope, baseQty);
    await recordMovement(client, {
      ...scope,
      userId,
      type: "IN",
      quantity: baseQty,
      previousStock: lvl.previous,
      newStock: lvl.next,
      reason: args.movementReason,
      referenceId: receiptId,
      batchId,
      unitCost: inflowCost,
    });
    // E8 — numéros de série : enregistrés EN STOCK sur le dépôt de
    // réception (doublons refusés avec la liste à l'appui).
    if (serials && serials.length > 0)
      await registerSerials(client, {
        tenantId,
        depotId,
        productId: item.productId,
        variantId: item.variantId ?? null,
        serials,
      });
    // Le coût d'achat catalogue suit la dernière réception
    if (item.unitCost > 0) {
      await client.query(
        "UPDATE products SET purchase_price=$2, updated_at=now() WHERE id=$1",
        [item.productId, item.unitCost],
      );
    }
    lines.push({
      productId: item.productId,
      variantId: item.variantId ?? null,
      baseQty,
      inflowCost,
      batchId,
      poItemId: item.poItemId ?? null,
    });
  }
  return { totalCost, lines };
}
