import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  SeedIds,
  seedTenant,
  TestContext,
} from "./helpers/app";

/**
 * E1 — Coûts réels (docs/05_AUDIT_EXPERT_STOCK.md §B.1) :
 *  CUMP recalculé à chaque entrée, coût figé par ligne de vente, marges
 *  historiques stables, valorisation/COGS sur coûts réels, revalorisation
 *  idempotente de l'historique.
 */

let ctx: TestContext;
let ids: SeedIds;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

async function receive(
  productId: string,
  quantity: number,
  unitCost: number,
  extra: Record<string, unknown> = {},
) {
  const res = await ctx.agent
    .post("/api/stock/receipts")
    .set(auth(ids.adminToken))
    .send({
      depotId: ids.depotId,
      items: [{ productId, quantity, unitCost, unitId: ids.unitId, ...extra }],
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function makeProduct(name: string, purchasePrice: number) {
  const res = await ctx.agent
    .post("/api/products")
    .set(auth(ids.adminToken))
    .send({
      name,
      barcode: `62${Date.now()}${Math.floor(Math.random() * 1000)}`,
      purchasePrice,
      sellingPrice: purchasePrice * 2,
      unitId: ids.unitId,
      categoryId: ids.categoryId,
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function sell(productId: string, quantity: number) {
  const res = await ctx.agent
    .post("/api/sales")
    .set(auth(ids.vendorToken))
    .send({ items: [{ productId, quantity }], paymentMethod: "CASH" });
  expect(res.status).toBe(201);
  return res.body.sale;
}

const avgOf = async (productId: string) => {
  const r = await ctx.pool.query<{ avg_cost: number }>(
    "SELECT avg_cost::float FROM products WHERE id=$1",
    [productId],
  );
  return r.rows[0]!.avg_cost;
};

const levelOf = async (productId: string) => {
  const r = await ctx.pool.query<{ quantity: number }>(
    "SELECT quantity::float FROM stock_levels WHERE product_id=$1 AND depot_id=$2",
    [productId, ids.depotId],
  );
  return r.rows[0]?.quantity ?? 0;
};

describe("E1 · CUMP et coût figé par vente", () => {
  it("CUMP : recalcul pondéré à chaque réception", async () => {
    const p = await makeProduct("CUMP Produit 1", 100);
    await receive(p, 10, 100);
    expect(await avgOf(p)).toBe(100);
    await receive(p, 10, 200);
    // (10×100 + 10×200) / 20 = 150
    expect(await avgOf(p)).toBe(150);
    await receive(p, 20, 300);
    // (20×150 + 20×300) / 40 = 225
    expect(await avgOf(p)).toBe(225);
  });

  it("la ligne de vente fige le coût du jour (CUMP)", async () => {
    const p = await makeProduct("CUMP Produit 2", 100);
    await receive(p, 10, 100);
    await receive(p, 10, 200); // CUMP = 150
    const sale = await sell(p, 4);
    expect(Number(sale.items[0].unit_cost)).toBe(150);
    const moves = await ctx.agent
      .get(`/api/stock/movements?productId=${p}&type=SALE`)
      .set(auth(ids.adminToken));
    expect(Number(moves.body.data[0].unit_cost)).toBe(150);
  });

  it("CRITÈRE E1 : un nouveau prix d'achat ne change plus la marge historique", async () => {
    const p = await makeProduct("CUMP Produit 3", 100);
    await receive(p, 10, 100); // CUMP 100
    const sale1 = await sell(p, 5); // figé à 100
    expect(Number(sale1.items[0].unit_cost)).toBe(100);

    // Le coût évolue ensuite fortement (nouvelle réception chère)
    await receive(p, 10, 500); // CUMP : (5×100 + 10×500)/15 ≈ 366,67
    expect(await avgOf(p)).toBeCloseTo(366.67, 2);

    // La marge de la 1ʳᵉ vente reste figée : coût = 5 × 100 = 500
    const margin = await ctx.agent
      .get("/api/reports/margin")
      .set(auth(ids.adminToken));
    const row = margin.body.data.find(
      (r: { product_id: string }) => r.product_id === p,
    );
    expect(Number(row.cost)).toBe(500);
    expect(Number(row.revenue)).toBe(1000); // 5 × 200 (vente au double)
    expect(Number(row.margin)).toBe(500);
    // Et la ligne de vente elle-même n'a pas bougé
    const detail = await ctx.agent
      .get(`/api/sales/${sale1.id}`)
      .set(auth(ids.adminToken));
    expect(Number(detail.body.items[0].unit_cost)).toBe(100);
  });

  it("annulation de vente : réintégration au même coût, CUMP ré-pondéré", async () => {
    const p = await makeProduct("CUMP Produit 4", 100);
    await receive(p, 10, 100); // CUMP 100, stock 10
    const sale = await sell(p, 4); // vendu à 100, stock 6
    await receive(p, 10, 220); // CUMP = (6×100 + 10×220)/16 = 175
    expect(await avgOf(p)).toBe(175);

    await ctx.agent
      .post(`/api/sales/${sale.id}/void`)
      .set(auth(ids.adminToken))
      .send({ reason: "Erreur de saisie" });
    // Réintégration de 4 au coût figé 100 : (16×175 + 4×100)/20 = 160
    expect(await levelOf(p)).toBe(20);
    expect(await avgOf(p)).toBe(160);
  });

  it("retour partiel : réintégration au coût de la ligne d'origine", async () => {
    const p = await makeProduct("CUMP Produit 5", 100);
    await receive(p, 10, 100);
    const sale = await sell(p, 5); // coût figé 100, stock 5
    await receive(p, 15, 300); // CUMP = (5×100 + 15×300)/20 = 250
    expect(await avgOf(p)).toBe(250);

    const ret = await ctx.agent
      .post(`/api/sales/${sale.id}/returns`)
      .set(auth(ids.adminToken))
      .send({ items: [{ saleItemId: sale.items[0].id, baseQty: 5 }] });
    expect(ret.status).toBe(201);
    // Retour de 5 au coût 100 : (20×250 + 5×100)/25 = 220
    expect(await avgOf(p)).toBe(220);
    expect(await levelOf(p)).toBe(25);
    // La ligne de retour porte bien le coût d'origine
    const ri = await ctx.pool.query<{ unit_cost: number }>(
      "SELECT unit_cost::float FROM sale_return_items WHERE sale_item_id=$1",
      [sale.items[0].id],
    );
    expect(ri.rows[0]!.unit_cost).toBe(100);
  });

  it("mouvement d'ajustement valorisé au CUMP", async () => {
    const p = await makeProduct("CUMP Produit 6", 100);
    await receive(p, 10, 150);
    await ctx.agent.post("/api/stock/adjust").set(auth(ids.adminToken)).send({
      productId: p,
      depotId: ids.depotId,
      type: "DAMAGE",
      delta: -2,
      reason: "2 unités cassées en rayon",
    });
    const moves = await ctx.agent
      .get(`/api/stock/movements?productId=${p}&type=DAMAGE`)
      .set(auth(ids.adminToken));
    expect(Number(moves.body.data[0].unit_cost)).toBe(150);
  });
});

describe("E1 · Rapports : valorisation CUMP, marge figée, COGS", () => {
  it("valorisation du stock = quantité × CUMP (pas prix catalogue)", async () => {
    const p = await makeProduct("CUMP Produit 7", 100); // catalogue 100
    await receive(p, 10, 60);
    await receive(p, 10, 90); // CUMP 75, stock 20
    const res = await ctx.agent
      .get("/api/reports/stock-valuation")
      .set(auth(ids.adminToken));
    const row = res.body.data.find(
      (r: { product: string }) => r.product === "CUMP Produit 7",
    );
    expect(row.cump).toBe(75);
    expect(row.purchase_value).toBe(1500); // 20 × 75 — pas 20 × 100
  });

  it("COGS de la période : Σ(base_qty × coût figé)", async () => {
    const p = await makeProduct("CUMP Produit 8", 100);
    await receive(p, 20, 120);
    await sell(p, 5); // 5 × 120 = 600
    await sell(p, 5); // 5 × 120 = 600
    const expected = 1200;
    const res = await ctx.agent
      .get("/api/reports/cogs")
      .set(auth(ids.adminToken));
    expect(res.body.cogs).toBeGreaterThanOrEqual(expected);
    // Recalcul indépendant côté SQL
    const check = await ctx.pool.query<{ cogs: number }>(
      `SELECT COALESCE(SUM(si.base_qty * si.unit_cost),0)::float AS cogs
         FROM sale_items si JOIN sales s ON s.id=si.sale_id
        WHERE s.tenant_id=$1 AND s.status='COMPLETED' AND si.product_id=$2`,
      [ids.tenantId, p],
    );
    expect(check.rows[0]!.cogs).toBe(expected);
  });

  it("revalorisation : fige l'historique sans coût, idempotente et auditée", async () => {
    const p = await makeProduct("CUMP Produit 9", 100);
    await receive(p, 10, 100);
    const sale = await sell(p, 3);
    // Simulation d'une ligne héritée SANS coût (avant E1)
    await ctx.pool.query("UPDATE sale_items SET unit_cost=NULL WHERE id=$1", [
      sale.items[0].id,
    ]);
    await ctx.pool.query("UPDATE products SET avg_cost=0 WHERE id=$1", [p]);

    const first = await ctx.agent
      .post("/api/reports/costs-revalue")
      .set(auth(ids.adminToken));
    expect(first.status).toBe(200);
    expect(first.body.saleItems).toBeGreaterThanOrEqual(1);

    const after = await ctx.pool.query<{ unit_cost: number }>(
      "SELECT unit_cost::float FROM sale_items WHERE id=$1",
      [sale.items[0].id],
    );
    expect(after.rows[0]!.unit_cost).toBe(100); // figé rétroactivement
    expect(await avgOf(p)).toBe(100); // CUMP reconstruit par rejeu

    // Idempotence : rien de nouveau la 2ᵉ fois
    const second = await ctx.agent
      .post("/api/reports/costs-revalue")
      .set(auth(ids.adminToken));
    expect(second.body.saleItems).toBe(0);
    expect(await avgOf(p)).toBe(100);

    const audit = await ctx.pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND action='REVALUE'",
      [ids.tenantId],
    );
    expect(audit.rows[0]!.n).toBeGreaterThanOrEqual(1);
  });
});
