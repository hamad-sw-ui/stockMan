import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../config/db";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import {
  pageParams,
  paged,
  pageQuerySchema,
  encodeCursor,
  decodeCursor,
} from "../lib/pagination";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import {
  validateBody,
  validateParams,
  validateQuery,
  uuidParam,
  money,
  qty,
} from "../middleware/validate";
import { PoolClient } from "pg";
import {
  decreaseLevel,
  increaseLevel,
  lockLevel,
  NO_VARIANT,
  recordMovement,
  setLevel,
} from "../services/stockService";
import { resolveDepot } from "../services/saleService";

const router = Router();
router.use(authenticate);
const adminWrite = [requireRole("ADMIN"), requireActiveLicense()];
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Conversion unité → facteur base (ratio d'unités, cf. saleService). */
async function unitFactor(
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

// ============================ RÉCEPTIONS FOURNISSEURS (IN) ==================
const receiptInput = z.object({
  depotId: z.string().uuid().optional(),
  supplierId: z.string().uuid().nullish(),
  reference: z.string().trim().max(100).nullish(),
  note: z.string().trim().max(2000).nullish(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        quantity: qty,
        unitId: z.string().uuid().nullish(),
        unitCost: money.default(0),
        batchNumber: z.string().trim().max(100).nullish(),
        expiryDate: z.string().date().nullish(),
      }),
    )
    .min(1, "Au moins une ligne est requise")
    .max(200),
});

router.post(
  "/receipts",
  ...adminWrite,
  validateBody(receiptInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof receiptInput>;
    const depotId = resolveDepot(u, b.depotId);

    const created = await withTransaction(async (client) => {
      const rec = await client.query<{ id: string }>(
        `INSERT INTO stock_receipts (tenant_id, depot_id, supplier_id, received_by, reference, note)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          u.tenantId,
          depotId,
          b.supplierId ?? null,
          u.id,
          b.reference ?? null,
          b.note ?? null,
        ],
      );
      const receiptId = rec.rows[0]!.id;
      let totalCost = 0;

      for (const item of b.items) {
        const { factor } = await unitFactor(
          client,
          u.tenantId,
          item.productId,
          item.unitId,
        );
        const baseQty = round2(item.quantity * factor);
        totalCost = round2(totalCost + baseQty * item.unitCost);

        // Lot : upsert manuel sur (produit, dépôt, numéro, variante)
        let batchId: string | null = null;
        if (item.batchNumber || item.expiryDate) {
          const batchNumber =
            item.batchNumber ?? `RCV-${receiptId.slice(0, 8)}`;
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM stock_batches
              WHERE product_id=$1 AND depot_id=$2 AND batch_number=$3
                AND COALESCE(variant_id, $4::uuid) = $4::uuid
              FOR UPDATE`,
            [
              item.productId,
              depotId,
              batchNumber,
              item.variantId ?? NO_VARIANT,
            ],
          );
          if (existing.rows[0]) {
            await client.query(
              "UPDATE stock_batches SET quantity = quantity + $2 WHERE id=$1",
              [existing.rows[0].id, baseQty],
            );
            batchId = existing.rows[0].id;
          } else {
            const batch = await client.query<{ id: string }>(
              `INSERT INTO stock_batches (product_id, variant_id, depot_id, supplier_id, batch_number, quantity, expiry_date)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
              [
                item.productId,
                item.variantId ?? null,
                depotId,
                b.supplierId ?? null,
                batchNumber,
                baseQty,
                item.expiryDate ?? null,
              ],
            );
            batchId = batch.rows[0]!.id;
          }
        }

        await client.query(
          `INSERT INTO stock_receipt_items (receipt_id, product_id, variant_id, batch_id, base_qty, unit_cost)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            receiptId,
            item.productId,
            item.variantId ?? null,
            batchId,
            baseQty,
            item.unitCost,
          ],
        );

        const scope = {
          tenantId: u.tenantId,
          depotId,
          productId: item.productId,
          variantId: item.variantId ?? null,
        };
        const lvl = await increaseLevel(client, scope, baseQty);
        await recordMovement(client, {
          ...scope,
          userId: u.id,
          type: "IN",
          quantity: baseQty,
          previousStock: lvl.previous,
          newStock: lvl.next,
          reason: b.reference
            ? `Réception ${b.reference}`
            : "Réception fournisseur",
          referenceId: receiptId,
        });
        // Le coût d'achat catalogue suit la dernière réception
        if (item.unitCost > 0) {
          await client.query(
            "UPDATE products SET purchase_price=$2, updated_at=now() WHERE id=$1",
            [item.productId, item.unitCost],
          );
        }
      }
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "RECEIPT",
          entity: "receipt",
          entityId: receiptId,
          depotId,
          newState: { lines: b.items.length, totalCost },
        },
        client,
      );
      return { receiptId, totalCost, lines: b.items.length };
    });
    res.status(201).json(created);
  }),
);

const receiptListQuery = pageQuerySchema.extend({
  supplierId: z.string().uuid().optional(),
  depotId: z.string().uuid().optional(),
});

router.get(
  "/receipts",
  requireRole("ADMIN"),
  validateQuery(receiptListQuery),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const q = req.query as unknown as z.infer<typeof receiptListQuery>;
    const { limit, offset } = pageParams(q);
    const params: unknown[] = [t];
    const conds = ["r.tenant_id = $1"];
    if (q.supplierId)
      conds.push(`r.supplier_id = $${params.push(q.supplierId)}`);
    if (q.depotId) conds.push(`r.depot_id = $${params.push(q.depotId)}`);
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM stock_receipts r ${where}`,
      params,
    );
    const rows = await query(
      `SELECT r.*, s.name AS supplier_name, d.name AS depot_name, usr.name AS received_by_name,
              COALESCE(agg.line_count, 0)::int AS line_count, COALESCE(agg.total_cost, 0)::float AS total_cost
         FROM stock_receipts r
         LEFT JOIN suppliers s ON s.id=r.supplier_id
         JOIN depots d ON d.id=r.depot_id
         LEFT JOIN users usr ON usr.id=r.received_by
         LEFT JOIN (SELECT receipt_id, COUNT(*)::int AS line_count, SUM(base_qty * unit_cost)::float AS total_cost
                      FROM stock_receipt_items GROUP BY receipt_id) agg ON agg.receipt_id = r.id
        ${where}
        ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, count.rows[0]!.n, q));
  }),
);

router.get(
  "/receipts/:id",
  requireRole("ADMIN"),
  validateParams(uuidParam),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const r = await query(
      `SELECT r.*, s.name AS supplier_name, d.name AS depot_name, usr.name AS received_by_name
         FROM stock_receipts r LEFT JOIN suppliers s ON s.id=r.supplier_id
         JOIN depots d ON d.id=r.depot_id LEFT JOIN users usr ON usr.id=r.received_by
        WHERE r.id=$1 AND r.tenant_id=$2`,
      [req.params.id!, t],
    );
    if (!r.rows[0]) throw HttpError.notFound("Réception introuvable.");
    const items = await query(
      `SELECT i.*, p.name AS product_name, v.name AS variant_name, bt.batch_number
         FROM stock_receipt_items i
         JOIN products p ON p.id=i.product_id
         LEFT JOIN product_variants v ON v.id=i.variant_id
         LEFT JOIN stock_batches bt ON bt.id=i.batch_id
        WHERE i.receipt_id=$1`,
      [req.params.id],
    );
    res.json({ ...r.rows[0], items: items.rows });
  }),
);

// ============================ TRANSFERTS INTER-DÉPÔTS =======================
const transferInput = z.object({
  fromDepotId: z.string().uuid(),
  toDepotId: z.string().uuid(),
  note: z.string().trim().max(2000).nullish(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        quantity: qty,
      }),
    )
    .min(1)
    .max(200),
});

router.post(
  "/transfers",
  ...adminWrite,
  validateBody(transferInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof transferInput>;
    if (b.fromDepotId === b.toDepotId)
      throw HttpError.badRequest(
        "SAME_DEPOT",
        "Les dépôts source et destination doivent différer.",
      );

    const created = await withTransaction(async (client) => {
      const depots = await client.query(
        "SELECT id FROM depots WHERE tenant_id=$1 AND id IN ($2, $3) AND is_active",
        [u.tenantId, b.fromDepotId, b.toDepotId],
      );
      if (depots.rows.length !== 2)
        throw HttpError.badRequest(
          "DEPOT_UNKNOWN",
          "Dépôts introuvables ou inactifs.",
        );
      const tr = await client.query<{ id: string }>(
        `INSERT INTO stock_transfers (tenant_id, from_depot, to_depot, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [u.tenantId, b.fromDepotId, b.toDepotId, b.note ?? null, u.id],
      );
      const transferId = tr.rows[0]!.id;
      for (const item of b.items) {
        const scope = {
          tenantId: u.tenantId,
          depotId: b.fromDepotId,
          productId: item.productId,
          variantId: item.variantId ?? null,
        };
        const lvl = await decreaseLevel(client, scope, item.quantity);
        await client.query(
          "INSERT INTO stock_transfer_items (transfer_id, product_id, variant_id, quantity) VALUES ($1,$2,$3,$4)",
          [transferId, item.productId, item.variantId ?? null, item.quantity],
        );
        await recordMovement(client, {
          ...scope,
          userId: u.id,
          type: "TRANSFER",
          quantity: item.quantity,
          previousStock: lvl.previous,
          newStock: lvl.next,
          reason: "Transfert sortant",
          referenceId: transferId,
        });
      }
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "TRANSFER",
          entity: "transfer",
          entityId: transferId,
          newState: {
            from: b.fromDepotId,
            to: b.toDepotId,
            lines: b.items.length,
          },
        },
        client,
      );
      return { transferId, lines: b.items.length, status: "PENDING" };
    });
    res.status(201).json(created);
  }),
);

router.get(
  "/transfers",
  requireRole("ADMIN"),
  validateQuery(
    pageQuerySchema.extend({
      status: z.enum(["PENDING", "RECEIVED", "CANCELLED"]).optional(),
    }),
  ),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const q = req.query as unknown as {
      page: number;
      size: number;
      status?: string;
    };
    const { limit, offset } = pageParams(q);
    const params: unknown[] = [t];
    const conds = ["tr.tenant_id = $1"];
    if (q.status) conds.push(`tr.status = $${params.push(q.status)}`);
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM stock_transfers tr ${where}`,
      params,
    );
    const rows = await query(
      `SELECT tr.*, df.name AS from_depot_name, dt.name AS to_depot_name, usr.name AS created_by_name
         FROM stock_transfers tr
         JOIN depots df ON df.id=tr.from_depot JOIN depots dt ON dt.id=tr.to_depot
         LEFT JOIN users usr ON usr.id=tr.created_by
        ${where} ORDER BY tr.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, count.rows[0]!.n, q));
  }),
);

router.post(
  "/transfers/:id/receive",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const done = await withTransaction(async (client) => {
      const tr = await client.query(
        "SELECT * FROM stock_transfers WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
        [req.params.id!, u.tenantId],
      );
      const transfer = tr.rows[0];
      if (!transfer) throw HttpError.notFound("Transfert introuvable.");
      if (transfer.status !== "PENDING")
        throw HttpError.conflict(
          "TRANSFER_CLOSED",
          "Ce transfert est déjà clôturé.",
        );
      const items = await client.query(
        "SELECT * FROM stock_transfer_items WHERE transfer_id=$1",
        [transfer.id],
      );
      for (const item of items.rows) {
        const scope = {
          tenantId: u.tenantId,
          depotId: transfer.to_depot,
          productId: item.product_id,
          variantId: item.variant_id,
        };
        const lvl = await increaseLevel(
          client,
          scope,
          parseFloat(item.quantity),
        );
        await recordMovement(client, {
          ...scope,
          userId: u.id,
          type: "TRANSFER",
          quantity: parseFloat(item.quantity),
          previousStock: lvl.previous,
          newStock: lvl.next,
          reason: "Transfert reçu",
          referenceId: transfer.id,
        });
      }
      await client.query(
        "UPDATE stock_transfers SET status='RECEIVED', received_by=$2, received_at=now() WHERE id=$1",
        [transfer.id, u.id],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "TRANSFER",
          entity: "transfer",
          entityId: transfer.id,
          previousState: { status: "PENDING" },
          newState: { status: "RECEIVED" },
        },
        client,
      );
      return { status: "RECEIVED" };
    });
    res.json(done);
  }),
);

router.post(
  "/transfers/:id/cancel",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const done = await withTransaction(async (client) => {
      const tr = await client.query(
        "SELECT * FROM stock_transfers WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
        [req.params.id!, u.tenantId],
      );
      const transfer = tr.rows[0];
      if (!transfer) throw HttpError.notFound("Transfert introuvable.");
      if (transfer.status !== "PENDING")
        throw HttpError.conflict(
          "TRANSFER_CLOSED",
          "Ce transfert est déjà clôturé.",
        );
      const items = await client.query(
        "SELECT * FROM stock_transfer_items WHERE transfer_id=$1",
        [transfer.id],
      );
      for (const item of items.rows) {
        const scope = {
          tenantId: u.tenantId,
          depotId: transfer.from_depot,
          productId: item.product_id,
          variantId: item.variant_id,
        };
        const lvl = await increaseLevel(
          client,
          scope,
          parseFloat(item.quantity),
        );
        await recordMovement(client, {
          ...scope,
          userId: u.id,
          type: "TRANSFER",
          quantity: parseFloat(item.quantity),
          previousStock: lvl.previous,
          newStock: lvl.next,
          reason: "Annulation de transfert",
          referenceId: transfer.id,
        });
      }
      await client.query(
        "UPDATE stock_transfers SET status='CANCELLED' WHERE id=$1",
        [transfer.id],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "TRANSFER",
          entity: "transfer",
          entityId: transfer.id,
          previousState: { status: "PENDING" },
          newState: { status: "CANCELLED" },
        },
        client,
      );
      return { status: "CANCELLED" };
    });
    res.json(done);
  }),
);

// ============================ AJUSTEMENTS / INVENTAIRE ======================
const adjustInput = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullish(),
    depotId: z.string().uuid().optional(),
    type: z.enum(["ADJUSTMENT", "DAMAGE", "EXPIRED"]).default("ADJUSTMENT"),
    newQuantity: money.optional(),
    delta: z.number().finite().optional(),
    reason: z
      .string()
      .trim()
      .min(3, "Un motif détaillé est obligatoire")
      .max(2000),
  })
  .refine((v) => (v.newQuantity !== undefined) !== (v.delta !== undefined), {
    message: "Fournir soit newQuantity soit delta (pas les deux).",
  });

router.post(
  "/adjust",
  ...adminWrite,
  validateBody(adjustInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof adjustInput>;
    const depotId = resolveDepot(u, b.depotId);

    const result = await withTransaction(async (client) => {
      const scope = {
        tenantId: u.tenantId,
        depotId,
        productId: b.productId,
        variantId: b.variantId ?? null,
      };
      const previous = await lockLevel(client, scope);
      const next =
        b.newQuantity !== undefined
          ? b.newQuantity
          : round2(previous + (b.delta ?? 0));
      if (next < 0)
        throw HttpError.badRequest(
          "STOCK_NEGATIVE",
          "Le stock ne peut pas devenir négatif.",
        );
      await setLevel(client, scope, next);

      // TYPE EXPIRED : réduit aussi les lots expirés correspondants
      if (b.type === "EXPIRED" && next < previous) {
        let toClear = previous - next;
        const batches = await client.query<{ id: string; quantity: string }>(
          `SELECT id, quantity FROM stock_batches
            WHERE product_id=$1 AND depot_id=$2 AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE AND quantity > 0
            ORDER BY expiry_date FOR UPDATE`,
          [b.productId, depotId],
        );
        for (const batch of batches.rows) {
          if (toClear <= 0) break;
          const take = Math.min(parseFloat(batch.quantity), toClear);
          await client.query(
            "UPDATE stock_batches SET quantity=quantity-$2 WHERE id=$1",
            [batch.id, take],
          );
          toClear -= take;
        }
      }

      await recordMovement(client, {
        ...scope,
        userId: u.id,
        type: b.type,
        quantity: Math.abs(round2(next - previous)),
        previousStock: previous,
        newStock: next,
        reason: b.reason,
      });
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "ADJUST",
          entity: "stock",
          entityId: b.productId,
          depotId,
          previousState: { quantity: previous },
          newState: { quantity: next, type: b.type },
          details: b.reason,
        },
        client,
      );
      return { previous, next, delta: round2(next - previous) };
    });
    res.json(result);
  }),
);

// ============================ JOURNAL DES MOUVEMENTS (cursor) ===============
const movementQuery = z.object({
  productId: z.string().uuid().optional(),
  depotId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  type: z
    .enum([
      "IN",
      "OUT",
      "TRANSFER",
      "ADJUSTMENT",
      "SALE",
      "RETURN",
      "DAMAGE",
      "EXPIRED",
      "VOID",
    ])
    .optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  cursor: z.string().optional(),
  size: z.coerce.number().int().min(1).max(100).default(50),
});

router.get(
  "/movements",
  validateQuery(movementQuery),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const q = req.query as unknown as z.infer<typeof movementQuery>;
    const c = decodeCursor(q.cursor);
    // Bornes de dates calculées en JS (UTC) — aucune conversion date↔timestamptz en SQL.
    const fromTs = q.from ? new Date(`${q.from}T00:00:00.000Z`) : null;
    const toTs = q.to
      ? new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000)
      : null;

    const params: unknown[] = [t];
    const conds = ["sm.tenant_id = $1"];
    if (q.productId) conds.push(`sm.product_id = $${params.push(q.productId)}`);
    if (q.depotId) conds.push(`sm.depot_id = $${params.push(q.depotId)}`);
    if (q.userId) conds.push(`sm.user_id = $${params.push(q.userId)}`);
    if (q.type) conds.push(`sm.type = $${params.push(q.type)}`);
    if (fromTs) conds.push(`sm.created_at >= $${params.push(fromTs)}`);
    if (toTs) conds.push(`sm.created_at < $${params.push(toTs)}`);
    if (c) {
      // Curseur (created_at, id) décomposé : comparaisons simples, portable partout
      conds.push(
        `(sm.created_at < $${params.push(c.createdAt)} OR (sm.created_at = $${params.length} AND sm.id < $${params.push(c.id)}))`,
      );
    }
    const limitIdx = `$${params.push(q.size + 1)}`;

    const r = await query(
      `SELECT sm.*, p.name AS product_name, v.name AS variant_name, d.name AS depot_name, usr.name AS user_name
         FROM stock_movements sm
         JOIN products p ON p.id=sm.product_id
         LEFT JOIN product_variants v ON v.id=sm.variant_id
         JOIN depots d ON d.id=sm.depot_id
         LEFT JOIN users usr ON usr.id=sm.user_id
        WHERE ${conds.join(" AND ")}
        ORDER BY sm.created_at DESC, sm.id DESC
        LIMIT ${limitIdx}`,
      params,
    );
    const hasMore = r.rows.length > q.size;
    const rows = hasMore ? r.rows.slice(0, q.size) : r.rows;
    const last = rows[rows.length - 1];
    res.json({
      data: rows,
      nextCursor:
        hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    });
  }),
);

export default router;
