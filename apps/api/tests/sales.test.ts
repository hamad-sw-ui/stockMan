import crypto from "crypto";
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

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
  await receiveStock(ctx, ids, 100); // 100 pièces sur le dépôt principal
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

describe("Ventes — intégrité, autorité serveur, offline (SEC-06/07, DAT-01/04)", () => {
  it("le total est calculé par le serveur, jamais par le client", async () => {
    const res = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 3 }],
        paymentMethod: "CASH",
        totalAmount: 1, // tentative de fraude : ignoré
      });
    expect(res.status).toBe(201);
    expect(res.body.sale.total_amount).toBe(1200); // 3 × 400 (prix catalogue)
    expect(res.body.sale.items[0].unit_price).toBe(400);
  });

  it("conversion d’unité : vendre 2 cartons déduit 24 pièces au prix ×12", async () => {
    const before = await ctx.agent
      .get(`/api/depots/${ids.depotId}/stock`)
      .set(auth(ids.adminToken));
    const qtyBefore = before.body.find(
      (p: { id: string }) => p.id === ids.productId,
    ).quantity;

    const res = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [
          { productId: ids.productId, unitId: ids.cartonId, quantity: 2 },
        ],
        paymentMethod: "MTN_MOMO",
        paymentReference: "MOMO-TEST-1",
      });
    expect(res.status).toBe(201);
    expect(res.body.sale.items[0].base_qty).toBe(24);
    expect(res.body.sale.items[0].unit_price).toBe(4800); // 400 × 12
    expect(res.body.sale.total_amount).toBe(9600);

    const after = await ctx.agent
      .get(`/api/depots/${ids.depotId}/stock`)
      .set(auth(ids.adminToken));
    const qtyAfter = after.body.find(
      (p: { id: string }) => p.id === ids.productId,
    ).quantity;
    expect(qtyBefore - qtyAfter).toBe(24);
    // mouvement SALE 24 tracé
    const moves = await ctx.agent
      .get(`/api/stock/movements?productId=${ids.productId}&type=SALE`)
      .set(auth(ids.adminToken));
    expect(moves.body.data[0].quantity).toBe(24);
    expect(moves.body.data[0].type).toBe("SALE");
  });

  it("idempotence offline : même clientSaleId = même vente, stock déduit une seule fois", async () => {
    const clientSaleId = crypto.randomUUID();
    const payload = {
      items: [{ productId: ids.productId, quantity: 5 }],
      paymentMethod: "ORANGE_MONEY",
      clientSaleId,
    };
    const before = await ctx.agent
      .get(`/api/depots/${ids.depotId}/stock`)
      .set(auth(ids.adminToken));
    const qtyBefore = before.body.find(
      (p: { id: string }) => p.id === ids.productId,
    ).quantity;

    const first = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send(payload);
    expect(first.status).toBe(201);
    const retry1 = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send(payload);
    const retry2 = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send(payload);
    expect(retry1.status).toBe(200);
    expect(retry1.body.deduplicated).toBe(true);
    expect(retry1.body.sale.id).toBe(first.body.sale.id);
    expect(retry2.body.sale.id).toBe(first.body.sale.id);

    const after = await ctx.agent
      .get(`/api/depots/${ids.depotId}/stock`)
      .set(auth(ids.adminToken));
    const qtyAfter = after.body.find(
      (p: { id: string }) => p.id === ids.productId,
    ).quantity;
    expect(qtyBefore - qtyAfter).toBe(5); // déduit UNE fois
  });

  it("stock insuffisant → 409 métier, aucune ligne partielle enregistrée", async () => {
    const before = await ctx.agent
      .get(`/api/depots/${ids.depotId}/stock`)
      .set(auth(ids.adminToken));
    const qtyBefore = before.body.find(
      (p: { id: string }) => p.id === ids.productId,
    ).quantity;

    const res = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 100000 }],
        paymentMethod: "CASH",
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STOCK_INSUFFICIENT");

    const after = await ctx.agent
      .get(`/api/depots/${ids.depotId}/stock`)
      .set(auth(ids.adminToken));
    expect(
      after.body.find((p: { id: string }) => p.id === ids.productId).quantity,
    ).toBe(qtyBefore);
  });

  it("vente avec variante : DAT-01 corrigé — décrémente le stock variante", async () => {
    const prod = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({
        name: "T-shirt Test",
        sellingPrice: 2500,
        purchasePrice: 1500,
        hasVariants: true,
        variants: [
          { name: "Rouge / M", sku: "TSH-RED-M" },
          { name: "Bleu / M", sku: "TSH-BLU-M" },
        ],
      });
    expect(prod.status).toBe(201);
    // Sélection déterministe : la liste des variantes est triée par nom côté API
    const variantId = (
      await ctx.agent
        .get(`/api/products/${prod.body.id}`)
        .set(auth(ids.adminToken))
    ).body.variants.find((v: { name: string }) => v.name === "Rouge / M").id;

    const rec = await ctx.agent
      .post("/api/stock/receipts")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [
          { productId: prod.body.id, variantId, quantity: 10, unitCost: 1500 },
        ],
      });
    expect(rec.status).toBe(201);

    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: prod.body.id, variantId, quantity: 2 }],
        paymentMethod: "CASH",
      });
    expect(sale.status).toBe(201);
    expect(sale.body.sale.items[0].variant_name).toBe("Rouge / M");

    const detail = await ctx.agent
      .get(`/api/products/${prod.body.id}`)
      .set(auth(ids.adminToken));
    const level = detail.body.levels.find(
      (l: { variant_id: string }) => l.variant_id === variantId,
    );
    expect(parseFloat(level.quantity)).toBe(8);
  });

  it("date future / trop ancienne rejetée (anti antidatation)", async () => {
    const future = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
        createdAt: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(future.status).toBe(400);
    expect(future.body.error.code).toBe("DATE_FUTURE");
    const old = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
        createdAt: new Date(Date.now() - 96 * 3600000).toISOString(),
      });
    expect(old.status).toBe(400);
    expect(old.body.error.code).toBe("SALE_TOO_OLD");
  });

  it("un VENDEUR ne peut pas vendre sur un autre dépôt que le sien", async () => {
    const depot2 = await ctx.agent
      .post("/api/depots")
      .set(auth(ids.adminToken))
      .send({ name: "Dépôt Secondaire" });
    const res = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        depotId: depot2.body.id,
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("DEPOT_FORBIDDEN");
  });

  it("annulation (avoir) par ADMIN restitue le stock ; un VENDEUR ne peut pas annuler", async () => {
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 4 }],
        paymentMethod: "CASH",
      });
    const id = sale.body.sale.id as string;

    const forbidden = await ctx.agent
      .post(`/api/sales/${id}/void`)
      .set(auth(ids.vendorToken))
      .send({});
    expect(forbidden.status).toBe(403);

    const before = await ctx.agent
      .get(`/api/depots/${ids.depotId}/stock`)
      .set(auth(ids.adminToken));
    const qtyBefore = before.body.find(
      (p: { id: string }) => p.id === ids.productId,
    ).quantity;

    const voidRes = await ctx.agent
      .post(`/api/sales/${id}/void`)
      .set(auth(ids.adminToken))
      .send({ reason: "Erreur de saisie" });
    expect(voidRes.status).toBe(200);

    const after = await ctx.agent
      .get(`/api/depots/${ids.depotId}/stock`)
      .set(auth(ids.adminToken));
    expect(
      after.body.find((p: { id: string }) => p.id === ids.productId).quantity,
    ).toBe(qtyBefore + 4);

    const again = await ctx.agent
      .post(`/api/sales/${id}/void`)
      .set(auth(ids.adminToken))
      .send({});
    expect(again.status).toBe(409);
  });

  it("retour partiel : borne par la quantité vendue, restocke et journalise", async () => {
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 6 }],
        paymentMethod: "CASH",
      });
    const lineId = sale.body.sale.items[0].id;

    const back = await ctx.agent
      .post(`/api/sales/${sale.body.sale.id}/returns`)
      .set(auth(ids.adminToken))
      .send({
        items: [{ saleItemId: lineId, baseQty: 2 }],
        reason: "Produit défectueux",
      });
    expect(back.status).toBe(201);
    expect(back.body.refundedTotal).toBe(800);

    const tooMuch = await ctx.agent
      .post(`/api/sales/${sale.body.sale.id}/returns`)
      .set(auth(ids.adminToken))
      .send({ items: [{ saleItemId: lineId, baseQty: 99 }] });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe("RETURN_EXCEEDS");

    const detail = await ctx.agent
      .get(`/api/sales/${sale.body.sale.id}`)
      .set(auth(ids.adminToken));
    expect(detail.body.returns).toHaveLength(1);
    expect(detail.body.returns[0].items[0].productName).toBe("Eau Test 1.5L");
  });

  it("liste : le VENDEUR ne voit que ses ventes ; le ticket est généré", async () => {
    // Une vente supplémentaire par l'ADMIN : l'admin voit tout, le vendeur seulement les siennes
    const adminSale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    expect(adminSale.status).toBe(201);
    const adminList = await ctx.agent
      .get("/api/sales")
      .set(auth(ids.adminToken));
    const vendorList = await ctx.agent
      .get("/api/sales")
      .set(auth(ids.vendorToken));
    expect(adminList.body.total).toBeGreaterThan(vendorList.body.total);
    expect(
      vendorList.body.data.every(
        (s: { vendor_name: string }) => s.vendor_name === "Vendeur Test",
      ),
    ).toBe(true);

    const receipt = await ctx.agent
      .get(`/api/sales/${vendorList.body.data[0].id}/receipt`)
      .set(auth(ids.vendorToken));
    expect(receipt.status).toBe(200);
    expect(receipt.body.text).toContain("SARL Test");
    expect(receipt.body.text).toContain("TOTAL");
  });
});
