/** Actions groupées (Piste 3) :
 *  - POST /api/products/bulk-archive  (archivage en lot, journalisé)
 *  - POST /api/customers/bulk-remind   (relance en lot) */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  seedTenant,
  type TestContext,
  type SeedIds,
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

const auth = () => ({ Authorization: `Bearer ${ids.adminToken}` });

describe("POST /api/products/bulk-archive", () => {
  it("archive plusieurs produits actifs et renvoie le compte", async () => {
    const res = await ctx.agent
      .post("/api/products/bulk-archive")
      .set(auth())
      .send({ ids: [ids.productId] });
    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(1);

    // Idempotent : un second appel n'archive plus rien (déjà archivé).
    const again = await ctx.agent
      .post("/api/products/bulk-archive")
      .set(auth())
      .send({ ids: [ids.productId] });
    expect(again.status).toBe(200);
    expect(again.body.archived).toBe(0);
  });

  it("rejette un corps sans ids", async () => {
    const res = await ctx.agent
      .post("/api/products/bulk-archive")
      .set(auth())
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("exige le rôle ADMIN", async () => {
    const res = await ctx.agent
      .post("/api/products/bulk-archive")
      .set("Authorization", `Bearer ${ids.vendorToken}`)
      .send({ ids: [ids.productId] });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/customers/bulk-remind", () => {
  it("relance un client avec numéro, en saute un sans numéro", async () => {
    // Un client avec téléphone.
    const c1 = await ctx.agent
      .post("/api/customers")
      .set(auth())
      .send({ name: "Client Tel", phone: "+237612345678" });
    expect(c1.status).toBe(201);
    // Un client sans téléphone.
    const c2 = await ctx.agent
      .post("/api/customers")
      .set(auth())
      .send({ name: "Client Sans Tel" });
    expect(c2.status).toBe(201);

    const res = await ctx.agent
      .post("/api/customers/bulk-remind")
      .set(auth())
      .send({ ids: [c1.body.id, c2.body.id], channel: "SMS" });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.total).toBe(2);
  });

  it("rejette une liste vide", async () => {
    const res = await ctx.agent
      .post("/api/customers/bulk-remind")
      .set(auth())
      .send({ ids: [], channel: "SMS" });
    expect(res.status).toBe(400);
  });
});
