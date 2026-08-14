import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  SeedIds,
  seedTenant,
  TestContext,
  receiveStock,
} from "./helpers/app";

/**
 * E8 — Pilotage stock : import CSV du stock initial (réception groupée
 * atomique, erreurs par ligne), stock RÉSERVÉ non vendable (garde caisse),
 * paramètres par dépôt (seuil effectif + rayonnage) reflétés dans les
 * rapports, KPI stock (ABC, rotation, couverture, dormant) + export CSV.
 */

let ctx: TestContext;
let ids: SeedIds;
let batchProductId: string;
let serialProductId: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
  // Produit à lots (garde BATCH_REQUIRED à l'import)
  const bp = await ctx.agent
    .post("/api/products")
    .set(auth(ids.adminToken))
    .send({
      name: "Lait UHT 1L",
      barcode: "6210000000014",
      purchasePrice: 500,
      sellingPrice: 700,
      unitId: ids.unitId,
      categoryId: ids.categoryId,
      trackBatch: true,
    });
  batchProductId = bp.body.id;
  // Produit sérialisé (refusé à l'import CSV)
  const sp = await ctx.agent
    .post("/api/products")
    .set(auth(ids.adminToken))
    .send({
      name: "Smartphone Beta",
      barcode: "3590010000017",
      purchasePrice: 80000,
      sellingPrice: 99000,
      unitId: ids.unitId,
      categoryId: ids.categoryId,
      requiresSerial: true,
    });
  serialProductId = sp.body.id;
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

async function qtyOf(productId: string, depotId: string) {
  const stock = await ctx.agent
    .get(`/api/depots/${depotId}/stock`)
    .set(auth(ids.adminToken));
  const row = stock.body.find((p: { id: string }) => p.id === productId);
  return row ? row.quantity : 0;
}

describe("Import CSV du stock initial (E8)", () => {
  it("réception groupée atomique + erreurs par ligne (inconnu, lot manquant, sérialisé, quantité illisible)", async () => {
    const csv = [
      "Produit;Quantité;Coût;Lot;Expiration",
      "6100000000018;40;190;;", // produit seed (par code-barres)
      "Produit Inconnu;5;100;;",
      "Lait UHT 1L;12;480;;", // lot obligatoire manquant
      "Smartphone Beta;2;75000;;", // sérialisé : refusé
      "Eau Test 1.5L;abc;150;;", // quantité illisible
      "Lait UHT 1L;12;480;LOT-A;2027-01-31",
    ].join("\n");
    const res = await ctx.agent
      .post("/api/stock/import")
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, csv, reference: "INV-OUVERTURE" });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);
    expect(res.body.receiptId).toBeTruthy();
    expect(res.body.errors).toHaveLength(4);
    const msg = res.body.errors
      .map((e: { message: string }) => e.message)
      .join(" | ");
    expect(msg).toContain("Produit inconnu");
    expect(msg).toContain("Lot");
    expect(msg).toContain("sérialisé");
    expect(msg).toContain("Quantité illisible");

    // Quantités réellement entrées : 40 (seed) + 12 (lait, lot créé)
    expect(await qtyOf(ids.productId, ids.depotId)).toBe(40);
    expect(await qtyOf(batchProductId, ids.depotId)).toBe(12);
    expect(await qtyOf(serialProductId, ids.depotId)).toBe(0);

    // Le lot de l'import existe (traçabilité)
    const batch = await ctx.pool.query(
      "SELECT quantity::float AS q FROM stock_batches WHERE batch_number='LOT-A'",
    );
    expect(parseFloat(batch.rows[0]!.q)).toBe(12);
  });

  it("fichier vide / en-tête mauvais : 400 CSV_EMPTY / CSV_HEADER", async () => {
    const empty = await ctx.agent
      .post("/api/stock/import")
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, csv: "Produit;Quantité\n" });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("CSV_EMPTY");
    const bad = await ctx.agent
      .post("/api/stock/import")
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, csv: "A;B\nx;y" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("CSV_HEADER");
  });

  it("toutes lignes invalides : 200 sans réception, imported = 0", async () => {
    const res = await ctx.agent
      .post("/api/stock/import")
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, csv: "Produit;Quantité\nFantôme;3;100" });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.receiptId).toBeNull();
  });
});

describe("Stock réservé (E8)", () => {
  it("réserve → disponible réduit à la caisse ; libération → revendable", async () => {
    // Stock seed actuel : 40 (import). Réserver 35 → 5 vendables.
    const reserve = await ctx.agent
      .post("/api/stock/reserve")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        productId: ids.productId,
        quantity: 35,
        reason: "Commande client confirmée",
      });
    expect(reserve.status).toBe(201);
    expect(reserve.body.reserved).toBe(35);
    expect(reserve.body.available).toBe(5);

    // Vente de 10 > 5 disponibles : le stock global (40) suffit, la réserve bloque
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [{ productId: ids.productId, quantity: 10 }],
        paymentMethod: "CASH",
      });
    expect(sale.status).toBe(409);
    expect(sale.body.error.code).toBe("STOCK_RESERVED");

    // Vente de 5 : passe
    const ok = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [{ productId: ids.productId, quantity: 5 }],
        paymentMethod: "CASH",
      });
    expect(ok.status).toBe(201);

    // Sur-réservation refusée (35 réservés, 35 en stock : dépasse toujours)
    const over = await ctx.agent
      .post("/api/stock/reserve")
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, productId: ids.productId, quantity: 50 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("STOCK_RESERVE_EXCEEDS");

    // Sur-libération refusée
    const relOver = await ctx.agent
      .post("/api/stock/release")
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, productId: ids.productId, quantity: 40 });
    expect(relOver.status).toBe(409);
    expect(relOver.body.error.code).toBe("RELEASE_EXCEEDS");

    // Libération partielle : 10 remis en vente
    const rel = await ctx.agent
      .post("/api/stock/release")
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, productId: ids.productId, quantity: 10 });
    expect(rel.status).toBe(200);
    expect(rel.body.reserved).toBe(25);
    expect(rel.body.available).toBe(10);
  });
});

describe("Paramètres par dépôt + seuil effectif dans les rapports (E8)", () => {
  it("PUT depot-settings : seuil par dépôt + rayonnage, reflétés dans la vue stock du dépôt", async () => {
    const put = await ctx.agent
      .put(`/api/products/${ids.productId}/depot-settings`)
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        minStockLevel: 20,
        binLocation: "A-01-03",
      });
    expect(put.status).toBe(200);
    expect(put.body.min_stock_level).toBe(20);
    expect(put.body.bin_location).toBe("A-01-03");

    const list = await ctx.agent
      .get(`/api/products/${ids.productId}/depot-settings`)
      .set(auth(ids.adminToken));
    expect(list.status).toBe(200);
    const row = list.body.find(
      (r: { depot_id: string }) => r.depot_id === ids.depotId,
    );
    expect(row.min_stock_level).toBe(20);

    // Vue stock du dépôt : seuil effectif (20 ≠ catalogue 5) + rayonnage
    const stock = await ctx.agent
      .get(`/api/depots/${ids.depotId}/stock`)
      .set(auth(ids.adminToken));
    const prod = stock.body.find((p: { id: string }) => p.id === ids.productId);
    expect(prod.min_stock_level).toBe(20);
    expect(prod.bin_location).toBe("A-01-03");
    expect(prod.reserved_qty).toBe(25);

    // Rapport prédictif cadré dépôt : 35 en stock < seuil 20 ? Non → absent ;
    // avec seuil 100 : présent.
    const low = await ctx.agent
      .get(`/api/reports/predictive?depotId=${ids.depotId}`)
      .set(auth(ids.adminToken));
    expect(
      low.body.some(
        (p: { product_id: string }) => p.product_id === ids.productId,
      ),
    ).toBe(false);
    await ctx.agent
      .put(`/api/products/${ids.productId}/depot-settings`)
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, minStockLevel: 100 });
    const high = await ctx.agent
      .get(`/api/reports/predictive?depotId=${ids.depotId}`)
      .set(auth(ids.adminToken));
    const hit = high.body.find(
      (p: { product_id: string }) => p.product_id === ids.productId,
    );
    expect(hit).toBeTruthy();
    expect(hit.min_stock_level).toBe(100);
  });
});

describe("KPI stock : ABC, rotation, couverture, dormant (E8)", () => {
  it("classe ABC sur 90 j, couverture 999 sans vente, dormant valorisé", async () => {
    const res = await ctx.agent
      .get("/api/reports/stock-kpis?depotId=" + ids.depotId)
      .set(auth(ids.adminToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const eau = res.body.data.find(
      (r: { product_id: string }) => r.product_id === ids.productId,
    );
    expect(eau).toBeTruthy();
    expect(eau.abc_class).toBe("A"); // seul produit vendu
    expect(eau.qty_sold_90d).toBe(5);
    expect(eau.current_stock).toBe(35);
    expect(eau.reserved).toBe(25);
    expect(eau.stock_value).toBeCloseTo(35 * eau.avg_cost, 2);
    expect(eau.coverage_days).toBeGreaterThan(0);
    expect(eau.turnover_90d).toBeCloseTo(5 / 35, 2);
    expect(eau.dormant).toBe(false);

    const lait = res.body.data.find(
      (r: { product_id: string }) => r.product_id === batchProductId,
    );
    expect(lait.abc_class).toBe("C"); // jamais vendu → pas de ligne ventes → C
    expect(lait.coverage_days).toBe(999);
    expect(lait.dormant).toBe(true); // jamais vendu + stock > 0

    expect(res.body.totals.dormant_count).toBeGreaterThanOrEqual(1);
    expect(res.body.totals.references).toBe(2); // smartphone : stock 0 → filtré

    // Export CSV
    const csv = await ctx.agent
      .get("/api/reports/stock-kpis?format=csv")
      .set(auth(ids.adminToken));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("Eau Test 1.5L");
    expect(csv.text).toContain("ABC");
  });
});
