import { NextFunction, Request, Response } from 'express';
import { z, ZodSchema } from 'zod';

/** Validation zod des entrées (corrige SEC-09/BCK-06 : plus de `undefined`,
 *  de types faux ou de valeurs négatives injectées jusqu'au SQL). */
export function validateBody<S extends ZodSchema>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data as z.infer<S>;
    next();
  };
}

export function validateQuery<S extends ZodSchema>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return next(parsed.error);
    Object.defineProperty(req, 'query', { value: parsed.data, writable: true });
    next();
  };
}

export function validateParams<S extends ZodSchema>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return next(parsed.error);
    Object.defineProperty(req, 'params', { value: parsed.data, writable: true });
    next();
  };
}

/** Schémas réutilisables. */
export const uuidParam = z.object({ id: z.string().uuid('Identifiant invalide') });
export const money = z.coerce.number().min(0, 'Montant négatif interdit').finite();
export const qty = z.coerce.number().positive('Quantité invalide').finite();
