import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import { pageParams, paged, pageQuerySchema } from "../lib/pagination";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import {
  validateBody,
  validateParams,
  validateQuery,
  uuidParam,
  money,
} from "../middleware/validate";
import { notify } from "../services/notificationService";
import { toDateStr } from "../lib/dates";

const router = Router();
router.use(authenticate);

const customerInput = z.object({
  name: z.string().trim().min(1, "Nom requis").max(255),
  phone: z.string().trim().max(50).nullish(),
  email: z.string().trim().email().max(255).nullish(),
  address: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  creditLimit: money.default(0),
  /** E8 — canal de prix : WHOLESALE = grille de gros appliquée à la caisse. */
  priceChannel: z.enum(["DETAIL", "WHOLESALE"]).default("DETAIL"),
});

// ============================ CRÉATION (ADMIN + VENDEUR : le carnet de
// dettes se crée aussi à la caisse) =========================================
router.post(
  "/",
  requireActiveLicense(),
  validateBody(customerInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof customerInput>;
    const r = await query(
      `INSERT INTO customers (tenant_id, name, phone, email, address, notes, credit_limit, price_channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        u.tenantId,
        b.name,
        b.phone ?? null,
        b.email ?? null,
        b.address ?? null,
        b.notes ?? null,
        b.creditLimit,
        b.priceChannel,
      ],
    );
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "CREATE",
      entity: "customer",
      entityId: r.rows[0]!.id,
      newState: { name: b.name, creditLimit: b.creditLimit },
    });
    res.status(201).json(r.rows[0]);
  }),
);

// ============================ LISTE (recherche + débiteurs) =================
router.get(
  "/",
  validateQuery(
    pageQuerySchema.extend({
      q: z.string().trim().max(100).optional(),
      withDebt: z.coerce.boolean().optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      page: number;
      size: number;
      q?: string;
      withDebt?: boolean;
    };
    const { limit, offset } = pageParams(q);
    const params: unknown[] = [u.tenantId];
    const conds = ["tenant_id = $1"];
    if (q.q) {
      const idx = params.push(`%${q.q.toLowerCase()}%`);
      conds.push(`(LOWER(name) LIKE $${idx} OR phone LIKE $${idx})`);
    }
    if (q.withDebt) conds.push("balance > 0");
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM customers ${where}`,
      params,
    );
    const rows = await query(
      `SELECT * FROM customers ${where} ORDER BY name LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, count.rows[0]!.n, q));
  }),
);

// ============================ DÉTAIL + VIEILLISSEMENT DES CRÉANCES =========
router.get(
  "/:id",
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const c = await query(
      "SELECT * FROM customers WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    if (!c.rows[0]) throw HttpError.notFound("Client introuvable.");
    const sales = await query<{
      id: string;
      created_at: string;
      due_date: string | null;
      total_amount: number;
      amount_paid: number;
      payment_status: string;
      status: string;
    }>(
      `SELECT id, created_at, due_date, total_amount::float, amount_paid::float, payment_status, status
         FROM sales WHERE tenant_id=$1 AND customer_id=$2 AND status='COMPLETED'
          AND payment_status <> 'PAID' ORDER BY created_at ASC`,
      [u.tenantId, req.params.id!],
    );
    // Vieillissement par tranches (référence = échéance, sinon date de vente) —
    // calcul applicatif (soustraction de dates non portable).
    const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
    const aging = { d0_30: 0, d31_60: 0, d61_90: 0, over90: 0 };
    const debts = sales.rows.map((s) => {
      const outstanding =
        Math.round((s.total_amount - s.amount_paid) * 100) / 100;
      const refStr = toDateStr(s.due_date) ?? toDateStr(s.created_at) ?? "";
      const ref = new Date(refStr).getTime();
      const days = Math.max(0, Math.round((today - ref) / 86400000));
      if (days <= 30)
        aging.d0_30 = Math.round((aging.d0_30 + outstanding) * 100) / 100;
      else if (days <= 60)
        aging.d31_60 = Math.round((aging.d31_60 + outstanding) * 100) / 100;
      else if (days <= 90)
        aging.d61_90 = Math.round((aging.d61_90 + outstanding) * 100) / 100;
      else aging.over90 = Math.round((aging.over90 + outstanding) * 100) / 100;
      return {
        saleId: s.id,
        date: toDateStr(s.created_at),
        dueDate: toDateStr(s.due_date),
        total: s.total_amount,
        paid: s.amount_paid,
        outstanding,
        days,
        status: s.payment_status,
      };
    });
    const recentPayments = await query(
      `SELECT p.id, p.amount::float, p.method, p.created_at, s.id AS sale_id
         FROM sale_payments p JOIN sales s ON s.id=p.sale_id
        WHERE p.tenant_id=$1 AND p.customer_id=$2
        ORDER BY p.created_at DESC LIMIT 20`,
      [u.tenantId, req.params.id!],
    );
    res.json({
      ...c.rows[0],
      aging,
      debts,
      recentPayments: recentPayments.rows,
    });
  }),
);

// ============================ MISE À JOUR (ADMIN) ===========================
router.patch(
  "/:id",
  requireRole("ADMIN"),
  validateParams(uuidParam),
  validateBody(
    customerInput.partial().extend({ isActive: z.boolean().optional() }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const prev = await query(
      "SELECT * FROM customers WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    if (!prev.rows[0]) throw HttpError.notFound("Client introuvable.");
    const b = req.body;
    const r = await query(
      `UPDATE customers SET name=COALESCE($3,name), phone=COALESCE($4,phone),
              email=COALESCE($5,email), address=COALESCE($6,address),
              notes=COALESCE($7,notes), credit_limit=COALESCE($8,credit_limit),
              is_active=COALESCE($9,is_active), price_channel=COALESCE($10,price_channel),
              updated_at=now()
        WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        req.params.id!,
        u.tenantId,
        b.name ?? null,
        b.phone ?? null,
        b.email ?? null,
        b.address ?? null,
        b.notes ?? null,
        b.creditLimit ?? null,
        b.isActive ?? null,
        b.priceChannel ?? null,
      ],
    );
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "UPDATE",
      entity: "customer",
      entityId: req.params.id!,
      previousState: prev.rows[0],
      newState: r.rows[0],
    });
    res.json(r.rows[0]);
  }),
);

// ============================ RELANCE (SMS / WhatsApp) ======================
router.post(
  "/:id/remind",
  requireRole("ADMIN"),
  validateParams(uuidParam),
  validateBody(
    z.object({
      channel: z.enum(["SMS", "WHATSAPP"]).default("SMS"),
      message: z.string().trim().min(5).max(320).optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as { channel: "SMS" | "WHATSAPP"; message?: string };
    const c = await query<{
      id: string;
      name: string;
      phone: string | null;
      balance: number;
    }>(
      "SELECT id, name, phone, balance::float FROM customers WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    const customer = c.rows[0];
    if (!customer) throw HttpError.notFound("Client introuvable.");
    if (!customer.phone)
      throw HttpError.badRequest(
        "REMIND_NO_PHONE",
        "Ce client n'a pas de numéro de téléphone : relance impossible.",
      );
    const t = await query<{ name: string; currency: string }>(
      "SELECT name, currency FROM tenants WHERE id=$1",
      [u.tenantId],
    );
    const message =
      b.message ??
      `Bonjour ${customer.name}, votre solde chez ${t.rows[0]!.name} est de ${customer.balance.toLocaleString("fr-FR")} ${t.rows[0]!.currency}. Merci de passer régulariser.`;
    const day = new Date().toISOString().slice(0, 10);
    const status = await notify({
      tenantId: u.tenantId,
      channel: b.channel,
      phone: customer.phone,
      message,
      type: "DEBT_REMINDER",
      dedupeKey: `REMIND:${day}:${customer.id}:${b.channel}`,
    });
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "REMIND",
      entity: "customer",
      entityId: customer.id,
      details: `Relance ${b.channel} → ${customer.phone} (${status})`,
    });
    res.json({ status, channel: b.channel, message });
  }),
);

export default router;
