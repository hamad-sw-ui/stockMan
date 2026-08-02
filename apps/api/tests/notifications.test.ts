import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, destroyTestContext, SeedIds, seedTenant, TestContext } from './helpers/app';
import { sendLowStockAlerts } from '../src/services/notificationService';

let ctx: TestContext;
let ids: SeedIds;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx); // produit minStock=5, stock 0 → déclenche l'alerte stock bas
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

describe('Notifications — canaux, dédup exactly-once, supervision (BCK-01/07)', () => {
  it('paramètres : GET crée les défauts, PUT les met à jour (upsert)', async () => {
    const def = await ctx.agent.get('/api/notifications/settings').set(auth(ids.adminToken));
    expect(def.status).toBe(200);
    expect(def.body.low_stock_enabled).toBe(true);

    const put = await ctx.agent
      .put('/api/notifications/settings')
      .set(auth(ids.adminToken))
      .send({ alertPhone: '+237699000000', alertWhatsapp: '+237655000000', dailyReportTime: '18:30', lowStockEnabled: true });
    expect(put.status).toBe(200);
    expect(put.body.alert_phone).toBe('+237699000000');
    expect(String(put.body.daily_report_time)).toContain('18:30');

    const again = await ctx.agent.get('/api/notifications/settings').set(auth(ids.adminToken));
    expect(again.body.alert_phone).toBe('+237699000000');

    const bad = await ctx.agent
      .put('/api/notifications/settings')
      .set(auth(ids.adminToken))
      .send({ dailyReportTime: 'ce soir' });
    expect(bad.status).toBe(400);

    // Un VENDEUR ne peut pas modifier les paramètres
    const denied = await ctx.agent
      .put('/api/notifications/settings')
      .set(auth(ids.vendorToken))
      .send({ alertPhone: '+237600000000' });
    expect(denied.status).toBe(403);
  });

  it('envoi de test SMS (driver mock) : tracé SENT dans le centre', async () => {
    const res = await ctx.agent
      .post('/api/notifications/test')
      .set(auth(ids.adminToken))
      .send({ channel: 'SMS', phone: '+237699000000' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('sent');

    const list = await ctx.agent.get('/api/notifications?type=SYSTEM').set(auth(ids.adminToken));
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].channel).toBe('SMS');
    expect(list.body.data[0].status).toBe('SENT');
  });

  it('alerte stock bas : IN_APP + SMS + WhatsApp, jamais en double (clé de dédup)', async () => {
    await sendLowStockAlerts(ids.tenantId); // 1ʳᵉ passe
    await sendLowStockAlerts(ids.tenantId); // 2ᵉ passe : dédups

    const list = await ctx.agent.get('/api/notifications?type=LOW_STOCK').set(auth(ids.adminToken));
    expect(list.body.total).toBe(3); // IN_APP + SMS + WHATSAPP, une fois chacun
    const channels = list.body.data.map((n: { channel: string }) => n.channel).sort();
    expect(channels).toEqual(['IN_APP', 'SMS', 'WHATSAPP']);
    expect(list.body.data.every((n: { status: string }) => n.status === 'SENT')).toBe(true);
    expect(list.body.data[0].message).toContain('Eau Test 1.5L');

    // Le compteur de non-lues ne compte que l'IN_APP
    expect(list.body.unread).toBe(1);
  });

  it('centre : marquage lu unitaire puis global', async () => {
    const list = await ctx.agent.get('/api/notifications?status=SENT').set(auth(ids.adminToken));
    const inApp = list.body.data.find((n: { channel: string }) => n.channel === 'IN_APP');
    const one = await ctx.agent.patch(`/api/notifications/${inApp.id}/read`).set(auth(ids.adminToken));
    expect(one.status).toBe(200);

    const after = await ctx.agent.get('/api/notifications').set(auth(ids.adminToken));
    expect(after.body.unread).toBe(0);

    // Tenant isolé : une notification d'un autre tenant n'est pas lisible ici
    const other = await ctx.agent.patch(`/api/notifications/${inApp.id}/read`).set(auth(ids.vendorToken));
    expect(other.status).toBe(200); // déjà lue… mais appartenant au même tenant ; vérifions l'isolation via SQL
    const alien = await ctx.pool.query(
      `INSERT INTO notifications (tenant_id, type, channel, message, status)
       SELECT id, 'SYSTEM', 'IN_APP', 'secret', 'SENT' FROM tenants WHERE id <> $1 LIMIT 1 RETURNING id`,
      [ids.tenantId],
    );
    if (alien.rows[0]) {
      const denied = await ctx.agent.patch(`/api/notifications/${alien.rows[0].id}/read`).set(auth(ids.adminToken));
      expect(denied.status).toBe(404);
    }
  });

  it('supervision : interdite aux non-admin éditeur', async () => {
    const denied = await ctx.agent.get('/api/notifications/supervision').set(auth(ids.adminToken));
    expect(denied.status).toBe(403);

    const bcrypt = (await import('bcryptjs')).default;
    const saTenant = await ctx.pool.query("INSERT INTO tenants (name) VALUES ('Plateforme') RETURNING id");
    await ctx.pool.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES ($1,'SA','sa-notif@test.cm',$2,'SUPER_ADMIN')`,
      [saTenant.rows[0].id, bcrypt.hashSync('Sa123456!', 10)],
    );
    const saLogin = await ctx.agent.post('/api/auth/login').send({ email: 'sa-notif@test.cm', password: 'Sa123456!' });
    const saToken = saLogin.body.accessToken;
    expect(saLogin.status).toBe(200);

    const sup = await ctx.agent.get('/api/notifications/supervision').set(auth(saToken));
    expect(sup.status).toBe(200);
    expect(Array.isArray(sup.body.byStatus)).toBe(true);
    expect(sup.body.byStatus.length).toBeGreaterThan(0);
  });
});
