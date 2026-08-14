import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";

import {
  authenticate,
  AuthRequest,
  requireRole,
  requireSuperAdmin,
} from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import { validateBody } from "../middleware/validate";

const router = Router();
router.use(authenticate);

/** Masquage effectif des secrets (corrige SEC-04 : la version initiale
 *  préparait un masquage… puis renvoyait les valeurs en clair). */
function mask(row: {
  key: string;
  value: string;
  is_secret?: boolean;
}): string {
  const v = row.value ?? "";
  const secret = row.is_secret || /token|key|secret/i.test(row.key);
  if (!secret || v.length === 0) return v;
  return v.length <= 4 ? "••••" : `••••••••${v.slice(-4)}`;
}

// ============================ CONFIG GLOBALE (SA) ===========================
router.get(
  "/",
  requireSuperAdmin,
  h(async (_req, res) => {
    const r = await query<{
      key: string;
      value: string;
      group: string;
      description: string | null;
      is_secret: boolean;
      updated_at: string;
    }>(
      'SELECT key, value, "group", description, is_secret, updated_at FROM system_configs ORDER BY "group", key',
    );
    res.json(
      r.rows.map((row) => ({
        ...row,
        value: mask(row),
        masked: row.is_secret || /token|key|secret/i.test(row.key),
      })),
    );
  }),
);

router.put(
  "/",
  requireSuperAdmin,
  validateBody(
    z.object({
      key: z
        .string()
        .trim()
        .min(2)
        .max(100)
        .regex(/^[a-z0-9_.]+$/),
      value: z.string().max(4000),
      group: z.enum(["API", "SYSTEM", "SECURITY"]).default("API"),
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
    res.json({ message: "Configuration enregistrée." });
  }),
);

// ============================ CONFIG TENANT (ADMIN) =========================
// Clés SECRÈTES (identifiants SMS/WhatsApp) : masquées en lecture.
const TENANT_SECRET_KEYS = [
  "sms_username",
  "sms_api_key",
  "whatsapp_token",
  "whatsapp_phone_id",
] as const;
// Préférences métier lisibles en clair (interrupteurs de fonctionnalités).
// cash_session_required (E6) : « true » interdit de vendre/encaisser hors
// session de caisse ouverte.
// barcode_internal_prefix (C2) : préfixe magasin GS1 (20–29) des codes-barres
// internes générés.
const TENANT_PREF_KEYS = [
  "cash_session_required",
  "barcode_internal_prefix",
] as const;
/** Règle de validation par préférence (valeur textuelle). */
const PREF_RULES: Record<
  string,
  { check: (v: string) => boolean; hint: string }
> = {
  cash_session_required: {
    check: (v) => ["true", "false"].includes(v),
    hint: "« true » ou « false »",
  },
  barcode_internal_prefix: {
    check: (v) => /^2[0-9]$/.test(v),
    hint: "2 chiffres entre 20 et 29 (plage GS1 « magasin »)",
  },
};

router.get(
  "/tenant",
  requireRole("ADMIN"),
  h(async (req, res) => {
    const r = await query<{ key: string; value: string; is_secret: boolean }>(
      "SELECT key, value, is_secret FROM tenant_configs WHERE tenant_id=$1 ORDER BY key",
      [(req as AuthRequest).user.tenantId],
    );
    res.json(
      r.rows.map((row) =>
        row.is_secret
          ? { ...row, value: mask({ ...row, is_secret: true }), masked: true }
          : { ...row, masked: false },
      ),
    );
  }),
);

router.put(
  "/tenant",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateBody(
    z.object({
      key: z.enum([...TENANT_SECRET_KEYS, ...TENANT_PREF_KEYS]),
      value: z.string().min(1, "Valeur requise").max(4000),
    }),
  ),
  h(async (req, res) => {
    const b = req.body as { key: string; value: string };
    const t = (req as AuthRequest).user.tenantId;
    const isPref = (TENANT_PREF_KEYS as readonly string[]).includes(b.key);
    const rule = PREF_RULES[b.key];
    if (rule && !rule.check(b.value.trim())) {
      throw HttpError.badRequest(
        "CONFIG_VALUE_INVALID",
        `La préférence « ${b.key} » attend ${rule.hint}.`,
      );
    }
    await query(
      `INSERT INTO tenant_configs (tenant_id, key, value, is_secret) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value=$3, is_secret=$4`,
      [t, b.key, b.value, !isPref],
    );
    res.json({
      message: isPref
        ? "Préférence enregistrée."
        : "Clé enregistrée (masquée en lecture).",
    });
  }),
);

export default router;
