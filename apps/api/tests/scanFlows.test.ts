/** Phase C3 (docs/06) — flux physiques pilotés par le scan, bout en bout :
 *  réception via code de CONDITIONNEMENT (carton ×12 : quantité pré-remplie),
 *  scan de variante, alias fournisseur, produit sérialisé (IMEI), transfert
 *  inter-dépôts et comptage de campagne. Le ScanField web résout via
 *  /products/lookup puis soumet ces mêmes exigences : on les fige ici. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  receiveStock,
  seedTenant,
  type SeedIds,
  type TestContext,
} from "./helpers/app";

let ctx: TestContext;
let ids: SeedIds;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
});
afterAll(() => destroyTestContext(ctx));

const level = async (productId: string, depotId: string) => {
  const r = await ctx.pool.query(
    `SELECT COALESCE(SUM(quantity),0)::float AS q FROM stock_levels
      WHERE product_id=$1 AND depot_id=$2`,
    [productId, depotId],
  );
  return r.rows[0]!.q as number;
};

describe("C3 — flux physiques pilotés par le scan", () => {
  it("scan d'un conditionnement : alias carton ×12 → factor 12 → 2 cartons = 24 Pce", async () => {
    const units = (await ctx.agent.get("/api/units").set(auth(ids.adminToken)))
      .body as Array<{ id: string; symbol: string; base_value: number }>;
    const carton = units.find((u) => u.symbol === "Ctn")!;
    expect(carton.base_value).toBe(12);

    // Code du carton posé comme alias conditionné (poste fournisseur).
    const alias = await ctx.agent
      .post(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.adminToken))
      .send({ code: "CTN-EAU-12", unitId: ids.cartonId });
    expect(alias.status, JSON.stringify(alias.body)).toBe(201);

    const look = await ctx.agent
      .get("/api/products/lookup/CTN-EAU-12")
      .set(auth(ids.adminToken));
    expect(look.status).toBe(200);
    expect(look.body.matched).toBe("alias");
    expect(look.body.unitId).toBe(ids.cartonId);
    expect(look.body.unitFactor).toBe(12);

    // Le ScanField pré-remplit { unitId: carton, quantité } — l'API convertit.
    const rcv = await ctx.agent
      .post("/api/stock/receipts")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        reference: "SCAN-CTN",
        items: [
          {
            productId: ids.productId,
            quantity: 2,
            unitId: ids.cartonId,
            unitCost: 2400,
          },
        ],
      });
    expect(rcv.status, JSON.stringify(rcv.body)).toBe(201);
    expect(await level(ids.productId, ids.depotId)).toBe(24);
  });

  it("scan d'un code variante : matched=variant, réception ciblée sur la variante", async () => {
    const prod = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({
        name: "Huile Scan 1L",
        barcode: "5449000000996",
        purchasePrice: 900,
        sellingPrice: 1400,
        unitId: ids.unitId,
        categoryId: ids.categoryId,
        variants: [
          {
            name: "Format 5 L",
            barcode: "3068320115009",
            additionalPrice: 5000,
          },
        ],
      });
    expect(prod.status, JSON.stringify(prod.body)).toBe(201);
    const vRow = await ctx.pool.query(
      `SELECT id FROM product_variants WHERE product_id=$1`,
      [prod.body.id],
    );
    const variantId = vRow.rows[0]!.id as string;

    const look = await ctx.agent
      .get("/api/products/lookup/3068320115009")
      .set(auth(ids.adminToken));
    expect(look.body.matched).toBe("variant");
    expect(look.body.variantId).toBe(variantId);

    const rcv = await ctx.agent
      .post("/api/stock/receipts")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          { productId: prod.body.id, variantId, quantity: 3, unitCost: 900 },
        ],
      });
    expect(rcv.status, JSON.stringify(rcv.body)).toBe(201);
    const v = await ctx.pool.query(
      `SELECT COALESCE(SUM(quantity),0)::float AS q FROM stock_levels
        WHERE variant_id=$1`,
      [variantId],
    );
    expect(v.rows[0]!.q).toBe(3);
  });

  it("scan d'un alias fournisseur sans unité : matched=alias, facteur 1", async () => {
    const alias = await ctx.agent
      .post(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.adminToken))
      .send({ code: "FOURN-0001", source: "SUPPLIER" });
    expect(alias.status).toBe(201);
    const look = await ctx.agent
      .get("/api/products/lookup/FOURN-0001")
      .set(auth(ids.adminToken));
    expect(look.body.matched).toBe("alias");
    expect(look.body.unitId).toBeNull();
    expect(look.body.unitFactor).toBe(1);
  });

  it("code inconnu : 404 BARCODE_UNKNOWN (affiché « Code inconnu » côté ScanField)", async () => {
    const look = await ctx.agent
      .get("/api/products/lookup/NOPE-12345")
      .set(auth(ids.adminToken));
    expect(look.status).toBe(404);
    expect(look.body.error.code).toBe("BARCODE_UNKNOWN");
  });

  it("réception sérialisée pilotée scan : numéros EN STOCK ; mismatch refusé", async () => {
    const phone = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({
        name: "Téléphone Scan Y",
        barcode: "3590000000010",
        purchasePrice: 50000,
        sellingPrice: 62000,
        unitId: ids.unitId,
        requiresSerial: true,
      });
    expect(phone.status).toBe(201);
    const phoneId = phone.body.id as string;

    const bad = await ctx.agent
      .post("/api/stock/receipts")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          {
            productId: phoneId,
            quantity: 2,
            unitCost: 50000,
            serials: ["SCAN-IMEI-1"],
          },
        ],
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("SERIAL_COUNT_MISMATCH");

    const ok = await ctx.agent
      .post("/api/stock/receipts")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          {
            productId: phoneId,
            quantity: 2,
            unitCost: 50000,
            serials: ["SCAN-IMEI-1", "SCAN-IMEI-2"],
          },
        ],
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const rows = (
      await ctx.agent
        .get(`/api/serials/product/${phoneId}`)
        .set(auth(ids.adminToken))
    ).body.rows as Array<{ serial: string; status: string }>;
    expect(rows.map((r) => r.serial).sort()).toEqual([
      "SCAN-IMEI-1",
      "SCAN-IMEI-2",
    ]);
    expect(rows.every((r) => r.status === "IN_STOCK")).toBe(true);
  });

  it("transfert inter-dépôts après scan : expédition 5, réception complète, dépôt cible crédité", async () => {
    await receiveStock(ctx, ids, 5);
    const depotB = (
      await ctx.agent
        .post("/api/depots")
        .set(auth(ids.adminToken))
        .send({ name: "Dépôt Scan B" })
    ).body.id as string;

    // Le scan côté DépôtsPage résout le produit puis poste ce transfert :
    const tr = await ctx.agent
      .post("/api/stock/transfers")
      .set(auth(ids.adminToken))
      .send({
        fromDepotId: ids.depotId,
        toDepotId: depotB,
        items: [{ productId: ids.productId, quantity: 5 }],
      });
    expect(tr.status, JSON.stringify(tr.body)).toBe(201);
    const transferId = tr.body.transferId as string;
    const item = await ctx.pool.query(
      `SELECT id FROM stock_transfer_items WHERE transfer_id=$1`,
      [transferId],
    );
    const rcv = await ctx.agent
      .post(`/api/stock/transfers/${transferId}/receive`)
      .set(auth(ids.adminToken))
      .send({
        items: [{ transferItemId: item.rows[0]!.id, receivedQty: 5 }],
      });
    expect(rcv.status, JSON.stringify(rcv.body)).toBe(200);
    expect(await level(ids.productId, depotB)).toBe(5);
    expect(await level(ids.productId, ids.depotId)).toBe(24); // 29 − 5
  });

  it("campagne d'inventaire : comptage saisi par produit scanné", async () => {
    const camp = await ctx.agent
      .post("/api/inventory-campaigns")
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId });
    expect(camp.status).toBe(201);
    const id = camp.body.id as string;
    const start = await ctx.agent
      .post(`/api/inventory-campaigns/${id}/start`)
      .set(auth(ids.adminToken))
      .send({});
    expect(start.status).toBe(200);

    // Résolution équivalente à ce que fait le ScanField de la page :
    const look = await ctx.agent
      .get("/api/products/lookup/6100000000018")
      .set(auth(ids.adminToken));
    expect(look.body.productId).toBe(ids.productId);

    const counted = await ctx.agent
      .put(`/api/inventory-campaigns/${id}/counts`)
      .set(auth(ids.adminToken))
      .send({ lines: [{ productId: look.body.productId, countedQty: 24 }] });
    expect(counted.status, JSON.stringify(counted.body)).toBe(200);

    const detail = (
      await ctx.agent
        .get(`/api/inventory-campaigns/${id}`)
        .set(auth(ids.adminToken))
    ).body;
    const line = detail.items.find(
      (i: { product_id: string }) => i.product_id === ids.productId,
    );
    expect(line.counted_qty).toBe(24);
  });
});
