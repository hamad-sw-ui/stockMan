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
import { validateQuery } from "../middleware/validate";

const router = Router();
router.use(authenticate);

const auditQuery = pageQuerySchema.extend({
  entity: z.string().trim().max(60).optional(),
  userId: z.string().uuid().optional(),
  action: z.string().trim().max(60).optional(),
  depotId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  tenantId: z.string().uuid().optional(), // Super Admin uniquement
});

router.get(
  "/",
  requireRole("ADMIN"),
  validateQuery(auditQuery),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof auditQuery>;
    const tenantId =
      u.role === "SUPER_ADMIN" ? (q.tenantId ?? null) : u.tenantId;
    if (!tenantId)
      throw HttpError.badRequest(
        "TENANT_REQUIRED",
        "Précisez tenantId pour la consultation globale.",
      );
    const { limit, offset } = pageParams(q);
    const fromTs = q.from ? new Date(`${q.from}T00:00:00.000Z`) : null;
    const toTs = q.to
      ? new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000)
      : null;
    const params: unknown[] = [tenantId];
    const conds = ["a.tenant_id = $1"];
    if (q.entity) conds.push(`a.entity = $${params.push(q.entity)}`);
    if (q.userId) conds.push(`a.user_id = $${params.push(q.userId)}`);
    if (q.action) conds.push(`a.action = $${params.push(q.action)}`);
    if (q.depotId) conds.push(`a.depot_id = $${params.push(q.depotId)}`);
    if (fromTs) conds.push(`a.created_at >= $${params.push(fromTs)}`);
    if (toTs) conds.push(`a.created_at < $${params.push(toTs)}`);
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_logs a ${where}`,
      params,
    );
    const rows = await query(
      `SELECT a.*, usr.name AS user_full_name, d.name AS depot_name
         FROM audit_logs a
         LEFT JOIN users usr ON usr.id=a.user_id
         LEFT JOIN depots d ON d.id=a.depot_id
        ${where} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, count.rows[0]!.n, q));
  }),
);

// Supervision Super Admin (audit des actions éditeur elles-mêmes)
router.get(
  "/supervision",
  requireSuperAdmin,
  h(async (_req, res) => {
    const r = await query(
      `SELECT a.*, t.name AS tenant_name FROM audit_logs a JOIN tenants t ON t.id=a.tenant_id
        ORDER BY a.created_at DESC LIMIT 50`,
    );
    res.json(r.rows);
  }),
);

export default router;
