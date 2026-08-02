import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { query, withTransaction } from '../config/db';
import { h } from '../lib/asyncHandler';
import { toDateStr } from '../lib/dates';
import { HttpError } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { pageParams, paged, pageQuerySchema } from '../lib/pagination';
import { authenticate, AuthRequest, requireRole, requireSuperAdmin, signAccessToken } from '../middleware/auth';
import { requireActiveLicense } from '../middleware/license';
import { validateBody, validateParams, validateQuery, uuidParam } from '../middleware/validate';
import bcrypt from 'bcryptjs';
import { getEnv } from '../config/env';

const router = Router();
router.use(authenticate);

// ============================ TENANT COURANT (ADMIN) ========================
router.get(
  '/current',
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const t = await query('SELECT id, name, subdomain, logo, primary_color, phone, currency, timezone, is_active FROM tenants WHERE id=$1', [u.tenantId]);
    const license = await query(
      `SELECT l.*, p.name AS plan_name, p.monthly_price::float FROM licenses l JOIN plans p ON p.code=l.plan_code
        WHERE l.tenant_id=$1 ORDER BY l.end_date DESC LIMIT 1`,
      [u.tenantId],
    );
    const users = await query(`SELECT COUNT(*)::int AS n FROM users WHERE tenant_id=$1 AND is_active AND role <> 'SUPER_ADMIN'`, [u.tenantId]);
    const depots = await query('SELECT COUNT(*)::int AS n FROM depots WHERE tenant_id=$1 AND is_active', [u.tenantId]);
    res.json({ ...t.rows[0], license: license.rows[0] ?? null, usage: { users: users.rows[0]!.n, depots: depots.rows[0]!.n } });
  }),
);

router.patch(
  '/current',
  requireRole('ADMIN'),
  requireActiveLicense(),
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(255).optional(),
      logo: z.string().max(300_000).nullish(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue').optional(),
      phone: z.string().trim().max(50).nullish(),
      currency: z.string().trim().max(10).optional(),
      timezone: z.string().trim().max(64).optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const prev = await query('SELECT * FROM tenants WHERE id=$1', [u.tenantId]);
    const b = req.body;
    const r = await query(
      `UPDATE tenants SET name=COALESCE($2,name), logo=COALESCE($3,logo), primary_color=COALESCE($4,primary_color),
              phone=COALESCE($5,phone), currency=COALESCE($6,currency), timezone=COALESCE($7,timezone), updated_at=now()
        WHERE id=$1 RETURNING id, name, logo, primary_color, phone, currency, timezone`,
      [u.tenantId, b.name ?? null, b.logo ?? null, b.primaryColor ?? null, b.phone ?? null, b.currency ?? null, b.timezone ?? null],
    );
    await writeAudit({ tenantId: u.tenantId, userId: u.id, userName: u.name, action: 'UPDATE', entity: 'tenant', entityId: u.tenantId, previousState: prev.rows[0], newState: r.rows[0] });
    res.json(r.rows[0]);
  }),
);

// ============================ CONSOLE SUPER ADMIN ===========================
router.get(
  '/',
  requireSuperAdmin,
  validateQuery(pageQuerySchema.extend({ search: z.string().trim().default('') })),
  h(async (req, res) => {
    const q = req.query as unknown as { page: number; size: number; search: string };
    const { limit, offset } = pageParams(q);
    // Recherche email via table dérivée non corrélée ; agrégats idem (1:1, sans fanout)
    const joinSearch = `LEFT JOIN (SELECT DISTINCT tenant_id FROM users WHERE ($1='' OR email ILIKE '%'||$1||'%')) ux ON ux.tenant_id = t.id`;
    const where = `WHERE ($1 = '' OR t.name ILIKE '%'||$1||'%' OR ux.tenant_id IS NOT NULL)`;
    const count = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM tenants t ${joinSearch} ${where}`, [q.search]);
    const rows = await query<{ id: string; [k: string]: unknown }>(
      `SELECT t.*,
              COALESCE(uc.c, 0)::int AS user_count,
              COALESCE(dc.c, 0)::int AS depot_count,
              COALESCE(rv.s, 0)::float AS revenue
         FROM tenants t
         ${joinSearch}
         LEFT JOIN (SELECT tenant_id, COUNT(*)::int AS c FROM users GROUP BY tenant_id) uc ON uc.tenant_id = t.id
         LEFT JOIN (SELECT tenant_id, COUNT(*)::int AS c FROM depots GROUP BY tenant_id) dc ON dc.tenant_id = t.id
         LEFT JOIN (SELECT tenant_id, SUM(total_amount)::float AS s FROM sales WHERE status='COMPLETED' GROUP BY tenant_id) rv ON rv.tenant_id = t.id
        ${where}
        ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [q.search],
    );
    // Dernière licence par tenant : 2ᵉ requête + regroupement JS (portable, sans LATERAL)
    const ids = rows.rows.map((r) => r.id);
    const licenseByTenant = new Map<string, { planCode: string; status: string; endDate: string | null }>();
    if (ids.length > 0) {
      const ph = ids.map((_, i) => `$${i + 1}`).join(',');
      const lic = await query<{ tenant_id: string; plan_code: string; status: string; end_date: string }>(
        `SELECT tenant_id, plan_code, status, end_date FROM licenses
          WHERE tenant_id IN (${ph})
          ORDER BY end_date DESC, created_at DESC`,
        ids,
      );
      for (const l of lic.rows) {
        if (!licenseByTenant.has(l.tenant_id)) {
          licenseByTenant.set(l.tenant_id, { planCode: l.plan_code, status: l.status, endDate: toDateStr(l.end_date) ?? l.end_date });
        }
      }
    }
    res.json(
      paged(
        rows.rows.map((r) => ({
          ...r,
          license: licenseByTenant.get(r.id) ?? null,
        })),
        count.rows[0]!.n,
        q,
      ),
    );
  }),
);

router.post(
  '/',
  requireSuperAdmin,
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(255),
      adminName: z.string().trim().min(2).max(255),
      adminEmail: z.string().trim().email(),
      planCode: z.string().default('TRIAL'),
      trialDays: z.coerce.number().int().min(0).max(90).default(14),
      phone: z.string().trim().max(50).nullish(),
    }),
  ),
  h(async (req, res) => {
    const sa = (req as AuthRequest).user;
    const b = req.body;
    const tempPassword = crypto.randomBytes(6).toString('base64url') + '1A';
    const created = await withTransaction(async (client) => {
      const plan = await client.query('SELECT * FROM plans WHERE code=$1', [b.planCode]);
      if (!plan.rows[0]) throw HttpError.badRequest('PLAN_UNKNOWN', 'Plan inconnu.');
      const t = await client.query('INSERT INTO tenants (name, phone) VALUES ($1,$2) RETURNING id', [b.name, b.phone ?? null]);
      const tenantId = t.rows[0]!.id;
      const status = b.planCode === 'TRIAL' ? 'TRIAL' : 'ACTIVE';
      const days = b.planCode === 'TRIAL' ? b.trialDays : 30;
      await client.query(
        `INSERT INTO licenses (tenant_id, plan_code, status, start_date, end_date, max_users, max_depots)
         VALUES ($1,$2,$3,CURRENT_DATE, CURRENT_DATE + $4::int, $5, $6)`,
        [tenantId, b.planCode, status, days, plan.rows[0]!.max_users, plan.rows[0]!.max_depots],
      );
      const hash = await bcrypt.hash(tempPassword, getEnv().BCRYPT_ROUNDS);
      await client.query(
        "INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,'ADMIN')",
        [tenantId, b.adminName, b.adminEmail.toLowerCase(), hash],
      );
      await client.query('INSERT INTO notification_settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING', [tenantId]);
      await client.query("INSERT INTO depots (tenant_id, name) VALUES ($1, 'Dépôt Principal')", [tenantId]);
      await client.query(
        `INSERT INTO units (tenant_id, name, symbol, base_value, is_base) VALUES
          ($1,'Pièce','Pce',1,true), ($1,'Carton','Ctn',12,false) ON CONFLICT (tenant_id, name) DO NOTHING`,
        [tenantId],
      );
      await writeAudit({ tenantId: sa.tenantId, userId: sa.id, userName: sa.name, action: 'CREATE', entity: 'tenant', entityId: tenantId, newState: b }, client);
      return { tenantId };
    });
    res.status(201).json({ ...created, adminEmail: b.adminEmail, temporaryPassword: tempPassword });
  }),
);

router.get(
  '/:id',
  requireSuperAdmin,
  validateParams(uuidParam),
  h(async (req, res) => {
    const t = await query('SELECT * FROM tenants WHERE id=$1', [req.params.id]);
    if (!t.rows[0]) throw HttpError.notFound('Tenant introuvable.');
    const [users, depots, licenses, stats] = await Promise.all([
      query('SELECT id, name, email, role, is_active, created_at FROM users WHERE tenant_id=$1 ORDER BY created_at', [req.params.id]),
      query('SELECT id, name, address, is_active FROM depots WHERE tenant_id=$1 ORDER BY name', [req.params.id]),
      query('SELECT l.*, p.name AS plan_name FROM licenses l JOIN plans p ON p.code=l.plan_code WHERE l.tenant_id=$1 ORDER BY l.end_date DESC', [req.params.id]),
      query(
        `SELECT COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END),0)::float AS revenue,
                COUNT(CASE WHEN status='COMPLETED' THEN 1 END)::int AS sales_count FROM sales WHERE tenant_id=$1`,
        [req.params.id],
      ),
    ]);
    res.json({ ...t.rows[0], users: users.rows, depots: depots.rows, licenses: licenses.rows, stats: stats.rows[0] });
  }),
);

router.patch(
  '/:id',
  requireSuperAdmin,
  validateParams(uuidParam),
  validateBody(z.object({ name: z.string().trim().min(2).max(255).optional(), phone: z.string().trim().max(50).nullish(), subdomain: z.string().trim().max(100).nullish() })),
  h(async (req, res) => {
    const b = req.body;
    const r = await query(
      'UPDATE tenants SET name=COALESCE($2,name), phone=COALESCE($3,phone), subdomain=COALESCE($4,subdomain), updated_at=now() WHERE id=$1 RETURNING *',
      [req.params.id!, b.name ?? null, b.phone ?? null, b.subdomain ?? null],
    );
    if (!r.rows[0]) throw HttpError.notFound('Tenant introuvable.');
    res.json(r.rows[0]);
  }),
);

router.post(
  '/:id/status',
  requireSuperAdmin,
  validateParams(uuidParam),
  validateBody(z.object({ isActive: z.boolean() })),
  h(async (req, res) => {
    const sa = (req as AuthRequest).user;
    const r = await withTransaction(async (client) => {
      const upd = await client.query('UPDATE tenants SET is_active=$2, updated_at=now() WHERE id=$1 RETURNING name, is_active', [
        req.params.id!, req.body.isActive,
      ]);
      if (!upd.rows[0]) throw HttpError.notFound('Tenant introuvable.');
      if (!req.body.isActive) {
        await client.query(
          'UPDATE refresh_tokens rt SET revoked_at=now() FROM users usr WHERE rt.user_id=usr.id AND usr.tenant_id=$1 AND rt.revoked_at IS NULL',
          [req.params.id],
        );
      }
      return upd.rows[0];
    });
    await writeAudit({ tenantId: sa.tenantId, userId: sa.id, userName: sa.name, action: 'UPDATE', entity: 'tenant', entityId: req.params.id!, newState: r });
    res.json({ message: `Tenant « ${r.name} » ${req.body.isActive ? 'réactivé' : 'suspendu'}.` });
  }),
);

/** Impersonation support (journalisée dans le tenant cible). */
router.post(
  '/:id/impersonate',
  requireSuperAdmin,
  validateParams(uuidParam),
  h(async (req, res) => {
    const sa = (req as AuthRequest).user;
    const admin = await query(
      `SELECT usr.*, t.is_active AS tenant_active FROM users usr JOIN tenants t ON t.id=usr.tenant_id
        WHERE usr.tenant_id=$1 AND usr.role='ADMIN' AND usr.is_active ORDER BY usr.created_at ASC LIMIT 1`,
      [req.params.id],
    );
    const u = admin.rows[0];
    if (!u) throw HttpError.notFound('Aucun administrateur actif sur ce tenant.');
    if (!u.tenant_active) throw HttpError.forbidden('Tenant suspendu : impersonation impossible.');
    const token = signAccessToken({ id: u.id, tenantId: u.tenant_id, role: u.role, name: u.name, depotId: u.depot_id, imp: true });
    await writeAudit({ tenantId: u.tenant_id, userId: sa.id, userName: `${sa.name} (support)`, action: 'IMPERSONATE', entity: 'user', entityId: u.id, details: `Session support ouverte par le Super Admin via le compte de ${u.name}.` });
    res.json({
      accessToken: token,
      user: { id: u.id, name: u.name, email: u.email, role: u.role, depotId: u.depot_id, tenantId: u.tenant_id, impersonated: true },
    });
  }),
);

/** SA : réinitialise le mot de passe du gérant d'un tenant. */
router.post(
  '/:id/reset-admin-password',
  requireSuperAdmin,
  validateParams(uuidParam),
  h(async (req, res) => {
    const admin = await query(
      "SELECT id, email FROM users WHERE tenant_id=$1 AND role='ADMIN' ORDER BY created_at ASC LIMIT 1",
      [req.params.id],
    );
    const u = admin.rows[0];
    if (!u) throw HttpError.notFound('Aucun administrateur sur ce tenant.');
    const temp = crypto.randomBytes(6).toString('base64url') + '1A';
    const hash = await bcrypt.hash(temp, getEnv().BCRYPT_ROUNDS);
    await query('UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1', [u.id, hash]);
    await query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [u.id]);
    res.json({ message: `Mot de passe réinitialisé pour ${u.email}`, temporaryPassword: temp });
  }),
);

export default router;
