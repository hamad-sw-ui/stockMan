import { PoolClient } from "pg";
import { query, withTransaction } from "../config/db";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import { AuthUser } from "../middleware/auth";
import { resolveDepot } from "../lib/resolveDepot";
import { receiveReceiptItems, unitFactor } from "./receiptService";
import { decreaseLevel, NO_VARIANT, recordMovement } from "./stockService";
import { currentAvgCost } from "./costingService";
import { assertDepotNotFrozen } from "./inventoryService";

/**
 * Approvisionnement par commandes (E4) : cycle du bon de commande
 *   BROUILLON (DRAFT) → ENVOYÉE (SENT) → RÉCEPTION_PARTIELLE
 *   → CLÔTURÉE (CLOSED) | ANNULÉE (CANCELLED, brouillon seulement).
 * La réception rattachée passe par le moteur de réception unique
 * (receiptService) : coûts réels et lots strictement identiques à une
 * réception libre, avec en plus reliquats, motifs d'écart codifiés et
 * mesure des délais (prévu/réel → OTIF).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export const DISCREPANCY_REASONS = [
  "NONE",
  "SHORT_DELIVERY",
  "DAMAGED",
  "WRONG_PRODUCT",
  "QUALITY",
  "PRICE_CHANGE",
  "OTHER",
] as const;
export const CLOSE_REASONS = [
  "DELIVERED",
  "SUPPLIER_SHORTAGE",
  "CANCELLED_BY_SUPPLIER",
  "PRICE_DISPUTE",
  "OTHER",
] as const;
export const RETURN_REASONS = [
  "DAMAGED",
  "EXPIRED",
  "WRONG_PRODUCT",
  "QUALITY",
  "OVERDELIVERY",
  "OTHER",
] as const;

export interface PoItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number; // unités de base
  unitCost: number; // coût négocié par unité de base
}

export interface PoInput {
  supplierId: string;
  depotId?: string;
  reference?: string | null;
  expectedAt?: string | null; // YYYY-MM-DD
  note?: string | null;
  items: PoItemInput[];
}

// ============================== CRÉATION (DRAFT) ============================
export async function createPurchaseOrder(user: AuthUser, input: PoInput) {
  const depotId = resolveDepot(user, input.depotId);
  return withTransaction(async (client) => {
    const sup = await client.query<{
      id: string;
      default_lead_time_days: number;
    }>(
      "SELECT id, default_lead_time_days FROM suppliers WHERE id=$1 AND tenant_id=$2",
      [input.supplierId, user.tenantId],
    );
    if (!sup.rows[0])
      throw HttpError.badRequest(
        "SUPPLIER_UNKNOWN",
        "Fournisseur introuvable.",
      );

    // Livraison prévue : défaut = aujourd'hui + délai habituel du fournisseur.
    let expectedAt = input.expectedAt ?? null;
    if (!expectedAt) {
      const lead = sup.rows[0].default_lead_time_days ?? 3;
      expectedAt = new Date(Date.now() + lead * 86_400_000)
        .toISOString()
        .slice(0, 10);
    }

    const po = await client.query<{ id: string }>(
      `INSERT INTO purchase_orders (tenant_id, supplier_id, depot_id, reference, expected_at, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        user.tenantId,
        input.supplierId,
        depotId,
        input.reference ?? null,
        expectedAt,
        input.note ?? null,
        user.id,
      ],
    );
    const poId = po.rows[0]!.id;
    for (const item of input.items) {
      const p = await client.query(
        "SELECT 1 FROM products WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL",
        [item.productId, user.tenantId],
      );
      if (!p.rows[0])
        throw HttpError.badRequest(
          "PRODUCT_UNKNOWN",
          `Produit introuvable ou archivé (${item.productId}).`,
        );
      if (item.quantity <= 0)
        throw HttpError.badRequest(
          "QUANTITY_INVALID",
          "La quantité commandée doit être positive.",
        );
      await client.query(
        `INSERT INTO purchase_order_items (po_id, product_id, variant_id, quantity, unit_cost)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          poId,
          item.productId,
          item.variantId ?? null,
          item.quantity,
          item.unitCost,
        ],
      );
    }
    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "PURCHASE_ORDER",
        entity: "purchase_order",
        entityId: poId,
        depotId,
        newState: { status: "DRAFT", lines: input.items.length },
      },
      client,
    );
    return purchaseOrderById(client, user.tenantId, poId);
  });
}

// ================================ DÉTAIL ====================================
export async function purchaseOrderById(
  client: PoolClient,
  tenantId: string,
  poId: string,
) {
  const po = await client.query(
    `SELECT po.*, s.name AS supplier_name, s.default_lead_time_days,
            d.name AS depot_name, usr.name AS created_by_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN depots d ON d.id = po.depot_id
       LEFT JOIN users usr ON usr.id = po.created_by
      WHERE po.id=$1 AND po.tenant_id=$2`,
    [poId, tenantId],
  );
  if (!po.rows[0]) throw HttpError.notFound("Commande introuvable.");
  const items = await client.query(
    `SELECT i.*, p.name AS product_name, v.name AS variant_name
       FROM purchase_order_items i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN product_variants v ON v.id = i.variant_id
      WHERE i.po_id=$1 ORDER BY i.id`,
    [poId],
  );
  const lines = items.rows.map((r) => {
    const ordered = parseFloat(r.quantity);
    const received = parseFloat(r.received_qty);
    return {
      ...r,
      quantity: ordered,
      received_qty: received,
      remaining_qty: Math.max(0, round2(ordered - received)),
      unit_cost: parseFloat(r.unit_cost),
    };
  });
  const rec = await client.query<{ n: string; total: string }>(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(i.base_qty*i.unit_cost),0)::float AS total
       FROM stock_receipts r JOIN stock_receipt_items i ON i.receipt_id=r.id
      WHERE r.purchase_order_id=$1`,
    [poId],
  );
  return {
    ...po.rows[0],
    items: lines,
    receipts_count: parseInt(rec.rows[0]!.n, 10),
    received_value: parseFloat(rec.rows[0]!.total),
  };
}

// ============================ TRANSITIONS DE STATUT =========================
async function lockPo(client: PoolClient, tenantId: string, poId: string) {
  const r = await client.query<{
    id: string;
    status: string;
    depot_id: string;
    supplier_id: string;
    reference: string | null;
    expected_at: string | Date | null;
  }>(
    `SELECT id, status, depot_id, supplier_id, reference, expected_at
       FROM purchase_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
    [poId, tenantId],
  );
  if (!r.rows[0]) throw HttpError.notFound("Commande introuvable.");
  return r.rows[0];
}

export async function sendPurchaseOrder(user: AuthUser, poId: string) {
  return withTransaction(async (client) => {
    const po = await lockPo(client, user.tenantId, poId);
    if (po.status !== "DRAFT")
      throw HttpError.conflict(
        "PO_NOT_DRAFT",
        "Seule une commande brouillon peut être envoyée.",
      );
    await client.query(
      "UPDATE purchase_orders SET status='SENT', sent_at=now(), updated_at=now() WHERE id=$1",
      [poId],
    );
    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "PURCHASE_ORDER",
        entity: "purchase_order",
        entityId: poId,
        depotId: po.depot_id,
        previousState: { status: "DRAFT" },
        newState: { status: "SENT" },
      },
      client,
    );
    return { status: "SENT" };
  });
}

export interface PoReceiptLineInput {
  poItemId: string;
  quantity: number; // en unité saisie
  unitId?: string | null;
  discrepancyReason?: (typeof DISCREPANCY_REASONS)[number] | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  serials?: string[] | null; // E8 — IMEI/n° de série (produit sérialisé)
}

/** Réception rattachée — partielle possible : avance les compteurs ligne par
 *  ligne, enregistre les motifs d'écart et recalcule le statut (reliquat
 *  visible). Clôture automatique quand tout est livré. */
export async function receivePurchaseOrder(
  user: AuthUser,
  poId: string,
  input: {
    reference?: string | null;
    note?: string | null;
    items: PoReceiptLineInput[];
  },
) {
  return withTransaction(async (client) => {
    const po = await lockPo(client, user.tenantId, poId);
    if (po.status !== "SENT" && po.status !== "PARTIALLY_RECEIVED")
      throw HttpError.conflict(
        "PO_NOT_RECEIVABLE",
        "Seule une commande envoyée (ou déjà partiellement réceptionnée) peut recevoir une livraison.",
      );

    // Validation + conversion de chaque ligne AVANT toute écriture stock
    const prepared: Array<{
      poItemId: string;
      productId: string;
      variantId: string | null;
      baseQty: number;
      unitId: string | null;
      quantity: number;
      unitCost: number;
      discrepancyReason: string | null;
      batchNumber: string | null;
      expiryDate: string | null;
      serials: string[] | null;
    }> = [];
    for (const line of input.items) {
      const it = await client.query<{
        id: string;
        product_id: string;
        variant_id: string | null;
        quantity: string;
        received_qty: string;
        unit_cost: string;
      }>(
        `SELECT id, product_id, variant_id, quantity, received_qty, unit_cost
           FROM purchase_order_items WHERE id=$1 AND po_id=$2 FOR UPDATE`,
        [line.poItemId, poId],
      );
      const poItem = it.rows[0];
      if (!poItem)
        throw HttpError.badRequest(
          "PO_ITEM_UNKNOWN",
          "Ligne de commande inconnue pour ce bon.",
        );
      const { factor } = await unitFactor(
        client,
        user.tenantId,
        poItem.product_id,
        line.unitId,
      );
      const baseQty = round2(line.quantity * factor);
      if (baseQty <= 0)
        throw HttpError.badRequest(
          "QUANTITY_INVALID",
          "Quantité convertie invalide.",
        );
      const remaining = round2(
        parseFloat(poItem.quantity) - parseFloat(poItem.received_qty),
      );
      if (baseQty > remaining + 1e-9)
        throw HttpError.conflict(
          "PO_OVER_RECEIPT",
          `Sur-réception refusée : reliquat ${remaining} sur cette ligne, vous saisissez ${baseQty}. Ajustez la quantité ou clôturez la commande.`,
          { poItemId: line.poItemId, remaining, received: baseQty },
        );
      const short = remaining - baseQty > 1e-9;
      prepared.push({
        poItemId: poItem.id,
        productId: poItem.product_id,
        variantId: poItem.variant_id,
        baseQty,
        unitId: line.unitId ?? null,
        quantity: line.quantity,
        unitCost: parseFloat(poItem.unit_cost),
        discrepancyReason:
          line.discrepancyReason ?? (short ? "SHORT_DELIVERY" : null),
        batchNumber: line.batchNumber ?? null,
        expiryDate: line.expiryDate ?? null,
        serials: line.serials ?? null,
      });
    }

    const rec = await client.query<{ id: string }>(
      `INSERT INTO stock_receipts (tenant_id, depot_id, supplier_id, received_by, reference, note, purchase_order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        user.tenantId,
        po.depot_id,
        po.supplier_id,
        user.id,
        input.reference ?? po.reference,
        input.note ?? `Réception commande ${po.reference ?? poId.slice(0, 8)}`,
        poId,
      ],
    );
    const receiptId = rec.rows[0]!.id;
    const { totalCost } = await receiveReceiptItems(client, {
      tenantId: user.tenantId,
      depotId: po.depot_id,
      userId: user.id,
      supplierId: po.supplier_id,
      receiptId,
      movementReason: `Réception commande ${po.reference ?? poId.slice(0, 8)}`,
      items: prepared.map((p) => ({
        productId: p.productId,
        variantId: p.variantId,
        quantity: p.quantity,
        unitId: p.unitId,
        unitCost: p.unitCost,
        batchNumber: p.batchNumber,
        expiryDate: p.expiryDate,
        poItemId: p.poItemId,
        discrepancyReason: p.discrepancyReason,
        serials: p.serials,
      })),
    });
    for (const p of prepared) {
      await client.query(
        "UPDATE purchase_order_items SET received_qty = received_qty + $2 WHERE id=$1",
        [p.poItemId, p.baseQty],
      );
    }

    // Statut : clôture automatique quand toutes les lignes sont livrées
    const rest = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM purchase_order_items
        WHERE po_id=$1 AND received_qty < quantity - 0.0000001`,
      [poId],
    );
    const fully = (rest.rows[0]?.n ?? 0) === 0;
    const nextStatus = fully ? "CLOSED" : "PARTIALLY_RECEIVED";
    await client.query(
      `UPDATE purchase_orders SET status=$2, first_received_at=COALESCE(first_received_at, now()),
              close_reason=CASE WHEN $2='CLOSED' THEN 'DELIVERED' ELSE close_reason END,
              closed_at=CASE WHEN $2='CLOSED' THEN now() ELSE closed_at END,
              updated_at=now()
        WHERE id=$1`,
      [poId, nextStatus],
    );
    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "PURCHASE_ORDER",
        entity: "purchase_order",
        entityId: poId,
        depotId: po.depot_id,
        newState: { status: nextStatus, receiptId, totalCost },
      },
      client,
    );
    return { receiptId, totalCost, status: nextStatus };
  });
}

/** Clôture manuelle : acte le reliquat restant comme définitif (motif codifié). */
export async function closePurchaseOrder(
  user: AuthUser,
  poId: string,
  reason: (typeof CLOSE_REASONS)[number],
) {
  return withTransaction(async (client) => {
    const po = await lockPo(client, user.tenantId, poId);
    if (po.status !== "SENT" && po.status !== "PARTIALLY_RECEIVED")
      throw HttpError.conflict(
        "PO_NOT_CLOSABLE",
        "Seule une commande envoyée ou partiellement réceptionnée peut être clôturée.",
      );
    const backorder = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(quantity - received_qty),0)::float AS total
         FROM purchase_order_items WHERE po_id=$1`,
      [poId],
    );
    await client.query(
      `UPDATE purchase_orders SET status='CLOSED', close_reason=$2, closed_at=now(), updated_at=now()
        WHERE id=$1`,
      [poId, reason],
    );
    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "PURCHASE_ORDER",
        entity: "purchase_order",
        entityId: poId,
        depotId: po.depot_id,
        newState: {
          status: "CLOSED",
          closeReason: reason,
          backorderQty: parseFloat(backorder.rows[0]!.total),
        },
      },
      client,
    );
    return {
      status: "CLOSED",
      backorderQty: parseFloat(backorder.rows[0]!.total),
    };
  });
}

export async function cancelPurchaseOrder(user: AuthUser, poId: string) {
  return withTransaction(async (client) => {
    const po = await lockPo(client, user.tenantId, poId);
    if (po.status !== "DRAFT")
      throw HttpError.conflict(
        "PO_NOT_DRAFT",
        "Seul un brouillon peut être annulé ; une commande envoyée se clôture (motif).",
      );
    await client.query(
      "UPDATE purchase_orders SET status='CANCELLED', updated_at=now() WHERE id=$1",
      [poId],
    );
    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "PURCHASE_ORDER",
        entity: "purchase_order",
        entityId: poId,
        depotId: po.depot_id,
        previousState: { status: "DRAFT" },
        newState: { status: "CANCELLED" },
      },
      client,
    );
    return { status: "CANCELLED" };
  });
}

// ============================ RETOUR FOURNISSEUR ============================
export interface SupplierReturnInput {
  supplierId: string;
  depotId?: string;
  receiptId?: string | null;
  reason: (typeof RETURN_REASONS)[number];
  note?: string | null;
  items: Array<{
    productId: string;
    variantId?: string | null;
    quantity: number; // en unité saisie
    unitId?: string | null;
    batchId?: string | null; // sinon allocation FEFO (périmés inclus : on renvoie
    // aussi les lots périmés — c'est justement l'usage du retour fournisseur)
  }>;
}

/** Retour fournisseur valorisé au COÛT RÉEL DU LOT renvoyé (E4) : sortie du
 *  stock (les sorties ne repondèrent pas le CUMP), mouvement SUPPLIER_RETURN
 *  par prélevement de lot, total d'avoir calculé. */
export async function createSupplierReturn(
  user: AuthUser,
  input: SupplierReturnInput,
) {
  const depotId = resolveDepot(user, input.depotId);
  return withTransaction(async (client) => {
    // Gel inventaire (E5) : le retour sort du stock du dépôt.
    await assertDepotNotFrozen(client, user.tenantId, depotId);
    const sup = await client.query(
      "SELECT 1 FROM suppliers WHERE id=$1 AND tenant_id=$2",
      [input.supplierId, user.tenantId],
    );
    if (!sup.rows[0])
      throw HttpError.badRequest(
        "SUPPLIER_UNKNOWN",
        "Fournisseur introuvable.",
      );
    if (input.receiptId) {
      const r = await client.query(
        "SELECT 1 FROM stock_receipts WHERE id=$1 AND tenant_id=$2",
        [input.receiptId, user.tenantId],
      );
      if (!r.rows[0])
        throw HttpError.badRequest(
          "RECEIPT_UNKNOWN",
          "Réception de rattachement introuvable.",
        );
    }

    const ret = await client.query<{ id: string }>(
      `INSERT INTO supplier_returns (tenant_id, supplier_id, depot_id, receipt_id, reason, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        user.tenantId,
        input.supplierId,
        depotId,
        input.receiptId ?? null,
        input.reason,
        input.note ?? null,
        user.id,
      ],
    );
    const returnId = ret.rows[0]!.id;
    let totalCost = 0;

    for (const item of input.items) {
      const { factor } = await unitFactor(
        client,
        user.tenantId,
        item.productId,
        item.unitId,
      );
      const baseQty = round2(item.quantity * factor);
      if (baseQty <= 0)
        throw HttpError.badRequest(
          "QUANTITY_INVALID",
          "Quantité convertie invalide.",
        );
      const scope = {
        tenantId: user.tenantId,
        depotId,
        productId: item.productId,
        variantId: item.variantId ?? null,
      };
      const avg = await currentAvgCost(client, user.tenantId, item.productId);

      // Allocation : lot explicite, sinon FEFO large (périmés inclus).
      const allocs: Array<{
        batchId: string | null;
        qty: number;
        cost: number;
      }> = [];
      if (item.batchId) {
        const b = await client.query<{
          id: string;
          quantity: string;
          unit_cost: string;
        }>(
          `SELECT id, quantity, unit_cost FROM stock_batches
            WHERE id=$1 AND product_id=$2 AND depot_id=$3
              AND COALESCE(variant_id,$4::uuid)=$4::uuid FOR UPDATE`,
          [item.batchId, item.productId, depotId, item.variantId ?? NO_VARIANT],
        );
        const batch = b.rows[0];
        if (!batch)
          throw HttpError.badRequest(
            "BATCH_UNKNOWN",
            "Lot introuvable pour ce produit/dépôt.",
          );
        if (parseFloat(batch.quantity) < baseQty)
          throw HttpError.conflict(
            "STOCK_INSUFFICIENT",
            `Lot insuffisant (disponible : ${parseFloat(batch.quantity)}).`,
          );
        await client.query(
          "UPDATE stock_batches SET quantity=quantity-$2 WHERE id=$1",
          [item.batchId, baseQty],
        );
        allocs.push({
          batchId: item.batchId,
          qty: baseQty,
          cost: parseFloat(batch.unit_cost) || avg,
        });
      } else {
        const lots = await client.query<{
          id: string;
          quantity: string;
          unit_cost: string;
        }>(
          `SELECT id, quantity, unit_cost FROM stock_batches
            WHERE product_id=$1 AND depot_id=$2
              AND COALESCE(variant_id,$3::uuid)=$3::uuid AND quantity > 0
            ORDER BY expiry_date ASC NULLS LAST, received_date ASC FOR UPDATE`,
          [item.productId, depotId, item.variantId ?? NO_VARIANT],
        );
        if (lots.rows.length > 0) {
          let need = baseQty;
          for (const lot of lots.rows) {
            if (need <= 1e-9) break;
            const take = Math.min(parseFloat(lot.quantity), need);
            await client.query(
              "UPDATE stock_batches SET quantity=quantity-$2 WHERE id=$1",
              [lot.id, take],
            );
            allocs.push({
              batchId: lot.id,
              qty: take,
              cost: parseFloat(lot.unit_cost) || avg,
            });
            need = round2(need - take);
          }
          if (need > 1e-9)
            throw HttpError.conflict(
              "STOCK_INSUFFICIENT",
              "Stock (lots) insuffisant pour ce retour.",
            );
        } else {
          allocs.push({ batchId: null, qty: baseQty, cost: avg });
        }
      }

      for (const a of allocs) {
        await client.query(
          `INSERT INTO supplier_return_items (return_id, product_id, variant_id, batch_id, quantity, unit_cost)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            returnId,
            item.productId,
            item.variantId ?? null,
            a.batchId,
            a.qty,
            a.cost,
          ],
        );
        totalCost = round2(totalCost + a.qty * a.cost);
      }
      const lvl = await decreaseLevel(client, scope, baseQty);
      // Un mouvement par prélevement de lot (traçabilité fine au coût du lot)
      for (const a of allocs) {
        await recordMovement(client, {
          ...scope,
          userId: user.id,
          type: "SUPPLIER_RETURN",
          quantity: a.qty,
          previousStock: lvl.previous,
          newStock: lvl.next,
          reason: `Retour fournisseur (${input.reason})${input.note ? ` — ${input.note}` : ""}`,
          referenceId: returnId,
          batchId: a.batchId,
          unitCost: a.cost,
        });
      }
    }
    await client.query(
      "UPDATE supplier_returns SET total_cost=$2 WHERE id=$1",
      [returnId, totalCost],
    );
    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "SUPPLIER_RETURN",
        entity: "supplier_return",
        entityId: returnId,
        depotId,
        newState: {
          reason: input.reason,
          lines: input.items.length,
          totalCost,
        },
      },
      client,
    );
    return { returnId, totalCost, lines: input.items.length };
  });
}

// ============================ TAUX DE SERVICE (OTIF) ========================
/** OTIF par fournisseur : On-Time = réception complète ≤ date prévue ;
 *  In-Full = quantités livrées = commandées à la clôture. Délai réel mesuré
 *  de l'envoi (ou création) à la première réception. */
export async function supplierServiceReport(
  tenantId: string,
  opts: { from?: string; to?: string; supplierId?: string },
) {
  const params: unknown[] = [tenantId];
  const conds = [
    "po.tenant_id=$1",
    "po.status IN ('SENT','PARTIALLY_RECEIVED','CLOSED')",
  ];
  if (opts.from)
    conds.push(
      `po.created_at >= $${params.push(new Date(`${opts.from}T00:00:00Z`))}`,
    );
  if (opts.to)
    conds.push(
      `po.created_at < $${params.push(new Date(new Date(`${opts.to}T00:00:00Z`).getTime() + 86_400_000))}`,
    );
  if (opts.supplierId)
    conds.push(`po.supplier_id = $${params.push(opts.supplierId)}`);
  const pos = await query<{
    id: string;
    supplier_id: string;
    supplier_name: string;
    status: string;
    expected_at: string | Date | null;
    sent_at: string | Date | null;
    created_at: string | Date;
    first_received_at: string | Date | null;
    closed_at: string | Date | null;
    close_reason: string | null;
    missing_lines: number;
  }>(
    `SELECT po.id, po.supplier_id, s.name AS supplier_name, po.status,
            po.expected_at, po.sent_at, po.created_at, po.first_received_at,
            po.closed_at, po.close_reason,
            COALESCE(miss.n, 0)::float AS missing_lines
       FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
       LEFT JOIN (
         SELECT po_id, COUNT(CASE WHEN received_qty < quantity - 0.0000001 THEN 1 END)::int AS n
           FROM purchase_order_items GROUP BY po_id
       ) miss ON miss.po_id = po.id
      WHERE ${conds.join(" AND ")}`,
    params,
  );
  const bySupplier = new Map<
    string,
    {
      supplier_id: string;
      supplier_name: string;
      orders: number;
      closed: number;
      on_time: number;
      in_full: number;
      otif: number;
      lead_days_sum: number;
      lead_days_n: number;
    }
  >();
  for (const r of pos.rows) {
    const row = bySupplier.get(r.supplier_id) ?? {
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
      orders: 0,
      closed: 0,
      on_time: 0,
      in_full: 0,
      otif: 0,
      lead_days_sum: 0,
      lead_days_n: 0,
    };
    row.orders++;
    const closed = r.status === "CLOSED";
    const isFull = r.missing_lines === 0;
    if (closed) {
      row.closed++;
      row.in_full += isFull ? 1 : 0;
      // On-time : la réception complète est intervenue au plus tard à la date prévue
      const expected = r.expected_at ? new Date(r.expected_at).getTime() : null;
      const doneAt = r.closed_at ? new Date(r.closed_at).getTime() : null;
      const onTime =
        expected != null && doneAt != null
          ? doneAt <= expected + 86_399_999 // jour prévu inclus
          : false;
      row.on_time += onTime ? 1 : 0;
      row.otif += onTime && isFull ? 1 : 0;
    }
    if (r.first_received_at) {
      const start = new Date(r.sent_at ?? r.created_at).getTime();
      const lead = Math.max(
        0,
        Math.round(
          (new Date(r.first_received_at).getTime() - start) / 86_400_000,
        ),
      );
      row.lead_days_sum += lead;
      row.lead_days_n++;
    }
    bySupplier.set(r.supplier_id, row);
  }
  return [...bySupplier.values()]
    .map((s) => ({
      supplier_id: s.supplier_id,
      supplier_name: s.supplier_name,
      orders: s.orders,
      closed_orders: s.closed,
      on_time_rate: s.closed ? round2((s.on_time / s.closed) * 100) : null,
      in_full_rate: s.closed ? round2((s.in_full / s.closed) * 100) : null,
      otif_rate: s.closed ? round2((s.otif / s.closed) * 100) : null,
      avg_lead_time_days:
        s.lead_days_n > 0 ? round2(s.lead_days_sum / s.lead_days_n) : null,
    }))
    .sort((a, b) => (b.otif_rate ?? 0) - (a.otif_rate ?? 0));
}
