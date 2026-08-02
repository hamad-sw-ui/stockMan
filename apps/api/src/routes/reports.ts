import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db';
import { h } from '../lib/asyncHandler';
import { dateRange, toDateStr, tzOffsetHours } from '../lib/dates';
import { authenticate, AuthRequest, requireRole, requireSuperAdmin } from '../middleware/auth';
import { validateQuery } from '../middleware/validate';

const router = Router();
router.use(authenticate);

const rangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  depotId: z.string().uuid().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

function csvResponse(res: import('express').Response, filename: string, header: string[], rows: unknown[][]) {
  const csv = [header, ...rows]
    .map((line) => line.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(';'))
    .join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv);
}

/** Fuseau horaire du tenant (rapports cadrés sur le jour local — DAT-08).
 *  Note moteur : le cadrage est réalisé par décalage `(x + off)::date`
 *  (portable), pas par AT TIME ZONE. */
async function tenantTimezone(tenantId: string): Promise<string> {
  const r = await query<{ timezone: string }>('SELECT timezone FROM tenants WHERE id=$1', [tenantId]);
  return r.rows[0]?.timezone ?? 'Africa/Douala';
}

// ============================ TABLEAU DE BORD ===============================
router.get(
  '/dashboard',
  validateQuery(rangeSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof rangeSchema>;
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const from = q.from ?? new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const to = q.to ?? new Date().toISOString().slice(0, 10);
    const depotParam = u.role === 'VENDEUR' ? u.depotId : (q.depotId ?? null);

    // Filtre dépôt optionnel composé en JS (sargable, portable)
    const params: unknown[] = [u.tenantId, from, to, off];
    let depotSql = '';
    let depotSqlS = '';
    if (depotParam) {
      const p = `$${params.push(depotParam)}`;
      depotSql = `AND depot_id = ${p}`;
      depotSqlS = `AND s.depot_id = ${p}`;
    }

    const [summary, seriesRaw, topProducts, paymentMix, alerts] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END),0)::float AS revenue,
                COUNT(CASE WHEN status='COMPLETED' THEN 1 END)::int AS sales_count,
                COALESCE(AVG(CASE WHEN status='COMPLETED' THEN total_amount END),0)::float AS avg_basket,
                COALESCE(SUM(CASE WHEN status='COMPLETED' AND (created_at + ($4 || ' hours')::interval)::date = (now() + ($4 || ' hours')::interval)::date THEN total_amount ELSE 0 END),0)::float AS today_revenue,
                COUNT(CASE WHEN status='VOIDED' THEN 1 END)::int AS voided_count
           FROM sales WHERE tenant_id=$1
             AND (created_at + ($4 || ' hours')::interval)::date BETWEEN $2::date AND $3::date
             ${depotSql}`,
        params,
      ),
      query(
        `SELECT (created_at + ($4 || ' hours')::interval)::date AS day,
                COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END),0)::float AS amount,
                COUNT(CASE WHEN status='COMPLETED' THEN 1 END)::int AS count
           FROM sales WHERE tenant_id=$1
             AND (created_at + ($4 || ' hours')::interval)::date BETWEEN $2::date AND $3::date
             ${depotSql}
          GROUP BY (created_at + ($4 || ' hours')::interval)::date`,
        params,
      ),
      query(
        `SELECT p.name, SUM(si.base_qty)::float AS qty, SUM(si.total_price)::float AS revenue
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id AND s.status='COMPLETED'
             AND (s.created_at + ($4 || ' hours')::interval)::date BETWEEN $2::date AND $3::date
             ${depotSqlS}
           JOIN products p ON p.id = si.product_id
          WHERE s.tenant_id=$1
          GROUP BY p.name ORDER BY revenue DESC LIMIT 5`,
        params,
      ),
      query(
        `SELECT payment_method, COUNT(*)::int AS count, COALESCE(SUM(total_amount),0)::float AS amount
           FROM sales WHERE tenant_id=$1 AND status='COMPLETED'
             AND (created_at + ($4 || ' hours')::interval)::date BETWEEN $2::date AND $3::date
             ${depotSql}
          GROUP BY payment_method`,
        params,
      ),
      query<{ id: string; min_stock: number; total: number }>(
        // HAVING filtré côté application (portable) : un agrégat par produit
        `SELECT p.id, p.min_stock_level::float AS min_stock, COALESCE(SUM(sl.quantity),0)::float AS total
           FROM products p
           LEFT JOIN stock_levels sl ON sl.product_id=p.id
          WHERE p.tenant_id=$1 AND p.archived_at IS NULL
          GROUP BY p.id, p.min_stock_level`,
        [u.tenantId],
      ),
    ]);

    // Série journalière complétée côté application (pas de trou de date)
    const byDay = new Map<string, { amount: number; count: number }>();
    for (const row of seriesRaw.rows) {
      const key = toDateStr(row.day) ?? String(row.day).slice(0, 10);
      byDay.set(key, { amount: row.amount, count: row.count });
    }
    const series = dateRange(from, to).map((date) => ({
      date,
      amount: byDay.get(date)?.amount ?? 0,
      count: byDay.get(date)?.count ?? 0,
    }));

    const lowStockCount = alerts.rows.filter((r) => r.total <= r.min_stock).length;
    res.json({
      range: { from, to, timezone: tz },
      summary: summary.rows[0],
      series,
      topProducts: topProducts.rows,
      paymentMix: paymentMix.rows,
      lowStockCount,
    });
  }),
);

// ============================ RAPPORT DES VENTES ============================
router.get(
  '/sales',
  requireRole('ADMIN'),
  validateQuery(rangeSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof rangeSchema>;
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const from = q.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = q.to ?? new Date().toISOString().slice(0, 10);

    // Agrégat par identifiants (sans jointure) puis résolution des libellés enJS :
    // résultat strictement identique sur tout moteur SQL.
    const rows = await query(
      `SELECT (s.created_at + ($4 || ' hours')::interval)::date AS day, s.depot_id, s.vendor_id,
              COUNT(*)::int AS sales_count, COALESCE(SUM(s.total_amount),0)::float AS revenue
         FROM sales s
        WHERE s.tenant_id=$1 AND s.status='COMPLETED'
          AND (s.created_at + ($4 || ' hours')::interval)::date BETWEEN $2::date AND $3::date
        GROUP BY (s.created_at + ($4 || ' hours')::interval)::date, s.depot_id, s.vendor_id
        ORDER BY day DESC`,
      [u.tenantId, from, to, off],
    );
    const [depots, vendors] = await Promise.all([
      query<{ id: string; name: string }>('SELECT id, name FROM depots WHERE tenant_id=$1', [u.tenantId]),
      query<{ id: string; name: string }>('SELECT id, name FROM users WHERE tenant_id=$1', [u.tenantId]),
    ]);
    const depotName = new Map(depots.rows.map((d) => [d.id, d.name]));
    const vendorName = new Map(vendors.rows.map((v) => [v.id, v.name]));
    const data = rows.rows
      .map((r) => ({
        date: toDateStr(r.day) ?? String(r.day).slice(0, 10),
        depot: depotName.get(r.depot_id) ?? '—',
        vendor: vendorName.get(r.vendor_id) ?? '—',
        sales_count: r.sales_count,
        revenue: r.revenue,
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.depot.localeCompare(b.depot) || a.vendor.localeCompare(b.vendor));
    if (q.format === 'csv') {
      return csvResponse(res, `ventes_${from}_${to}.csv`, ['Date', 'Dépôt', 'Vendeur', 'Nb ventes', 'CA (FCFA)'], data.map((r) => [r.date, r.depot, r.vendor, r.sales_count, r.revenue]));
    }
    res.json({ range: { from, to, timezone: tz }, data });
  }),
);

// ============================ MARGES ========================================
router.get(
  '/margin',
  requireRole('ADMIN'),
  validateQuery(rangeSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof rangeSchema>;
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const from = q.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = q.to ?? new Date().toISOString().slice(0, 10);

    const rows = await query<{ product_id: string; name: string; qty_sold: number; revenue: number; cost: number; margin: number }>(
      `SELECT p.id AS product_id, p.name, SUM(si.base_qty)::float AS qty_sold,
              SUM(si.total_price)::float AS revenue,
              SUM(si.base_qty * p.purchase_price)::float AS cost,
              (SUM(si.total_price) - SUM(si.base_qty * p.purchase_price))::float AS margin
         FROM sale_items si
         JOIN sales s ON s.id=si.sale_id AND s.status='COMPLETED'
           AND (s.created_at + ($4 || ' hours')::interval)::date BETWEEN $2::date AND $3::date
         JOIN products p ON p.id=si.product_id
        WHERE s.tenant_id=$1
        GROUP BY p.id, p.name, p.purchase_price ORDER BY margin DESC`,
      [u.tenantId, from, to, off],
    );
    // Taux arrondi à 0,1 point — calcul applicatif (ROUND(float,int) non portable)
    const data = rows.rows.map((r) => ({
      ...r,
      margin_pct: r.revenue > 0 ? Math.round((1000 * r.margin) / r.revenue) / 10 : 0,
    }));
    const totals = data.reduce(
      (acc, r) => ({ revenue: acc.revenue + r.revenue, cost: acc.cost + r.cost, margin: acc.margin + r.margin }),
      { revenue: 0, cost: 0, margin: 0 },
    );
    if (q.format === 'csv') {
      return csvResponse(res, `marges_${from}_${to}.csv`, ['Produit', 'Qté vendue', 'CA', 'Coût', 'Marge', 'Marge %'],
        data.map((r) => [r.name, r.qty_sold, r.revenue, r.cost, r.margin, r.margin_pct]));
    }
    res.json({ range: { from, to, timezone: tz }, totals, data });
  }),
);

// ============================ VALORISATION DU STOCK =========================
router.get(
  '/stock-valuation',
  requireRole('ADMIN'),
  validateQuery(z.object({ depotId: z.string().uuid().optional(), format: z.enum(['json', 'csv']).default('json') })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as { depotId?: string; format: 'json' | 'csv' };
    // Regroupement applicatif (portable à 100 %) : niveaux agrégés par (dépôt, produit)
    const lvlParams: unknown[] = [];
    let depotSql = '';
    if (q.depotId) depotSql = `WHERE depot_id = $${lvlParams.push(q.depotId)}`;
    const [levels, products, depots, categories] = await Promise.all([
      query<{ depot_id: string; product_id: string; q: number }>(
        `SELECT depot_id, product_id, SUM(quantity)::float AS q FROM stock_levels ${depotSql} GROUP BY depot_id, product_id`,
        lvlParams,
      ),
      query<{ id: string; name: string; category_id: string | null; purchase_price: number; selling_price: number }>(
        'SELECT id, name, category_id, purchase_price::float, selling_price::float FROM products WHERE tenant_id=$1 AND archived_at IS NULL',
        [u.tenantId],
      ),
      query<{ id: string; name: string }>('SELECT id, name FROM depots WHERE tenant_id=$1', [u.tenantId]),
      query<{ id: string; name: string }>('SELECT id, name FROM categories WHERE tenant_id=$1', [u.tenantId]),
    ]);
    const productById = new Map(products.rows.map((p) => [p.id, p]));
    const depotName = new Map(depots.rows.map((d) => [d.id, d.name]));
    const categoryName = new Map(categories.rows.map((c) => [c.id, c.name]));
    const rows = levels.rows
      .filter((l) => l.q > 0 && productById.has(l.product_id))
      .map((l) => {
        const p = productById.get(l.product_id)!;
        return {
          depot: depotName.get(l.depot_id) ?? '—',
          product: p.name,
          category: (l.product_id && p.category_id ? categoryName.get(p.category_id) : null) ?? '—',
          quantity: l.q,
          purchase_value: l.q * p.purchase_price,
          sale_value: l.q * p.selling_price,
        };
      })
      .sort((a, b) => a.depot.localeCompare(b.depot) || a.product.localeCompare(b.product));
    const totals = rows.reduce((acc, r) => ({ purchase: acc.purchase + r.purchase_value, sale: acc.sale + r.sale_value }), { purchase: 0, sale: 0 });
    if (q.format === 'csv') {
      return csvResponse(res, 'valorisation_stock.csv', ['Dépôt', 'Produit', 'Catégorie', 'Quantité', 'Valeur achat', 'Valeur vente'],
        rows.map((r) => [r.depot, r.product, r.category, r.quantity, r.purchase_value, r.sale_value]));
    }
    res.json({ totals, data: rows });
  }),
);

// ============================ PÉREMPTIONS ===================================
router.get(
  '/expiry',
  requireRole('ADMIN'),
  validateQuery(z.object({ days: z.coerce.number().int().min(1).max(365).default(30), includeExpired: z.coerce.boolean().default(true) })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as { days: number; includeExpired: boolean };
    // Fenêtre calculée en JS : comparaisons DATE ↔ TIMESTAMP évitées côté moteur
    const cutoff = new Date(Date.now() + q.days * 86_400_000).toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    const r = await query<{ product: string; depot: string | null; batch_number: string; quantity: number; expiry_date: Date | string }>(
      `SELECT p.name AS product, d.name AS depot, b.batch_number, b.quantity::float AS quantity,
              b.expiry_date
         FROM stock_batches b
         JOIN products p ON p.id=b.product_id
         LEFT JOIN depots d ON d.id=b.depot_id
        WHERE p.tenant_id=$1 AND b.quantity > 0 AND b.expiry_date::date <= $2::date
          ${q.includeExpired ? '' : 'AND b.expiry_date::date >= $3::date'}
        ORDER BY b.expiry_date ASC LIMIT 200`,
      q.includeExpired ? [u.tenantId, cutoff] : [u.tenantId, cutoff, todayStr],
    );
    // Compte à rebours calculé côté application (soustraction date-date non portable)
    const today = new Date(new Date().toISOString().slice(0, 10));
    res.json(
      r.rows.map((row) => {
        const exp = new Date(row.expiry_date);
        const daysLeft = Math.round((exp.getTime() - today.getTime()) / 86_400_000);
        return { ...row, expiry_date: toDateStr(row.expiry_date) ?? row.expiry_date, days_left: daysLeft };
      }),
    );
  }),
);

// ============================ PRÉDICTIF (corrigé BCK-02) ====================
router.get(
  '/predictive',
  requireRole('ADMIN'),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const since30d = new Date(Date.now() - 30 * 86_400_000);
    const r = await query<{ product_id: string; name: string; current_stock: number; min_stock_level: number; qty_30d: number }>(
      `WITH stock AS (
         SELECT p.id, p.name, p.min_stock_level::float, COALESCE(SUM(sl.quantity),0)::float AS current_stock
           FROM products p LEFT JOIN stock_levels sl ON sl.product_id = p.id
          WHERE p.tenant_id=$1 AND p.archived_at IS NULL
          GROUP BY p.id, p.name, p.min_stock_level
       ), sold AS (
         SELECT si.product_id, SUM(si.base_qty)::float AS qty_30d
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id AND s.status='COMPLETED' AND s.tenant_id=$1
          WHERE s.created_at >= $2
          GROUP BY si.product_id
       )
       SELECT st.id AS product_id, st.name, st.current_stock::float, st.min_stock_level::float,
              COALESCE(so.qty_30d, 0)::float AS qty_30d
         FROM stock st LEFT JOIN sold so ON so.product_id = st.id
        WHERE (COALESCE(so.qty_30d,0) > 0 AND st.current_stock < (so.qty_30d / 30.0) * 14)
           OR st.current_stock <= st.min_stock_level`,
      [u.tenantId, since30d],
    );
    // Indicateurs dérivés calculés côté application (ROUND non portable)
    const rows = r.rows
      .map((row) => {
        const avgDaily = row.qty_30d / 30;
        return {
          product_id: row.product_id,
          name: row.name,
          current_stock: row.current_stock,
          min_stock_level: row.min_stock_level,
          avg_daily_sales: Math.round(avgDaily * 100) / 100,
          days_until_stockout: row.qty_30d > 0 ? Math.round(row.current_stock / avgDaily) : 999,
        };
      })
      .sort((a, b) => a.days_until_stockout - b.days_until_stockout || a.name.localeCompare(b.name))
      .slice(0, 50);
    res.json(rows);
  }),
);

// ============================ Z DE CAISSE (clôture journée) =================
router.get(
  '/z-report',
  validateQuery(z.object({ date: z.string().date().optional(), depotId: z.string().uuid().optional() })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as { date?: string; depotId?: string };
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const date = q.date ?? new Date().toISOString().slice(0, 10);
    const depotParam = u.role === 'VENDEUR' ? u.depotId : (q.depotId ?? null);

    const params: unknown[] = [u.tenantId, date, off];
    let depotSql = '';
    let depotSqlS = '';
    if (depotParam) {
      const p = `$${params.push(depotParam)}`;
      depotSql = `AND depot_id = ${p}`;
      depotSqlS = `AND s.depot_id = ${p}`;
    }

    const [totals, byPayment, byVendor, voids] = await Promise.all([
      query(
        `SELECT d.name AS depot, COUNT(CASE WHEN s.status='COMPLETED' THEN 1 END)::int AS sales_count,
                COALESCE(SUM(CASE WHEN s.status='COMPLETED' THEN s.total_amount ELSE 0 END),0)::float AS revenue
           FROM sales s JOIN depots d ON d.id=s.depot_id
          WHERE s.tenant_id=$1 AND (s.created_at + ($3 || ' hours')::interval)::date = $2::date
            ${depotSqlS}
          GROUP BY d.name`,
        params,
      ),
      query(
        `SELECT payment_method, COUNT(*)::int AS count, COALESCE(SUM(total_amount),0)::float AS amount
           FROM sales WHERE tenant_id=$1 AND status='COMPLETED'
             AND (created_at + ($3 || ' hours')::interval)::date = $2::date ${depotSql}
          GROUP BY payment_method`,
        params,
      ),
      query(
        `SELECT vu.name AS vendor, COUNT(CASE WHEN s.status='COMPLETED' THEN 1 END)::int AS count,
                COALESCE(SUM(CASE WHEN s.status='COMPLETED' THEN s.total_amount ELSE 0 END),0)::float AS amount
           FROM sales s JOIN users vu ON vu.id=s.vendor_id
          WHERE s.tenant_id=$1 AND (s.created_at + ($3 || ' hours')::interval)::date = $2::date
            ${depotSqlS}
          GROUP BY vu.name ORDER BY amount DESC`,
        params,
      ),
      query(
        `SELECT COUNT(*)::int AS voided, COALESCE(SUM(total_amount),0)::float AS amount
           FROM sales WHERE tenant_id=$1 AND status='VOIDED'
             AND (created_at + ($3 || ' hours')::interval)::date = $2::date ${depotSql}`,
        params,
      ),
    ]);
    res.json({
      date, timezone: tz,
      totals: totals.rows, byPayment: byPayment.rows, byVendor: byVendor.rows,
      voids: voids.rows[0],
    });
  }),
);

// ============================ STATS SUPER ADMIN =============================
router.get(
  '/superadmin/stats',
  requireSuperAdmin,
  h(async (_req, res) => {
    // Bornes temporelles calculées en JS (portable, pas de date_trunc/INTERVAL littéral)
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const last30d = new Date(Date.now() - 30 * 86_400_000);
    const last24h = new Date(Date.now() - 24 * 3_600_000);
    const [tenants, revenue, mrr, trials, notifsFailed, newTenants, topTenants] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(CASE WHEN is_active THEN 1 END)::int AS active,
                (SELECT COUNT(*) FROM users WHERE is_active)::int AS active_users
           FROM tenants`,
      ),
      query(
        `SELECT COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END),0)::float AS all_time,
                COALESCE(SUM(CASE WHEN status='COMPLETED' AND created_at >= $1 THEN total_amount ELSE 0 END),0)::float AS month
           FROM sales`,
        [monthStart],
      ),
      query(
        `SELECT COALESCE(SUM(p.monthly_price),0)::float AS mrr
           FROM licenses l JOIN plans p ON p.code=l.plan_code
          WHERE l.status='ACTIVE' AND l.end_date >= CURRENT_DATE AND l.plan_code <> 'TRIAL'`,
      ),
      query(
        `SELECT l.end_date, t.name AS tenant_name FROM licenses l JOIN tenants t ON t.id=l.tenant_id
          WHERE l.status='TRIAL' AND l.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
          ORDER BY l.end_date LIMIT 10`,
      ),
      query(`SELECT COUNT(*)::int AS n FROM notifications WHERE status='FAILED' AND created_at >= $1`, [last24h]),
      query(`SELECT COUNT(*)::int AS n FROM tenants WHERE created_at >= $1`, [last30d]),
      query(
        `SELECT t.name, COALESCE(SUM(CASE WHEN s.status='COMPLETED' THEN s.total_amount ELSE 0 END),0)::float AS revenue
           FROM tenants t LEFT JOIN sales s ON s.tenant_id=t.id AND s.created_at >= $1
          GROUP BY t.name ORDER BY revenue DESC LIMIT 5`,
        [last30d],
      ),
    ]);
    res.json({
      tenants: tenants.rows[0],
      revenue: revenue.rows[0],
      mrr: mrr.rows[0]!.mrr,
      trialsEndingSoon: trials.rows.map((r) => ({ tenant_name: r.tenant_name, end_date: toDateStr(r.end_date) ?? r.end_date })),
      failedNotifications24h: notifsFailed.rows[0]!.n,
      newTenants30d: newTenants.rows[0]!.n,
      topTenants: topTenants.rows,
    });
  }),
);

export default router;
