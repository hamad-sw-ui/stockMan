import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db";
import { h } from "../lib/asyncHandler";
import { dateRange, toDateStr, tzOffsetHours } from "../lib/dates";
import {
  authenticate,
  AuthRequest,
  requireRole,
  requireSuperAdmin,
} from "../middleware/auth";
import { validateQuery } from "../middleware/validate";

const router = Router();
router.use(authenticate);

const rangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  depotId: z.string().uuid().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

function csvResponse(
  res: import("express").Response,
  filename: string,
  header: string[],
  rows: unknown[][],
) {
  const csv = [header, ...rows]
    .map((line) =>
      line.map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`).join(";"),
    )
    .join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("﻿" + csv);
}

/** Fuseau horaire du tenant (rapports cadrés sur le jour local — DAT-08).
 *  Note moteur : le cadrage est réalisé par décalage `(x + off)::date`
 *  (portable), pas par AT TIME ZONE. */
async function tenantTimezone(tenantId: string): Promise<string> {
  const r = await query<{ timezone: string }>(
    "SELECT timezone FROM tenants WHERE id=$1",
    [tenantId],
  );
  return r.rows[0]?.timezone ?? "Africa/Douala";
}

// ============================ TABLEAU DE BORD ===============================
router.get(
  "/dashboard",
  validateQuery(rangeSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof rangeSchema>;
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const from =
      q.from ?? new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const to = q.to ?? new Date().toISOString().slice(0, 10);
    const depotParam = u.role === "VENDEUR" ? u.depotId : (q.depotId ?? null);

    // Filtre dépôt optionnel composé en JS (sargable, portable)
    const params: unknown[] = [u.tenantId, from, to, off];
    let depotSql = "";
    let depotSqlS = "";
    if (depotParam) {
      const p = `$${params.push(depotParam)}`;
      depotSql = `AND depot_id = ${p}`;
      depotSqlS = `AND s.depot_id = ${p}`;
    }

    const [summary, seriesRaw, topProducts, paymentMix, alerts] =
      await Promise.all([
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
          // Seuil effectif (E8) : surcharge par dépôt quand un dépôt est
          // cadré, seuil catalogue sinon. HAVING filtré côté application.
          `SELECT p.id,
                  ${depotParam ? "COALESCE(pds.min_stock_level, p.min_stock_level)" : "p.min_stock_level"}::float AS min_stock,
                  COALESCE(SUM(sl.quantity),0)::float AS total
             FROM products p
             LEFT JOIN stock_levels sl ON sl.product_id=p.id
               ${depotParam ? "AND sl.depot_id = $2" : ""}
             ${depotParam ? "LEFT JOIN product_depot_settings pds ON pds.product_id=p.id AND pds.depot_id=$2" : ""}
            WHERE p.tenant_id=$1 AND p.archived_at IS NULL
            GROUP BY p.id, p.min_stock_level${depotParam ? ", pds.min_stock_level" : ""}`,
          depotParam ? [u.tenantId, depotParam] : [u.tenantId],
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

    const lowStockCount = alerts.rows.filter(
      (r) => r.total <= r.min_stock,
    ).length;
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
  "/sales",
  requireRole("ADMIN"),
  validateQuery(rangeSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof rangeSchema>;
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const from =
      q.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
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
      query<{ id: string; name: string }>(
        "SELECT id, name FROM depots WHERE tenant_id=$1",
        [u.tenantId],
      ),
      query<{ id: string; name: string }>(
        "SELECT id, name FROM users WHERE tenant_id=$1",
        [u.tenantId],
      ),
    ]);
    const depotName = new Map(depots.rows.map((d) => [d.id, d.name]));
    const vendorName = new Map(vendors.rows.map((v) => [v.id, v.name]));
    const data = rows.rows
      .map((r) => ({
        date: toDateStr(r.day) ?? String(r.day).slice(0, 10),
        depot: depotName.get(r.depot_id) ?? "—",
        vendor: vendorName.get(r.vendor_id) ?? "—",
        sales_count: r.sales_count,
        revenue: r.revenue,
      }))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          a.depot.localeCompare(b.depot) ||
          a.vendor.localeCompare(b.vendor),
      );
    if (q.format === "csv") {
      return csvResponse(
        res,
        `ventes_${from}_${to}.csv`,
        ["Date", "Dépôt", "Vendeur", "Nb ventes", "CA (FCFA)"],
        data.map((r) => [r.date, r.depot, r.vendor, r.sales_count, r.revenue]),
      );
    }
    res.json({ range: { from, to, timezone: tz }, data });
  }),
);

// ============================ MARGES ========================================
router.get(
  "/margin",
  requireRole("ADMIN"),
  validateQuery(rangeSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof rangeSchema>;
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const from =
      q.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = q.to ?? new Date().toISOString().slice(0, 10);

    const rows = await query<{
      product_id: string;
      name: string;
      qty_sold: number;
      revenue: number;
      cost: number;
      margin: number;
    }>(
      `SELECT p.id AS product_id, p.name, SUM(si.base_qty)::float AS qty_sold,
              SUM(si.total_price)::float AS revenue,
              SUM(si.base_qty * COALESCE(si.unit_cost, p.purchase_price))::float AS cost,
              (SUM(si.total_price) - SUM(si.base_qty * COALESCE(si.unit_cost, p.purchase_price)))::float AS margin
         FROM sale_items si
         JOIN sales s ON s.id=si.sale_id AND s.status='COMPLETED'
           AND (s.created_at + ($4 || ' hours')::interval)::date BETWEEN $2::date AND $3::date
         JOIN products p ON p.id=si.product_id
        WHERE s.tenant_id=$1
        GROUP BY p.id, p.name ORDER BY margin DESC`,
      [u.tenantId, from, to, off],
    );
    // Taux arrondi à 0,1 point — calcul applicatif (ROUND(float,int) non portable)
    const data = rows.rows.map((r) => ({
      ...r,
      margin_pct:
        r.revenue > 0 ? Math.round((1000 * r.margin) / r.revenue) / 10 : 0,
    }));
    const totals = data.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenue,
        cost: acc.cost + r.cost,
        margin: acc.margin + r.margin,
      }),
      { revenue: 0, cost: 0, margin: 0 },
    );
    if (q.format === "csv") {
      return csvResponse(
        res,
        `marges_${from}_${to}.csv`,
        ["Produit", "Qté vendue", "CA", "Coût", "Marge", "Marge %"],
        data.map((r) => [
          r.name,
          r.qty_sold,
          r.revenue,
          r.cost,
          r.margin,
          r.margin_pct,
        ]),
      );
    }
    res.json({ range: { from, to, timezone: tz }, totals, data });
  }),
);

// ============================ VALORISATION DU STOCK =========================
router.get(
  "/stock-valuation",
  requireRole("ADMIN"),
  validateQuery(
    z.object({
      depotId: z.string().uuid().optional(),
      format: z.enum(["json", "csv"]).default("json"),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      depotId?: string;
      format: "json" | "csv";
    };
    // Regroupement applicatif (portable à 100 %) : niveaux agrégés par (dépôt, produit)
    const lvlParams: unknown[] = [];
    let depotSql = "";
    if (q.depotId) depotSql = `WHERE depot_id = $${lvlParams.push(q.depotId)}`;
    const [levels, products, depots, categories] = await Promise.all([
      query<{ depot_id: string; product_id: string; q: number }>(
        `SELECT depot_id, product_id, SUM(quantity)::float AS q FROM stock_levels ${depotSql} GROUP BY depot_id, product_id`,
        lvlParams,
      ),
      query<{
        id: string;
        name: string;
        category_id: string | null;
        purchase_price: number;
        avg_cost: number;
        selling_price: number;
      }>(
        "SELECT id, name, category_id, purchase_price::float, avg_cost::float, selling_price::float FROM products WHERE tenant_id=$1 AND archived_at IS NULL",
        [u.tenantId],
      ),
      query<{ id: string; name: string }>(
        "SELECT id, name FROM depots WHERE tenant_id=$1",
        [u.tenantId],
      ),
      query<{ id: string; name: string }>(
        "SELECT id, name FROM categories WHERE tenant_id=$1",
        [u.tenantId],
      ),
    ]);
    const productById = new Map(products.rows.map((p) => [p.id, p]));
    const depotName = new Map(depots.rows.map((d) => [d.id, d.name]));
    const categoryName = new Map(categories.rows.map((c) => [c.id, c.name]));
    const rows = levels.rows
      .filter((l) => l.q > 0 && productById.has(l.product_id))
      .map((l) => {
        const p = productById.get(l.product_id)!;
        // Valorisation au COÛT RÉEL : CUMP du produit (repli catalogue si le
        // CUMP n'a jamais été alimenté — produit créé avant E1).
        const cump = p.avg_cost > 0 ? p.avg_cost : p.purchase_price;
        return {
          depot: depotName.get(l.depot_id) ?? "—",
          product: p.name,
          category:
            (l.product_id && p.category_id
              ? categoryName.get(p.category_id)
              : null) ?? "—",
          quantity: l.q,
          cump,
          purchase_value: l.q * cump,
          sale_value: l.q * p.selling_price,
        };
      })
      .sort(
        (a, b) =>
          a.depot.localeCompare(b.depot) || a.product.localeCompare(b.product),
      );
    const totals = rows.reduce(
      (acc, r) => ({
        purchase: acc.purchase + r.purchase_value,
        sale: acc.sale + r.sale_value,
      }),
      { purchase: 0, sale: 0 },
    );
    if (q.format === "csv") {
      return csvResponse(
        res,
        "valorisation_stock.csv",
        [
          "Dépôt",
          "Produit",
          "Catégorie",
          "Quantité",
          "CUMP",
          "Valeur achat",
          "Valeur vente",
        ],
        rows.map((r) => [
          r.depot,
          r.product,
          r.category,
          r.quantity,
          r.cump,
          r.purchase_value,
          r.sale_value,
        ]),
      );
    }
    res.json({ totals, data: rows });
  }),
);

// ============================ PÉREMPTIONS ===================================
router.get(
  "/expiry",
  requireRole("ADMIN"),
  validateQuery(
    z.object({
      days: z.coerce.number().int().min(1).max(365).default(30),
      includeExpired: z.coerce.boolean().default(true),
      format: z.enum(["json", "csv"]).default("json"),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      days: number;
      includeExpired: boolean;
      format: "json" | "csv";
    };
    // Fenêtre calculée en JS : comparaisons DATE ↔ TIMESTAMP évitées côté moteur
    const cutoff = new Date(Date.now() + q.days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    const r = await query<{
      product: string;
      depot: string | null;
      batch_number: string;
      quantity: number;
      expiry_date: Date | string;
    }>(
      `SELECT p.name AS product, d.name AS depot, b.batch_number, b.quantity::float AS quantity,
              b.expiry_date
         FROM stock_batches b
         JOIN products p ON p.id=b.product_id
         LEFT JOIN depots d ON d.id=b.depot_id
        WHERE p.tenant_id=$1 AND b.quantity > 0 AND b.expiry_date::date <= $2::date
          ${q.includeExpired ? "" : "AND b.expiry_date::date >= $3::date"}
        ORDER BY b.expiry_date ASC LIMIT 200`,
      q.includeExpired ? [u.tenantId, cutoff] : [u.tenantId, cutoff, todayStr],
    );
    // Compte à rebours calculé côté application (soustraction date-date non portable)
    const today = new Date(new Date().toISOString().slice(0, 10));
    const enriched = r.rows.map((row) => {
      const exp = new Date(row.expiry_date);
      const daysLeft = Math.round(
        (exp.getTime() - today.getTime()) / 86_400_000,
      );
      return {
        ...row,
        expiry_date: toDateStr(row.expiry_date) ?? row.expiry_date,
        days_left: daysLeft,
      };
    });
    if (q.format === "csv") {
      return csvResponse(
        res,
        `peremptions_${todayStr}.csv`,
        ["Produit", "Dépôt", "Lot", "Quantité", "Expiration", "Jours restants"],
        enriched.map((row) => [
          row.product,
          row.depot ?? "",
          row.batch_number,
          row.quantity,
          row.expiry_date,
          row.days_left,
        ]),
      );
    }
    res.json(enriched);
  }),
);

// ============================ PRÉDICTIF (corrigé BCK-02) ====================
router.get(
  "/predictive",
  requireRole("ADMIN"),
  validateQuery(
    z.object({
      depotId: z.string().uuid().optional(),
      format: z.enum(["json", "csv"]).default("json"),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const qp = req.query as unknown as {
      depotId?: string;
      format: "json" | "csv";
    };
    const since30d = new Date(Date.now() - 30 * 86_400_000);
    // E8 — cadrage dépôt optionnel : stock, ventes et seuil EFFECTIF (surcharge
    // par dépôt) évalués sur ce dépôt uniquement.
    const depotParam = qp.depotId ?? null;
    const stockCte = depotParam
      ? `SELECT p.id, p.name, COALESCE(pds.min_stock_level, p.min_stock_level)::float AS eff_min,
                p.purchase_price::float,
                COALESCE(SUM(sl.quantity),0)::float AS current_stock
           FROM products p
           LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.depot_id = $3
           LEFT JOIN product_depot_settings pds ON pds.product_id = p.id AND pds.depot_id = $3
          WHERE p.tenant_id=$1 AND p.archived_at IS NULL
          GROUP BY p.id, p.name, p.min_stock_level, pds.min_stock_level, p.purchase_price`
      : `SELECT p.id, p.name, p.min_stock_level::float AS eff_min, p.purchase_price::float,
                COALESCE(SUM(sl.quantity),0)::float AS current_stock
           FROM products p LEFT JOIN stock_levels sl ON sl.product_id = p.id
          WHERE p.tenant_id=$1 AND p.archived_at IS NULL
          GROUP BY p.id, p.name, p.min_stock_level, p.purchase_price`;
    const r = await query<{
      product_id: string;
      name: string;
      current_stock: number;
      min_stock_level: number;
      purchase_price: number;
      qty_30d: number;
    }>(
      `WITH stock AS (${stockCte}
       ), sold AS (
         SELECT si.product_id, SUM(si.base_qty)::float AS qty_30d
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id AND s.status='COMPLETED' AND s.tenant_id=$1
            ${depotParam ? "AND s.depot_id = $3" : ""}
          WHERE s.created_at >= $2
          GROUP BY si.product_id
       )
       SELECT st.id AS product_id, st.name, st.current_stock::float, st.eff_min::float AS min_stock_level,
              st.purchase_price::float, COALESCE(so.qty_30d, 0)::float AS qty_30d
         FROM stock st LEFT JOIN sold so ON so.product_id = st.id
        WHERE (COALESCE(so.qty_30d,0) > 0 AND st.current_stock < (so.qty_30d / 30.0) * 14)
           OR st.current_stock <= st.eff_min`,
      depotParam ? [u.tenantId, since30d, depotParam] : [u.tenantId, since30d],
    );
    // Fournisseur le plus courant par produit (réception directe d'abord,
    // lot à défaut) — résolution applicative (fenêtres SQL non portables).
    const supByProduct = new Map<
      string,
      { supplier_id: string; supplier_name: string; lead_days: number }
    >();
    if (r.rows.length > 0) {
      const sups = await query<{
        product_id: string;
        supplier_id: string;
        supplier_name: string;
        lead_days: number;
      }>(
        `SELECT ri.product_id, r.supplier_id, sp.name AS supplier_name,
                sp.default_lead_time_days::int AS lead_days
           FROM stock_receipt_items ri
           JOIN stock_receipts r ON r.id = ri.receipt_id
           JOIN suppliers sp ON sp.id = r.supplier_id
          WHERE r.tenant_id=$1 AND r.supplier_id IS NOT NULL
            AND r.created_at >= $2
          ORDER BY r.created_at DESC`,
        [u.tenantId, new Date(Date.now() - 365 * 86_400_000)],
      );
      for (const s of sups.rows) {
        if (!supByProduct.has(s.product_id)) {
          supByProduct.set(s.product_id, {
            supplier_id: s.supplier_id,
            supplier_name: s.supplier_name,
            lead_days: s.lead_days,
          });
        }
      }
    }
    // Indicateurs dérivés calculés côté application (ROUND non portable)
    const rows = r.rows
      .map((row) => {
        const avgDaily = row.qty_30d / 30;
        const sup = supByProduct.get(row.product_id) ?? null;
        // Quantité suggérée (E4) : couverture cible = délai fournisseur + 7 j
        // de tampon ; sans historique de vente → remonter à 2× le seuil mini.
        const lead = sup?.lead_days ?? 3;
        const target =
          avgDaily > 0 ? avgDaily * (lead + 7) : row.min_stock_level * 2;
        const suggested = Math.max(
          0,
          Math.ceil((target - row.current_stock) * 100) / 100,
        );
        return {
          product_id: row.product_id,
          name: row.name,
          current_stock: row.current_stock,
          min_stock_level: row.min_stock_level,
          avg_daily_sales: Math.round(avgDaily * 100) / 100,
          days_until_stockout:
            row.qty_30d > 0 ? Math.round(row.current_stock / avgDaily) : 999,
          suggested_qty: suggested,
          purchase_price: row.purchase_price,
          supplier_id: sup?.supplier_id ?? null,
          supplier_name: sup?.supplier_name ?? null,
          lead_days: sup?.lead_days ?? null,
        };
      })
      .sort(
        (a, b) =>
          a.days_until_stockout - b.days_until_stockout ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 50);
    if (qp.format === "csv") {
      return csvResponse(
        res,
        `predictif_${new Date().toISOString().slice(0, 10)}.csv`,
        [
          "Produit",
          "Stock",
          "Seuil alerte",
          "Moy/jour",
          "Rupture dans (j)",
          "Qté suggérée",
          "Fournisseur",
          "Délai (j)",
        ],
        rows.map((row) => [
          row.name,
          row.current_stock,
          row.min_stock_level,
          row.avg_daily_sales,
          row.days_until_stockout >= 999 ? "" : row.days_until_stockout,
          row.suggested_qty,
          row.supplier_name ?? "",
          row.lead_days ?? "",
        ]),
      );
    }
    res.json(rows);
  }),
);

// ============================ Z DE CAISSE (clôture journée) =================
router.get(
  "/z-report",
  validateQuery(
    z.object({
      date: z.string().date().optional(),
      depotId: z.string().uuid().optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as { date?: string; depotId?: string };
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const date = q.date ?? new Date().toISOString().slice(0, 10);
    const depotParam = u.role === "VENDEUR" ? u.depotId : (q.depotId ?? null);

    const params: unknown[] = [u.tenantId, date, off];
    let depotSql = "";
    let depotSqlS = "";
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
      // Encaissements réels par méthode (versements — exact avec le paiement
      // mixte, contrairement à la méthode principale de la vente) (E3).
      query(
        `SELECT p.method AS payment_method, COUNT(DISTINCT p.sale_id)::int AS count,
                COALESCE(SUM(p.amount),0)::float AS amount
           FROM sale_payments p
           JOIN sales s ON s.id = p.sale_id AND s.status='COMPLETED'
          WHERE p.tenant_id=$1
            AND (s.created_at + ($3 || ' hours')::interval)::date = $2::date ${depotSqlS}
          GROUP BY p.method`,
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
      date,
      timezone: tz,
      totals: totals.rows,
      byPayment: byPayment.rows,
      byVendor: byVendor.rows,
      voids: voids.rows[0],
    });
  }),
);

// ============================ STATS SUPER ADMIN =============================
router.get(
  "/superadmin/stats",
  requireSuperAdmin,
  h(async (_req, res) => {
    // Bornes temporelles calculées en JS (portable, pas de date_trunc/INTERVAL littéral)
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const last30d = new Date(Date.now() - 30 * 86_400_000);
    const last24h = new Date(Date.now() - 24 * 3_600_000);
    const [
      tenants,
      revenue,
      mrr,
      trials,
      notifsFailed,
      newTenants,
      topTenants,
    ] = await Promise.all([
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
      query(
        `SELECT COUNT(*)::int AS n FROM notifications WHERE status='FAILED' AND created_at >= $1`,
        [last24h],
      ),
      query(`SELECT COUNT(*)::int AS n FROM tenants WHERE created_at >= $1`, [
        last30d,
      ]),
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
      trialsEndingSoon: trials.rows.map((r) => ({
        tenant_name: r.tenant_name,
        end_date: toDateStr(r.end_date) ?? r.end_date,
      })),
      failedNotifications24h: notifsFailed.rows[0]!.n,
      newTenants30d: newTenants.rows[0]!.n,
      topTenants: topTenants.rows,
    });
  }),
);

// ============================ COGS / MARGE PÉRIODE (E1) =====================
router.get(
  "/cogs",
  requireRole("ADMIN"),
  validateQuery(rangeSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof rangeSchema>;
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const from =
      q.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = q.to ?? new Date().toISOString().slice(0, 10);
    // Coût des marchandises vendues à partir du coût FIGÉ des lignes de vente
    // (lot réel ou CUMP du jour) — jamais du prix d'achat courant.
    const params: unknown[] = [u.tenantId, from, to, off];
    let depotCond = "";
    if (q.depotId) depotCond = `AND s.depot_id = $${params.push(q.depotId)}`;
    const r = await query<{
      revenue: number;
      cogs: number;
      sales_count: number;
      qty_sold: number;
    }>(
      `SELECT COALESCE(SUM(si.total_price),0)::float AS revenue,
              COALESCE(SUM(si.base_qty * COALESCE(si.unit_cost, p.purchase_price)),0)::float AS cogs,
              COUNT(DISTINCT s.id)::int AS sales_count,
              COALESCE(SUM(si.base_qty),0)::float AS qty_sold
         FROM sale_items si
         JOIN sales s ON s.id=si.sale_id AND s.status='COMPLETED' ${depotCond}
           AND (s.created_at + ($4 || ' hours')::interval)::date BETWEEN $2::date AND $3::date
         JOIN products p ON p.id=si.product_id
        WHERE s.tenant_id=$1`,
      params,
    );
    const row = r.rows[0]!;
    const margin = Math.round((row.revenue - row.cogs) * 100) / 100;
    res.json({
      range: { from, to, timezone: tz },
      revenue: row.revenue,
      cogs: row.cogs,
      margin,
      margin_pct:
        row.revenue > 0 ? Math.round((1000 * margin) / row.revenue) / 10 : 0,
      sales_count: row.sales_count,
      qty_sold: row.qty_sold,
    });
  }),
);

// ============================ TRAÇABILITÉ LOT / RAPPEL (E2) =================
router.get(
  "/batch-trace",
  requireRole("ADMIN"),
  validateQuery(
    z.object({
      productId: z.string().uuid(),
      batchNumber: z.string().trim().min(1).max(100),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      productId: string;
      batchNumber: string;
    };
    const batches = await query<Record<string, unknown> & { id: string }>(
      `SELECT b.*, d.name AS depot_name, s.name AS supplier_name
         FROM stock_batches b
         LEFT JOIN depots d ON d.id = b.depot_id
         LEFT JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.product_id=$1 AND b.batch_number=$2
        ORDER BY b.depot_id NULLS LAST`,
      [q.productId, q.batchNumber],
    );
    if (batches.rows.length === 0) {
      return res.json({
        found: false,
        batchNumber: q.batchNumber,
        batches: [],
        inflows: [],
        outflows: [],
      });
    }
    const ids = batches.rows.map((b: { id: string }) => b.id);
    const ph = ids.map((_: unknown, i: number) => `$${i + 1}`).join(",");
    // Entrées (réceptions) et sorties (ventes prélevées sur ce lot) — rappel
    // de lot : « où est entré ce lot, où est-il parti, combien reste-t-il ? »
    const inflows = await query(
      `SELECT r.created_at, r.reference, sup.name AS supplier, d.name AS depot,
              i.base_qty::float AS qty, i.unit_cost::float AS unit_cost
         FROM stock_receipt_items i
         JOIN stock_receipts r ON r.id = i.receipt_id
         LEFT JOIN suppliers sup ON sup.id = r.supplier_id
         LEFT JOIN depots d ON d.id = r.depot_id
        WHERE i.batch_id IN (${ph}) ORDER BY r.created_at ASC`,
      ids,
    );
    const outflows = await query(
      `SELECT s.id AS sale_id, s.status, s.created_at, d.name AS depot,
              usr.name AS vendor, si.base_qty::float AS qty,
              si.unit_price::float AS unit_price, si.unit_cost::float AS unit_cost
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN depots d ON d.id = s.depot_id
         LEFT JOIN users usr ON usr.id = s.vendor_id
        WHERE si.batch_id IN (${ph}) ORDER BY s.created_at ASC`,
      ids,
    );
    const movements = await query(
      `SELECT m.type, m.quantity::float, m.created_at, d.name AS depot, usr.name AS user_name
         FROM stock_movements m
         LEFT JOIN depots d ON d.id = m.depot_id
         LEFT JOIN users usr ON usr.id = m.user_id
        WHERE m.batch_id IN (${ph}) AND m.type <> 'SALE'
        ORDER BY m.created_at ASC`,
      ids,
    );
    res.json({
      found: true,
      batchNumber: q.batchNumber,
      batches: batches.rows,
      inflows: inflows.rows,
      outflows: outflows.rows,
      otherMovements: movements.rows,
    });
  }),
);

// ============================ REVALORISATION HISTORIQUE (E1) ================
import { revalueTenantCosts } from "../services/costingService";
import { writeAudit } from "../lib/audit";

router.post(
  "/costs-revalue",
  requireRole("ADMIN"),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const report = await revalueTenantCosts(u.tenantId);
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "REVALUE",
      entity: "stock",
      details: `Revalorisation CUMP historique : ${report.products} produits, ${report.batches} lots, ${report.saleItems} lignes de vente`,
      newState: report,
    });
    res.json(report);
  }),
);

// ============================ JOURNAL DE TVA (E7) ===========================
// TVA collectée ventilée par taux : factures à +, avoirs à − (cadrage jour
// local tenant, DAT-08). Base de la déclaration mensuelle (CA / impôts).
router.get(
  "/vat-journal",
  requireRole("ADMIN"),
  validateQuery(rangeSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof rangeSchema>;
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const from =
      q.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = q.to ?? new Date().toISOString().slice(0, 10);

    const cond = [
      "i.tenant_id=$1",
      "(i.issued_at + ($4 || ' hours')::interval)::date BETWEEN $2::date AND $3::date",
    ];
    const params: unknown[] = [u.tenantId, from, to, off];
    if (q.depotId) {
      params.push(q.depotId);
      cond.push(`i.depot_id=$${params.length}`);
    }
    const where = cond.join(" AND ");

    const inv = await query<{
      number: string;
      day: Date;
      depot: string;
      kind: "INVOICE" | "CREDIT_NOTE";
      customer: string | null;
      ht: number;
      vat: number;
      ttc: number;
    }>(
      `SELECT i.number,
              (i.issued_at + ($4 || ' hours')::interval)::date AS day,
              d.name AS depot, i.kind, i.customer_name AS customer,
              i.total_ht::float AS ht, i.total_vat::float AS vat, i.total_ttc::float AS ttc
         FROM invoices i JOIN depots d ON d.id = i.depot_id
        WHERE ${where}
        ORDER BY day, i.number`,
      params,
    );
    const sign = (kind: string) => (kind === "CREDIT_NOTE" ? -1 : 1);
    const rows = inv.rows.map((r) => ({
      number: r.number,
      date: toDateStr(r.day),
      depot: r.depot,
      kind: r.kind,
      customer: r.customer,
      ht: sign(r.kind) * r.ht,
      vat: sign(r.kind) * r.vat,
      ttc: sign(r.kind) * r.ttc,
    }));

    // Ventilation par taux (depuis les lignes facturées de la période)
    const byRateRows = await query<{
      rate: number;
      kind: string;
      ht: number;
      vat: number;
    }>(
      `SELECT ii.tax_rate::float AS rate, i.kind,
              COALESCE(SUM(ii.total_ht),0)::float AS ht,
              COALESCE(SUM(ii.total_vat),0)::float AS vat
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
        WHERE ${where}
        GROUP BY ii.tax_rate, i.kind
        ORDER BY ii.tax_rate`,
      params,
    );
    const rateMap = new Map<
      number,
      { rate: number; ht: number; vat: number }
    >();
    for (const r of byRateRows.rows) {
      const s = sign(r.kind);
      const cur = rateMap.get(r.rate) ?? { rate: r.rate, ht: 0, vat: 0 };
      cur.ht = Math.round((cur.ht + s * r.ht) * 100) / 100;
      cur.vat = Math.round((cur.vat + s * r.vat) * 100) / 100;
      rateMap.set(r.rate, cur);
    }
    const byRate = [...rateMap.values()].sort((a, b) => a.rate - b.rate);

    const totals = rows.reduce(
      (a, r) => ({
        ht: Math.round((a.ht + r.ht) * 100) / 100,
        vat: Math.round((a.vat + r.vat) * 100) / 100,
        ttc: Math.round((a.ttc + r.ttc) * 100) / 100,
      }),
      { ht: 0, vat: 0, ttc: 0 },
    );

    if (q.format === "csv") {
      return csvResponse(
        res,
        `journal_tva_${from}_${to}.csv`,
        ["Numéro", "Date", "Dépôt", "Type", "Client", "HT", "TVA", "TTC"],
        [
          ...rows.map((r) => [
            r.number,
            r.date,
            r.depot,
            r.kind === "CREDIT_NOTE" ? "AVOIR" : "FACTURE",
            r.customer ?? "Comptant",
            r.ht.toFixed(2),
            r.vat.toFixed(2),
            r.ttc.toFixed(2),
          ]),
          [],
          ["VENTILATION PAR TAUX", "", "", "", "", "", "", ""],
          ...byRate.map((r) => [
            `TVA ${r.rate} %`,
            "",
            "",
            "",
            "",
            r.ht.toFixed(2),
            r.vat.toFixed(2),
            "",
          ]),
          [
            "TOTAL",
            "",
            "",
            "",
            "",
            totals.ht.toFixed(2),
            totals.vat.toFixed(2),
            totals.ttc.toFixed(2),
          ],
        ],
      );
    }
    res.json({ range: { from, to, timezone: tz }, rows, byRate, totals });
  }),
);

// ============================ KPI STOCK (E8) ================================
// Valeur, rotation, couverture, classification ABC et STOCK DORMANT (capital
// immobilisé) par produit — cadrage dépôt optionnel. Règles :
//  - rotation 90 j  = vendus (90 j) / stock courant ;
//  - couverture (j) = stock courant / moyenne journalière (999 si pas de
//    vente sur 90 j) ;
//  - ABC            = part cumulée des quantités vendues 90 j (A < 80 %,
//    B < 95 %, C le reste) ;
//  - dormant        = pas de vente depuis ≥ dormantDays jours ET stock > 0.
router.get(
  "/stock-kpis",
  requireRole("ADMIN"),
  validateQuery(
    z.object({
      depotId: z.string().uuid().optional(),
      dormantDays: z.coerce.number().int().min(7).max(365).default(60),
      format: z.enum(["json", "csv"]).default("json"),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      depotId?: string;
      dormantDays: number;
      format: "json" | "csv";
    };
    const since90 = new Date(Date.now() - 90 * 86_400_000);
    const depotParam = q.depotId ?? null;

    const [sold, stock] = await Promise.all([
      query<{
        product_id: string;
        qty: number;
        last_sale: Date | string | null;
      }>(
        `SELECT si.product_id, SUM(si.base_qty)::float AS qty, MAX(s.created_at) AS last_sale
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id AND s.status='COMPLETED' AND s.tenant_id=$1
            ${depotParam ? "AND s.depot_id = $3" : ""}
          WHERE s.created_at >= $2
          GROUP BY si.product_id`,
        depotParam ? [u.tenantId, since90, depotParam] : [u.tenantId, since90],
      ),
      query<{
        product_id: string;
        name: string;
        barcode: string | null;
        unit: string | null;
        avg_cost: number;
        current_stock: number;
        reserved: number;
      }>(
        `SELECT p.id AS product_id, p.name, p.barcode, un.symbol AS unit,
                p.avg_cost::float,
                COALESCE(SUM(sl.quantity),0)::float AS current_stock,
                COALESCE(SUM(sl.reserved_qty),0)::float AS reserved
           FROM products p
           LEFT JOIN stock_levels sl ON sl.product_id = p.id
             ${depotParam ? "AND sl.depot_id = $2" : ""}
           LEFT JOIN units un ON un.id = p.unit_id
          WHERE p.tenant_id=$1 AND p.archived_at IS NULL
          GROUP BY p.id, p.name, p.barcode, un.symbol, p.avg_cost
          ORDER BY p.name`,
        depotParam ? [u.tenantId, depotParam] : [u.tenantId],
      ),
    ]);

    // ABC : classes sur les quantités vendues 90 j (même convention que les
    // campagnes tournantes — le franchissant complète sa classe).
    const soldBy = new Map(sold.rows.map((r) => [r.product_id, r]));
    const totalSold = sold.rows.reduce((a, r) => a + r.qty, 0);
    const classes = new Map<string, "A" | "B" | "C">();
    {
      let cumBefore = 0;
      for (const r of [...sold.rows].sort((a, b) => b.qty - a.qty)) {
        const shareBefore = totalSold > 0 ? cumBefore / totalSold : 0;
        classes.set(
          r.product_id,
          shareBefore < 0.8 ? "A" : shareBefore < 0.95 ? "B" : "C",
        );
        cumBefore += r.qty;
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const nowMs = Date.now();
    const rows = stock.rows
      .map((p) => {
        const s = soldBy.get(p.product_id);
        const qtySold = s?.qty ?? 0;
        const avgDaily = qtySold / 90;
        const coverage =
          avgDaily > 1e-9 ? Math.round(p.current_stock / avgDaily) : 999;
        const turnover =
          p.current_stock > 1e-9 ? round2(qtySold / p.current_stock) : 0;
        const lastSaleDate = s?.last_sale ? new Date(s.last_sale) : null;
        const daysSinceSale = lastSaleDate
          ? Math.floor((nowMs - lastSaleDate.getTime()) / 86_400_000)
          : 999;
        const dormant =
          p.current_stock > 1e-9 && daysSinceSale >= q.dormantDays;
        return {
          product_id: p.product_id,
          name: p.name,
          barcode: p.barcode,
          unit: p.unit,
          current_stock: p.current_stock,
          reserved: p.reserved,
          avg_cost: p.avg_cost,
          stock_value: round2(p.current_stock * p.avg_cost),
          qty_sold_90d: round2(qtySold),
          avg_daily: round2(avgDaily),
          coverage_days: coverage,
          turnover_90d: turnover,
          abc_class: classes.get(p.product_id) ?? "C",
          last_sale_at: lastSaleDate ? lastSaleDate.toISOString() : null,
          days_since_sale: daysSinceSale,
          dormant,
        };
      })
      // Un produit jamais approvisionné et jamais vendu n'apporte rien ici.
      .filter(
        (r) =>
          r.current_stock > 1e-9 || r.qty_sold_90d > 1e-9 || r.reserved > 1e-9,
      );

    const dormantRows = rows.filter((r) => r.dormant);
    const totals = {
      stock_value: round2(rows.reduce((a, r) => a + r.stock_value, 0)),
      references: rows.length,
      dormant_count: dormantRows.length,
      dormant_value: round2(dormantRows.reduce((a, r) => a + r.stock_value, 0)),
    };

    if (q.format === "csv") {
      return csvResponse(
        res,
        `kpi_stock_${new Date().toISOString().slice(0, 10)}.csv`,
        [
          "Produit",
          "Code-barres",
          "Stock",
          "Réservé",
          "CUMP",
          "Valeur stock",
          "Vendus 90j",
          "Moy/jour",
          "Couverture (j)",
          "Rotation 90j",
          "ABC",
          "Jours sans vente",
          "Dormant",
        ],
        rows.map((r) => [
          r.name,
          r.barcode ?? "",
          r.current_stock,
          r.reserved,
          r.avg_cost,
          r.stock_value.toFixed(2),
          r.qty_sold_90d,
          r.avg_daily,
          r.coverage_days >= 999 ? "" : r.coverage_days,
          r.turnover_90d,
          r.abc_class,
          r.days_since_sale >= 999 ? "" : r.days_since_sale,
          r.dormant ? "OUI" : "",
        ]),
      );
    }
    res.json({ totals, data: rows });
  }),
);

// ============================ EXPORTS SYSCOHADA (E7) ========================
// Plan comptable OHADA (référentiel SYSCOHADA révisé) — comptes par défaut :
//   701100 Ventes de marchandises (HT) · 443100 État, TVA collectée
//   411100 Clients (crédit & avoirs)   · 571000 Caisse (espèces)
//   521100/521200 Banques mobiles (MTN MoMo / Orange Money)
//   311000 Marchandises (inventaire valorisé)
const SYSCOHADA = {
  sales: "701100",
  vat: "443100",
  customers: "411100",
  cash: "571000",
  momo: "521100",
  om: "521200",
  inventory: "311000",
} as const;

const frDate = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const acc = (n: number) => n.toFixed(2);

/** Journal des ventes (VT) : une écriture DÉBIT par mode de règlement et par
 *  crédit client, CRÉDIT 701100 HT + 443100 TVA ; les avoirs contrepassent
 *  le compte client (411100) et les comptes de produit/TVA. */
router.get(
  "/exports/syscohada-sales",
  requireRole("ADMIN"),
  validateQuery(rangeSchema.omit({ format: true })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as z.infer<typeof rangeSchema>;
    const tz = await tenantTimezone(u.tenantId);
    const off = tzOffsetHours(tz);
    const from =
      q.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = q.to ?? new Date().toISOString().slice(0, 10);

    const inv = await query<{
      id: string;
      number: string;
      day: Date;
      kind: "INVOICE" | "CREDIT_NOTE";
      sale_id: string | null;
      customer: string | null;
      ht: number;
      vat: number;
      ttc: number;
    }>(
      `SELECT i.id, i.number, i.kind, i.sale_id, i.customer_name AS customer,
              (i.issued_at + ($4 || ' hours')::interval)::date AS day,
              i.total_ht::float AS ht, i.total_vat::float AS vat, i.total_ttc::float AS ttc
         FROM invoices i
        WHERE i.tenant_id=$1
          AND (i.issued_at + ($4 || ' hours')::interval)::date BETWEEN $2::date AND $3::date
        ORDER BY day, i.number`,
      [u.tenantId, from, to, off],
    );

    // Règlements des ventes facturées (répartition DÉBIT par méthode)
    const saleIds = inv.rows
      .map((r) => r.sale_id)
      .filter((x): x is string => x != null);
    const payBySale = new Map<string, Map<string, number>>();
    if (saleIds.length > 0) {
      const ph = saleIds.map((_, i) => `$${i + 2}`).join(",");
      const pays = await query<{
        sale_id: string;
        method: string;
        amount: number;
      }>(
        `SELECT sale_id, method, COALESCE(SUM(amount),0)::float AS amount
           FROM sale_payments WHERE tenant_id=$1 AND sale_id IN (${ph})
          GROUP BY sale_id, method`,
        [u.tenantId, ...saleIds],
      );
      for (const p of pays.rows) {
        const m = payBySale.get(p.sale_id) ?? new Map<string, number>();
        m.set(p.method, (m.get(p.method) ?? 0) + p.amount);
        payBySale.set(p.sale_id, m);
      }
    }

    const methodAccount = (m: string) =>
      m === "CASH"
        ? SYSCOHADA.cash
        : m === "MTN_MOMO"
          ? SYSCOHADA.momo
          : SYSCOHADA.om;
    const lines: unknown[][] = [];
    for (const r of inv.rows) {
      const day = frDate(toDateStr(r.day));
      const label = `Vente ${r.customer ?? "comptant"}`;
      if (r.kind === "INVOICE") {
        // DÉBIT : règlements réels par méthode, reliquat = crédit client
        let paidTotal = 0;
        for (const [method, amount] of payBySale.get(r.sale_id ?? "") ?? []) {
          lines.push([
            "VT",
            day,
            methodAccount(method),
            r.number,
            label,
            acc(amount),
            "0.00",
          ]);
          paidTotal += amount;
        }
        const credit = Math.round((r.ttc - paidTotal) * 100) / 100;
        if (credit > 0.004) {
          lines.push([
            "VT",
            day,
            SYSCOHADA.customers,
            r.number,
            `Crédit — ${label}`,
            acc(credit),
            "0.00",
          ]);
        }
        lines.push([
          "VT",
          day,
          SYSCOHADA.sales,
          r.number,
          `${label} (HT)`,
          "0.00",
          acc(r.ht),
        ]);
        if (r.vat > 0.004) {
          lines.push([
            "VT",
            day,
            SYSCOHADA.vat,
            r.number,
            `TVA — ${label}`,
            "0.00",
            acc(r.vat),
          ]);
        }
      } else {
        // AVOIR : contrepasse produit & TVA, avoir porté au crédit du client
        const labelAv = `Avoir ${r.customer ?? "comptant"}`;
        lines.push([
          "VT",
          day,
          SYSCOHADA.sales,
          r.number,
          `${labelAv} (HT)`,
          acc(r.ht),
          "0.00",
        ]);
        if (r.vat > 0.004) {
          lines.push([
            "VT",
            day,
            SYSCOHADA.vat,
            r.number,
            `TVA — ${labelAv}`,
            acc(r.vat),
            "0.00",
          ]);
        }
        lines.push([
          "VT",
          day,
          SYSCOHADA.customers,
          r.number,
          labelAv,
          "0.00",
          acc(r.ttc),
        ]);
      }
    }
    return csvResponse(
      res,
      `syscohada_ventes_${from}_${to}.csv`,
      ["Journal", "Date", "Compte", "Référence", "Libellé", "Débit", "Crédit"],
      lines,
    );
  }),
);

/** Créances clients (411100) : soldes avec vieillissement 30/60/90. */
router.get(
  "/exports/syscohada-receivables",
  requireRole("ADMIN"),
  validateQuery(z.object({})),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const customers = await query<{
      id: string;
      name: string;
      phone: string | null;
      balance: number;
    }>(
      "SELECT id, name, phone, balance::float FROM customers WHERE tenant_id=$1 AND balance > 0 ORDER BY name",
      [u.tenantId],
    );
    const open = await query<{
      customer_id: string;
      due_date: string | null;
      created_at: string;
      outstanding: number;
    }>(
      `SELECT s.customer_id, s.due_date, s.created_at,
              (s.total_amount - s.amount_paid)::float AS outstanding
         FROM sales s
        WHERE s.tenant_id=$1 AND s.status='COMPLETED' AND s.customer_id IS NOT NULL
          AND (s.amount_paid + 0.005) < s.total_amount`,
      [u.tenantId],
    );
    const now = Date.now();
    interface RecRow {
      name: string;
      phone: string | null;
      balance: number;
      d30: number;
      d60: number;
      d90: number;
      over90: number;
      oldest: string | null;
    }
    const byCustomer = new Map<string, RecRow>();
    for (const c of customers.rows) {
      byCustomer.set(c.id, {
        name: c.name,
        phone: c.phone,
        balance: c.balance,
        d30: 0,
        d60: 0,
        d90: 0,
        over90: 0,
        oldest: null,
      });
    }
    for (const s of open.rows) {
      const row = byCustomer.get(s.customer_id);
      if (!row) continue;
      const ref = toDateStr(s.due_date) ?? toDateStr(s.created_at) ?? "";
      const days = ref
        ? Math.floor((now - new Date(ref).getTime()) / 86_400_000)
        : 0;
      const o = s.outstanding;
      if (days > 90) row.over90 += o;
      else if (days > 60) row.d90 += o;
      else if (days > 30) row.d60 += o;
      else row.d30 += o;
      if (ref && (!row.oldest || ref < row.oldest)) row.oldest = ref;
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return csvResponse(
      res,
      `syscohada_creances_${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Compte",
        "Client",
        "Téléphone",
        "Solde",
        "0-30 j",
        "31-60 j",
        "61-90 j",
        ">90 j",
        "Échéance la plus ancienne",
      ],
      [...byCustomer.values()].map((r) => [
        SYSCOHADA.customers,
        r.name,
        r.phone ?? "",
        acc(round(r.balance)),
        acc(round(r.d30)),
        acc(round(r.d60)),
        acc(round(r.d90)),
        acc(round(r.over90)),
        frDate(r.oldest),
      ]),
    );
  }),
);

/** Inventaire valorisé (311000 marchandises) au CUMP, par dépôt. */
router.get(
  "/exports/syscohada-inventory",
  requireRole("ADMIN"),
  validateQuery(z.object({ depotId: z.string().uuid().optional() })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const depotId = (req.query as { depotId?: string }).depotId;
    const levels = await query<{
      product_id: string;
      depot_id: string;
      qty: number;
    }>(
      `SELECT sl.product_id, sl.depot_id, COALESCE(SUM(sl.quantity),0)::float AS qty
         FROM stock_levels sl
         JOIN products p ON p.id = sl.product_id
        WHERE p.tenant_id=$1 ${depotId ? "AND sl.depot_id=$2" : ""}
        GROUP BY sl.product_id, sl.depot_id`,
      depotId ? [u.tenantId, depotId] : [u.tenantId],
    );
    // Quantité strictement positive (filtrage JS — HAVING non portable)
    levels.rows = levels.rows.filter((l) => l.qty > 0);
    const products = await query<{
      id: string;
      name: string;
      avg_cost: number;
    }>("SELECT id, name, avg_cost::float FROM products WHERE tenant_id=$1", [
      u.tenantId,
    ]);
    const depots = await query<{ id: string; name: string }>(
      "SELECT id, name FROM depots WHERE tenant_id=$1",
      [u.tenantId],
    );
    const prodName = new Map(products.rows.map((p) => [p.id, p.name]));
    const prodCost = new Map(products.rows.map((p) => [p.id, p.avg_cost]));
    const depotName = new Map(depots.rows.map((d) => [d.id, d.name]));
    const rows = levels.rows
      .map((l) => {
        const cost = prodCost.get(l.product_id) ?? 0;
        const value = Math.round(l.qty * cost * 100) / 100;
        return {
          compte: SYSCOHADA.inventory,
          produit: prodName.get(l.product_id) ?? "Produit",
          depot: depotName.get(l.depot_id) ?? "—",
          qty: l.qty,
          cump: cost,
          value,
        };
      })
      .sort(
        (a, b) =>
          a.depot.localeCompare(b.depot) || a.produit.localeCompare(b.produit),
      );
    const total = rows.reduce(
      (a, r) => Math.round((a + r.value) * 100) / 100,
      0,
    );
    return csvResponse(
      res,
      `syscohada_inventaire_${new Date().toISOString().slice(0, 10)}.csv`,
      ["Compte", "Produit", "Dépôt", "Quantité", "CUMP", "Valeur"],
      [
        ...rows.map((r) => [
          r.compte,
          r.produit,
          r.depot,
          String(r.qty),
          acc(r.cump),
          acc(r.value),
        ]),
        ["", "TOTAL", "", "", "", acc(total)],
      ],
    );
  }),
);

export default router;
