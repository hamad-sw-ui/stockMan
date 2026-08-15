import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getEnv } from "../config/env";
import { HttpError } from "../lib/errors";

export type Role = "SUPER_ADMIN" | "ADMIN" | "VENDEUR";

export interface AuthUser {
  id: string;
  tenantId: string;
  role: Role;
  name: string;
  depotId: string | null;
  impersonated?: boolean;
}

export interface AuthRequest extends Request {
  user: AuthUser;
}

export interface AccessTokenPayload {
  id: string;
  tenantId: string;
  role: Role;
  name: string;
  depotId: string | null;
  imp?: boolean;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, getEnv().JWT_SECRET, { expiresIn: "15m" });
}

/** Authentification par Bearer JWT. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return next(HttpError.unauthorized("Aucun jeton fourni."));
  try {
    const decoded = jwt.verify(
      token,
      getEnv().JWT_SECRET,
    ) as AccessTokenPayload & jwt.JwtPayload;
    (req as AuthRequest).user = {
      id: decoded.id,
      tenantId: decoded.tenantId,
      role: decoded.role,
      name: decoded.name,
      depotId: decoded.depotId ?? null,
      impersonated: decoded.imp === true,
    };
    return next();
  } catch {
    return next(
      HttpError.unauthorized(
        "Session expirée ou jeton invalide.",
        "TOKEN_INVALID",
      ),
    );
  }
}

/** RBAC centralisé (corrige SEC-05 : appliqué sur les routes sensibles). */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthRequest).user;
    if (!user) return next(HttpError.unauthorized());
    if (user.role === "SUPER_ADMIN") return next();
    if (!roles.includes(user.role)) {
      return next(
        HttpError.forbidden("Accès réservé aux rôles : " + roles.join(", ")),
      );
    }
    return next();
  };
}

/** Accès strictement réservé au Super Admin (pas de passe-droit). */
export function requireSuperAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const user = (req as AuthRequest).user;
  if (!user || user.role !== "SUPER_ADMIN") {
    return next(HttpError.forbidden("Accès réservé au Super Administrateur."));
  }
  return next();
}
