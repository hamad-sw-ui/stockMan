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
 * E3 — Devis / proforma : pricing serveur sans mouvement de stock, conversion
 * au PRIX FIGÉ du devis, expiration, anti double-conversion, annulation.
 */

let ctx: TestContext;
let ids: SeedIds;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
  await receiveStock(ctx, ids, 100);
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

async function makeQuote(payload: Record<string, unknown> = {}) {
  return ctx.agent
    .post("/api/quotes")
    .set(auth(ids.adminToken))
    .send({
      depotId: ids.depotId,
      items: [{ productId: ids.productId, quantity: 5 }],
      validUntil: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      ...payload,
    });
}

const stockOf = async () => {
  const r = await ctx.pool.query<{ q: number }>(
    "SELECT quantity::float AS q FROM stock_levels WHERE product_id=$1 AND depot_id=$2",
    [ids.productId, ids.depotId],
  );
  return r.rows[0]!.q;
};

describe("E3 · Devis (proforma)", () => {
  it("création : prix calculés serveur, AUCUN mouvement de stock", async () => {
    const before = await stockOf();
    const q = await makeQuote();
    expect(q.status).toBe(201);
    expect(q.body.status).toBe("DRAFT");
    expect(Number(q.body.total_amount)).toBe(2000); // 5 × 400
    expect(q.body.items[0].product_name).toBe("Eau Test 1.5L");
    expect(await stockOf()).toBe(before); // intouché
    const moves = await ctx.pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id=$1",
      [ids.tenantId],
    );
    // Aucun mouvement SALE issu du devis (seuls les IN des réceptions existent)
    const salesMoves = await ctx.pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id=$1 AND type='SALE'",
      [ids.tenantId],
    );
    expect(moves.rows[0]!.n).toBeGreaterThan(0);
    expect(salesMoves.rows[0]!.n).toBe(0);
  });

  it("conversion : vente créée au PRIX FIGÉ du devis, même après un changement de prix catalogue", async () => {
    const q = await makeQuote();
    expect(q.status).toBe(201);
    const before = await stockOf();
    // Le prix catalogue double entre le devis et la conversion
    await ctx.agent
      .patch(`/api/products/${ids.productId}`)
      .set(auth(ids.adminToken))
      .send({ sellingPrice: 800 });
    const conv = await ctx.agent
      .post(`/api/quotes/${q.body.id}/convert`)
      .set(auth(ids.adminToken))
      .send({ paymentMethod: "CASH" });
    expect(conv.status).toBe(201);
    // Prix honoré : 5 × 400 (prix du devis), PAS 5 × 800
    expect(Number(conv.body.sale.total_amount)).toBe(2000);
    expect(Number(conv.body.sale.items[0].unit_price)).toBe(400);
    expect(await stockOf()).toBe(before - 5); // stock décrémenté à la conversion
    // Restaurer le prix pour les autres tests
    await ctx.agent
      .patch(`/api/products/${ids.productId}`)
      .set(auth(ids.adminToken))
      .send({ sellingPrice: 400 });
  });

  it("anti double-conversion : la seconde tentative est refusée, aucune vente dupliquée", async () => {
    const q = await makeQuote();
    const c1 = await ctx.agent
      .post(`/api/quotes/${q.body.id}/convert`)
      .set(auth(ids.adminToken))
      .send({});
    expect(c1.status).toBe(201);
    const c2 = await ctx.agent
      .post(`/api/quotes/${q.body.id}/convert`)
      .set(auth(ids.adminToken))
      .send({});
    expect(c2.status).toBe(409);
    expect(c2.body.error.code).toBe("QUOTE_ALREADY_CONVERTED");
    const salesCount = await ctx.pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM sales WHERE tenant_id=$1 AND id=$2",
      [ids.tenantId, c1.body.sale.id],
    );
    expect(salesCount.rows[0]!.n).toBe(1);
    const detail = await ctx.agent
      .get(`/api/quotes/${q.body.id}`)
      .set(auth(ids.adminToken));
    expect(detail.body.status).toBe("CONVERTED");
    expect(detail.body.converted_sale_id).toBe(c1.body.sale.id);
  });

  it("vente à crédit possible depuis un devis (statut PARTIAL/CREDIT hérité)", async () => {
    const c = await ctx.agent
      .post("/api/customers")
      .set(auth(ids.adminToken))
      .send({ name: "Client Devis Crédit", phone: "+237655001100" });
    const q = await makeQuote({ customerId: c.body.id });
    const conv = await ctx.agent
      .post(`/api/quotes/${q.body.id}/convert`)
      .set(auth(ids.adminToken))
      .send({ payments: [] });
    expect(conv.status).toBe(201);
    expect(conv.body.sale.payment_status).toBe("CREDIT");
    expect(conv.body.sale.customer_name).toBe("Client Devis Crédit");
  });

  it("expiration d'un devis : conversion refusée ; annulation d'un brouillon", async () => {
    const q = await makeQuote();
    // Forcer l'expiration
    await ctx.pool.query("UPDATE quotes SET valid_until=$2 WHERE id=$1", [
      q.body.id,
      "2020-01-01",
    ]);
    const conv = await ctx.agent
      .post(`/api/quotes/${q.body.id}/convert`)
      .set(auth(ids.adminToken))
      .send({});
    expect(conv.status).toBe(409);
    expect(conv.body.error.code).toBe("QUOTE_EXPIRED");
    // Le devis est redevenu DRAFT (compensation) → annulation possible
    const q2 = await ctx.agent
      .get(`/api/quotes/${q.body.id}`)
      .set(auth(ids.adminToken));
    expect(q2.body.status).toBe("DRAFT");
    const cancel = await ctx.agent
      .post(`/api/quotes/${q.body.id}/cancel`)
      .set(auth(ids.adminToken));
    expect(cancel.body.status).toBe("CANCELLED");
    const conv3 = await ctx.agent
      .post(`/api/quotes/${q.body.id}/convert`)
      .set(auth(ids.adminToken))
      .send({});
    expect(conv3.status).toBe(409);
  });

  it("liste avec filtre statut + RBAC (le vendeur ne crée pas de devis)", async () => {
    await makeQuote();
    const list = await ctx.agent
      .get("/api/quotes?status=DRAFT")
      .set(auth(ids.adminToken));
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(
      list.body.data.every((x: { status: string }) => x.status === "DRAFT"),
    ).toBe(true);
    const vendorTry = await ctx.agent
      .post("/api/quotes")
      .set(auth(ids.vendorToken))
      .send({ items: [{ productId: ids.productId, quantity: 1 }] });
    expect(vendorTry.status).toBe(403);
  });
});
