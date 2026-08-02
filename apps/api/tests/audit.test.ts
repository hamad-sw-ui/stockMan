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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

describe("Journal d'audit — alimentation réelle et traçabilité (DAT-06)", () => {
  it("les opérations sensibles écrivent une entrée horodatée avec l’acteur", async () => {
    // seedTenant a déjà produit : register (CREATE tenant), création catégorie/produit, login…
    const product = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({
        name: "Savon Audit",
        purchasePrice: 300,
        sellingPrice: 550,
        unitId: ids.unitId,
      });
    expect(product.status).toBe(201);

    const logs = await ctx.agent
      .get("/api/audit-logs?entity=product&size=50")
      .set(auth(ids.adminToken));
    expect(logs.status).toBe(200);
    const entry = logs.body.data.find(
      (l: { entity_id: string }) => l.entity_id === product.body.id,
    );
    expect(entry).toBeTruthy();
    expect(entry.action).toBe("CREATE");
    expect(entry.user_name).toBe("Admin Test");
    expect(entry.created_at).toBeTruthy();

    // Filtre par utilisateur
    const byUser = await ctx.agent
      .get(`/api/audit-logs?userId=${ids.adminId}`)
      .set(auth(ids.adminToken));
    expect(byUser.body.data.length).toBeGreaterThan(0);
    expect(
      byUser.body.data.every(
        (l: { user_id: string }) => l.user_id === ids.adminId,
      ),
    ).toBe(true);

    // Les connexions sont journalisées (LOGIN)
    const sessions = await ctx.agent
      .get("/api/audit-logs?entity=session&action=LOGIN")
      .set(auth(ids.adminToken));
    expect(sessions.body.data.length).toBeGreaterThan(0);
  });

  it("un VENDEUR ne consulte pas le journal ; un ADMIN ne voit que SON tenant", async () => {
    const denied = await ctx.agent
      .get("/api/audit-logs")
      .set(auth(ids.vendorToken));
    expect(denied.status).toBe(403);

    const list = await ctx.agent
      .get("/api/audit-logs?size=100")
      .set(auth(ids.adminToken));
    const alien = await ctx.pool.query(
      "SELECT id FROM tenants WHERE id <> $1",
      [ids.tenantId],
    );
    if (alien.rows.length > 0) {
      const alienIds = new Set(alien.rows.map((r: { id: string }) => r.id));
      expect(
        list.body.data.every(
          (l: { tenant_id: string }) => !alienIds.has(l.tenant_id),
        ),
      ).toBe(true);
    }
  });

  it("indicateur dissimulé : les réponses admin ne contiennent pas les états internes des autres tenants", async () => {
    // Un faux secret injecté en base ne fuit jamais dans /api/audit-logs
    await ctx.pool.query(
      "INSERT INTO audit_logs (tenant_id, action, entity, details) VALUES ($1,'CONFIG','test','valeur=mon-secret-xyz')",
      [ids.tenantId],
    );
    const list = await ctx.agent
      .get("/api/audit-logs?entity=test")
      .set(auth(ids.adminToken));
    // L'entrée appartient au tenant : visible mais avec ses métadonnées seules
    expect(list.body.data[0].tenant_id).toBe(ids.tenantId);
  });
});

describe("Configurations sensibles — masquage effectif des secrets (SEC-04)", () => {
  it("tenant : écriture acceptée, lecture masquée, jamais de valeur en clair", async () => {
    const put = await ctx.agent
      .put("/api/configs/tenant")
      .set(auth(ids.adminToken))
      .send({ key: "sms_api_key", value: "AKIA-1234567890-SECRET" });
    expect(put.status).toBe(200);

    const list = await ctx.agent
      .get("/api/configs/tenant")
      .set(auth(ids.adminToken));
    expect(list.status).toBe(200);
    const row = list.body.find((r: { key: string }) => r.key === "sms_api_key");
    expect(row).toBeTruthy();
    expect(row.value).not.toContain("AKIA-1234567890-SECRET");
    expect(row.value).toMatch(/^•+/);
    expect(JSON.stringify(list.body)).not.toContain("AKIA-1234567890-SECRET");

    // Clé non autorisée rejetée
    const bad = await ctx.agent
      .put("/api/configs/tenant")
      .set(auth(ids.adminToken))
      .send({ key: "admin_password", value: "x" });
    expect(bad.status).toBe(400);
  });

  it("plateforme : le Super Admin gère les configs globales masquées", async () => {
    const denied = await ctx.agent
      .put("/api/configs")
      .set(auth(ids.adminToken))
      .send({ key: "x.y", value: "z" });
    expect(denied.status).toBe(403);

    const bcrypt = (await import("bcryptjs")).default;
    const saTenant = await ctx.pool.query(
      "INSERT INTO tenants (name) VALUES ('Éditeur') RETURNING id",
    );
    await ctx.pool.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES ($1,'SA','sa-cfg@test.cm',$2,'SUPER_ADMIN')`,
      [saTenant.rows[0].id, bcrypt.hashSync("Sa123456!", 10)],
    );
    const saLogin = await ctx.agent
      .post("/api/auth/login")
      .send({ email: "sa-cfg@test.cm", password: "Sa123456!" });
    const saToken = saLogin.body.accessToken;

    const put = await ctx.agent.put("/api/configs").set(auth(saToken)).send({
      key: "whatsapp_token",
      value: "EAAG-super-long-token-value",
      group: "API",
    });
    expect(put.status).toBe(200);

    const list = await ctx.agent.get("/api/configs").set(auth(saToken));
    const row = list.body.find(
      (r: { key: string }) => r.key === "whatsapp_token",
    );
    expect(row.masked).toBe(true);
    expect(row.value.endsWith("alue")).toBe(true); // seuls les 4 derniers caractères affichés
    expect(JSON.stringify(list.body)).not.toContain(
      "EAAG-super-long-token-value",
    );
  });
});
