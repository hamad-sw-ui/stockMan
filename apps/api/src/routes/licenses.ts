import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db';
import { h } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { authenticate, AuthRequest, requireSuperAdmin } from '../middleware/auth';
import { validateBody, validateParams, uuidParam } from '../middleware/validate';

const router = Router();
router.use(authenticate);

// ============================ PLANS =========================================
router.get(
  '/plans',
  h(async (_req, res) => {
    const r = await query('SELECT code, name, max_users, max_depots, monthly_price::float FROM plans ORDER BY monthly_price');
    res.json(r.rows);
  }),
);

router.post(
  '/plans',
  requireSuperAdmin,
  validateBody(
    z.object({
      code: z.string().trim().min(2).max(30).regex(/^[A-Z0-9_]+$/),
      name: z.string().trim().min(2).max(100),
      maxUsers: z.coerce.number().int().min(1).max(10000),
      maxDepots: z.coerce.number().int().min(1).max(1000),
      monthlyPrice: z.coerce.number().min(0),
    }),
  ),
  h(async (req, res) => {
    const b = req.body;
    const r = await query('INSERT INTO plans (code, name, max_users, max_depots, monthly_price) VALUES ($1,$2,$3,$4,$5) RETURNING *', [
      b.code, b.name, b.maxUsers, b.maxDepots, b.monthlyPrice,
    ]);
    res.status(201).json(r.rows[0]);
  }),
);

router.patch(
  '/plans/:code',
  requireSuperAdmin,
  validateBody(z.object({ name: z.string().trim().min(2).max(100).optional(), maxUsers: z.coerce.number().int().min(1).optional(), maxDepots: z.coerce.number().int().min(1).optional(), monthlyPrice: z.coerce.number().min(0).optional() })),
  h(async (req, res) => {
    const b = req.body;
    const r = await query(
      'UPDATE plans SET name=COALESCE($2,name), max_users=COALESCE($3,max_users), max_depots=COALESCE($4,max_depots), monthly_price=COALESCE($5,monthly_price) WHERE code=$1 RETURNING *',
      [req.params.code, b.name ?? null, b.maxUsers ?? null, b.maxDepots ?? null, b.monthlyPrice ?? null],
    );
    if (!r.rows[0]) throw HttpError.notFound('Plan introuvable.');
    res.json(r.rows[0]);
  }),
);

// ============================ LICENCES ======================================
router.get(
  '/',
  requireSuperAdmin,
  h(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const r = await query(
      `SELECT l.*, t.name AS tenant_name, p.name AS plan_name, p.monthly_price::float
         FROM licenses l JOIN tenants t ON t.id=l.tenant_id JOIN plans p ON p.code=l.plan_code
        ${status ? 'WHERE l.status = $1' : ''}
        ORDER BY l.end_date ASC LIMIT 500`,
      status ? [status] : [],
    );
    res.json(r.rows);
  }),
);

router.post(
  '/',
  requireSuperAdmin,
  validateBody(
    z.object({
      tenantId: z.string().uuid(),
      planCode: z.string(),
      startDate: z.string().date(),
      months: z.coerce.number().int().min(1).max(36).default(1),
      notes: z.string().trim().max(2000).nullish(),
    }),
  ),
  h(async (req, res) => {
    const sa = (req as AuthRequest).user;
    const b = req.body;
    const plan = await query('SELECT * FROM plans WHERE code=$1', [b.planCode]);
    if (!plan.rows[0]) throw HttpError.badRequest('PLAN_UNKNOWN', 'Plan inconnu.');
    const status = b.planCode === 'TRIAL' ? 'TRIAL' : 'ACTIVE';
    const r = await query(
      `INSERT INTO licenses (tenant_id, plan_code, status, start_date, end_date, max_users, max_depots, notes)
       VALUES ($1,$2,$3,$4::date, ($4::date + ($5::int || ' months')::interval)::date, $6, $7, $8) RETURNING *`,
      [b.tenantId, b.planCode, status, b.startDate, b.months, plan.rows[0]!.max_users, plan.rows[0]!.max_depots, b.notes ?? null],
    );
    await writeAudit({ tenantId: sa.tenantId, userId: sa.id, userName: sa.name, action: 'LICENSE', entity: 'license', entityId: r.rows[0]?.id ?? null, newState: r.rows[0] });
    res.status(201).json(r.rows[0]);
  }),
);

/** Renouvellement : prolonge de N mois à partir de la fin actuelle (ou d'aujourd'hui si dépassée). */
router.post(
  '/:id/renew',
  requireSuperAdmin,
  validateParams(uuidParam),
  validateBody(z.object({ months: z.coerce.number().int().min(1).max(36).default(1), notes: z.string().trim().max(2000).nullish() })),
  h(async (req, res) => {
    const sa = (req as AuthRequest).user;
    const r = await query(
      `UPDATE licenses
          SET end_date = ((CASE WHEN end_date > CURRENT_DATE THEN end_date ELSE CURRENT_DATE END)
                          + ($2::int || ' months')::interval)::date,
              status = CASE WHEN plan_code='TRIAL' THEN 'TRIAL' ELSE 'ACTIVE' END,
              notes = COALESCE($3, notes), updated_at=now()
        WHERE id=$1 RETURNING *`,
      [req.params.id!, req.body.months, req.body.notes ?? null],
    );
    if (!r.rows[0]) throw HttpError.notFound('Licence introuvable.');
    await writeAudit({ tenantId: sa.tenantId, userId: sa.id, userName: sa.name, action: 'LICENSE', entity: 'license', entityId: req.params.id!, newState: r.rows[0] });
    res.json(r.rows[0]);
  }),
);

export default router;
