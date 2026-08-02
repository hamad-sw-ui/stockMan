import crypto from 'crypto';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '../lib/logger';

/** Request-id + log requête structuré (BCK-06/OPS). */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const id = req.header('X-Request-Id') ?? crypto.randomUUID();
  (req as Request & { id?: string }).id = id;
  res.setHeader('X-Request-Id', id);
  const started = Date.now();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level]('HTTP', {
      requestId: id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - started,
      ip: req.ip,
    });
  });
  next();
}

const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;
const passThrough: RequestHandler = (_req, _res, next) => next();

/** Limiteur global modéré (SEC-09) — désactivé en environnement de test. */
export const apiLimiter = isTest
  ? passThrough
  : rateLimit({
      windowMs: 5 * 60 * 1000,
      limit: 1200,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Trop de requêtes. Réessayez dans quelques minutes.' } },
    });

/** Limiteurs stricts anti brute-force (login / PIN, SEC-09). */
export const loginLimiter = isTest
  ? passThrough
  : rateLimit({
      windowMs: 60 * 1000,
      limit: 10,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Trop de tentatives de connexion. Patientez 1 minute.' } },
    });

export const registerLimiter = isTest
  ? passThrough
  : rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: 10,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: "Trop d'inscriptions depuis cette adresse." } },
    });
