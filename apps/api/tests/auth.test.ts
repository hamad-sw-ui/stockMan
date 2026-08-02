import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext, destroyTestContext, TestContext } from './helpers/app';

let ctx: TestContext;
const email = 'admin@acme.test';
const password = 'Secret123!';

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

describe('Authentification & sessions', () => {
  it('inscrire un tenant crée admin + licence TRIAL + dépôt + unités', async () => {
    const res = await ctx.agent.post('/api/auth/register').send({
      tenantName: 'ACME SARL',
      userName: 'Patron ACME',
      email,
      password,
      phone: '+237600000000',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.role).toBe('ADMIN');

    const me = await ctx.agent.get('/api/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.license.status).toBe('TRIAL');

    const depots = await ctx.agent.get('/api/depots').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(depots.body).toHaveLength(1);
    const units = await ctx.agent.get('/api/units').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(units.body.length).toBeGreaterThanOrEqual(2);
  });

  it('rejette un email déjà enregistré avec un code métier propre', async () => {
    const res = await ctx.agent.post('/api/auth/register').send({
      tenantName: 'Autre SARL',
      userName: 'Autre Patron',
      email,
      password,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejette un mot de passe faible', async () => {
    const res = await ctx.agent.post('/api/auth/register').send({
      tenantName: 'Weak SARL',
      userName: 'Faible',
      email: 'faible@test.cm',
      password: '123',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('login OK / mauvais mot de passe 401', async () => {
    const ok = await ctx.agent.post('/api/auth/login').send({ email, password });
    expect(ok.status).toBe(200);
    expect(String(ok.headers['set-cookie'])).toContain('refreshToken');
    const ko = await ctx.agent.post('/api/auth/login').send({ email, password: 'Wrong999!' });
    expect(ko.status).toBe(401);
  });

  it('refresh : rotation effective + rejeu du jeton consommé détecté', async () => {
    // Client SANS jar : on pilote explicitement le cookie (le jar de l'agent
    // supertest écraserait le cookie « ancien » par le plus récent).
    const http = () => request(ctx.app);
    const login = await http().post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];

    // 1ᵉʳ refresh : succès et rotation
    const r1 = await http().post('/api/auth/refresh').set('Cookie', cookies.join(';'));
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const cookies2 = r1.headers['set-cookie'] as unknown as string[];

    // Rejeu de l'ANCIEN refresh (déjà rotatif) → REFRESH_REUSE et révocation globale
    const replay = await http().post('/api/auth/refresh').set('Cookie', cookies.join(';'));
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSE');

    // Le refresh rotatif est aussi compromis → reconnecté uniquement via login
    const r3 = await http().post('/api/auth/refresh').set('Cookie', cookies2.join(';'));
    expect(r3.status).toBe(401);
  });

  it('logout invalide le refresh cookie', async () => {
    const http = () => request(ctx.app);
    const login = await http().post('/api/auth/login').send({ email, password });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const out = await http().post('/api/auth/logout').set('Cookie', cookies.join(';'));
    expect(out.status).toBe(200);
    const after = await http().post('/api/auth/refresh').set('Cookie', cookies.join(';'));
    expect(after.status).toBe(401);
  });

  it('change-password impose le mot de passe actuel et rouvre une session', async () => {
    const login = await ctx.agent.post('/api/auth/login').send({ email, password });
    const token = login.body.accessToken;
    const bad = await ctx.agent
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Wrong1', newPassword: 'Nouveau123!' });
    expect(bad.status).toBe(400);
    const good = await ctx.agent
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'Nouveau123!' });
    expect(good.status).toBe(200);
    // reset pour les autres suites
    const relog = await ctx.agent.post('/api/auth/login').send({ email, password: 'Nouveau123!' });
    await ctx.agent
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${relog.body.accessToken}`)
      .send({ currentPassword: 'Nouveau123!', newPassword: password });
  });

  it('connexion PIN fonctionne et est validée', async () => {
    const login = await ctx.agent.post('/api/auth/login').send({ email, password });
    const token = login.body.accessToken;
    const depots = await ctx.agent.get('/api/depots').set('Authorization', `Bearer ${token}`);
    const v = await ctx.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Vendeur PIN', email: 'pin@test.cm', role: 'VENDEUR', depotId: depots.body[0].id, pin: '5544' });
    expect(v.status).toBe(201);

    const pinLogin = await ctx.agent.post('/api/auth/pin').send({ email: 'pin@test.cm', pin: '5544' });
    expect(pinLogin.status).toBe(200);
    const wrong = await ctx.agent.post('/api/auth/pin').send({ email: 'pin@test.cm', pin: '0000' });
    expect(wrong.status).toBe(401);
    const malformed = await ctx.agent.post('/api/auth/pin').send({ email: 'pin@test.cm', pin: 'abc' });
    expect(malformed.status).toBe(400);
  });

  it('forgot/reset password ne révèle pas l’existence des comptes', async () => {
    const unknown = await ctx.agent.post('/api/auth/forgot-password').send({ email: 'nobody@test.cm' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.devToken).toBeUndefined();
    const known = await ctx.agent.post('/api/auth/forgot-password').send({ email });
    expect(known.status).toBe(200);
    expect(known.body.devToken).toBeTruthy(); // hors production
    const reset = await ctx.agent
      .post('/api/auth/reset-password')
      .send({ token: known.body.devToken, newPassword: 'Reset12345!' });
    expect(reset.status).toBe(200);
    const relog = await ctx.agent.post('/api/auth/login').send({ email, password: 'Reset12345!' });
    expect(relog.status).toBe(200);
    // restauration
    await ctx.agent
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${relog.body.accessToken}`)
      .send({ currentPassword: 'Reset12345!', newPassword: password });
  });
});
