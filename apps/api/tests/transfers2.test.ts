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
 * E8 — Transferts v2 : réception PARTIELLE par ligne avec écarts valorisés
 * (DAMAGE/LOSS), reliquat visible dans le stock en transit, annulation qui ne
 * restitue que le reliquat. Vérifie les gardes (sur-réception, motif requis)
 * et les mouvements tracés.
 */

let ctx: TestContext;
let ids: SeedIds;
let depotB: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
  await receiveStock(ctx, ids, 100); // coût unitaire 200 (helper)
  const second = await ctx.agent
    .post("/api/depots")
    .set(auth(ids.adminToken))
    .send({ name: "Dépôt Transit" });
  depotB = second.body.id;
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

const qtyOf = async (productId: string, depotId: string) => {
  const stock = await ctx.agent
    .get(`/api/depots/${depotId}/stock`)
    .set(auth(ids.adminToken));
  const row = stock.body.find((p: { id: string }) => p.id === productId);
  return row ? row.quantity : 0;
};

const transferItemIdOf = async (transferId: string) => {
  const r = await ctx.pool.query<{ id: string }>(
    "SELECT id FROM stock_transfer_items WHERE transfer_id=$1 ORDER BY id LIMIT 1",
    [transferId],
  );
  return r.rows[0]!.id;
};

async function createTransfer(qty: number): Promise<string> {
  const res = await ctx.agent
    .post("/api/stock/transfers")
    .set(auth(ids.adminToken))
    .send({
      fromDepotId: ids.depotId,
      toDepotId: depotB,
      items: [{ productId: ids.productId, quantity: qty }],
    });
  expect(res.status).toBe(201);
  return res.body.transferId as string;
}

describe("Transferts v2 (E8) — réception partielle et écarts", () => {
  it("réception partielle + casse (DAMAGE) : PARTIALLY_RECEIVED, reliquat en transit", async () => {
    const transferId = await createTransfer(10);
    const itemId = await transferItemIdOf(transferId);
    const beforeA = await qtyOf(ids.productId, ids.depotId);

    const rcv = await ctx.agent
      .post(`/api/stock/transfers/${transferId}/receive`)
      .set(auth(ids.adminToken))
      .send({
        items: [
          {
            transferItemId: itemId,
            receivedQty: 6,
            lostQty: 2,
            discrepancyReason: "DAMAGE",
          },
        ],
      });
    expect(rcv.status, JSON.stringify(rcv.body)).toBe(200);
    expect(rcv.body.status).toBe("PARTIALLY_RECEIVED");

    // Dépôt destination : seules les 6 pièces reçues entrent
    expect(await qtyOf(ids.productId, depotB)).toBe(6);
    // Source : les 10 sorties à l'émission ne reviennent pas
    expect(await qtyOf(ids.productId, ids.depotId)).toBe(beforeA);

    // Transit : reliquat 10 − 6 − 2 = 2 pièces, valorisées au coût (200)
    const transit = await ctx.agent
      .get("/api/stock/transit")
      .set(auth(ids.adminToken));
    expect(transit.status).toBe(200);
    const line = transit.body.data.find(
      (r: { itemId: string }) => r.itemId === itemId,
    );
    expect(line).toBeTruthy();
    expect(line.inTransit).toBeCloseTo(2, 5);
    expect(line.value).toBeCloseTo(400, 5);

    // Mouvement de casse tracé et valorisé (2 × 200)
    const mv = await ctx.pool.query<{
      type: string;
      quantity: string;
      reason_code: string | null;
      unit_cost: string | null;
    }>(
      `SELECT type, quantity::float, reason_code, unit_cost::float
         FROM stock_movements
        WHERE reference_id=$1 AND type='DAMAGE'`,
      [transferId],
    );
    expect(mv.rows).toHaveLength(1);
    expect(parseFloat(mv.rows[0]!.quantity)).toBeCloseTo(2, 5);
    expect(mv.rows[0]!.reason_code).toBe("TRANSIT_DAMAGE");
    expect(parseFloat(mv.rows[0]!.unit_cost ?? "0")).toBeCloseTo(200, 5);

    // Clôture du reliquat → RECEIVED, transit vide
    const rcv2 = await ctx.agent
      .post(`/api/stock/transfers/${transferId}/receive`)
      .set(auth(ids.adminToken));
    expect(rcv2.status).toBe(200);
    expect(rcv2.body.status).toBe("RECEIVED");
    expect(await qtyOf(ids.productId, depotB)).toBe(8);
    const transit2 = await ctx.agent
      .get("/api/stock/transit")
      .set(auth(ids.adminToken));
    expect(
      transit2.body.data.find((r: { itemId: string }) => r.itemId === itemId),
    ).toBeUndefined();
  });

  it("perte sans motif : 400 DISCREPANCY_REASON_REQUIRED", async () => {
    const transferId = await createTransfer(4);
    const itemId = await transferItemIdOf(transferId);
    const res = await ctx.agent
      .post(`/api/stock/transfers/${transferId}/receive`)
      .set(auth(ids.adminToken))
      .send({
        items: [{ transferItemId: itemId, receivedQty: 2, lostQty: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("DISCREPANCY_REASON_REQUIRED");
    // Aucune écriture : reliquat intact
    const transit = await ctx.agent
      .get("/api/stock/transit")
      .set(auth(ids.adminToken));
    const line = transit.body.data.find(
      (r: { itemId: string }) => r.itemId === itemId,
    );
    expect(line.inTransit).toBeCloseTo(4, 5);
  });

  it("sur-réception : 409 TRANSFER_OVER_RECEIPT", async () => {
    const transferId = await createTransfer(3);
    const itemId = await transferItemIdOf(transferId);
    const res = await ctx.agent
      .post(`/api/stock/transfers/${transferId}/receive`)
      .set(auth(ids.adminToken))
      .send({
        items: [
          {
            transferItemId: itemId,
            receivedQty: 3,
            lostQty: 1,
            discrepancyReason: "LOSS",
          },
        ],
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TRANSFER_OVER_RECEIPT");
  });

  it("annulation d'un transfert PARTIELLEMENT reçu : seul le reliquat est restitué", async () => {
    const beforeA = await qtyOf(ids.productId, ids.depotId);
    const beforeB = await qtyOf(ids.productId, depotB);
    const transferId = await createTransfer(10);
    const itemId = await transferItemIdOf(transferId);
    const rcv = await ctx.agent
      .post(`/api/stock/transfers/${transferId}/receive`)
      .set(auth(ids.adminToken))
      .send({
        items: [
          {
            transferItemId: itemId,
            receivedQty: 6,
            lostQty: 1,
            discrepancyReason: "LOSS",
          },
        ],
      });
    expect(rcv.status).toBe(200);
    expect(rcv.body.status).toBe("PARTIALLY_RECEIVED");

    const cancel = await ctx.agent
      .post(`/api/stock/transfers/${transferId}/cancel`)
      .set(auth(ids.adminToken));
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    // Reliquat = 10 − 6 − 1 = 3 restitués à la source (jamais les 6 déjà reçus)
    expect(await qtyOf(ids.productId, ids.depotId)).toBe(beforeA - 10 + 3);
    expect(await qtyOf(ids.productId, depotB)).toBe(beforeB + 6);
  });

  it("filtre dépôt du transit : vue ciblée sur un dépôt", async () => {
    const transferId = await createTransfer(5);
    const itemId = await transferItemIdOf(transferId);
    const all = await ctx.agent
      .get("/api/stock/transit")
      .set(auth(ids.adminToken));
    const scoped = await ctx.agent
      .get(`/api/stock/transit?depotId=${depotB}`)
      .set(auth(ids.adminToken));
    const otherDepot = await ctx.agent
      .get("/api/stock/transit?depotId=00000000-0000-0000-0000-000000000000")
      .set(auth(ids.adminToken));
    expect(otherDepot.status).toBe(200);
    expect(otherDepot.body.data).toHaveLength(0);
    expect(
      all.body.data.some((r: { itemId: string }) => r.itemId === itemId),
    ).toBe(true);
    expect(
      scoped.body.data.some((r: { itemId: string }) => r.itemId === itemId),
    ).toBe(true);
  });
});
