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
  qty,
} from "../middleware/validate";
import { convertQuote, createQuote, quoteById } from "../services/quoteService";
import { writeAudit } from "../lib/audit";

const router = Router();
router.use(authenticate);

// ============================ CRÉATION (proforma) ===========================
const quoteInput = z.object({
  depotId: z.string().uuid().optional(),
  customerId: z.string().uuid().nullish(),
  note: z.string().trim().max(2000).nullish(),
  validUntil: z.string().date().nullish(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        unitId: z.string().uuid().nullish(),
        quantity: qty,
        discountPct: z.coerce.number().min(0).max(100).default(0),
      }),
    )
    .min(1, "Le devis est vide")
    .max(200),
});

router.post(
  "/",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateBody(quoteInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof quoteInput>;
    const quote = await createQuote(u, {
      depotId: b.depotId,
      customerId: b.customerId ?? null,
      note: b.note ?? null,
      validUntil: b.validUntil ?? null,
      items: b.items,
    });
    res.status(201).json(quote);
  }),
);

// ============================ LISTE =========================================
router.get(
  "/",
  validateQuery(
    pageQuerySchema.extend({
      status: z.enum(["DRAFT", "CONVERTED", "CANCELLED"]).optional(),
      customerId: z.string().uuid().optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      page: number;
      size: number;
      status?: string;
      customerId?: string;
    };
    const { limit, offset } = pageParams(q);
    const params: unknown[] = [u.tenantId];
    const conds = ["q.tenant_id = $1"];
    if (q.status) conds.push(`q.status = $${params.push(q.status)}`);
    if (q.customerId)
      conds.push(`q.customer_id = $${params.push(q.customerId)}`);
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM quotes q ${where}`,
      params,
    );
    const rows = await query(
      `SELECT q.*, c.name AS customer_name, d.name AS depot_name,
              COALESCE(lc.line_count, 0)::int AS line_count
         FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id
         JOIN depots d ON d.id=q.depot_id
         LEFT JOIN (SELECT quote_id, COUNT(*)::int AS line_count FROM quote_items GROUP BY quote_id) lc
           ON lc.quote_id = q.id
        ${where} ORDER BY q.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, count.rows[0]!.n, q));
  }),
);

// ============================ DÉTAIL ========================================
router.get(
  "/:id",
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(
      await withTransaction((c) => quoteById(c, u.tenantId, req.params.id!)),
    );
  }),
);

// ============================ CONVERSION → VENTE ============================
router.post(
  "/:id/convert",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateParams(uuidParam),
  validateBody(
    z.object({
      paymentMethod: z.enum(["CASH", "MTN_MOMO", "ORANGE_MONEY"]).optional(),
      dueDate: z.string().date().nullish(),
      clientSaleId: z.string().uuid().nullish(),
      payments: z
        .array(
          z.object({
            method: z.enum(["CASH", "MTN_MOMO", "ORANGE_MONEY"]),
            amount: z.coerce.number().positive().finite(),
            reference: z.string().trim().max(100).nullish(),
            clientPaymentId: z.string().uuid().nullish(),
          }),
        )
        .max(10)
        .optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const result = await convertQuote(u, req.params.id!, {
      paymentMethod: req.body.paymentMethod,
      dueDate: req.body.dueDate ?? null,
      clientSaleId: req.body.clientSaleId ?? undefined,
      payments: req.body.payments,
    });
    res.status(result.deduplicated ? 200 : 201).json(result);
  }),
);

// ============================ ANNULATION ====================================
router.post(
  "/:id/cancel",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const r = await query<{ id: string }>(
      "UPDATE quotes SET status='CANCELLED' WHERE id=$1 AND tenant_id=$2 AND status='DRAFT' RETURNING id",
      [req.params.id!, u.tenantId],
    );
    if (!r.rows[0]) {
      const exists = await query(
        "SELECT 1 FROM quotes WHERE id=$1 AND tenant_id=$2",
        [req.params.id!, u.tenantId],
      );
      if (!exists.rows[0]) throw HttpError.notFound("Devis introuvable.");
      throw HttpError.conflict(
        "QUOTE_ALREADY_CONVERTED",
        "Seul un devis brouillon peut être annulé.",
      );
    }
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "QUOTE",
      entity: "quote",
      entityId: req.params.id!,
      newState: { status: "CANCELLED" },
    });
    res.json({ status: "CANCELLED" });
  }),
);

export default router;
