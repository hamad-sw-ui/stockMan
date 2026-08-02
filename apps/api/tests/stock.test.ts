import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, destroyTestContext, SeedIds, seedTenant, TestContext, receiveStock } from './helpers/app';

let ctx: TestContext;
let ids: SeedIds;
let depotB: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
  await receiveStock(ctx, ids, 50);
  const second = await ctx.agent.post('/api/depots').set(auth(ids.adminToken)).send({ name: 'Dépôt B' });
  depotB = second.body.id;
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

const qtyOf = async (productId: string, depotId: string) => {
  const stock = await ctx.agent.get(`/api/depots/${depotId}/stock`).set(auth(ids.adminToken));
  const row = stock.body.find((p: { id: string }) => p.id === productId);
  return row ? row.quantity : 0;
};

describe('Opérations de stock (réceptions, transferts, ajustements, FEFO)', () => {
  it('réception : crée le mouvement IN, le lot et met à jour le coût d’achat', async () => {
    const before = await qtyOf(ids.productId, ids.depotId);
    const res = await ctx.agent
      .post('/api/stock/receipts')
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        reference: 'BL-2026-001',
        items: [{ productId: ids.productId, quantity: 20, unitCost: 180, batchNumber: 'LOT-001', expiryDate: null }],
      });
    expect(res.status).toBe(201);
    expect(res.body.totalCost).toBe(3600);
    expect(await qtyOf(ids.productId, ids.depotId)).toBe(before + 20);

    const detail = await ctx.agent.get(`/api/products/${ids.productId}`).set(auth(ids.adminToken));
    expect(detail.body.purchase_price).toBe(180);
    expect(detail.body.batches.some((b: { batch_number: string }) => b.batch_number === 'LOT-001')).toBe(true);

    const list = await ctx.agent.get('/api/stock/receipts').set(auth(ids.adminToken));
    expect(list.body.data[0].reference).toBe('BL-2026-001');
    expect(list.body.data[0].total_cost).toBe(3600);
  });

  it('réception en unité dérivée : 2 cartons = 24 pièces', async () => {
    const before = await qtyOf(ids.productId, ids.depotId);
    const res = await ctx.agent
      .post('/api/stock/receipts')
      .set(auth(ids.adminToken))
      .send({ depotId: ids.depotId, items: [{ productId: ids.productId, quantity: 2, unitId: ids.cartonId, unitCost: 200 }] });
    expect(res.status).toBe(201);
    expect(await qtyOf(ids.productId, ids.depotId)).toBe(before + 24);
  });

  it('transfert inter-dépôts : sortie immédiate, réception à double validation', async () => {
    const fromBefore = await qtyOf(ids.productId, ids.depotId);
    const create = await ctx.agent
      .post('/api/stock/transfers')
      .set(auth(ids.adminToken))
      .send({ fromDepotId: ids.depotId, toDepotId: depotB, items: [{ productId: ids.productId, quantity: 10 }] });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('PENDING');
    expect(await qtyOf(ids.productId, ids.depotId)).toBe(fromBefore - 10);
    expect(await qtyOf(ids.productId, depotB)).toBe(0);

    const rcv = await ctx.agent.post(`/api/stock/transfers/${create.body.transferId}/receive`).set(auth(ids.adminToken));
    expect(rcv.body.status).toBe('RECEIVED');
    expect(await qtyOf(ids.productId, depotB)).toBe(10);

    const twice = await ctx.agent.post(`/api/stock/transfers/${create.body.transferId}/receive`).set(auth(ids.adminToken));
    expect(twice.status).toBe(409);
  });

  it('transfert > stock disponible : refusé sans effet de bord', async () => {
    const fromBefore = await qtyOf(ids.productId, ids.depotId);
    const res = await ctx.agent
      .post('/api/stock/transfers')
      .set(auth(ids.adminToken))
      .send({ fromDepotId: ids.depotId, toDepotId: depotB, items: [{ productId: ids.productId, quantity: 999999 }] });
    expect(res.status).toBe(409);
    expect(await qtyOf(ids.productId, ids.depotId)).toBe(fromBefore);
  });

  it('annulation de transfert : restitution au dépôt d’origine', async () => {
    const fromBefore = await qtyOf(ids.productId, ids.depotId);
    const create = await ctx.agent
      .post('/api/stock/transfers')
      .set(auth(ids.adminToken))
      .send({ fromDepotId: ids.depotId, toDepotId: depotB, items: [{ productId: ids.productId, quantity: 5 }] });
    await ctx.agent.post(`/api/stock/transfers/${create.body.transferId}/cancel`).set(auth(ids.adminToken));
    expect(await qtyOf(ids.productId, ids.depotId)).toBe(fromBefore);
    expect(await qtyOf(ids.productId, depotB)).toBe(10); // inchangé
  });

  it('ajustement : motif obligatoire, mouvement tracé, types DAMAGE/EXPIRED', async () => {
    const noReason = await ctx.agent
      .post('/api/stock/adjust')
      .set(auth(ids.adminToken))
      .send({ productId: ids.productId, depotId: ids.depotId, delta: -1 });
    expect(noReason.status).toBe(400);

    const before = await qtyOf(ids.productId, ids.depotId);
    const ok = await ctx.agent
      .post('/api/stock/adjust')
      .set(auth(ids.adminToken))
      .send({ productId: ids.productId, depotId: ids.depotId, type: 'DAMAGE', delta: -3, reason: 'Casier renversé, 3 bouteilles cassées' });
    expect(ok.status).toBe(200);
    expect(ok.body.delta).toBe(-3);
    expect(await qtyOf(ids.productId, ids.depotId)).toBe(before - 3);

    const moves = await ctx.agent.get(`/api/stock/movements?productId=${ids.productId}&type=DAMAGE`).set(auth(ids.adminToken));
    expect(moves.body.data[0].reason).toContain('Casier');
  });

  it('FEFO : la vente consomme le lot qui expire le plus tôt, jamais un lot périmé', async () => {
    const prod = await ctx.agent
      .post('/api/products')
      .set(auth(ids.adminToken))
      .send({ name: 'Yaourt Test', sellingPrice: 500, purchasePrice: 300 });
    const pid = prod.body.id as string;
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

    // Trois lots : périmé (5), bientôt (5), lointain (10)
    for (const [batch, expiry] of [['EXPIRED', past], ['SOON', soon], ['LATER', later]] as const) {
      const qty = batch === 'LATER' ? 10 : 5;
      const res = await ctx.agent
        .post('/api/stock/receipts')
        .set(auth(ids.adminToken))
        .send({ depotId: ids.depotId, items: [{ productId: pid, quantity: qty, batchNumber: batch, expiryDate: expiry }] });
      expect(res.status).toBe(201);
    }

    // Vente de 8 : doit prendre les 5 du lot SOON puis 3 du lot LATER (JAMAIS le périmé)
    const sale = await ctx.agent
      .post('/api/sales')
      .set(auth(ids.vendorToken))
      .send({ items: [{ productId: pid, quantity: 8 }], paymentMethod: 'CASH' });
    expect(sale.status).toBe(201);

    const detail = await ctx.agent.get(`/api/products/${pid}`).set(auth(ids.adminToken));
    const batches = Object.fromEntries(detail.body.batches.map((b: { batch_number: string; quantity: string }) => [b.batch_number, parseFloat(b.quantity)]));
    expect(batches['EXPIRED']).toBe(5); // intact
    expect(batches['SOON']).toBe(0);
    expect(batches['LATER']).toBe(7);

    // Il reste 12 valides (5 périmés exclus). Vendre 13 lots valides → échec.
    const tooMuch = await ctx.agent
      .post('/api/sales')
      .set(auth(ids.vendorToken))
      .send({ items: [{ productId: pid, quantity: 13 }], paymentMethod: 'CASH' });
    expect(tooMuch.status).toBe(409);
  });

  it('mouvements : pagination par curseur stable', async () => {
    const page1 = await ctx.agent.get('/api/stock/movements?size=5').set(auth(ids.adminToken));
    expect(page1.body.data.length).toBe(5);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await ctx.agent.get(`/api/stock/movements?size=5&cursor=${encodeURIComponent(page1.body.nextCursor)}`).set(auth(ids.adminToken));
    expect(page2.body.data.length).toBeGreaterThan(0);
    const ids1 = new Set(page1.body.data.map((m: { id: string }) => m.id));
    for (const m of page2.body.data) expect(ids1.has(m.id)).toBe(false);
  });
});
