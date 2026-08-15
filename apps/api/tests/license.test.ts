import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  SeedIds,
  seedTenant,
  TestContext,
} from "./helpers/app";

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

describe("Licences (DAT-06 : le middleware de licence est effectif)", () => {
  it("licence TRIAL créée à l’inscription ; les quotas sont contrôlés", async () => {
    // seed : TRIAL 2 utilisateurs → la création d’un 3ᵉ compte actif est bloquée
    await ctx.pool.query(
      "UPDATE licenses SET max_users=2, max_depots=1, plan_code='TRIAL', status='TRIAL' WHERE tenant_id=$1",
      [ids.tenantId],
    );
    const third = await ctx.agent
      .post("/api/users")
      .set(auth(ids.adminToken))
      .send({
        name: "Troisième",
        email: "trois@test.cm",
        role: "VENDEUR",
        depotId: ids.depotId,
      });
    expect(third.status).toBe(402);
    expect(third.body.error.code).toBe("LICENSE_LIMIT_USERS");

    // max_depots : 1 dépôt existant → création d’un 2ᵉ bloquée
    const depot = await ctx.agent
      .post("/api/depots")
      .set(auth(ids.adminToken))
      .send({ name: "Dépôt Bureau" });
    expect(depot.status).toBe(402);
    expect(depot.body.error.code).toBe("LICENSE_LIMIT_DEPOTS");
  });

  it("licence expirée : écriture bloquée (402), lecture préservée", async () => {
    await ctx.pool.query(
      "UPDATE licenses SET status='EXPIRED', end_date = CURRENT_DATE - 10 WHERE tenant_id=$1",
      [ids.tenantId],
    );
    const write = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({ name: "Produit bloqué", sellingPrice: 100 });
    expect(write.status).toBe(402);
    expect(write.body.error.code).toBe("LICENSE_EXPIRED");

    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    expect(sale.status).toBe(402);

    // Lecture toujours possible : le client garde accès à ses données
    const read = await ctx.agent.get("/api/products").set(auth(ids.adminToken));
    expect(read.status).toBe(200);
  });

  it("renouvellement par le Super Admin débloque l’écriture", async () => {
    // Création du Super Admin + tenant système en base
    await ctx.pool.query(
      `INSERT INTO plans (code, name, max_users, max_depots, monthly_price) VALUES ('PRO','Pro',50,10,15000) ON CONFLICT DO NOTHING`,
    );
    const saTenant = await ctx.pool.query(
      `INSERT INTO tenants (name) VALUES ('Éditeur Test') RETURNING id`,
    );
    const bcrypt = (await import("bcryptjs")).default;
    await ctx.pool.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES ($1,'SA','sa@test.cm',$2,'SUPER_ADMIN')`,
      [saTenant.rows[0].id, bcrypt.hashSync("Sa123456!", 10)],
    );
    const saLogin = await ctx.agent
      .post("/api/auth/login")
      .send({ email: "sa@test.cm", password: "Sa123456!" });
    expect(saLogin.status).toBe(200);
    const saToken = saLogin.body.accessToken;

    const licenses = await ctx.agent.get("/api/licenses").set(auth(saToken));
    const lic = licenses.body.find(
      (l: { tenant_name: string }) => l.tenant_name === "SARL Test",
    );
    expect(lic).toBeTruthy();

    const renew = await ctx.agent
      .post(`/api/licenses/${lic.id}/renew`)
      .set(auth(saToken))
      .send({ months: 1 });
    expect(renew.status).toBe(200);

    const write = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({ name: "Produit débloqué", sellingPrice: 100 });
    expect(write.status).toBe(201);
  });
});
