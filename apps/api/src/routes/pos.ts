import { Router } from "express";
import { query } from "../config/db";
import { h } from "../lib/asyncHandler";
import { authenticate, AuthRequest } from "../middleware/auth";
import { resolveDepot } from "../services/saleService";

const router = Router();
router.use(authenticate);

/**
 * Bootstrap de caisse (POS) : catalogue compact + stocks du dépôt du vendeur
 * (+ favoris 30 j) en UN appel — pensé pour le pré-chargement hors-ligne (IndexedDB).
 */
router.get(
  "/bootstrap",
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const depotId = resolveDepot(
      u,
      typeof req.query.depotId === "string" ? req.query.depotId : undefined,
    );

    const [
      products,
      variantsRaw,
      levels,
      units,
      categories,
      favorites,
      customers,
      aliases,
      weightedCfg,
    ] = await Promise.all([
      query(
        `SELECT p.id, p.name, p.barcode, p.selling_price::float, p.purchase_price::float,
                p.min_stock_level::float, p.has_variants, p.image_url, p.requires_serial,
                p.is_weighed,
                un.id AS unit_id, un.symbol AS unit_symbol, un.base_value::float AS unit_base_value,
                c.name AS category_name
           FROM products p
           LEFT JOIN units un ON un.id = p.unit_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.tenant_id = $1 AND p.archived_at IS NULL
          ORDER BY p.name`,
        [u.tenantId],
      ),
      query(
        `SELECT v.id, v.product_id, v.name, v.sku, v.barcode, v.additional_price::float AS additional_price, v.attributes
           FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE p.tenant_id=$1 AND p.archived_at IS NULL ORDER BY v.name`,
        [u.tenantId],
      ),
      query(
        "SELECT product_id, variant_id, quantity::float FROM stock_levels WHERE depot_id = $1",
        [depotId],
      ),
      query(
        "SELECT id, name, symbol, base_value::float, is_base FROM units WHERE tenant_id=$1",
        [u.tenantId],
      ),
      query(
        "SELECT id, name FROM categories WHERE tenant_id=$1 ORDER BY sort_order, name",
        [u.tenantId],
      ),
      query(
        `SELECT si.product_id, SUM(si.base_qty)::float AS qty
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE s.tenant_id=$1 AND s.depot_id=$2 AND s.status='COMPLETED'
            AND s.created_at >= now() - INTERVAL '30 days'
          GROUP BY si.product_id ORDER BY qty DESC LIMIT 12`,
        [u.tenantId, depotId],
      ),
      // Clients sélectionnables à la caisse — carnet de dettes hors-ligne (E3)
      query(
        `SELECT id, name, phone, balance::float, credit_limit::float
             FROM customers WHERE tenant_id=$1 AND is_active ORDER BY name LIMIT 500`,
        [u.tenantId],
      ),
      // C3 — registre d'alias (codes fournisseurs + conditionnements) pour la
      // résolution multi-codes AU SCAN, hors-ligne comprise. Plafond 5 000 :
      // au-delà, le drapeau barcodesComplete=false invite la caisse à faire
      // le lookup en ligne (GET /api/products/lookup/:code) à la volée.
      // 5 001 lignes lues pour détecter le dépassement.
      query(
        `SELECT pb.code, pb.product_id, pb.variant_id, pb.unit_id,
                un.base_value::float AS unit_base_value, un.symbol AS unit_symbol
           FROM product_barcodes pb
           JOIN products p ON p.id = pb.product_id AND p.archived_at IS NULL
           LEFT JOIN units un ON un.id = pb.unit_id
          WHERE pb.tenant_id=$1
          ORDER BY pb.created_at DESC
          LIMIT 5001`,
        [u.tenantId],
      ),
      // C5 — mode de décodage des étiquettes de balance (pesée embarquée) :
      // OFF (défaut) / PRICE / WEIGHT. Lu ici pour rester hors-ligne.
      query(
        `SELECT value FROM tenant_configs
          WHERE tenant_id=$1 AND key='barcode_weighted_mode'`,
        [u.tenantId],
      ),
    ]);

    // Jointure effectuée côté application (évite json_agg, portable)
    const variantsByProduct = new Map<
      string,
      Array<{
        id: string;
        name: string;
        sku: string | null;
        barcode: string | null;
        additionalPrice: number;
        attributes: unknown;
      }>
    >();
    for (const v of variantsRaw.rows) {
      if (!variantsByProduct.has(v.product_id))
        variantsByProduct.set(v.product_id, []);
      variantsByProduct.get(v.product_id)!.push({
        id: v.id,
        name: v.name,
        sku: v.sku,
        barcode: v.barcode,
        additionalPrice: v.additional_price,
        attributes: v.attributes,
      });
    }

    res.json({
      serverTime: new Date().toISOString(),
      depotId,
      products: products.rows.map((p) => ({
        ...p,
        variants: variantsByProduct.get(p.id) ?? [],
      })),
      levels: levels.rows,
      units: units.rows,
      categories: categories.rows,
      favorites: favorites.rows.map((f) => f.product_id),
      customers: customers.rows,
      barcodes: aliases.rows.slice(0, 5000),
      barcodesComplete: aliases.rows.length <= 5000,
      // C5 — décodage des codes de balance à la caisse (« OFF » par défaut).
      weightedMode:
        weightedCfg.rows[0]?.value === "PRICE" ||
        weightedCfg.rows[0]?.value === "WEIGHT"
          ? weightedCfg.rows[0].value
          : "OFF",
    });
  }),
);

export default router;
