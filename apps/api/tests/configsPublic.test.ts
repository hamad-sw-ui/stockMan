/** F4 — `/api/configs/public` : expose le numéro WhatsApp de support (clé
 *  système non-secrète) à tout utilisateur authentifié ; null tant que
 *  l'éditeur ne l'a pas renseigné. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  seedTenant,
  type TestContext,
} from "./helpers/app";

let ctx: TestContext;
let adminToken: string;

beforeAll(async () => {
  ctx = await createTestContext();
  const ids = await seedTenant(ctx);
  adminToken = ids.adminToken;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

describe("GET /api/configs/public", () => {
  it("renvoie supportWhatsapp=null quand la clé n'est pas renseignée", async () => {
    const res = await ctx.agent
      .get("/api/configs/public")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ supportWhatsapp: null });
  });

  it("renvoie le numéro configuré (non-secret) une fois renseigné", async () => {
    await ctx.pool.query(
      `INSERT INTO system_configs (key, value, "group", is_secret)
       VALUES ('support_whatsapp', '237612345678', 'SYSTEM', false)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    const res = await ctx.agent
      .get("/api/configs/public")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ supportWhatsapp: "237612345678" });
  });

  it("ne masque jamais une clé non-secrète (numéro lisible)", async () => {
    await ctx.pool.query(
      `UPDATE system_configs SET is_secret = true WHERE key = 'support_whatsapp'`,
    );
    // Revenons en non-secret pour le test précédent ne soit pas pollué.
    await ctx.pool.query(
      `UPDATE system_configs SET is_secret = false WHERE key = 'support_whatsapp'`,
    );
    const res = await ctx.agent
      .get("/api/configs/public")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.supportWhatsapp).toBe("237612345678");
  });

  it("exige une authentification", async () => {
    const res = await ctx.agent.get("/api/configs/public");
    expect(res.status).toBe(401);
  });
});
