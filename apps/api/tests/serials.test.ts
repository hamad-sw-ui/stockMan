import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  SeedIds,
  seedTenant,
  TestContext,
} from "./helpers/app";

/**
 * E8 — Sérialisation (IMEI / n° de série) : enregistrement à la réception
 * (obligatoire pour produit sérialisé), vente à NUMÉRO précis avec gardes
 * (inconnu, déjà vendu, mauvais dépôt, nombre), lookup garantie/SAV,
 * annulation qui remet les numéros en stock, retour partiel refusé
 * (indivisibilité d'un numéro).
 */

let ctx: TestContext;
let ids: SeedIds;
let phoneId: string;
let saleId: string;
let saleItemId: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
  // Produit sérialisé (téléphonie)
  const prod = await ctx.agent
    .post("/api/products")
    .set(auth(ids.adminToken))
    .send({
      name: "Téléphone Alpha X",
      barcode: "3590000000017",
      purchasePrice: 50000,
      sellingPrice: 62000,
      unitId: ids.unitId,
      categoryId: ids.categoryId,
      requiresSerial: true,
    });
  if (prod.status !== 201)
    throw new Error("création produit sérialisé: " + JSON.stringify(prod.body));
  phoneId = prod.body.id;
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

const serialsInStock = async () => {
  const res = await ctx.agent
    .get(`/api/serials/product/${phoneId}`)
    .set(auth(ids.adminToken));
  return res.body.rows as Array<{ serial: string; status: string }>;
};
const lookup = async (serial: string) =>
  ctx.agent
    .get(`/api/serials/lookup?serial=${serial}`)
    .set(auth(ids.adminToken));

describe("Sérialisation IMEI (E8)", () => {
  it("réception d'un produit sérialisé SANS numéros : 400 SERIAL_COUNT_MISMATCH", async () => {
    const res = await ctx.agent
      .post("/api/stock/receipts")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [{ productId: phoneId, quantity: 2, unitCost: 50000 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SERIAL_COUNT_MISMATCH");
  });

  it("réception avec doublon dans la ligne : 400 SERIAL_DUP_IN_LINE", async () => {
    const res = await ctx.agent
      .post("/api/stock/receipts")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          {
            productId: phoneId,
            quantity: 2,
            unitCost: 50000,
            serials: ["IMEI-001", "IMEI-001"],
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SERIAL_DUP_IN_LINE");
  });

  it("réception valide : numéros EN STOCK ; doublon global refusé (409)", async () => {
    const res = await ctx.agent
      .post("/api/stock/receipts")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          {
            productId: phoneId,
            quantity: 3,
            unitCost: 50000,
            serials: ["IMEI-001", "IMEI-002", "IMEI-003"],
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await serialsInStock()).map((s) => s.serial).sort()).toEqual([
      "IMEI-001",
      "IMEI-002",
      "IMEI-003",
    ]);

    // Enregistrement manuel : nouveau numéro OK, numéro existant → 409
    const ok = await ctx.agent
      .post(`/api/serials/product/${phoneId}`)
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, serials: ["IMEI-004"] });
    expect(ok.status).toBe(201);
    expect(ok.body.registered).toBe(1);
    const dup = await ctx.agent
      .post(`/api/serials/product/${phoneId}`)
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, serials: ["IMEI-004", "IMEI-005"] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("SERIAL_DUPLICATE");
    expect(dup.body.error.details.serials).toEqual(["IMEI-004"]);
  });

  it("vente : gardes nombre/inconnu, puis vente à numéros exacts + lookup garantie", async () => {
    // Nombre attendu ≠ fournis
    const mismatch = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          { productId: phoneId, quantity: 2, serialNumbers: ["IMEI-001"] },
        ],
        paymentMethod: "CASH",
      });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe("SERIAL_COUNT_MISMATCH");

    // Numéro inconnu
    const unknown = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          { productId: phoneId, quantity: 1, serialNumbers: ["IMEI-999"] },
        ],
        paymentMethod: "CASH",
      });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("SERIAL_UNKNOWN");

    // Vente valide de 2 numéros
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          {
            productId: phoneId,
            quantity: 2,
            serialNumbers: ["IMEI-001", "IMEI-002"],
          },
        ],
        paymentMethod: "CASH",
      });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    saleId = sale.body.sale.id;
    const phoneLine = sale.body.sale.items.find(
      (i: { product_id: string }) => i.product_id === phoneId,
    );
    saleItemId = phoneLine.id;
    expect(sale.body.sale.total_amount).toBe(124000);

    // Lookup : vendus, avec vente + facture rattachées (E7)
    const lk = await lookup("IMEI-001");
    expect(lk.status).toBe(200);
    expect(lk.body.status).toBe("SOLD");
    expect(lk.body.productName).toBe("Téléphone Alpha X");
    expect(lk.body.sale.saleId).toBe(saleId);
    expect(lk.body.sale.invoice).toMatch(/^FAC-/);

    // Revente du même numéro : refusée (déjà vendu)
    const resold = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          { productId: phoneId, quantity: 1, serialNumbers: ["IMEI-001"] },
        ],
        paymentMethod: "CASH",
      });
    expect(resold.status).toBe(409);
    expect(resold.body.error.code).toBe("SERIAL_NOT_AVAILABLE");
  });

  it("mauvais dépôt : 409 SERIAL_WRONG_DEPOT", async () => {
    const b = await ctx.agent
      .post("/api/depots")
      .set(auth(ids.adminToken))
      .send({ name: "Dépôt Serial B" });
    const reg = await ctx.agent
      .post(`/api/serials/product/${phoneId}`)
      .set(auth(ids.adminToken))
      .send({ depotId: b.body.id, serials: ["IMEI-B01"] });
    expect(reg.status).toBe(201);
    const res = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          { productId: phoneId, quantity: 1, serialNumbers: ["IMEI-B01"] },
        ],
        paymentMethod: "CASH",
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SERIAL_WRONG_DEPOT");
  });

  it("retour partiel d'une ligne sérialisée : 400 SERIAL_PARTIAL_RETURN", async () => {
    const res = await ctx.agent
      .post(`/api/sales/${saleId}/returns`)
      .set(auth(ids.adminToken))
      .send({ items: [{ saleItemId, baseQty: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SERIAL_PARTIAL_RETURN");
  });

  it("annulation de la vente : les numéros repassent EN STOCK, stock physique restitué", async () => {
    const before = (await serialsInStock()).map((s) => s.serial);
    expect(before).not.toContain("IMEI-001");
    const v = await ctx.agent
      .post(`/api/sales/${saleId}/void`)
      .set(auth(ids.adminToken))
      .send({ reason: "Test annulation série" });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const after = (await serialsInStock()).map((s) => s.serial);
    expect(after).toContain("IMEI-001");
    expect(after).toContain("IMEI-002");
    // Stock physique : 3 − 2 vendus + 2 annulés = 3 (+ 1 enregistré manuellement)
    // (IMEI-004 est sur un dépôt B… non, enregistré sur depotId) → 4 attendus
    expect(after.length).toBe(5); // 4 sur dépôt principal + IMEI-B01 (dépôt B)
    const lk = await lookup("IMEI-001");
    expect(lk.body.status).toBe("IN_STOCK");
    expect(lk.body.sale).toBeNull();
  });
});
