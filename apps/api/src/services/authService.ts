import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { PoolClient } from "pg";
import { query, withTransaction } from "../config/db";
import { getEnv } from "../config/env";
import { toDateStr } from "../lib/dates";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import { AccessTokenPayload, Role, signAccessToken } from "../middleware/auth";

const REFRESH_TTL_DAYS = 7;
const REFRESH_COOKIE = "refreshToken";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

interface DbUser {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  role: Role;
  depot_id: string | null;
  is_active: boolean;
  password_hash: string;
  pin_hash: string | null;
  tenant_name: string;
  tenant_active: boolean;
  tenant_logo: string | null;
  tenant_color: string | null;
  tenant_currency: string;
  tenant_timezone: string;
}

function publicUser(u: DbUser, impersonated = false) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    depotId: u.depot_id,
    tenantId: u.tenant_id,
    impersonated,
    tenant: {
      id: u.tenant_id,
      name: u.tenant_name,
      logo: u.tenant_logo,
      primaryColor: u.tenant_color,
      currency: u.tenant_currency,
      timezone: u.tenant_timezone,
      isActive: u.tenant_active,
    },
  };
}

async function findUserByEmail(email: string): Promise<DbUser | null> {
  const r = await query<DbUser>(
    `SELECT u.*, t.name AS tenant_name, t.is_active AS tenant_active,
            t.logo AS tenant_logo, t.primary_color AS tenant_color,
            t.currency AS tenant_currency, t.timezone AS tenant_timezone
       FROM users u JOIN tenants t ON t.id = u.tenant_id
      WHERE LOWER(u.email) = LOWER($1)
      ORDER BY u.created_at ASC LIMIT 1`,
    [email],
  );
  return r.rows[0] ?? null;
}

async function findUserById(id: string): Promise<DbUser | null> {
  const r = await query<DbUser>(
    `SELECT u.*, t.name AS tenant_name, t.is_active AS tenant_active,
            t.logo AS tenant_logo, t.primary_color AS tenant_color,
            t.currency AS tenant_currency, t.timezone AS tenant_timezone
       FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

function accessPayload(u: DbUser, impersonated = false): AccessTokenPayload {
  return {
    id: u.id,
    tenantId: u.tenant_id,
    role: u.role,
    name: u.name,
    depotId: u.depot_id,
    imp: impersonated || undefined,
  };
}

async function issueRefreshToken(
  userId: string,
  tenantId: string,
): Promise<string> {
  const raw = crypto.randomBytes(48).toString("base64url");
  await query(
    `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
    [userId, tenantId, sha256(raw), REFRESH_TTL_DAYS],
  );
  return raw;
}

export const refreshCookieConfig = {
  name: REFRESH_COOKIE,
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // 'lax' : cookies préservés en cross-port localhost (dev) et same-origin (prod nginx)
    sameSite: "lax" as const,
    path: "/api/auth",
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  },
};

/** Vérifie qu'un compte peut ouvrir une session (actif + tenant actif). */
function assertCanLogin(u: DbUser) {
  if (!u.is_active)
    throw HttpError.forbidden(
      "Ce compte est désactivé. Contactez votre administrateur.",
      "USER_DISABLED",
    );
  if (!u.tenant_active)
    throw HttpError.forbidden(
      "L'abonnement de cette entreprise est suspendu.",
      "TENANT_DISABLED",
    );
}

// ---------------------------------------------------------------------------
export async function register(input: {
  tenantName: string;
  userName: string;
  email: string;
  password: string;
  phone?: string;
}) {
  const { tenantName, userName, email, password, phone } = input;
  const env = getEnv();
  const hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  const result = await withTransaction(async (client) => {
    const t = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, phone) VALUES ($1, $2) RETURNING id`,
      [tenantName, phone ?? null],
    );
    const tenantId = t.rows[0]!.id;

    const u = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'ADMIN') RETURNING id`,
      [tenantId, userName, email, hash],
    );

    // Licence d'essai 14 jours + dépôt initial + unités par défaut (BCK-05)
    await client.query(
      `INSERT INTO licenses (tenant_id, plan_code, status, start_date, end_date, max_users, max_depots)
       VALUES ($1, 'TRIAL', 'TRIAL', CURRENT_DATE, CURRENT_DATE + 14, 2, 1)`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO notification_settings (tenant_id, alert_phone) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, phone ?? null],
    );
    await client.query(
      `INSERT INTO depots (tenant_id, name) VALUES ($1, 'Dépôt Principal')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO units (tenant_id, name, symbol, base_value, is_base) VALUES
        ($1,'Pièce','Pce',1,true), ($1,'Carton','Ctn',12,false), ($1,'Kilogramme','Kg',1,true), ($1,'Litre','L',1,true)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId],
    );

    await writeAudit(
      {
        tenantId,
        userId: u.rows[0]!.id,
        userName,
        action: "CREATE",
        entity: "tenant",
        entityId: tenantId,
        details: `Inscription de « ${tenantName} » (essai 14 j).`,
      },
      client,
    );
    return { tenantId, userId: u.rows[0]!.id };
  });

  const user = await findUserById(result.userId);
  if (!user) throw new Error("Utilisateur créé introuvable");
  return buildSession(user);
}

// ---------------------------------------------------------------------------
async function buildSession(u: DbUser, impersonated = false) {
  const accessToken = signAccessToken(accessPayload(u, impersonated));
  const refreshToken = await issueRefreshToken(u.id, u.tenant_id);
  return { accessToken, refreshToken, user: publicUser(u, impersonated) };
}

export async function login(email: string, password: string) {
  const user = await findUserByEmail(email);
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok)
    throw HttpError.unauthorized("Identifiants invalides.", "BAD_CREDENTIALS");
  assertCanLogin(user!);
  await writeAudit({
    tenantId: user!.tenant_id,
    userId: user!.id,
    userName: user!.name,
    action: "LOGIN",
    entity: "session",
    entityId: user!.id,
  });
  return buildSession(user!);
}

export async function loginWithPin(email: string, pin: string) {
  const user = await findUserByEmail(email);
  if (!user?.pin_hash)
    throw HttpError.unauthorized("Identifiants invalides.", "BAD_CREDENTIALS");
  const ok = await bcrypt.compare(pin, user.pin_hash);
  if (!ok)
    throw HttpError.unauthorized("Identifiants invalides.", "BAD_CREDENTIALS");
  assertCanLogin(user);
  await writeAudit({
    tenantId: user.tenant_id,
    userId: user.id,
    userName: user.name,
    action: "LOGIN",
    entity: "session",
    details: "Connexion PIN",
  });
  return buildSession(user);
}

// ---------------------------------------------------------------------------
export async function refresh(rawToken: string | undefined) {
  if (!rawToken)
    throw HttpError.unauthorized("Session absente.", "NO_REFRESH_TOKEN");
  const tokenHash = sha256(rawToken);
  const r = await query<{
    id: string;
    user_id: string;
    revoked_at: string | null;
    replaced_by: string | null;
    expires_at: string;
  }>(
    `SELECT id, user_id, revoked_at, replaced_by, expires_at FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  const row = r.rows[0];
  if (!row)
    throw HttpError.unauthorized("Session invalide.", "REFRESH_UNKNOWN");

  if (row.revoked_at) {
    // Réutilisation d'un jeton rotatif = possible vol → on révoque TOUTE la session (SEC-08)
    await query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [row.user_id],
    );
    throw HttpError.unauthorized(
      "Session compromise, veuillez vous reconnecter.",
      "REFRESH_REUSE",
    );
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw HttpError.unauthorized("Session expirée.", "REFRESH_EXPIRED");
  }

  const user = await findUserById(row.user_id);
  if (!user) throw HttpError.unauthorized("Compte introuvable.");
  assertCanLogin(user);

  // Rotation : révocation de l'ancien, émission du nouveau
  return withTransaction(async (client: PoolClient) => {
    const newRaw = crypto.randomBytes(48).toString("base64url");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' days')::interval) RETURNING id`,
      [user.id, user.tenant_id, sha256(newRaw), REFRESH_TTL_DAYS],
    );
    await client.query(
      "UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1",
      [row.id, inserted.rows[0]!.id],
    );
    const accessToken = signAccessToken(accessPayload(user));
    return { accessToken, refreshToken: newRaw, user: publicUser(user) };
  });
}

export async function logout(rawToken: string | undefined, userId?: string) {
  if (rawToken) {
    await query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1",
      [sha256(rawToken)],
    );
  } else if (userId) {
    await query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [userId],
    );
  }
}

// ---------------------------------------------------------------------------
const RESET_PURPOSE = "pwd-reset";

export async function forgotPassword(
  email: string,
): Promise<{ devToken?: string }> {
  const user = await findUserByEmail(email);
  if (!user) return {}; // silence volontaire : ne pas énumérer les comptes
  const token = jwt.sign(
    { sub: user.id, purpose: RESET_PURPOSE },
    getEnv().REFRESH_SECRET,
    { expiresIn: "30m" },
  );
  // Pas de serveur SMTP dans le périmètre : le lien est journalisé et, en dev,
  // renvoyé dans la réponse. En production, brancher ici le provider SMS.
  if (getEnv().NODE_ENV !== "production") {
    return { devToken: token };
  }
  return {};
}

export async function resetPassword(token: string, newPassword: string) {
  let payload: { sub: string; purpose: string };
  try {
    payload = jwt.verify(token, getEnv().REFRESH_SECRET) as {
      sub: string;
      purpose: string;
    };
  } catch {
    throw HttpError.badRequest(
      "RESET_TOKEN_INVALID",
      "Lien de réinitialisation expiré ou invalide.",
    );
  }
  if (payload.purpose !== RESET_PURPOSE) {
    throw HttpError.badRequest("RESET_TOKEN_INVALID", "Jeton invalide.");
  }
  const hash = await bcrypt.hash(newPassword, getEnv().BCRYPT_ROUNDS);
  await withTransaction(async (client) => {
    const r = await client.query(
      "UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING tenant_id",
      [payload.sub, hash],
    );
    if (r.rows.length === 0) throw HttpError.notFound("Compte introuvable.");
    await client.query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [payload.sub],
    );
  });
}

export async function changePassword(
  userId: string,
  current: string,
  next: string,
) {
  const user = await findUserById(userId);
  if (!user) throw HttpError.notFound("Compte introuvable.");
  const ok = await bcrypt.compare(current, user.password_hash);
  if (!ok)
    throw HttpError.badRequest(
      "BAD_CURRENT_PASSWORD",
      "Mot de passe actuel incorrect.",
    );
  const hash = await bcrypt.hash(next, getEnv().BCRYPT_ROUNDS);
  await withTransaction(async (client) => {
    await client.query(
      "UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1",
      [userId, hash],
    );
    await client.query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [userId],
    );
  });
  return buildSession(user);
}

export async function me(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw HttpError.notFound("Compte introuvable.");
  const license = await query(
    `SELECT plan_code, status, end_date, max_users, max_depots FROM licenses
      WHERE tenant_id = $1 ORDER BY end_date DESC LIMIT 1`,
    [user.tenant_id],
  );
  const lic = license.rows[0];
  return {
    ...publicUser(user),
    license: lic
      ? { ...lic, end_date: toDateStr(lic.end_date) ?? lic.end_date }
      : null,
  };
}
