import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import pool from './config/db';
import authRoutes from './routes/authRoutes';
// ... rest of imports
import productRoutes from './routes/productRoutes';
import saleRoutes from './routes/saleRoutes';
import reportRoutes from './routes/reportRoutes';
import vendorRoutes from './routes/vendorRoutes';
import supplierRoutes from './routes/supplierRoutes';
import tenantRoutes from './routes/tenantRoutes';
import unitRoutes from './routes/unitRoutes';
import configRoutes from './routes/configRoutes';
import stockRoutes from './routes/stockRoutes';
import { SchedulerService } from './services/SchedulerService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/** Origines autorisées : variable CORS_ORIGIN (séparateur virgule), sinon dev Vite par défaut */
function getCorsOrigin(): boolean | string | RegExp | (string | RegExp)[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    return 'http://localhost:5173';
  }
  if (raw === '*') {
    return true;
  }
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length === 1 ? list[0] : list;
}

// Middleware
app.use(cors({
  origin: getCorsOrigin(),
  credentials: true // Autoriser l'envoi de cookies (refresh token)
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/configs', configRoutes);

// Initialisation des tâches planifiées
SchedulerService.init();

// Routes de base
app.get('/', (req, res) => {
  res.json({ message: 'Bienvenue sur l\'API StockMan v1.0' });
});

// Test Endpoint pour vérifier la DB
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM tenants');
    res.json({ status: 'OK', tenantsCount: result.rows[0].count });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: 'DB Non accessible' });
  }
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});
