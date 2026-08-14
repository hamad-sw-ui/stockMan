import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  SeedIds,
  seedTenant,
  TestContext,
  receiveStock,
} from "./helpers/app";

let ctx: TestContext;
let ids: SeedIds;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
  await receiveStock(ctx, ids, 100); // 100 pièces à 200 FCFA

  const v = auth(ids.vendorToken);
  // CA de référence : 3 Pce CASH (1 200) + 2 Cartons MOMO (9 600)
  await ctx.agent
    .post("/api/sales")
    .set(v)
    .send({
      items: [{ productId: ids.productId, quantity: 3 }],
      paymentMethod: "CASH",
    });
  await ctx.agent
    .post("/api/sales")
    .set(v)
    .send({
      items: [{ productId: ids.productId, unitId: ids.cartonId, quantity: 2 }],
      paymentMethod: "MTN_MOMO",
      paymentReference: "MOMO-RPT-1",
    });
  // Une vente annulée (exclue du CA, comptée dans les avoirs)
  const test = await ctx.agent
    .post("/api/sales")
    .set(v)
    .send({
      items: [{ productId: ids.productId, quantity: 1 }],
      paymentMethod: "CASH",
    });
  await ctx.agent
    .post(`/api/sales/${test.body.sale.id}/void`)
    .set(auth(ids.adminToken))
    .send({ reason: "Test" });
  // Un lot périssable à J+5 (stock total 83)
  await receiveStock(ctx, ids, 10, {
    batchNumber: "EXP-5",
    expiryDate: inDays(5),
  });
  // Le seuil d'alerte passe à 200 pour les vues prédictives
  await ctx.agent
    .patch(`/api/products/${ids.productId}`)
    .set(auth(ids.adminToken))
    .send({ minStockLevel: 200 });
}, 90_000);
afterAll(async () => {
  await destroyTestContext(ctx);
});

describe("Rapports décisionnels — exactitude des chiffres (BCK-02, DAT-08)", () => {
  it("tableau de bord : CA, série complétée sans trou, top produits, mix paiement", async () => {
    const res = await ctx.agent
      .get("/api/reports/dashboard")
      .set(auth(ids.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.range.timezone).toBe("Africa/Douala");

    const s = res.body.summary;
    expect(s.revenue).toBe(10800);
    expect(s.sales_count).toBe(2);
    expect(s.voided_count).toBe(1);
    expect(s.avg_basket).toBe(5400);
    expect(s.today_revenue).toBe(10800);

    expect(res.body.series).toHaveLength(7); // défaut : 7 derniers jours
    const today = new Date().toISOString().slice(0, 10);
    const dayRow =
      res.body.series.find((d: { date: string }) => d.date === today) ??
      res.body.series[res.body.series.length - 1];
    expect(dayRow.amount).toBe(10800);
    expect(dayRow.count).toBe(2);

    expect(res.body.topProducts[0].name).toBe("Eau Test 1.5L");
    expect(res.body.topProducts[0].qty).toBe(27);
    expect(res.body.topProducts[0].revenue).toBe(10800);

    const momo = res.body.paymentMix.find(
      (m: { payment_method: string }) => m.payment_method === "MTN_MOMO",
    );
    expect(momo.amount).toBe(9600);
    const cash = res.body.paymentMix.find(
      (m: { payment_method: string }) => m.payment_method === "CASH",
    );
    expect(cash.amount).toBe(1200); // la vente annulée est exclue

    expect(res.body.lowStockCount).toBe(1); // seuil remonté à 200
  });

  it("rapport des ventes par jour/dépôt/vendeur + export CSV", async () => {
    const res = await ctx.agent
      .get("/api/reports/sales")
      .set(auth(ids.adminToken));
    expect(res.status).toBe(200);
    const total = res.body.data.reduce(
      (acc: number, r: { revenue: number }) => acc + Number(r.revenue),
      0,
    );
    expect(total).toBe(10800);
    expect(res.body.data[0].vendor).toBe("Vendeur Test");
    expect(res.body.data[0].depot).toBe("Dépôt Principal");

    const csv = await ctx.agent
      .get("/api/reports/sales?format=csv")
      .set(auth(ids.adminToken));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain('"Date";"Dépôt";"Vendeur"');
    expect(csv.text).toContain("10800");
  });

  it("marges : coût et taux calculés côté serveur", async () => {
    const res = await ctx.agent
      .get("/api/reports/margin")
      .set(auth(ids.adminToken));
    expect(res.status).toBe(200);
    const row = res.body.data.find(
      (r: { name: string }) => r.name === "Eau Test 1.5L",
    );
    expect(Number(row.qty_sold)).toBe(27);
    expect(Number(row.revenue)).toBe(10800);
    expect(Number(row.cost)).toBe(5400);
    expect(Number(row.margin)).toBe(5400);
    expect(Number(row.margin_pct)).toBe(50);
    expect(res.body.totals.margin).toBe(5400);
  });

  it("valorisation du stock : quantités et valeurs exactes", async () => {
    const res = await ctx.agent
      .get("/api/reports/stock-valuation")
      .set(auth(ids.adminToken));
    expect(res.status).toBe(200);
    const row = res.body.data.find(
      (r: { product: string }) => r.product === "Eau Test 1.5L",
    );
    expect(Number(row.quantity)).toBe(83);
    expect(Number(row.purchase_value)).toBe(16600); // 83 × 200
    expect(Number(row.sale_value)).toBe(33200); // 83 × 400
    expect(res.body.totals.purchase).toBe(16600);
  });

  it("péremptions : le lot à J+5 apparaît avec son compte à rebours", async () => {
    const res = await ctx.agent
      .get("/api/reports/expiry?days=30")
      .set(auth(ids.adminToken));
    expect(res.status).toBe(200);
    const row = res.body.find(
      (r: { batch_number: string }) => r.batch_number === "EXP-5",
    );
    expect(row).toBeTruthy();
    expect(Number(row.quantity)).toBe(10);
    expect(row.days_left).toBeGreaterThanOrEqual(4);
    expect(row.days_left).toBeLessThanOrEqual(5);
  });

  it("prédictif : vitesse de vente et horizon de rupture calculés", async () => {
    const res = await ctx.agent
      .get("/api/reports/predictive")
      .set(auth(ids.adminToken));
    expect(res.status).toBe(200);
    const row = res.body.find(
      (r: { name: string }) => r.name === "Eau Test 1.5L",
    );
    expect(row).toBeTruthy();
    expect(Number(row.current_stock)).toBe(83);
    expect(Number(row.avg_daily_sales)).toBeCloseTo(0.9, 2); // 27 / 30 j
    expect(Number(row.days_until_stockout)).toBe(92); // 83 / 0.9 ≈ 92,2
  });

  it("Z de caisse : clôture du jour avec avoirs", async () => {
    const res = await ctx.agent
      .get("/api/reports/z-report")
      .set(auth(ids.adminToken));
    expect(res.status).toBe(200);
    const depot = res.body.totals.find(
      (t: { depot: string }) => t.depot === "Dépôt Principal",
    );
    expect(Number(depot.sales_count)).toBe(2);
    expect(Number(depot.revenue)).toBe(10800);
    expect(res.body.byPayment).toHaveLength(2);
    expect(res.body.byVendor[0].vendor).toBe("Vendeur Test");
    expect(Number(res.body.byVendor[0].amount)).toBe(10800);
    expect(Number(res.body.voids.voided)).toBe(1);
    expect(Number(res.body.voids.amount)).toBe(400);

    // Le VENDEUR obtient le Z de SON dépôt
    const vendorZ = await ctx.agent
      .get("/api/reports/z-report")
      .set(auth(ids.vendorToken));
    expect(vendorZ.status).toBe(200);
    expect(Number(vendorZ.body.totals[0].revenue)).toBe(10800);
  });

  it("stats plateforme (Super Admin)", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const saTenant = await ctx.pool.query(
      "INSERT INTO tenants (name) VALUES ('Éditeur SA') RETURNING id",
    );
    await ctx.pool.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES ($1,'SA','sa-rpt@test.cm',$2,'SUPER_ADMIN')`,
      [saTenant.rows[0].id, bcrypt.hashSync("Sa123456!", 10)],
    );
    const saLogin = await ctx.agent
      .post("/api/auth/login")
      .send({ email: "sa-rpt@test.cm", password: "Sa123456!" });
    const denied = await ctx.agent
      .get("/api/reports/superadmin/stats")
      .set(auth(ids.adminToken));
    expect(denied.status).toBe(403);

    const res = await ctx.agent
      .get("/api/reports/superadmin/stats")
      .set(auth(saLogin.body.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.tenants.total).toBeGreaterThanOrEqual(2);
    expect(res.body.revenue.all_time).toBeGreaterThanOrEqual(10800);
    expect(res.body.mrr).toBe(0); // tous les tenants sont en TRIAL
    expect(Array.isArray(res.body.trialsEndingSoon)).toBe(true);
  });
});

describe("Caisse (POS) — bootstrap hors-ligne, scan, stock vendeur", () => {
  it("bootstrap : catalogue compact + niveaux du dépôt + favoris", async () => {
    const res = await ctx.agent
      .get("/api/pos/bootstrap")
      .set(auth(ids.vendorToken));
    expect(res.status).toBe(200);
    expect(res.body.depotId).toBe(ids.depotId);
    expect(res.body.serverTime).toBeTruthy();

    const product = res.body.products.find(
      (p: { name: string }) => p.name === "Eau Test 1.5L",
    );
    expect(product).toBeTruthy();
    expect(Number(product.selling_price)).toBe(400);
    expect(Array.isArray(product.variants)).toBe(true);

    const level = res.body.levels.find(
      (l: { product_id: string }) => l.product_id === ids.productId,
    );
    expect(Number(level.quantity)).toBe(83);

    expect(res.body.units.length).toBeGreaterThanOrEqual(2);
    expect(
      res.body.categories.some((c: { name: string }) => c.name === "Boissons"),
    ).toBe(true);
    expect(res.body.favorites).toContain(ids.productId); // 27 vendus sur 30 j
  });

  it("scan code-barres : produit trouvé, variante trouvée, inconnu 404", async () => {
    const prod = await ctx.agent
      .get("/api/products/barcode/6100000000018")
      .set(auth(ids.vendorToken));
    expect(prod.status).toBe(200);
    expect(prod.body.matched).toBe("product");
    expect(prod.body.name).toBe("Eau Test 1.5L");

    const variantProduct = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({
        name: "Parfum Test",
        sellingPrice: 5000,
        hasVariants: true,
        variants: [{ name: "50 ml", barcode: "6001234500018" }],
      });
    expect(variantProduct.status).toBe(201);
    const variant = await ctx.agent
      .get("/api/products/barcode/6001234500018")
      .set(auth(ids.vendorToken));
    expect(variant.status).toBe(200);
    expect(variant.body.matched).toBe("variant");
    expect(variant.body.variant_name).toBe("50 ml");

    const unknown = await ctx.agent
      .get("/api/products/barcode/0000000000000")
      .set(auth(ids.vendorToken));
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("BARCODE_UNKNOWN");

    // Le produit à variantes est visible dans le bootstrap avec ses variantes
    const boot = await ctx.agent
      .get("/api/pos/bootstrap")
      .set(auth(ids.vendorToken));
    const p = boot.body.products.find(
      (x: { name: string }) => x.name === "Parfum Test",
    );
    expect(p.variants).toHaveLength(1);
    expect(p.variants[0].barcode).toBe("6001234500018");
  });

  it("stock du dépôt : recherche en ligne simple pour le vendeur", async () => {
    const res = await ctx.agent
      .get(`/api/depots/${ids.depotId}/stock?search=Eau`)
      .set(auth(ids.vendorToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Eau Test 1.5L");
    expect(Number(res.body[0].quantity)).toBe(83);
    expect(res.body[0].unit_symbol).toBe("Pce");
  });
});
