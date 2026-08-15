import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  seedTenant,
  TestContext,
  SeedIds,
} from "./helpers/app";

/**
 * C5 — Codes à pesée côté serveur : drapeau produit `is_weighed`, préférence
 * tenant `barcode_weighted_mode` (OFF/PRICE/WEIGHT validée) et exposition en
 * bootstrap de caisse (le décodage GS1 20–29 est embarqué, hors-ligne).
 * Matrice : docs/06_AUDIT_PRO_CODE_BARRES.md § C5.
 */
describe("C5 — Codes à pesée (flag produit + config + bootstrap caisse)", () => {
  let ctx: TestContext;
  let ids: SeedIds;
  const auth = (t?: string) => ({
    Authorization: `Bearer ${t ?? ids.adminToken}`,
  });

  beforeAll(async () => {
    ctx = await createTestContext();
    ids = await seedTenant(ctx);
  });
  afterAll(() => destroyTestContext(ctx));

  it("par défaut : bootstrap en mode OFF et produits non marqués", async () => {
    const boot = await ctx.agent
      .get("/api/pos/bootstrap")
      .set(auth(ids.vendorToken));
    expect(boot.status).toBe(200);
    expect(boot.body.weightedMode).toBe("OFF");
    const p = boot.body.products.find(
      (x: { id: string }) => x.id === ids.productId,
    );
    expect(p.is_weighed).toBe(false);
  });

  it("la préférence barcode_weighted_mode est validée (valeur libre refusée)", async () => {
    const bad = await ctx.agent
      .put("/api/configs/tenant")
      .set(auth())
      .send({ key: "barcode_weighted_mode", value: "GRAMMES" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("CONFIG_VALUE_INVALID");
  });

  it("mode PRICE enregistré puis exposé au bootstrap de caisse", async () => {
    const put = await ctx.agent
      .put("/api/configs/tenant")
      .set(auth())
      .send({ key: "barcode_weighted_mode", value: "PRICE" });
    expect(put.status).toBe(200);
    const boot = await ctx.agent
      .get("/api/pos/bootstrap")
      .set(auth(ids.vendorToken));
    expect(boot.body.weightedMode).toBe("PRICE");
    // WEIGHT fonctionne pareil (bascule libre)
    await ctx.agent
      .put("/api/configs/tenant")
      .set(auth())
      .send({ key: "barcode_weighted_mode", value: "WEIGHT" });
    const boot2 = await ctx.agent
      .get("/api/pos/bootstrap")
      .set(auth(ids.vendorToken));
    expect(boot2.body.weightedMode).toBe("WEIGHT");
  });

  it("article à pesée : création, lecture fiche et exposition bootstrap", async () => {
    const created = await ctx.agent.post("/api/products").set(auth()).send({
      name: "Poulet entier (balance)",
      // Code article balance à 7 chiffres (préfixe 26 + article 00123) —
      // accepté par le validateur (alphabet Code 128 / pas de checksum 13).
      barcode: "2600123",
      purchasePrice: 2200,
      sellingPrice: 3000,
      unitId: ids.unitId,
      categoryId: ids.categoryId,
      isWeighed: true,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.is_weighed).toBe(true);
    const id: string = created.body.id;

    const detail = await ctx.agent.get(`/api/products/${id}`).set(auth());
    expect(detail.body.is_weighed).toBe(true);

    const boot = await ctx.agent
      .get("/api/pos/bootstrap")
      .set(auth(ids.vendorToken));
    const p = boot.body.products.find((x: { id: string }) => x.id === id);
    expect(p.is_weighed).toBe(true);
    expect(p.barcode).toBe("2600123");
  });

  it("PATCH : le drapeau peut être retiré sans toucher au reste", async () => {
    const created = await ctx.agent.post("/api/products").set(auth()).send({
      name: "Viande hachée (balance)",
      barcode: "2100456",
      sellingPrice: 4500,
      unitId: ids.unitId,
      isWeighed: true,
    });
    expect(created.status).toBe(201);
    const id: string = created.body.id;
    const patch = await ctx.agent
      .patch(`/api/products/${id}`)
      .set(auth())
      .send({ isWeighed: false });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.is_weighed).toBe(false);
    expect(patch.body.barcode).toBe("2100456"); // inchangé
  });

  it("deux codes article balance distincts cohabitent (unicité respectée)", async () => {
    const dup = await ctx.agent.post("/api/products").set(auth()).send({
      name: "Copieur du poulet",
      barcode: "2600123", // déjà pris par « Poulet entier (balance) »
      sellingPrice: 100,
      isWeighed: true,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("BARCODE_TAKEN");
  });
});
