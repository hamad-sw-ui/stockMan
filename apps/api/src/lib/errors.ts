import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

/** Erreur métier/HTTP normalisée. `code` est stable côté client (i18n des messages). */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new HttpError(400, code, message, details);
  }
  static unauthorized(
    message = "Authentification requise",
    code = "UNAUTHORIZED",
  ) {
    return new HttpError(401, code, message);
  }
  static forbidden(message = "Permission insuffisante", code = "FORBIDDEN") {
    return new HttpError(403, code, message);
  }
  static notFound(message = "Ressource introuvable", code = "NOT_FOUND") {
    return new HttpError(404, code, message);
  }
  static conflict(code: string, message: string, details?: unknown) {
    return new HttpError(409, code, message, details);
  }
}

/** Mapping des codes PostgreSQL vers des réponses métier compréhensibles. */
function fromPgError(err: {
  code?: string;
  constraint?: string;
  message?: string;
}): HttpError | null {
  switch (err.code) {
    case "23505": {
      // PG réel expose `constraint` ; on balaye aussi le message (DETAIL « Key (col)=… »)
      const c = `${err.constraint ?? ""} ${err.message ?? ""}`.toLowerCase();
      if (c.includes("email"))
        return HttpError.conflict(
          "EMAIL_TAKEN",
          "Cette adresse email est déjà utilisée.",
        );
      if (c.includes("barcode"))
        return HttpError.conflict(
          "BARCODE_TAKEN",
          "Ce code-barres est déjà utilisé.",
        );
      if (c.includes("sku"))
        return HttpError.conflict(
          "SKU_TAKEN",
          "Ce SKU est déjà utilisé pour une autre variante.",
        );
      return HttpError.conflict(
        "UNIQUE_VIOLATION",
        "Une valeur saisie existe déjà.",
        { constraint: err.constraint },
      );
    }
    case "23503":
      return HttpError.badRequest(
        "FK_VIOLATION",
        "Référence invalide : un élément lié est introuvable ou utilisé.",
      );
    case "23514":
      return HttpError.badRequest(
        "CHECK_VIOLATION",
        "Valeur invalide (quantité ou prix hors limites).",
      );
    case "23502":
      return HttpError.badRequest("NOT_NULL", "Champ obligatoire manquant.");
    default:
      return null;
  }
}

/** Handler 404 — doit être monté après toutes les routes. */
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    error: { code: "ROUTE_NOT_FOUND", message: "Route introuvable." },
  });
}

/** Gestionnaire d'erreurs global — aucune stack ni message interne ne fuit
 *  vers le client (corrige SEC-11). */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const requestId = (req as Request & { id?: string }).id;

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION",
        message: "Données invalides.",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    });
    return;
  }
  const pg = fromPgError(err as { code?: string });
  if (pg) {
    res.status(pg.status).json({
      error: { code: pg.code, message: pg.message, details: pg.details },
    });
    return;
  }

  logger.error("Erreur non gérée", {
    requestId,
    path: req.path,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({
    error: {
      code: "INTERNAL",
      message: "Erreur interne du serveur.",
      requestId,
    },
  });
}
