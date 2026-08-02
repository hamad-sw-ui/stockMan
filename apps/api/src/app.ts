import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { getEnv } from './config/env';
import { query } from './config/db';
import { h } from './lib/asyncHandler';
import { errorHandler, notFoundHandler } from './lib/errors';
import { apiLimiter, requestContext } from './middleware/security';
import authRoutes from './routes/auth';
import catalogRoutes from './routes/catalog';
import productRoutes from './routes/products';
import stockOpsRoutes from './routes/stockOps';
import saleRoutes from './routes/sales';
import posRoutes from './routes/pos';
import userRoutes from './routes/users';
import tenantRoutes from './routes/tenants';
import licenseRoutes from './routes/licenses';
import reportRoutes from './routes/reports';
import notificationRoutes from './routes/notifications';
import configRoutes from './routes/configs';
import auditRoutes from './routes/audit';

export function buildApp() {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY ? 1 : 0);

  app.use(
    helmet({
      contentSecurityPolicy: false, // l'API ne sert pas de HTML ; géré côté web/nginx
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // CORS : liste explicite (jamais '*' avec credentials)
  const origins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || origins.includes(origin)) return cb(null, true);
        return cb(new Error(`Origine CORS refusée : ${origin}`));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestContext);
  app.use('/api', apiLimiter);

  // ---------------------------------------------------------------------
  app.get('/', (_req, res) => {
    res.json({ name: 'StockMan API', version: '2.0.0' });
  });

  app.get(
    '/api/health',
    h(async (_req: Request, res: Response) => {
      const r = await query('SELECT 1 AS ok');
      res.json({ status: 'ok', db: r.rows[0]!.ok === 1, ts: new Date().toISOString() });
    }),
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/pos', posRoutes);
  app.use('/api/sales', saleRoutes);
  app.use('/api/stock', stockOpsRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/tenants', tenantRoutes);
  app.use('/api/licenses', licenseRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/configs', configRoutes);
  app.use('/api/audit-logs', auditRoutes);
  app.use('/api', catalogRoutes); // /categories /units /depots /suppliers

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
