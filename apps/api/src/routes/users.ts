import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { query, withTransaction } from "../config/db";
import { getEnv } from "../config/env";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import {
  validateBody,
  validateParams,
  validateQuery,
  uuidParam,
} from "../middleware/validate";
import { passwordSchema } from "./auth";

const router = Router();
router.use(authenticate);

const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, "Le PIN comporte 4 à 6 chiffres");

// ============================ LISTE =========================================
router.get(
  "/",
  requireRole("ADMIN"),
  validateQuery(
    z.object({
      role: z.enum(["ADMIN", "VENDEUR"]).optional(),
      includeInactive: z.coerce.boolean().default(false),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      role?: string;
      includeInactive: boolean;
    };
    // pin_hash JAMAIS exposé (correction SEC-10)
    const params: unknown[] = [u.tenantId];
    const conds = ["usr.tenant_id = $1", "usr.role <> 'SUPER_ADMIN'"];
    if (q.role) conds.push(`usr.role = $${params.push(q.role)}`);
    if (!q.includeInactive) conds.push("usr.is_active");
    const r = await query(
      `SELECT usr.id, usr.name, usr.email, usr.role, usr.is_active, usr.depot_id, usr.created_at,
              usr.max_discount_pct::float,
              d.name AS depot_name, (usr.pin_hash IS NOT NULL) AS has_pin
         FROM users usr LEFT JOIN depots d ON d.id = usr.depot_id
        WHERE ${conds.join(" AND ")}
        ORDER BY usr.is_active DESC, usr.role, usr.name`,
      params,
    );
    res.json(r.rows);
  }),
);

// ============================ CRÉATION ======================================
const createUserSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.string().trim().email().max(255),
  role: z.enum(["ADMIN", "VENDEUR"]),
  password: passwordSchema.optional(),
  pin: pinSchema.nullish(),
  depotId: z.string().uuid().nullish(),
  /** E8 — plafond de remise manuelle à la caisse (NULL = défaut rôle :
   *  10 % vendeur, 100 % gérant). */
  maxDiscountPct: z.coerce.number().min(0).max(100).nullish(),
});

/** Vérifie l'unicité fonctionnelle du PIN dans le tenant (hash bcrypt ≠ index). */
async function assertPinAvailable(
  tenantId: string,
  pin: string,
  excludeUserId?: string | null,
) {
  const others = await query<{ pin_hash: string }>(
    "SELECT pin_hash FROM users WHERE tenant_id=$1 AND pin_hash IS NOT NULL AND ($2::uuid IS NULL OR id <> $2)",
    [tenantId, excludeUserId ?? null],
  );
  for (const row of others.rows) {
    if (await bcrypt.compare(pin, row.pin_hash)) {
      throw HttpError.conflict(
        "PIN_TAKEN",
        "Ce PIN est déjà utilisé par un autre compte du tenant.",
      );
    }
  }
}

router.post(
  "/",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateBody(createUserSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof createUserSchema>;
    if (b.role === "VENDEUR" && !b.depotId) {
      throw HttpError.badRequest(
        "DEPOT_REQUIRED",
        "Un vendeur doit être affecté à un dépôt.",
      );
    }
    const password =
      b.password ?? crypto.randomBytes(6).toString("base64url") + "1A";
    const env = getEnv();

    if (b.pin) await assertPinAvailable(u.tenantId, b.pin);

    const created = await withTransaction(async (client) => {
      const max = req.license?.maxUsers ?? 2;
      const count = await client.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM users WHERE tenant_id=$1 AND is_active AND role <> 'SUPER_ADMIN'",
        [u.tenantId],
      );
      if (count.rows[0]!.n >= max) {
        throw new HttpError(
          402,
          "LICENSE_LIMIT_USERS",
          `Votre licence autorise ${max} utilisateur(s) actif(s) maximum.`,
        );
      }
      const hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
      const pinHash = b.pin
        ? await bcrypt.hash(b.pin, env.BCRYPT_ROUNDS)
        : null;
      const r = await client.query(
        `INSERT INTO users (tenant_id, name, email, password_hash, role, depot_id, pin_hash, max_discount_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, email, role, depot_id, max_discount_pct`,
        [
          u.tenantId,
          b.name,
          b.email.toLowerCase(),
          hash,
          b.role,
          b.depotId ?? null,
          pinHash,
          b.maxDiscountPct ?? null,
        ],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "CREATE",
          entity: "user",
          entityId: r.rows[0]?.id ?? null,
          newState: r.rows[0],
        },
        client,
      );
      return r.rows[0];
    });
    res.status(201).json({
      ...created,
      generatedPassword: b.password ? undefined : password,
    });
  }),
);

// ============================ MISE À JOUR ===================================
router.patch(
  "/:id",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateParams(uuidParam),
  validateBody(createUserSchema.partial().omit({ password: true, pin: true })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const target = await query(
      "SELECT * FROM users WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    if (!target.rows[0]) throw HttpError.notFound("Utilisateur introuvable.");
    const b = req.body;
    if (
      (b.role ?? target.rows[0].role) === "VENDEUR" &&
      !(b.depotId ?? target.rows[0].depot_id)
    ) {
      throw HttpError.badRequest(
        "DEPOT_REQUIRED",
        "Un vendeur doit être affecté à un dépôt.",
      );
    }
    const r = await query(
      `UPDATE users SET name=COALESCE($3,name), email=COALESCE($4,email), role=COALESCE($5,role),
              depot_id=COALESCE($6,depot_id),
              max_discount_pct=CASE WHEN $7::boolean THEN $8 ELSE max_discount_pct END,
              updated_at=now()
        WHERE id=$1 AND tenant_id=$2 RETURNING id, name, email, role, depot_id, max_discount_pct`,
      [
        req.params.id!,
        u.tenantId,
        b.name ?? null,
        b.email ? b.email.toLowerCase() : null,
        b.role ?? null,
        b.depotId ?? null,
        b.maxDiscountPct !== undefined, // NULL explicite = retour au défaut rôle
        b.maxDiscountPct ?? null,
      ],
    );
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "UPDATE",
      entity: "user",
      entityId: req.params.id!,
      previousState: target.rows[0],
      newState: r.rows[0],
    });
    res.json(r.rows[0]);
  }),
);

// ============================ MOT DE PASSE / PIN / ACTIVATION ===============
router.post(
  "/:id/reset-password",
  requireRole("ADMIN"),
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const temp = crypto.randomBytes(6).toString("base64url") + "1A";
    const hash = await bcrypt.hash(temp, getEnv().BCRYPT_ROUNDS);
    const r = await withTransaction(async (client) => {
      const upd = await client.query(
        "UPDATE users SET password_hash=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING email",
        [req.params.id!, u.tenantId, hash],
      );
      if (!upd.rows[0]) throw HttpError.notFound("Utilisateur introuvable.");
      await client.query(
        "UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
        [req.params.id],
      );
      return upd.rows[0];
    });
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "UPDATE",
      entity: "user",
      entityId: req.params.id!,
      details: "Réinitialisation du mot de passe par un administrateur.",
    });
    res.json({
      message: `Mot de passe réinitialisé pour ${r.email}`,
      temporaryPassword: temp,
    });
  }),
);

router.post(
  "/:id/reset-pin",
  requireRole("ADMIN"),
  validateParams(uuidParam),
  validateBody(z.object({ pin: pinSchema })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    await assertPinAvailable(u.tenantId, req.body.pin, req.params.id!);
    const hash = await bcrypt.hash(req.body.pin, getEnv().BCRYPT_ROUNDS);
    const r = await query(
      "UPDATE users SET pin_hash=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id",
      [req.params.id!, u.tenantId, hash],
    );
    if (!r.rows[0]) throw HttpError.notFound("Utilisateur introuvable.");
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "UPDATE",
      entity: "user",
      entityId: req.params.id!,
      details: "PIN réinitialisé.",
    });
    res.json({ message: "PIN mis à jour." });
  }),
);

router.post(
  "/:id/deactivate",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    if (req.params.id === u.id)
      throw HttpError.badRequest(
        "SELF_DEACTIVATE",
        "Impossible de désactiver votre propre compte.",
      );
    await withTransaction(async (client) => {
      const r = await client.query(
        "UPDATE users SET is_active=false, updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING email",
        [req.params.id!, u.tenantId],
      );
      if (!r.rows[0]) throw HttpError.notFound("Utilisateur introuvable.");
      await client.query(
        "UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
        [req.params.id],
      );
    });
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "UPDATE",
      entity: "user",
      entityId: req.params.id!,
      details: "Compte désactivé.",
    });
    res.json({ message: "Compte désactivé et sessions révoquées." });
  }),
);

router.post(
  "/:id/activate",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const max = req.license?.maxUsers ?? 2;
    const count = await query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM users WHERE tenant_id=$1 AND is_active AND role <> 'SUPER_ADMIN'",
      [u.tenantId],
    );
    if (count.rows[0]!.n >= max) {
      throw new HttpError(
        402,
        "LICENSE_LIMIT_USERS",
        `Votre licence autorise ${max} utilisateur(s) actif(s) maximum.`,
      );
    }
    const r = await query(
      "UPDATE users SET is_active=true, updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING email",
      [req.params.id!, u.tenantId],
    );
    if (!r.rows[0]) throw HttpError.notFound("Utilisateur introuvable.");
    res.json({ message: "Compte réactivé." });
  }),
);

export default router;
