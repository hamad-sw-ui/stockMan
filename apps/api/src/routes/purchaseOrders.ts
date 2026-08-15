import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../config/db";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";
import { pageParams, paged, pageQuerySchema } from "../lib/pagination";
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
import {
  cancelPurchaseOrder,
  CLOSE_REASONS,
  closePurchaseOrder,
  createPurchaseOrder,
  createSupplierReturn,
  DISCREPANCY_REASONS,
  purchaseOrderById,
  receivePurchaseOrder,
  RETURN_REASONS,
  sendPurchaseOrder,
  supplierServiceReport,
} from "../services/procurementService";

const router = Router();
router.use(authenticate);
const adminWrite = [requireRole("ADMIN"), requireActiveLicense()];

// ============================ CRÉATION DE COMMANDE ==========================
const poInput = z.object({
  supplierId: z.string().uuid(),
  depotId: z.string().uuid().optional(),
  reference: z.string().trim().max(100).nullish(),
  expectedAt: z.string().date().nullish(),
  note: z.string().trim().max(2000).nullish(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        quantity: qty,
        unitCost: money.default(0),
      }),
    )
    .min(1, "La commande est vide")
    .max(200),
});

router.post(
  "/",
  ...adminWrite,
  validateBody(poInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof poInput>;
    const po = await createPurchaseOrder(u, {
      supplierId: b.supplierId,
      depotId: b.depotId,
      reference: b.reference ?? null,
      expectedAt: b.expectedAt ?? null,
      note: b.note ?? null,
      items: b.items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId ?? null,
        quantity: i.quantity,
        unitCost: i.unitCost,
      })),
    });
    res.status(201).json(po);
  }),
);

// ============================ LISTE =========================================
router.get(
  "/",
  requireRole("ADMIN"),
  validateQuery(
    pageQuerySchema.extend({
      status: z
        .enum(["DRAFT", "SENT", "PARTIALLY_RECEIVED", "CLOSED", "CANCELLED"])
        .optional(),
      supplierId: z.string().uuid().optional(),
    }),
  ),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const q = req.query as unknown as {
      page: number;
      size: number;
      status?: string;
      supplierId?: string;
    };
    const { limit, offset } = pageParams(q);
    const params: unknown[] = [t];
    const conds = ["po.tenant_id = $1"];
    if (q.status) conds.push(`po.status = $${params.push(q.status)}`);
    if (q.supplierId)
      conds.push(`po.supplier_id = $${params.push(q.supplierId)}`);
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM purchase_orders po ${where}`,
      params,
    );
    const rows = await query(
      `SELECT po.*, s.name AS supplier_name, d.name AS depot_name, usr.name AS created_by_name,
              agg.line_count, agg.ordered_total, agg.received_total
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         JOIN depots d ON d.id = po.depot_id
         LEFT JOIN users usr ON usr.id = po.created_by
         LEFT JOIN (
           SELECT po_id, COUNT(*)::int AS line_count,
                  SUM(quantity)::float AS ordered_total,
                  SUM(received_qty)::float AS received_total
             FROM purchase_order_items GROUP BY po_id
         ) agg ON agg.po_id = po.id
        ${where}
        ORDER BY po.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, count.rows[0]!.n, q));
  }),
);

// ============================ TAUX DE SERVICE (OTIF) ========================
// NB : déclaré AVANT /:id pour ne pas être capturé par la route paramétrée.
router.get(
  "/otif",
  requireRole("ADMIN"),
  validateQuery(
    z.object({
      from: z.string().date().optional(),
      to: z.string().date().optional(),
      supplierId: z.string().uuid().optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      from?: string;
      to?: string;
      supplierId?: string;
    };
    res.json(
      await supplierServiceReport(u.tenantId, {
        from: q.from,
        to: q.to,
        supplierId: q.supplierId,
      }),
    );
  }),
);

// ============================ RETOURS FOURNISSEUR ===========================
const returnInput = z.object({
  supplierId: z.string().uuid(),
  depotId: z.string().uuid().optional(),
  receiptId: z.string().uuid().nullish(),
  reason: z.enum(RETURN_REASONS),
  note: z.string().trim().max(2000).nullish(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        quantity: qty,
        unitId: z.string().uuid().nullish(),
        batchId: z.string().uuid().nullish(),
      }),
    )
    .min(1, "Au moins une ligne est requise")
    .max(200),
});

router.post(
  "/returns",
  ...adminWrite,
  validateBody(returnInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof returnInput>;
    const created = await createSupplierReturn(u, {
      supplierId: b.supplierId,
      depotId: b.depotId,
      receiptId: b.receiptId ?? null,
      reason: b.reason,
      note: b.note ?? null,
      items: b.items,
    });
    res.status(201).json(created);
  }),
);

router.get(
  "/returns",
  requireRole("ADMIN"),
  validateQuery(
    pageQuerySchema.extend({ supplierId: z.string().uuid().optional() }),
  ),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const q = req.query as unknown as {
      page: number;
      size: number;
      supplierId?: string;
    };
    const { limit, offset } = pageParams(q);
    const params: unknown[] = [t];
    const conds = ["sr.tenant_id = $1"];
    if (q.supplierId)
      conds.push(`sr.supplier_id = $${params.push(q.supplierId)}`);
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM supplier_returns sr ${where}`,
      params,
    );
    const rows = await query(
      `SELECT sr.*, s.name AS supplier_name, d.name AS depot_name, usr.name AS created_by_name,
              COALESCE(agg.line_count, 0)::int AS line_count
         FROM supplier_returns sr
         JOIN suppliers s ON s.id=sr.supplier_id
         JOIN depots d ON d.id=sr.depot_id
         LEFT JOIN users usr ON usr.id=sr.created_by
         LEFT JOIN (SELECT return_id, COUNT(*)::int AS line_count
                      FROM supplier_return_items GROUP BY return_id) agg
           ON agg.return_id = sr.id
        ${where} ORDER BY sr.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, count.rows[0]!.n, q));
  }),
);

router.get(
  "/returns/:id",
  requireRole("ADMIN"),
  validateParams(uuidParam),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const r = await query(
      `SELECT sr.*, s.name AS supplier_name, d.name AS depot_name, usr.name AS created_by_name
         FROM supplier_returns sr
         JOIN suppliers s ON s.id=sr.supplier_id
         JOIN depots d ON d.id=sr.depot_id
         LEFT JOIN users usr ON usr.id=sr.created_by
        WHERE sr.id=$1 AND sr.tenant_id=$2`,
      [req.params.id!, t],
    );
    if (!r.rows[0]) throw HttpError.notFound("Retour fournisseur introuvable.");
    const items = await query(
      `SELECT i.*, p.name AS product_name, v.name AS variant_name, b.batch_number
         FROM supplier_return_items i
         JOIN products p ON p.id=i.product_id
         LEFT JOIN product_variants v ON v.id=i.variant_id
         LEFT JOIN stock_batches b ON b.id=i.batch_id
        WHERE i.return_id=$1`,
      [req.params.id],
    );
    res.json({ ...r.rows[0], items: items.rows });
  }),
);

// ============================ DÉTAIL / TRANSITIONS ==========================
router.get(
  "/:id",
  requireRole("ADMIN"),
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(
      await withTransaction((c) =>
        purchaseOrderById(c, u.tenantId, req.params.id!),
      ),
    );
  }),
);

router.post(
  "/:id/send",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    res.json(
      await sendPurchaseOrder((req as AuthRequest).user, req.params.id!),
    );
  }),
);

router.post(
  "/:id/receive",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(
    z.object({
      reference: z.string().trim().max(100).nullish(),
      note: z.string().trim().max(2000).nullish(),
      items: z
        .array(
          z.object({
            poItemId: z.string().uuid(),
            quantity: qty,
            unitId: z.string().uuid().nullish(),
            discrepancyReason: z.enum(DISCREPANCY_REASONS).nullish(),
            batchNumber: z.string().trim().max(100).nullish(),
            expiryDate: z.string().date().nullish(),
            serials: z
              .array(z.string().trim().min(1).max(100))
              .max(500)
              .nullish(),
          }),
        )
        .min(1)
        .max(200),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res
      .status(201)
      .json(await receivePurchaseOrder(u, req.params.id!, req.body));
  }),
);

router.post(
  "/:id/close",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(z.object({ reason: z.enum(CLOSE_REASONS).default("OTHER") })),
  h(async (req, res) => {
    res.json(
      await closePurchaseOrder(
        (req as AuthRequest).user,
        req.params.id!,
        req.body.reason,
      ),
    );
  }),
);

router.post(
  "/:id/cancel",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    res.json(
      await cancelPurchaseOrder((req as AuthRequest).user, req.params.id!),
    );
  }),
);

export default router;
