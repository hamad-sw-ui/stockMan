import { PoolClient } from "pg";
import { withTransaction } from "../config/db";
import { HttpError } from "../lib/errors";

/**
 * Valorisation des stocks au COÛT RÉEL — phase E1 (docs/05_AUDIT_EXPERT_STOCK.md).
 *
 * Méthode retenue : **CUMP** (coût unitaire moyen pondéré après chaque entrée),
 * pratique standard du référentiel SYSCOHADA, tenu au niveau PRODUIT (tous
 * dépôts confondus) :
 *
 *      nouveau CUMP = (stock × ancien CUMP + qté entrée × coût entrée)
 *                     ────────────────────────────────────────────────────
 *                                   stock + qté entrée
 *
 * Les sorties consomment au CUMP du jour SANS le modifier. Le coût est figé
 * sur chaque ligne de vente (`sale_items.unit_cost`) : les marges historiques
 * ne bougent plus lorsque le prix d'achat évolue.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Verrouille la fiche produit et retourne son CUMP courant. */
export async function lockProductCost(
  client: PoolClient,
  tenantId: string,
  productId: string,
): Promise<number> {
  const r = await client.query<{ avg_cost: number }>(
    "SELECT avg_cost FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
    [productId, tenantId],
  );
  if (!r.rows[0])
    throw HttpError.badRequest("PRODUCT_UNKNOWN", "Produit introuvable.");
  return r2(Number(r.rows[0].avg_cost) || 0);
}

/** Stock physique total du produit, tous dépôts confondus. */
export async function stockOfProduct(
  client: PoolClient,
  productId: string,
): Promise<number> {
  const r = await client.query<{ q: number }>(
    "SELECT COALESCE(SUM(quantity),0)::float AS q FROM stock_levels WHERE product_id=$1",
    [productId],
  );
  return r.rows[0]?.q ?? 0;
}

/**
 * CUMP — entrée de stock : À APPELER AVANT la hausse physique des niveaux
 * (la pondération lit le stock « avant »). Retourne le nouveau CUMP.
 */
export async function applyInflowCost(
  client: PoolClient,
  tenantId: string,
  productId: string,
  qtyBase: number,
  unitCost: number,
): Promise<number> {
  const avg = await lockProductCost(client, tenantId, productId);
  const stockBefore = await stockOfProduct(client, productId);
  const totalQty = stockBefore + qtyBase;
  const next =
    totalQty > 1e-9
      ? r2((stockBefore * avg + qtyBase * unitCost) / totalQty)
      : r2(unitCost);
  await client.query(
    "UPDATE products SET avg_cost=$2, updated_at=now() WHERE id=$1",
    [productId, next],
  );
  return next;
}

/** Coût applicable d'une sortie : CUMP courant (ne le modifie pas). */
export async function currentAvgCost(
  client: PoolClient,
  tenantId: string,
  productId: string,
): Promise<number> {
  return lockProductCost(client, tenantId, productId);
}

/** Coût effectif d'un lot (repli sur le CUMP si le lot n'a pas de coût). */
export function effectiveBatchCost(
  batchCost: number | null | undefined,
  avgCost: number,
): number {
  return batchCost && batchCost > 0 ? batchCost : avgCost;
}

export interface RevalueReport {
  products: number;
  batches: number;
  saleItems: number;
}

/**
 * Revalorisation de l'historique (idempotente, boucle applicative — portable) :
 *  1) lots : dernier coût de réception connu du lot ;
 *  2) produits : rejeu chronologique des réceptions ⇒ CUMP courant reconstruit ;
 *  3) lignes de vente sans coût figé : repli sur le prix d'achat catalogue
 *     (meilleur effort rétroactif — l'exactitude est garantie à l'avenir par
 *     le figeage à la vente).
 */
export async function revalueTenantCosts(
  tenantId: string,
): Promise<RevalueReport> {
  return withTransaction(async (client) => {
    // 1) Coût des lots : dernière réception chronologique connue écrase les
    //    précédentes (rejeu ASC → la dernière écriture gagne).
    const ri = await client.query<{ batch_id: string; unit_cost: number }>(
      `SELECT i.batch_id, i.unit_cost
         FROM stock_receipt_items i
         JOIN stock_receipts r ON r.id = i.receipt_id
        WHERE r.tenant_id=$1 AND i.batch_id IS NOT NULL AND i.unit_cost > 0
        ORDER BY r.created_at ASC, i.id ASC`,
      [tenantId],
    );
    const batchCost = new Map<string, number>();
    for (const row of ri.rows) batchCost.set(row.batch_id, row.unit_cost);
    let batches = 0;
    for (const [batchId, cost] of batchCost) {
      const u = await client.query(
        "UPDATE stock_batches SET unit_cost=$2 WHERE id=$1 AND unit_cost = 0",
        [batchId, cost],
      );
      batches += u.rowCount ?? 0;
    }

    // 2) CUMP produit : rejeu des entrées par produit, chronologique.
    const prods = await client.query<{ id: string; purchase_price: number }>(
      "SELECT id, purchase_price::float FROM products WHERE tenant_id=$1",
      [tenantId],
    );
    let products = 0;
    for (const p of prods.rows) {
      const recs = await client.query<{ base_qty: number; unit_cost: number }>(
        `SELECT i.base_qty, i.unit_cost
           FROM stock_receipt_items i
           JOIN stock_receipts r ON r.id = i.receipt_id
          WHERE r.tenant_id=$1 AND i.product_id=$2
          ORDER BY r.created_at ASC, i.id ASC`,
        [tenantId, p.id],
      );
      let stock = 0;
      let avg = 0;
      let sawCostedEntry = false;
      for (const rec of recs.rows) {
        const q = Number(rec.base_qty);
        const c = Number(rec.unit_cost) || 0;
        if (q <= 0) continue;
        if (c > 0) sawCostedEntry = true;
        const tot = stock + q;
        avg = tot > 1e-9 ? (stock * avg + q * c) / tot : c;
        stock = tot;
      }
      if (!sawCostedEntry) avg = Number(p.purchase_price) || 0;
      await client.query("UPDATE products SET avg_cost=$2 WHERE id=$1", [
        p.id,
        r2(avg),
      ]);
      products++;
    }

    // 3) Lignes de vente non figées : repli sur le catalogue.du produit.
    const items = await client.query<{ id: string; product_id: string }>(
      `SELECT si.id, si.product_id
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.tenant_id=$1 AND si.unit_cost IS NULL`,
      [tenantId],
    );
    let saleItems = 0;
    for (const it of items.rows) {
      const pr = await client.query<{ p: number }>(
        "SELECT purchase_price::float AS p FROM products WHERE id=$1",
        [it.product_id],
      );
      await client.query("UPDATE sale_items SET unit_cost=$2 WHERE id=$1", [
        it.id,
        r2(pr.rows[0]?.p ?? 0),
      ]);
      saleItems++;
    }

    return { products, batches, saleItems };
  });
}
