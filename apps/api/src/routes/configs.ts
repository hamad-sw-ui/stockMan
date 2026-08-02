import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db';
import { h } from '../lib/asyncHandler';

import { authenticate, AuthRequest, requireRole, requireSuperAdmin } from '../middleware/auth';
import { requireActiveLicense } from '../middleware/license';
import { validateBody } from '../middleware/validate';

const router = Router();
router.use(authenticate);

/** Masquage effectif des secrets (corrige SEC-04 : la version initiale
 *  préparait un masquage… puis renvoyait les valeurs en clair). */
function mask(row: { key: string; value: string; is_secret?: boolean }): string {
  const v = row.value ?? '';
  const secret = row.is_secret || /token|key|secret/i.test(row.key);
  if (!secret || v.length === 0) return v;
  return v.length <= 4 ? '••••' : `••••••••${v.slice(-4)}`;
}

// ============================ CONFIG GLOBALE (SA) ===========================
router.get(
  '/',
  requireSuperAdmin,
  h(async (_req, res) => {
    const r = await query<{ key: string; value: string; group: string; description: string | null; is_secret: boolean; updated_at: string }>('SELECT key, value, "group", description, is_secret, updated_at FROM system_configs ORDER BY "group", key');
    res.json(r.rows.map((row) => ({ ...row, value: mask(row), masked: row.is_secret || /token|key|secret/i.test(row.key) })));
  }),
);

router.put(
  '/',
  requireSuperAdmin,
  validateBody(
    z.object({
      key: z.string().trim().min(2).max(100).regex(/^[a-z0-9_.]+$/),
      value: z.string().max(4000),
      group: z.enum(['API', 'SYSTEM', 'SECURITY']).default('API'),
      description: z.string().trim().max(1000).nullish(),
      isSecret: z.boolean().default(true),
    }),
  ),
  h(async (req, res) => {
    const b = req.body;
    await query(
      `INSERT INTO system_configs (key, value, "group", description, is_secret, updated_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (key) DO UPDATE SET value=$2, "group"=$3, description=COALESCE($4, system_configs.description), is_secret=$5, updated_at=now()`,
      [b.key, b.value, b.group, b.description ?? null, b.isSecret],
    );
    res.json({ message: 'Configuration enregistrée.' });
  }),
);

// ============================ CONFIG TENANT (ADMIN) =========================
const TENANT_KEYS = ['sms_username', 'sms_api_key', 'whatsapp_token', 'whatsapp_phone_id'] as const;

router.get(
  '/tenant',
  requireRole('ADMIN'),
  h(async (req, res) => {
    const r = await query<{ key: string; value: string; is_secret: boolean }>('SELECT key, value, is_secret FROM tenant_configs WHERE tenant_id=$1 ORDER BY key', [
      (req as AuthRequest).user.tenantId,
    ]);
    res.json(r.rows.map((row) => ({ ...row, value: mask({ ...row, is_secret: true }) })));
  }),
);

router.put(
  '/tenant',
  requireRole('ADMIN'),
  requireActiveLicense(),
  validateBody(z.object({ key: z.enum(TENANT_KEYS), value: z.string().min(1, 'Valeur requise').max(4000) })),
  h(async (req, res) => {
    const b = req.body;
    const t = (req as AuthRequest).user.tenantId;
    await query(
      `INSERT INTO tenant_configs (tenant_id, key, value, is_secret) VALUES ($1,$2,$3,true)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value=$3`,
      [t, b.key, b.value],
    );
    res.json({ message: 'Clé enregistrée (masquée en lecture).' });
  }),
);

export default router;
