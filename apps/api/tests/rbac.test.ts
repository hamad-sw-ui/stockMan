import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, destroyTestContext, SeedIds, seedTenant, TestContext } from './helpers/app';

let ctx: TestContext;
let ids: SeedIds;

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('RBAC (corrige SEC-05 : les rôles sont réellement appliqués)', () => {
  it('toute route protégée exige un jeton', async () => {
    for (const path of ['/api/products', '/api/sales', '/api/users', '/api/reports/dashboard', '/api/tenants']) {
      const res = await ctx.agent.get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it('un VENDEUR ne peut pas modifier le catalogue', async () => {
    const create = await ctx.agent
      .post('/api/products')
      .set(auth(ids.vendorToken))
      .send({ name: 'Produit interdit', sellingPrice: 100 });
    expect(create.status).toBe(403);

    const patch = await ctx.agent
      .patch(`/api/products/${ids.productId}`)
      .set(auth(ids.vendorToken))
      .send({ name: 'Renommé' });
    expect(patch.status).toBe(403);

    const archive = await ctx.agent.post(`/api/products/${ids.productId}/archive`).set(auth(ids.vendorToken));
    expect(archive.status).toBe(403);
  });

  it('un VENDEUR ne peut pas gérer unités, équipe, dépôts, fournisseurs', async () => {
    const cases: Array<[string, string, object?]> = [
      ['post', '/api/units', { name: 'Lot', symbol: 'Lt', baseValue: 6 }],
      ['delete', `/api/units/${ids.unitId}`],
      ['post', '/api/users', { name: 'X', email: 'x@x.cm', role: 'VENDEUR', depotId: ids.depotId }],
      ['post', '/api/depots', { name: 'Depot interdit' }],
      ['post', '/api/suppliers', { name: 'Fourn interdit' }],
      ['post', '/api/stock/adjust', { productId: ids.productId, delta: -1, reason: 'vol' }],
      ['post', '/api/stock/receipts', { items: [{ productId: ids.productId, quantity: 1 }] }],
    ];
    for (const [method, path, body] of cases) {
      const res = await (ctx.agent as unknown as Record<string, (p: string) => ReturnType<typeof ctx.agent.get>>)[method]!(path)
        .set(auth(ids.vendorToken))
        .send(body ?? {});
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
    }
  });

  it('un VENDEUR lit les référentiels et consulte le stock de SON dépôt', async () => {
    expect((await ctx.agent.get('/api/units').set(auth(ids.vendorToken))).status).toBe(200);
    expect((await ctx.agent.get('/api/depots').set(auth(ids.vendorToken))).status).toBe(200);
    expect((await ctx.agent.get(`/api/depots/${ids.depotId}/stock`).set(auth(ids.vendorToken))).status).toBe(200);
    expect((await ctx.agent.get('/api/categories').set(auth(ids.vendorToken))).status).toBe(200);
  });

  it('pas d’accès inter-tenant : les données d’un autre tenant sont invisibles', async () => {
    // Tenant B complètement isolé
    const reg = await ctx.agent.post('/api/auth/register').send({
      tenantName: 'Tenant B',
      userName: 'Boss B',
      email: 'boss-b@test.cm',
      password: 'Passw0rd!',
    });
    const tokenB = reg.body.accessToken;
    const productsB = await ctx.agent.get('/api/products').set(auth(tokenB));
    expect(productsB.body.total).toBe(0);
    const detail = await ctx.agent.get(`/api/products/${ids.productId}`).set(auth(tokenB));
    expect(detail.status).toBe(404);
  });

  it('un ADMIN du tenant ne peut pas toucher la console Super Admin', async () => {
    expect((await ctx.agent.get('/api/tenants').set(auth(ids.adminToken))).status).toBe(403);
    expect((await ctx.agent.get('/api/reports/superadmin/stats').set(auth(ids.adminToken))).status).toBe(403);
    expect((await ctx.agent.get('/api/configs').set(auth(ids.adminToken))).status).toBe(403);
    expect((await ctx.agent.get('/api/licenses').set(auth(ids.adminToken))).status).toBe(403);
  });
});
