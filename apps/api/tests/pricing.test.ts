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
 * E8 — Politique de prix : grille gros/détail par canal client, promotions
 * datées (produit prioritaire sur globale, fenêtre respectée, figée sur la
 * ligne), plafond de remise manuelle par utilisateur (défaut 10 % vendeur),
 * historique horodaté des changements de prix au PATCH produit.
 */

let ctx: TestContext;
let ids: SeedIds;
let wholesaleClientId: string;
let detailClientId: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const now = () => new Date();
const iso = (d: Date) => d.toISOString();

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
  await receiveStock(ctx, ids, 500);
  // Grille de gros sur le produit seed : 350 F dès 10 pièces
  const patch = await ctx.agent
    .patch(`/api/products/${ids.productId}`)
    .set(auth(ids.adminToken))
    .send({ wholesalePrice: 350, wholesaleMinQty: 10 });
  expect(patch.status).toBe(200);

  const wc = await ctx.agent
    .post("/api/customers")
    .set(auth(ids.adminToken))
    .send({ name: "Client Gros", priceChannel: "WHOLESALE" });
  wholesaleClientId = wc.body.id;
  const dc = await ctx.agent
    .post("/api/customers")
    .set(auth(ids.adminToken))
    .send({ name: "Client Détail" });
  detailClientId = dc.body.id;
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

async function sellOnce(opts: {
  customerId?: string;
  qty?: number;
  discountPct?: number;
  token?: string;
}) {
  const res = await ctx.agent
    .post("/api/sales")
    .set(auth(opts.token ?? ids.adminToken))
    .send({
      depotId: ids.depotId,
      customerId: opts.customerId,
      items: [
        {
          productId: ids.productId,
          quantity: opts.qty ?? 1,
          discountPct: opts.discountPct ?? 0,
        },
      ],
      paymentMethod: "CASH",
    });
  return res;
}

describe("Grille gros / détail (E8)", () => {
  it("client canal GROS : prix de gros appliqué au-dessus du seuil, détail sinon", async () => {
    const gros = await sellOnce({ customerId: wholesaleClientId, qty: 12 });
    expect(gros.status, JSON.stringify(gros.body)).toBe(201);
    expect(gros.body.sale.items[0].unit_price).toBe(350);
    expect(gros.body.sale.total_amount).toBe(4200);

    // Sous le seuil (10) : prix de détail (400)
    const sousSeuil = await sellOnce({ customerId: wholesaleClientId, qty: 5 });
    expect(sousSeuil.status).toBe(201);
    expect(sousSeuil.body.sale.items[0].unit_price).toBe(400);
  });

  it("client canal DÉTAIL (ou vente anonyme) : prix catalogue même en gros volume", async () => {
    const detail = await sellOnce({ customerId: detailClientId, qty: 20 });
    expect(detail.status).toBe(201);
    expect(detail.body.sale.items[0].unit_price).toBe(400);
  });
});

describe("Promotions datées (E8)", () => {
  let promoProductId: string;
  it("CRUD + fenêtre invalide rejetée (400 PROMO_WINDOW_INVALID)", async () => {
    const bad = await ctx.agent
      .post("/api/pricing/promotions")
      .set(auth(ids.adminToken))
      .send({
        name: "Promo cassée",
        discountPct: 10,
        startsAt: iso(now()),
        endsAt: iso(new Date(Date.now() - 3600_000)),
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("PROMO_WINDOW_INVALID");

    const ok = await ctx.agent
      .post("/api/pricing/promotions")
      .set(auth(ids.adminToken))
      .send({
        name: "Promo produit -10%",
        productId: ids.productId,
        discountPct: 10,
        startsAt: iso(new Date(Date.now() - 3600_000)),
        endsAt: iso(new Date(Date.now() + 3600_000)),
      });
    expect(ok.status).toBe(201);
    promoProductId = ok.body.id;

    const list = await ctx.agent
      .get("/api/pricing/promotions?active=true")
      .set(auth(ids.adminToken));
    expect(list.status).toBe(200);
    expect(
      list.body.data.some((p: { id: string }) => p.id === promoProductId),
    ).toBe(true);
  });

  it("promo produit prioritaire sur la promo globale, remise figée sur la ligne", async () => {
    const global = await ctx.agent
      .post("/api/pricing/promotions")
      .set(auth(ids.adminToken))
      .send({
        name: "Promo globale -5%",
        discountPct: 5,
        startsAt: iso(new Date(Date.now() - 3600_000)),
        endsAt: iso(new Date(Date.now() + 3600_000)),
      });
    expect(global.status).toBe(201);

    // Client détail : 400 − 10 % (produit) = 360 — la globale (5 %) ne gagne pas
    const sale = await sellOnce({ customerId: detailClientId, qty: 2 });
    expect(sale.status).toBe(201);
    expect(sale.body.sale.items[0].unit_price).toBe(360);
    expect(sale.body.sale.items[0].promo_pct).toBe(10);

    // Client gros SANS promo produit : grille (350) − 5 % globale = 332.5
    const del = await ctx.agent
      .delete(`/api/pricing/promotions/${promoProductId}`)
      .set(auth(ids.adminToken));
    expect(del.status).toBe(200);
    const gros = await sellOnce({ customerId: wholesaleClientId, qty: 12 });
    expect(gros.status).toBe(201);
    expect(gros.body.sale.items[0].unit_price).toBe(332.5);
    expect(gros.body.sale.items[0].promo_pct).toBe(5);

    // Promo inactive : ignorée
    const off = await ctx.agent
      .patch(`/api/pricing/promotions/${global.body.id}`)
      .set(auth(ids.adminToken))
      .send({ isActive: false });
    expect(off.status).toBe(200);
    const sansPromo = await sellOnce({
      customerId: wholesaleClientId,
      qty: 12,
    });
    expect(sansPromo.body.sale.items[0].unit_price).toBe(350);
    expect(sansPromo.body.sale.items[0].promo_pct ?? 0).toBe(0);
  });

  it("promo hors fenêtre (future) : ignorée", async () => {
    await ctx.agent
      .post("/api/pricing/promotions")
      .set(auth(ids.adminToken))
      .send({
        name: "Promo future -50%",
        productId: ids.productId,
        discountPct: 50,
        startsAt: iso(new Date(Date.now() + 86_400_000)),
        endsAt: iso(new Date(Date.now() + 2 * 86_400_000)),
      });
    const sale = await sellOnce({ customerId: detailClientId, qty: 1 });
    expect(sale.body.sale.items[0].unit_price).toBe(400);
  });
});

describe("Plafond de remise manuelle (E8)", () => {
  it("vendeur : défaut 10 % — 15 % refusé (403), 10 % accepté", async () => {
    const refuse = await sellOnce({
      discountPct: 15,
      token: ids.vendorToken,
    });
    expect(refuse.status).toBe(403);
    expect(refuse.body.error.code).toBe("DISCOUNT_LIMIT_EXCEEDED");

    const ok = await sellOnce({ discountPct: 10, token: ids.vendorToken });
    expect(ok.status).toBe(201);
    expect(ok.body.sale.items[0].unit_price).toBe(360);
  });

  it("gérant : 50 % accepté (défaut 100 %)", async () => {
    const ok = await sellOnce({ discountPct: 50 });
    expect(ok.status).toBe(201);
    expect(ok.body.sale.items[0].unit_price).toBe(200);
  });

  it("plafond personnalisé utilisateur : 25 % → 15 % accepté ; NULL → retour défaut rôle", async () => {
    const up = await ctx.agent
      .patch(`/api/users/${ids.vendorId}`)
      .set(auth(ids.adminToken))
      .send({ maxDiscountPct: 25 });
    expect(up.status).toBe(200);
    const ok = await sellOnce({ discountPct: 15, token: ids.vendorToken });
    expect(ok.status).toBe(201);

    const reset = await ctx.agent
      .patch(`/api/users/${ids.vendorId}`)
      .set(auth(ids.adminToken))
      .send({ maxDiscountPct: null });
    expect(reset.status).toBe(200);
    const ko = await sellOnce({ discountPct: 15, token: ids.vendorToken });
    expect(ko.status).toBe(403);
  });
});

describe("Historique des prix (E8)", () => {
  it("PATCH produit : changements détail & gros historisés avec motif, pas d'écriture sans changement", async () => {
    const before = await ctx.agent
      .get(`/api/pricing/price-history/${ids.productId}`)
      .set(auth(ids.adminToken));
    const countBefore = before.body.total;

    const raise = await ctx.agent
      .patch(`/api/products/${ids.productId}`)
      .set(auth(ids.adminToken))
      .send({ sellingPrice: 450, priceChangeReason: "Hausse fournisseur" });
    expect(raise.status).toBe(200);

    // Sans changement effectif → aucune ligne ajoutée
    const noop = await ctx.agent
      .patch(`/api/products/${ids.productId}`)
      .set(auth(ids.adminToken))
      .send({ sellingPrice: 450 });
    expect(noop.status).toBe(200);

    const hist = await ctx.agent
      .get(`/api/pricing/price-history/${ids.productId}`)
      .set(auth(ids.adminToken));
    expect(hist.status).toBe(200);
    expect(hist.body.total).toBe(countBefore + 1);
    const row = hist.body.data.find(
      (h: { field: string; new_price: number }) =>
        h.field === "DETAIL" && h.new_price === 450,
    );
    expect(row).toBeTruthy();
    expect(row.old_price).toBe(400);
    expect(row.reason).toBe("Hausse fournisseur");
    expect(row.changed_by_name).toBeTruthy();
  });
});
