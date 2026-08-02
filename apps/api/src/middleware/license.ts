import { NextFunction, Request, Response } from 'express';
import { query } from '../config/db';
import { getEnv } from '../config/env';
import { toDateStr } from '../lib/dates';
import { HttpError } from '../lib/errors';
import { AuthRequest } from './auth';

export interface LicenseInfo {
  id: string;
  planCode: string;
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  endDate: string;
  maxUsers: number;
  maxDepots: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    license?: LicenseInfo;
  }
}

async function loadCurrentLicense(tenantId: string): Promise<LicenseInfo | null> {
  const r = await query(
    `SELECT id, plan_code, status, end_date, max_users, max_depots
       FROM licenses WHERE tenant_id = $1 ORDER BY end_date DESC, created_at DESC LIMIT 1`,
    [tenantId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    planCode: row.plan_code,
    status: row.status,
    endDate: toDateStr(row.end_date) ?? String(row.end_date),
    maxUsers: row.max_users,
    maxDepots: row.max_depots,
  };
}

/**
 * Contrôle de licence (corrige DAT-06) :
 *  - aucune licence              → 402 LICENSE_REQUIRED ;
 *  - EXPIRED/SUSPENDED ou fin dépassée (+ grâce) → 402 LICENSE_EXPIRED ;
 *  - les lectures (GET/HEAD) restent toujours possibles.
 */
export function requireActiveLicense(writeMethodsOnly = true) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthRequest).user;
    if (!user) return next(HttpError.unauthorized());
    if (user.role === 'SUPER_ADMIN') return next();

    const readOnly = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (writeMethodsOnly && readOnly) return next();

    try {
      const license = await loadCurrentLicense(user.tenantId);
      if (!license) {
        return next(
          new HttpError(402, 'LICENSE_REQUIRED', "Aucune licence active : contactez l'éditeur StockMan."),
        );
      }
      const grace = getEnv().LICENSE_GRACE_DAYS;
      const limit = new Date(license.endDate);
      limit.setDate(limit.getDate() + grace);
      const expired =
        license.status === 'EXPIRED' || license.status === 'SUSPENDED' || limit.getTime() < Date.now();
      if (expired) {
        return next(
          new HttpError(
            402,
            'LICENSE_EXPIRED',
            `Licence expirée le ${license.endDate}. Renouvelez votre abonnement pour continuer à enregistrer des opérations.`,
            { endDate: license.endDate, planCode: license.planCode },
          ),
        );
      }
      req.license = license;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
