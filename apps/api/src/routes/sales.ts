import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db";
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
import * as saleService from "../services/saleService";

const router = Router();
router.use(authenticate);

// ============================ CRÉATION (caisse, sync offline) ===============
const createSaleSchema = z.object({
  depotId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        unitId: z.string().uuid().nullish(),
        quantity: qty,
        discountPct: z.coerce.number().min(0).max(100).default(0),
        // E8 — produit sérialisé (IMEI) : numéros exacts vendus.
        serialNumbers: z
          .array(z.string().trim().min(1).max(100))
          .max(500)
          .nullish(),
        // NB : priceOverride (prix figé de devis) volontairement ABSENT du
        // schéma client — la conversion de devis l'injecte côté serveur.
      }),
    )
    .min(1, "Le panier est vide")
    .max(200),
  paymentMethod: z.enum(["CASH", "MTN_MOMO", "ORANGE_MONEY"]),
  paymentReference: z.string().trim().max(100).nullish(),
  clientSaleId: z.string().uuid().nullish(),
  createdAt: z.string().datetime({ offset: true }).nullish(),
  amountReceived: z.coerce.number().min(0).optional(),
  // E3 — client, crédit, paiement mixte
  customerId: z.string().uuid().nullish(),
  dueDate: z.string().date().nullish(),
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
});

router.post(
  "/",
  requireActiveLicense(),
  validateBody(createSaleSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body;
    const result = await saleService.createSale(u, {
      depotId: b.depotId,
      items: b.items.map(
        (it: {
          productId: string;
          variantId?: string | null;
          unitId?: string | null;
          quantity: number;
          discountPct?: number;
          serialNumbers?: string[] | null;
        }) => ({ ...it, serialNumbers: it.serialNumbers ?? undefined }),
      ),
      paymentMethod: b.paymentMethod,
      paymentReference: b.paymentReference ?? undefined,
      clientSaleId: b.clientSaleId ?? undefined,
      createdAt: b.createdAt ?? undefined,
      amountReceived: b.amountReceived,
      customerId: b.customerId ?? undefined,
      dueDate: b.dueDate ?? undefined,
      payments: b.payments?.map(
        (p: {
          method: "CASH" | "MTN_MOMO" | "ORANGE_MONEY";
          amount: number;
          reference?: string | null;
          clientPaymentId?: string | null;
        }) => ({
          method: p.method,
          amount: p.amount,
          reference: p.reference ?? undefined,
          clientPaymentId: p.clientPaymentId ?? undefined,
        }),
      ),
    });
    res.status(result.deduplicated ? 200 : 201).json(result);
  }),
);

// ============================ LISTE (filtres + pagination) ==================
const listSchema = pageQuerySchema.extend({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  depotId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  paymentMethod: z.enum(["CASH", "MTN_MOMO", "ORANGE_MONEY"]).optional(),
  paymentStatus: z.enum(["PAID", "PARTIAL", "CREDIT"]).optional(),
  customerId: z.string().uuid().optional(),
  status: z.enum(["COMPLETED", "VOIDED"]).optional(),
  mine: z.coerce.boolean().optional(),
});

router.get(
  "/",
  validateQuery(listSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof listSchema>;
    const { limit, offset } = pageParams(q);
    const vendorId =
      u.role === "VENDEUR" ? u.id : q.mine ? u.id : (q.vendorId ?? null);
    // Bornes calculées en JS + filtres optionnels composés en JS
    const fromTs = q.from ? new Date(`${q.from}T00:00:00.000Z`) : null;
    const toTs = q.to
      ? new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000)
      : null;
    const params: unknown[] = [u.tenantId];
    const conds = ["s.tenant_id = $1"];
    if (fromTs) conds.push(`s.created_at >= $${params.push(fromTs)}`);
    if (toTs) conds.push(`s.created_at < $${params.push(toTs)}`);
    if (q.depotId) conds.push(`s.depot_id = $${params.push(q.depotId)}`);
    if (vendorId) conds.push(`s.vendor_id = $${params.push(vendorId)}`);
    if (q.paymentMethod)
      conds.push(`s.payment_method = $${params.push(q.paymentMethod)}`);
    if (q.paymentStatus)
      conds.push(`s.payment_status = $${params.push(q.paymentStatus)}`);
    if (q.customerId)
      conds.push(`s.customer_id = $${params.push(q.customerId)}`);
    if (q.status) conds.push(`s.status = $${params.push(q.status)}`);
    // Compteurs via sous-requêtes agrégées non corrélées AVANT le WHERE (pas de fanout : 1 ligne/sale)
    const fromClause = `
      FROM sales s
      JOIN users vu ON vu.id = s.vendor_id
      JOIN depots d ON d.id = s.depot_id
      LEFT JOIN customers cu ON cu.id = s.customer_id
      LEFT JOIN (SELECT sale_id, COUNT(*)::int AS c FROM sale_items GROUP BY sale_id) lc ON lc.sale_id = s.id
      LEFT JOIN (SELECT sr2.sale_id, SUM(sri.base_qty * sri.unit_price)::float AS amt
                   FROM sale_returns sr2 JOIN sale_return_items sri ON sri.return_id = sr2.id
                  GROUP BY sr2.sale_id) ra ON ra.sale_id = s.id`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM sales s WHERE ${conds.join(" AND ")}`,
      params,
    );
    const rows = await query(
      `SELECT s.id, s.status, s.total_amount, s.payment_method, s.payment_reference, s.created_at, s.synced_at,
              s.client_sale_id, s.payment_status, s.amount_paid, s.customer_id,
              cu.name AS customer_name, vu.name AS vendor_name, d.name AS depot_name,
              COALESCE(lc.c, 0)::int AS line_count, COALESCE(ra.amt, 0)::float AS returned_amount
       ${fromClause} WHERE ${conds.join(" AND ")}
       ORDER BY s.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
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
    const s = await query(
      `SELECT s.*, vu.name AS vendor_name, d.name AS depot_name
         FROM sales s JOIN users vu ON vu.id=s.vendor_id JOIN depots d ON d.id=s.depot_id
        WHERE s.id=$1 AND s.tenant_id=$2`,
      [req.params.id!, u.tenantId],
    );
    const sale = s.rows[0];
    if (!sale) throw HttpError.notFound("Vente introuvable.");
    if (u.role === "VENDEUR" && sale.vendor_id !== u.id) {
      throw HttpError.forbidden("Accès limité à vos propres ventes.");
    }
    const items = await query(
      `SELECT si.*, p.name AS product_name, v.name AS variant_name, un.symbol AS unit_symbol
         FROM sale_items si
         JOIN products p ON p.id=si.product_id
         LEFT JOIN product_variants v ON v.id=si.variant_id
         LEFT JOIN units un ON un.id=si.unit_id
        WHERE si.sale_id=$1 ORDER BY si.id`,
      [req.params.id],
    );
    const returnRows = await query(
      `SELECT sr.id AS return_id, sr.reason, sr.created_at, usr.name AS created_by_name,
              p.name AS product_name, v.name AS variant_name, sri.base_qty, sri.unit_price
         FROM sale_returns sr
         LEFT JOIN sale_return_items sri ON sri.return_id = sr.id
         LEFT JOIN products p ON p.id = sri.product_id
         LEFT JOIN product_variants v ON v.id = sri.variant_id
         LEFT JOIN users usr ON usr.id = sr.created_by
        WHERE sr.sale_id=$1 ORDER BY sr.created_at, sr.id`,
      [req.params.id],
    );
    // Regroupement des lignes par retour (évite json_agg, portable)
    interface ReturnItem {
      productName: string;
      variantName: string | null;
      baseQty: number;
      unitPrice: number;
    }
    interface ReturnGroup {
      id: string;
      reason: string | null;
      created_at: unknown;
      created_by_name: string | null;
      items: ReturnItem[];
    }
    const byReturn = new Map<string, ReturnGroup>();
    for (const row of returnRows.rows) {
      if (!byReturn.has(row.return_id)) {
        byReturn.set(row.return_id, {
          id: row.return_id,
          reason: row.reason,
          created_at: row.created_at,
          created_by_name: row.created_by_name,
          items: [],
        });
      }
      if (row.product_name != null) {
        byReturn.get(row.return_id)!.items.push({
          productName: row.product_name,
          variantName: row.variant_name,
          baseQty: parseFloat(row.base_qty),
          unitPrice: parseFloat(row.unit_price),
        });
      }
    }
    res.json({ ...sale, items: items.rows, returns: [...byReturn.values()] });
  }),
);

router.get(
  "/:id/receipt",
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(await saleService.receiptData(u.tenantId, req.params.id!));
  }),
);

// ============================ ANNULATION (avoir) ============================
router.post(
  "/:id/void",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateParams(uuidParam),
  validateBody(z.object({ reason: z.string().trim().max(1000).optional() })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const sale = await saleService.voidSale(u, req.params.id!, req.body.reason);
    res.json({ message: "Vente annulée, stock restitué.", sale });
  }),
);

// ============================ VERSEMENTS (règlement crédit, E3) =============
router.post(
  "/:id/payments",
  requireActiveLicense(),
  validateParams(uuidParam),
  validateBody(
    z.object({
      method: z.enum(["CASH", "MTN_MOMO", "ORANGE_MONEY"]),
      amount: z.coerce.number().positive("Montant invalide").finite(),
      reference: z.string().trim().max(100).nullish(),
      clientPaymentId: z.string().uuid().nullish(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body;
    const result = await saleService.addPayment(u, req.params.id!, {
      method: b.method,
      amount: b.amount,
      reference: b.reference ?? undefined,
      clientPaymentId: b.clientPaymentId ?? undefined,
    });
    res.status(result.deduplicated ? 200 : 201).json(result);
  }),
);

// ============================ RETOURS PARTIELS ==============================
router.post(
  "/:id/returns",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateParams(uuidParam),
  validateBody(
    z.object({
      items: z
        .array(z.object({ saleItemId: z.string().uuid(), baseQty: qty }))
        .min(1)
        .max(100),
      reason: z.string().trim().max(1000).optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const result = await saleService.returnSaleItems(
      u,
      req.params.id!,
      req.body.items,
      req.body.reason,
    );
    res.status(201).json(result);
  }),
);

export default router;
