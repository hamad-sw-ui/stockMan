import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";
import { pageParams, paged, pageQuerySchema } from "../lib/pagination";
import {
  authenticate,
  AuthRequest,
  requireRole,
  requireSuperAdmin,
} from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import {
  validateBody,
  validateParams,
  validateQuery,
  uuidParam,
} from "../middleware/validate";
import { notify } from "../services/notificationService";

const router = Router();
router.use(authenticate);

// ============================ CENTRE DE NOTIFICATIONS =======================
router.get(
  "/",
  validateQuery(
    pageQuerySchema.extend({
      type: z.string().optional(),
      status: z.enum(["PENDING", "SENT", "FAILED", "READ"]).optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      page: number;
      size: number;
      type?: string;
      status?: string;
    };
    const { limit, offset } = pageParams(q);
    const params: unknown[] = [u.tenantId];
    const conds = ["tenant_id = $1"];
    if (q.type) conds.push(`type = $${params.push(q.type)}`);
    if (q.status) conds.push(`status = $${params.push(q.status)}`);
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM notifications ${where}`,
      params,
    );
    const rows = await query(
      `SELECT id, type, channel, message, status, phone, created_at, provider_response
         FROM notifications ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const unread = await query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM notifications WHERE tenant_id=$1 AND channel='IN_APP' AND status='SENT'",
      [u.tenantId],
    );
    res.json({
      ...paged(rows.rows, count.rows[0]!.n, q),
      unread: unread.rows[0]!.n,
    });
  }),
);

router.patch(
  "/:id/read",
  validateParams(uuidParam),
  h(async (req, res) => {
    const r = await query(
      "UPDATE notifications SET status='READ' WHERE id=$1 AND tenant_id=$2 AND channel='IN_APP' RETURNING id",
      [req.params.id!, (req as AuthRequest).user.tenantId],
    );
    if (!r.rows[0]) throw HttpError.notFound("Notification introuvable.");
    res.json({ message: "Notification marquée comme lue." });
  }),
);

router.post(
  "/read-all",
  h(async (req, res) => {
    await query(
      "UPDATE notifications SET status='READ' WHERE tenant_id=$1 AND channel='IN_APP' AND status='SENT'",
      [(req as AuthRequest).user.tenantId],
    );
    res.json({ message: "Toutes les notifications sont marquées lues." });
  }),
);

// ============================ PARAMÈTRES D'ALERTES ==========================
router.get(
  "/settings",
  requireRole("ADMIN"),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    await query(
      "INSERT INTO notification_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING",
      [u.tenantId],
    );
    const r = await query(
      "SELECT * FROM notification_settings WHERE tenant_id=$1",
      [u.tenantId],
    );
    res.json(r.rows[0]);
  }),
);

router.put(
  "/settings",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateBody(
    z.object({
      alertPhone: z.string().trim().max(50).nullish(),
      alertWhatsapp: z.string().trim().max(50).nullish(),
      lowStockEnabled: z.boolean().optional(),
      expiryAlertEnabled: z.boolean().optional(),
      dailyReportEnabled: z.boolean().optional(),
      dailyReportTime: z
        .string()
        .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Format HH:MM attendu")
        .optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body;
    const r = await query(
      `INSERT INTO notification_settings (tenant_id, alert_phone, alert_whatsapp, low_stock_enabled, expiry_alert_enabled, daily_report_enabled, daily_report_time)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::time, '20:00'))
       ON CONFLICT (tenant_id) DO UPDATE SET
         alert_phone=EXCLUDED.alert_phone, alert_whatsapp=EXCLUDED.alert_whatsapp,
         low_stock_enabled=EXCLUDED.low_stock_enabled, expiry_alert_enabled=EXCLUDED.expiry_alert_enabled,
         daily_report_enabled=EXCLUDED.daily_report_enabled, daily_report_time=EXCLUDED.daily_report_time
       RETURNING *`,
      [
        u.tenantId,
        b.alertPhone ?? null,
        b.alertWhatsapp ?? null,
        b.lowStockEnabled ?? true,
        b.expiryAlertEnabled ?? true,
        b.dailyReportEnabled ?? true,
        b.dailyReportTime ?? null,
      ],
    );
    res.json(r.rows[0]);
  }),
);

/** Envoi d'un message de test (vérifie la configuration du canal). */
router.post(
  "/test",
  requireRole("ADMIN"),
  validateBody(
    z.object({
      channel: z.enum(["SMS", "WHATSAPP"]),
      phone: z.string().trim().min(8).max(20),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const result = await notify({
      tenantId: u.tenantId,
      channel: req.body.channel,
      phone: req.body.phone,
      type: "SYSTEM",
      message:
        "✅ Test StockMan : vos notifications sont correctement configurées.",
    });
    res.json({ result });
  }),
);

// ============================ SUPERVISION GLOBALE (SA) ======================
router.get(
  "/supervision",
  requireSuperAdmin,
  h(async (_req, res) => {
    const [byStatus, lastFailures] = await Promise.all([
      query(`SELECT status, channel, COUNT(*)::int AS n FROM notifications
              WHERE created_at >= now() - INTERVAL '7 days' GROUP BY status, channel ORDER BY channel, status`),
      query(
        `SELECT n.created_at, t.name AS tenant, n.type, n.channel, n.message, n.provider_response
           FROM notifications n JOIN tenants t ON t.id=n.tenant_id
          WHERE n.status='FAILED' ORDER BY n.created_at DESC LIMIT 20`,
      ),
    ]);
    res.json({ byStatus: byStatus.rows, lastFailures: lastFailures.rows });
  }),
);

export default router;
