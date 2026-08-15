/**
 * Phase C2 — génération interne de codes-barres (docs/06) :
 * EAN-13 plage magasin 20–29, séquence atomique par tenant (pattern
 * invoice_sequences), re-tirage sur collision, préfixe réglable,
 * promotion « principal » quand la cible n'a pas encore de code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  seedTenant,
  TestContext,
  SeedIds,
} from "./helpers/app";
import { ean13ChecksumApi } from "../src/lib/barcode";

let ctx: TestContext;
let a: SeedIds; // tenant principal
let b: SeedIds; // tenant indépendant (séquence propre)

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** EAN-13 interne valide sur la plage magasin 20–29. */
const expectInternalEan = (code: string, prefix = "20") => {
  expect(code).toMatch(/^2[0-9]\d{11}$/);
  expect(code.startsWith(prefix)).toBe(true);
  expect(ean13ChecksumApi(code.slice(0, 12))).toBe(Number(code[12]));
};
/** Les 10 chiffres de séquence embarqués dans le code. */
const serialOf = (code: string) => Number(code.slice(2, 12));

beforeAll(async () => {
  ctx = await createTestContext();
  a = await seedTenant(ctx);
  b = await seedTenant(ctx);
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

async function mkProduct(token: string, name: string, extra: object = {}) {
  const r = await ctx.agent
    .post("/api/products")
    .set(auth(token))
    .send({ name, sellingPrice: 100, ...extra });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

describe("POST /api/products/barcodes/generate", () => {
  it("cible SANS code : le tirage devient le code principal (miroir legacy)", async () => {
    const pid = await mkProduct(a.adminToken, "Miel Local 500g");
    const r = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth(a.adminToken))
      .send({ productId: pid });
    expect(r.status).toBe(201);
    expectInternalEan(r.body.code);
    expect(r.body.source).toBe("GENERATED");
    expect(r.body.symbology).toBe("EAN13");
    expect(r.body.is_primary).toBe(true);

    // Write-through : la colonne legacy ET le résolveur produit répondent.
    const fresh = await ctx.agent
      .get(`/api/products/${pid}`)
      .set(auth(a.adminToken));
    expect(fresh.body.barcode).toBe(r.body.code);
    const look = await ctx.agent
      .get(`/api/products/lookup/${r.body.code}`)
      .set(auth(a.vendorToken));
    expect(look.status).toBe(200);
    expect(look.body.matched).toBe("product");
    expect(look.body.productName).toBe("Miel Local 500g");
  });

  it("cible DÉJÀ codée : alias GENERATED supplémentaire (principal intact)", async () => {
    const r = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth(a.adminToken))
      .send({ productId: a.productId }); // le seed a déjà 6100000000018
    expect(r.status).toBe(201);
    expect(r.body.is_primary).toBe(false);
    expectInternalEan(r.body.code);
    const look = await ctx.agent
      .get(`/api/products/lookup/${r.body.code}`)
      .set(auth(a.vendorToken));
    expect(look.body.matched).toBe("alias");
    // Le principal n'a pas bougé :
    const list = await ctx.agent
      .get(`/api/products/${a.productId}/barcodes`)
      .set(auth(a.adminToken));
    const primary = list.body.rows.find(
      (x: { is_primary: boolean }) => x.is_primary,
    );
    expect(primary.code).toBe("6100000000018");
  });

  it("la séquence est croissante et ne repasse jamais deux fois", async () => {
    const p1 = await mkProduct(a.adminToken, "Seq A1");
    const p2 = await mkProduct(a.adminToken, "Seq A2");
    const codes: string[] = [];
    for (const pid of [p1, p2, a.productId]) {
      const r = await ctx.agent
        .post("/api/products/barcodes/generate")
        .set(auth(a.adminToken))
        .send({ productId: pid });
      codes.push(r.body.code as string);
    }
    const serials = codes.map(serialOf);
    expect(new Set(codes).size).toBe(3);
    expect(serials[1]).toBeGreaterThan(serials[0]!);
    expect(serials[2]).toBeGreaterThan(serials[1]!);
  });

  it("variante sans code : promotion principale sur la variante", async () => {
    const pid = await mkProduct(a.adminToken, "Tissu Coupon", {
      hasVariants: true,
      variants: [{ name: "2 m" }, { name: "5 m" }],
    });
    const detail = await ctx.agent
      .get(`/api/products/${pid}`)
      .set(auth(a.adminToken));
    const variant = detail.body.variants.find(
      (v: { name: string }) => v.name === "5 m",
    );
    const r = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth(a.adminToken))
      .send({ productId: pid, variantId: variant.id });
    expect(r.status).toBe(201);
    expect(r.body.is_primary).toBe(true);
    const look = await ctx.agent
      .get(`/api/products/lookup/${r.body.code}`)
      .set(auth(a.vendorToken));
    expect(look.body.matched).toBe("variant");
    expect(look.body.variantName).toBe("5 m");
  });

  it("unitId présent → jamais principal (alias de conditionnement net)", async () => {
    const pid = await mkProduct(a.adminToken, "Vrac Sans Code");
    const r = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth(a.adminToken))
      .send({ productId: pid, unitId: a.cartonId });
    expect(r.status).toBe(201);
    expect(r.body.is_primary).toBe(false);
    const look = await ctx.agent
      .get(`/api/products/lookup/${r.body.code}`)
      .set(auth(a.vendorToken));
    expect(look.body.matched).toBe("alias");
    expect(look.body.unitFactor).toBe(12);
  });

  it("deux postes en parallèle ne tirent JAMAIS le même code", async () => {
    const p1 = await mkProduct(a.adminToken, "Concurrence 1");
    const p2 = await mkProduct(a.adminToken, "Concurrence 2");
    const [r1, r2] = await Promise.all([
      ctx.agent
        .post("/api/products/barcodes/generate")
        .set(auth(a.adminToken))
        .send({ productId: p1 }),
      ctx.agent
        .post("/api/products/barcodes/generate")
        .set(auth(a.adminToken))
        .send({ productId: p2 }),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.code).not.toBe(r2.body.code);
  });

  it("collision injectée sur la prochaine valeur → re-tirage automatique", async () => {
    // Tenant B : séquence vierge → le prochain corps est 20 + 0000000001.
    const body = "200000000001";
    const collisionCode = `${body}${ean13ChecksumApi(body)}`;
    await mkProduct(b.adminToken, "Occupant", { barcode: collisionCode });
    const r = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth(b.adminToken))
      .send({ productId: b.productId });
    expect(r.status).toBe(201);
    expect(r.body.code).not.toBe(collisionCode);
    expect(serialOf(r.body.code)).toBe(2); // la valeur 1 a été sautée
    expectInternalEan(r.body.code);
  });

  it("chaque tenant possède SA séquence (B démarre à 1, indépendant de A)", async () => {
    const pid = await mkProduct(b.adminToken, "Produit B1");
    const r = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth(b.adminToken))
      .send({ productId: pid });
    expect(r.status).toBe(201);
    // La valeur 1 a été sautée ci-dessus (collision) → prochain libre = 3 ? Non :
    // la collision a consommé 1 puis tiré 2 ; ce tirage-ci consomme 3.
    expect(serialOf(r.body.code)).toBe(3);
    expect(r.body.code.startsWith("20")).toBe(true);
  });

  it("préfixe magasin personnalisé (config tenant 20–29, validation)", async () => {
    const bad = await ctx.agent
      .put("/api/configs/tenant")
      .set(auth(b.adminToken))
      .send({ key: "barcode_internal_prefix", value: "99" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("CONFIG_VALUE_INVALID");

    const ok = await ctx.agent
      .put("/api/configs/tenant")
      .set(auth(b.adminToken))
      .send({ key: "barcode_internal_prefix", value: "26" });
    expect(ok.status).toBe(200);
    const pid = await mkProduct(b.adminToken, "Produit B2");
    const r = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth(b.adminToken))
      .send({ productId: pid });
    expect(r.status).toBe(201);
    expectInternalEan(r.body.code, "26");
    // La séquence du nouveau préfixe démarre indépendamment de « 20 ».
    expect(serialOf(r.body.code)).toBe(1);
  });

  it("gardes : produit d'un autre tenant 404, variante tierce 400, vendeur 403", async () => {
    const alien = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth(b.adminToken))
      .send({ productId: a.productId });
    expect(alien.status).toBe(404);

    const pA = await mkProduct(a.adminToken, "Proprio Variante", {
      hasVariants: true,
      variants: [{ name: "X" }],
    });
    const vA = (
      await ctx.agent.get(`/api/products/${pA}`).set(auth(a.adminToken))
    ).body.variants[0].id;
    const cross = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth(a.adminToken))
      .send({ productId: a.productId, variantId: vA }); // variante d'ailleurs
    expect(cross.status).toBe(400);
    expect(cross.body.error.code).toBe("VARIANT_UNKNOWN");

    const vendor = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth(a.vendorToken))
      .send({ productId: a.productId });
    expect(vendor.status).toBe(403);
  });
});
