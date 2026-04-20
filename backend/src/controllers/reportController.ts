import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;

    // 1. Chiffre d'affaires total et du jour
    const salesRes = await pool.query(
      `SELECT 
        COALESCE(SUM(total_amount), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE THEN total_amount ELSE 0 END), 0) as today_revenue,
        COUNT(id) as total_sales_count
       FROM sales 
       WHERE tenant_id = $1`,
      [tenantId]
    );

    // 2. Nombre de produits en alerte (stock faible)
    const stockAlertsRes = await pool.query(
      `SELECT COUNT(*) as alert_count FROM products WHERE tenant_id = $1 AND quantity <= min_stock_level`,
      [tenantId]
    );

    // 3. Ventes des 7 derniers jours (pour le graphique)
    const chartRes = await pool.query(
      `SELECT 
        TO_CHAR(date_series, 'DD Mon') as date,
        COALESCE(SUM(s.total_amount), 0) as amount
       FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') AS date_series
       LEFT JOIN sales s ON DATE(s.created_at) = DATE(date_series) AND s.tenant_id = $1
       GROUP BY date_series
       ORDER BY date_series ASC`,
      [tenantId]
    );

    // 4. Top 5 produits les plus vendus
    const topProductsRes = await pool.query(
      `SELECT p.name, SUM(si.quantity) as total_qty
       FROM sale_items si
       JOIN products p ON si.product_id = p.id
       JOIN sales s ON si.sale_id = s.id
       WHERE s.tenant_id = $1
       GROUP BY p.name
       ORDER BY total_qty DESC
       LIMIT 5`,
      [tenantId]
    );

    res.json({
      summary: salesRes.rows[0],
      alerts: stockAlertsRes.rows[0].alert_count,
      chartData: chartRes.rows,
      topProducts: topProductsRes.rows
    });

  } catch (err) {
    console.error('Erreur Stats Dashboard:', err);
    res.status(500).json({ message: 'Erreur lors du calcul des statistiques' });
  }
};

// Analyse prédictive des stocks (Phase 4)
export const getPredictiveReport = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;

    // 1. Calculer la moyenne des ventes quotidiennes par produit sur les 30 derniers jours
    const query = `
      WITH daily_sales AS (
        SELECT 
          p.id as product_id,
          p.name,
          p.quantity as current_stock,
          COALESCE(SUM(si.quantity), 0) / 30.0 as avg_daily_sales
        FROM products p
        LEFT JOIN sale_items si ON si.product_id = p.id
        LEFT JOIN sales s ON si.sale_id = s.id AND s.created_at >= (CURRENT_DATE - INTERVAL '30 days')
        WHERE p.tenant_id = $1
        GROUP BY p.id, p.name, p.quantity
      )
      SELECT 
        product_id,
        name,
        current_stock,
        ROUND(avg_daily_sales, 2) as avg_daily_sales,
        CASE 
          WHEN avg_daily_sales > 0 THEN ROUND(current_stock / avg_daily_sales)
          ELSE 999 -- Indique un stock qui ne bouge pas
        END as days_until_stockout
      FROM daily_sales
      WHERE current_stock < (avg_daily_sales * 7) -- On ne montre que ce qui risque de finir sous 7 jours
      OR current_stock <= 5 -- Ou stock très bas par défaut
      ORDER BY days_until_stockout ASC
      LIMIT 20;
    `;

    const result = await pool.query(query, [tenantId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur Rapport Prédictif:', err);
    res.status(500).json({ message: 'Erreur lors de la génération du rapport prédictif' });
  }
};

/**
 * Statistiques consolidées pour le Super Admin (Phase finale CDC)
 */
export const getSuperAdminStats = async (req: AuthRequest, res: Response) => {
  try {
    // 1. Chiffre d'affaires Global (Tous tenants)
    const globalRevenueRes = await pool.query(
      `SELECT 
        COALESCE(SUM(total_amount), 0) as total_revenue,
        COUNT(id) as total_sales_count
       FROM sales`
    );

    // 2. Statistiques des Tenants
    const tenantStatsRes = await pool.query(
      `SELECT 
        COUNT(*) as total_tenants,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_tenants
       FROM tenants`
    );

    // 3. Top 3 des Dépôts les plus performants (Hélicoptère CDC)
    const topDepotsRes = await pool.query(
      `SELECT 
        d.name, 
        t.name as tenant_name,
        SUM(s.total_amount) as revenue
       FROM sales s
       JOIN depots d ON s.depot_id = d.id
       JOIN tenants t ON s.tenant_id = t.id
       GROUP BY d.name, t.name
       ORDER BY revenue DESC
       LIMIT 3`
    );

    // 4. Alertes système (Stock critique global)
    const globalAlertsRes = await pool.query(
      `SELECT COUNT(*) as critical_count FROM products WHERE quantity <= min_stock_level`
    );

    res.json({
      global: globalRevenueRes.rows[0],
      tenants: tenantStatsRes.rows[0],
      topDepots: topDepotsRes.rows,
      alerts: globalAlertsRes.rows[0].critical_count
    });

  } catch (err) {
    console.error('Erreur SuperAdmin Stats:', err);
    res.status(500).json({ message: 'Erreur lors de la récupération des stats globales' });
  }
};
