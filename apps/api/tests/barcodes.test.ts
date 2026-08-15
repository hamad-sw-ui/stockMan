/**
 * Système code-barres — phase C1 (docs/06_AUDIT_PRO_CODE_BARRES.md) :
 *  - résolveur unique GET /api/products/lookup/:code (produit > variante >
 *    alias/conditionnement), identique en compat sur l'ancien /barcode/:code ;
 *  - registre product_barcodes : alias fournisseurs + codes par
 *    conditionnement (facteur de conversion), write-through is_primary ;
 *  - garde d'unicité GLOBALE (produit | variante | alias) avec 409 qui NOMME
 *    le détenteur — comble l'absence historique d'unicité sur les variantes ;
 *  - validation GS1 côté serveur (EAN-13/EAN-8/UPC-A checksums, Code 39/128) ;
 *  - migration V011 : backfill des codes existants + dédoublonnage contrôlé.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { newDb, IMemoryDb, DataType } from "pg-mem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  seedTenant,
  TestContext,
  SeedIds,
} from "./helpers/app";
import { detectAndValidateBarcode } from "../src/lib/barcode";

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

// =====================================================================
// Résolveur (lookup enrichi + route legacy)
// =====================================================================
describe("GET /api/products/lookup/:code — résolveur C1", () => {
  it("trouve un produit par son code principal (facteur 1, infos prix/TVA)", async () => {
    const r = await ctx.agent
      .get("/api/products/lookup/6100000000018")
      .set(auth(ids.vendorToken));
    expect(r.status).toBe(200);
    expect(r.body.matched).toBe("product");
    expect(r.body.productId).toBe(ids.productId);
    expect(r.body.productName).toBe("Eau Test 1.5L");
    expect(r.body.sellingPrice).toBe(400);
    expect(r.body.unitFactor).toBe(1);
    expect(r.body.variantId).toBeNull();
    expect(r.body.taxRate).toBeCloseTo(19.25);
  });

  it("trouve une variante par son code principal (variante résolue)", async () => {
    const created = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({
        name: "Savon Lookup",
        sellingPrice: 300,
        hasVariants: true,
        variants: [
          { name: "Petit", barcode: "4006381333931" },
          { name: "Grand", barcode: "5901234123457" },
        ],
      });
    expect(created.status).toBe(201);
    const r = await ctx.agent
      .get("/api/products/lookup/4006381333931")
      .set(auth(ids.vendorToken));
    expect(r.status).toBe(200);
    expect(r.body.matched).toBe("variant");
    expect(r.body.variantName).toBe("Petit");
    expect(r.body.productName).toBe("Savon Lookup");
  });

  it("404 BARCODE_UNKNOWN sur code inconnu (lookup et legacy)", async () => {
    // 0000000000000 : EAN-13 à checksum valide mais inconnu du catalogue.
    const a = await ctx.agent
      .get("/api/products/lookup/0000000000000")
      .set(auth(ids.vendorToken));
    expect(a.status).toBe(404);
    expect(a.body.error.code).toBe("BARCODE_UNKNOWN");
    const b = await ctx.agent
      .get("/api/products/barcode/0000000000000")
      .set(auth(ids.vendorToken));
    expect(b.status).toBe(404);
    expect(b.body.error.code).toBe("BARCODE_UNKNOWN");
  });

  it("route legacy : forme historique + extensions conditionnement", async () => {
    const r = await ctx.agent
      .get("/api/products/barcode/6100000000018")
      .set(auth(ids.vendorToken));
    expect(r.status).toBe(200);
    expect(r.body.matched).toBe("product");
    expect(r.body.id).toBe(ids.productId);
    expect(r.body.unit_factor).toBe(1);
    expect(r.body.alias).toBe(false);
  });
});

// =====================================================================
// Registre d'alias (multi-codes, conditionnements, unicité globale)
// =====================================================================
describe("Registre product_barcodes — alias & unicité globale", () => {
  it("l'admin ajoute un alias fournisseur au produit ; le lookup le résout", async () => {
    const add = await ctx.agent
      .post(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.adminToken))
      .send({ code: "FOURNISSEUR-778", source: "SUPPLIER" });
    expect(add.status).toBe(201);
    expect(add.body.code).toBe("FOURNISSEUR-778");
    expect(add.body.is_primary).toBe(false);

    const look = await ctx.agent
      .get("/api/products/lookup/FOURNISSEUR-778")
      .set(auth(ids.vendorToken));
    expect(look.status).toBe(200);
    expect(look.body.matched).toBe("alias");
    expect(look.body.productId).toBe(ids.productId);

    // …et la route legacy DÉLÈGUE au résolveur : l'alias y répond aussi.
    const legacy = await ctx.agent
      .get("/api/products/barcode/FOURNISSEUR-778")
      .set(auth(ids.vendorToken));
    expect(legacy.status).toBe(200);
    expect(legacy.body.alias).toBe(true);
    expect(legacy.body.matched).toBe("product");
  });

  it("rejouer le même alias est idempotent (200 + l'existant, pas de doublon)", async () => {
    const again = await ctx.agent
      .post(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.adminToken))
      .send({ code: "FOURNISSEUR-778", source: "SUPPLIER" });
    expect(again.status).toBe(200);
    const list = await ctx.agent
      .get(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.adminToken));
    const rows = list.body.rows.filter(
      (x: { code: string }) => x.code === "FOURNISSEUR-778",
    );
    expect(rows).toHaveLength(1);
  });

  it("un alias de conditionnement (carton) renvoie le facteur de conversion", async () => {
    const add = await ctx.agent
      .post(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.adminToken))
      .send({ code: "5901234123457", unitId: ids.cartonId });
    // 5901234123457 déjà pris ci-dessus par la variante « Grand » → 409 (garde !)
    expect(add.status).toBe(409);
    const addOk = await ctx.agent
      .post(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.adminToken))
      .send({ code: "3760000000000", unitId: ids.cartonId });
    expect(addOk.status).toBe(201);
    const look = await ctx.agent
      .get("/api/products/lookup/3760000000000")
      .set(auth(ids.vendorToken));
    expect(look.status).toBe(200);
    expect(look.body.matched).toBe("alias");
    expect(look.body.unitSymbol).toBe("Ctn");
    expect(look.body.unitFactor).toBe(12); // scanner le carton = 12 pièces
  });

  it("un alias peut viser une variante précise", async () => {
    const product = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({
        name: "Huile Alias",
        sellingPrice: 1500,
        hasVariants: true,
        variants: [{ name: "5 L" }],
      });
    expect(product.status).toBe(201);
    const variantId = (
      await ctx.agent
        .get(`/api/products/${product.body.id}`)
        .set(auth(ids.adminToken))
    ).body.variants[0].id;
    const add = await ctx.agent
      .post(`/api/products/${product.body.id}/barcodes`)
      .set(auth(ids.adminToken))
      .send({ code: "3017620422003", variantId });
    expect(add.status).toBe(201);
    // 3017620422003 : Nutella — checksum réel valide.
    const look = await ctx.agent
      .get("/api/products/lookup/3017620422003")
      .set(auth(ids.vendorToken));
    expect(look.status).toBe(200);
    expect(look.body.matched).toBe("alias");
    expect(look.body.variantId).toBe(variantId);
    expect(look.body.variantName).toBe("5 L");
  });

  it("variante inconnue / unité inconnue → 400 explicites", async () => {
    const badVariant = await ctx.agent
      .post(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.adminToken))
      .send({ code: "998877661", variantId: crypto.randomUUID() });
    expect(badVariant.status).toBe(400);
    expect(badVariant.body.error.code).toBe("VARIANT_UNKNOWN");
    const badUnit = await ctx.agent
      .post(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.adminToken))
      .send({ code: "998877662", unitId: crypto.randomUUID() });
    expect(badUnit.status).toBe(400);
    expect(badUnit.body.error.code).toBe("UNIT_UNKNOWN");
  });

  it("un code déjà pris est refusé partout, en NOMMANT le détenteur", async () => {
    // 1. Création produit avec le code principal du seed :
    const p = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({ name: "Copieur", barcode: "6100000000018", sellingPrice: 100 });
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe("BARCODE_TAKEN");
    expect(p.body.error.message).toContain("Eau Test 1.5L");

    // 2. Création produit avec le code d'une variante existante :
    const v = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({ name: "Copieur 2", barcode: "4006381333931", sellingPrice: 100 });
    expect(v.status).toBe(409);
    expect(v.body.error.message).toContain("Savon Lookup");
    expect(v.body.error.message).toContain("Petit"); // la variante est citée

    // 3. Alias avec un code de colonne legacy :
    const a = await ctx.agent
      .post(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.adminToken))
      .send({ code: "4006381333931" });
    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe("BARCODE_TAKEN");

    // 4. PATCH variante vers le code d'autrui :
    const product = await ctx.agent
      .get(`/api/products/${ids.productId}`)
      .set(auth(ids.adminToken));
    void product; // (la route /:id reste couverte ailleurs)
    const savon = await ctx.pool.query(
      `SELECT v.id FROM product_variants v JOIN products p ON p.id=v.product_id
       WHERE p.tenant_id=$1 AND p.name='Savon Lookup' AND v.name='Grand'`,
      [ids.tenantId],
    );
    const patch = await ctx.agent
      .patch(`/api/products/variants/${savon.rows[0]!.id}`)
      .set(auth(ids.adminToken))
      .send({ barcode: "6100000000018" });
    expect(patch.status).toBe(409);
    expect(patch.body.error.message).toContain("Eau Test 1.5L");

    // 5. Import CSV : la ligne en conflit est rejetée avec le nom du détenteur.
    const csv = ["Nom;Code-barres;Prix vente", `Bidon;4006381333931;900`].join(
      "\n",
    );
    const imp = await ctx.agent
      .post("/api/products/import")
      .set("Content-Type", "text/csv")
      .set(auth(ids.adminToken))
      .send(csv);
    expect(imp.status).toBe(200);
    expect(imp.body.created).toBe(0);
    expect(imp.body.errors[0].message).toContain("Savon Lookup");
  });

  it("deux fois le même code dans le formulaire → 400 BARCODE_DUP_IN_FORM", async () => {
    const r = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({
        name: "Doublon Interne",
        sellingPrice: 100,
        hasVariants: true,
        variants: [
          { name: "A", barcode: "5449000000996" },
          { name: "B", barcode: "5449000000996" },
        ],
      });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("BARCODE_DUP_IN_FORM");
  });

  it("le code principal est listé, non supprimable ici ; l'alias, si", async () => {
    const list = await ctx.agent
      .get(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.vendorToken));
    expect(list.status).toBe(200);
    const primary = list.body.rows.find(
      (x: { code: string }) => x.code === "6100000000018",
    );
    expect(primary.is_primary).toBe(true);
    const refus = await ctx.agent
      .delete(`/api/products/barcodes/${primary.id}`)
      .set(auth(ids.adminToken));
    expect(refus.status).toBe(400);
    expect(refus.body.error.code).toBe("BARCODE_PRIMARY");

    const alias = list.body.rows.find(
      (x: { code: string }) => x.code === "FOURNISSEUR-778",
    );
    const del = await ctx.agent
      .delete(`/api/products/barcodes/${alias.id}`)
      .set(auth(ids.adminToken));
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
    const gone = await ctx.agent
      .get("/api/products/lookup/FOURNISSEUR-778")
      .set(auth(ids.vendorToken));
    expect(gone.status).toBe(404);

    // Audit CREATE + DELETE versés
    const audit = await ctx.pool.query(
      `SELECT action FROM audit_logs WHERE tenant_id=$1 AND entity='product_barcode' AND entity_id=$2 ORDER BY created_at`,
      [ids.tenantId, alias.id],
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      "CREATE",
      "DELETE",
    ]);
  });

  it("le rôle VENDEUR ne peut pas gérer les alias (403)", async () => {
    const r = await ctx.agent
      .post(`/api/products/${ids.productId}/barcodes`)
      .set(auth(ids.vendorToken))
      .send({ code: "VENDEUR-INTERDIT" });
    expect(r.status).toBe(403);
  });
});

// =====================================================================
// Write-through colonne legacy ⇄ registre
// =====================================================================
describe("Miroir is_primary (write-through)", () => {
  it("PATCH produit : nouveau code → miroir bascule ; null → retrait net", async () => {
    const p = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({
        name: "Miroir Produit",
        barcode: "3068320115009",
        sellingPrice: 10,
      });
    expect(p.status).toBe(201);
    const pid = p.body.id as string;
    const reg = async () =>
      (
        await ctx.pool.query(
          `SELECT code, is_primary FROM product_barcodes WHERE tenant_id=$1 AND product_id=$2 ORDER BY code`,
          [ids.tenantId, pid],
        )
      ).rows;
    expect(await reg()).toEqual([{ code: "3068320115009", is_primary: true }]);

    // Changement de code : l'ancien quitte le registre, le nouveau s'y pose.
    const ch = await ctx.agent
      .patch(`/api/products/${pid}`)
      .set(auth(ids.adminToken))
      .send({ barcode: "3024487000015" });
    expect(ch.status).toBe(200);
    expect(await reg()).toEqual([{ code: "3024487000015", is_primary: true }]);
    const old = await ctx.agent
      .get("/api/products/lookup/3068320115009")
      .set(auth(ids.vendorToken));
    expect(old.status).toBe(404);

    // Retrait explicite (null) : colonne ET miroir disparaissent.
    const off = await ctx.agent
      .patch(`/api/products/${pid}`)
      .set(auth(ids.adminToken))
      .send({ barcode: null });
    expect(off.status).toBe(200);
    expect(off.body.barcode).toBeNull();
    expect(await reg()).toEqual([]);
  });
});

// =====================================================================
// Validation GS1 (lib pure + garde API)
// =====================================================================
describe("Validation GS1 des formats (lib + API)", () => {
  it("détecte et contrôle EAN-13 / EAN-8 / UPC-A / Code 39 / Code 128", () => {
    expect(detectAndValidateBarcode("4006381333931")).toMatchObject({
      ok: true,
      symbology: "EAN13",
    });
    const bad = detectAndValidateBarcode("4006381333930");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("attendu 1");

    expect(detectAndValidateBarcode("96385074")).toMatchObject({
      ok: true,
      symbology: "EAN8",
    });
    expect(detectAndValidateBarcode("96385071").ok).toBe(false);

    // UPC-A valide → normalisé en EAN-13 avec note explicative.
    const upc = detectAndValidateBarcode("012345678905");
    expect(upc).toMatchObject({ ok: true, code: "0012345678905" });
    if (upc.ok) expect(upc.symbology).toBe("EAN13");
    if (upc.ok) expect(upc.note).toContain("UPC-A");

    // Code 39 : minuscules normalisées en majuscules.
    const c39 = detectAndValidateBarcode("abc-123");
    expect(c39).toMatchObject({
      ok: true,
      code: "ABC-123",
      symbology: "CODE39",
    });

    // Code 128 : ASCII imprimable hors alphabet 39 (accolades…).
    expect(detectAndValidateBarcode("lot{name}").ok).toBe(true);

    // Accents / caractères non imprimables : refus nets.
    expect(detectAndValidateBarcode("café-au-lait").ok).toBe(false);
    expect(detectAndValidateBarcode("").ok).toBe(false);
  });

  it("l'API refuse un checksum faux avec le chiffre attendu (400 BARCODE_INVALID)", async () => {
    const r = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({
        name: "Checksum Faux",
        barcode: "4006381333930",
        sellingPrice: 1,
      });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("BARCODE_INVALID");
    expect(r.body.error.message).toContain("attendu 1");

    const ok = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({ name: "EAN8 Valide", barcode: "96385074", sellingPrice: 1 });
    expect(ok.status).toBe(201);
    const look = await ctx.agent
      .get("/api/products/lookup/96385074")
      .set(auth(ids.vendorToken));
    expect(look.status).toBe(200);
    expect(look.body.matched).toBe("product");
  });

  it("UPC-A scanné est normalisé (EAN-13 avec 0 en tête) dès la création", async () => {
    const r = await ctx.agent
      .post("/api/products")
      .set(auth(ids.adminToken))
      .send({ name: "UPC Produit", barcode: "036000291452", sellingPrice: 2 });
    expect(r.status).toBe(201);
    expect(r.body.barcode).toBe("0036000291452");
    const look = await ctx.agent
      .get("/api/products/lookup/0036000291452")
      .set(auth(ids.vendorToken));
    expect(look.status).toBe(200);
  });
});

// =====================================================================
// Migration V011 sur base « legacy » (V001…V010 seule, données abîmées)
// =====================================================================
describe("Migration V011 — backfill & dédoublonnage contrôlé", () => {
  it("déduplique les codes variantes et réinjecte les codes principaux", async () => {
    const MIG_DIR = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "database",
      "migrations",
    );
    const db: IMemoryDb = newDb({ autoCreateForeignKeyIndices: true });
    db.registerExtension("pgcrypto", (schema) => {
      schema.registerFunction({
        name: "gen_random_uuid",
        returns: DataType.uuid,
        implementation: () => crypto.randomUUID(),
        impure: true,
      });
    });
    db.public.registerFunction({
      name: "gen_random_uuid",
      returns: DataType.uuid,
      implementation: () => crypto.randomUUID(),
      impure: true,
    });
    db.public.registerFunction({
      name: "length",
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (s: string | null) => (s == null ? null : s.length),
      impure: false,
    });
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const apply = (name: string) =>
      pool.query(fs.readFileSync(path.join(MIG_DIR, name), "utf8"));

    // Chaîne historique JUSQU'À V010 (base « legacy » sans le registre)
    for (const f of fs.readdirSync(MIG_DIR).sort()) {
      if (/^V(00[1-9]|010)__/.test(f)) await apply(f);
    }

    // Données legacy : un tenant, deux produits (un sans code), une paire de
    // variantes en doublon + une variante unique chez le MÊME tenant ; et le
    // même code chez un AUTRE tenant (légal : ne doit PAS être renommé).
    const t1 = (
      await pool.query(
        "INSERT INTO tenants (name) VALUES ('Legacy A') RETURNING id",
      )
    ).rows[0]!.id as string;
    const t2 = (
      await pool.query(
        "INSERT INTO tenants (name) VALUES ('Legacy B') RETURNING id",
      )
    ).rows[0]!.id as string;
    const p1 = (
      await pool.query(
        "INSERT INTO products (tenant_id, name, barcode) VALUES ($1,'Eau Legacy','4006381333931') RETURNING id",
        [t1],
      )
    ).rows[0]!.id as string;
    await pool.query(
      "INSERT INTO products (tenant_id, name) VALUES ($1,'Sans Code Legacy')",
      [t1],
    );
    const p2 = (
      await pool.query(
        "INSERT INTO products (tenant_id, name, barcode) VALUES ($1,'Eau Bis','4006381333931') RETURNING id",
        [t2],
      )
    ).rows[0]!.id as string;

    await pool.query(
      `INSERT INTO product_variants (product_id, name, barcode, created_at)
       VALUES ($1,'Aînée','DUP-CODE10','2024-01-01'), ($1,'Cadette','DUP-CODE10','2024-06-01'), ($1,'Solo','UNIQVARX1','2024-01-02')`,
      [p1],
    );
    // Même code chez le tenant B — doit survivre intact (unicité par tenant).
    await pool.query(
      `INSERT INTO product_variants (product_id, name, barcode, created_at)
       VALUES ($1,'Voisine','DUP-CODE10','2024-03-01')`,
      [p2],
    );

    // ← LA migration testée
    await apply("V011__codes_barres.sql");

    // Dédoublonnage INTRA-tenant : l'aînée conserve, la cadette est suffixée ;
    // la voisine d'un autre tenant n'est PAS touchée.
    const kept = await pool.query(
      "SELECT name FROM product_variants WHERE barcode='DUP-CODE10' ORDER BY name",
    );
    expect(kept.rows.map((r: { name: string }) => r.name)).toEqual([
      "Aînée",
      "Voisine",
    ]);
    const renamed = await pool.query(
      "SELECT name, barcode FROM product_variants WHERE name='Cadette'",
    );
    expect(renamed.rows[0]!.barcode).toMatch(/^DUP-CODE10-DUP-[0-9a-f]{8}$/);

    // Backfill tenant 1 : produit (EAN13 détecté) + 3 variantes (dont la
    // renommée, devenue son nouveau code principal).
    const rowsT1 = await pool.query(
      `SELECT code, symbology, is_primary, (variant_id IS NOT NULL) AS on_variant
         FROM product_barcodes WHERE tenant_id=$1 ORDER BY code`,
      [t1],
    );
    expect(rowsT1.rows).toEqual([
      {
        code: "4006381333931",
        symbology: "EAN13",
        is_primary: true,
        on_variant: false,
      },
      {
        code: "DUP-CODE10",
        symbology: "CODE39",
        is_primary: true,
        on_variant: true,
      },
      {
        code: renamed.rows[0]!.barcode,
        symbology: "CODE39",
        is_primary: true,
        on_variant: true,
      },
      {
        code: "UNIQVARX1",
        symbology: "CODE39",
        is_primary: true,
        on_variant: true,
      },
    ]);

    // Tenant B : même code produit, PAS de conflit (unicité par tenant).
    const rowsT2 = await pool.query(
      `SELECT code FROM product_barcodes WHERE tenant_id=$1 AND variant_id IS NULL`,
      [t2],
    );
    expect(rowsT2.rows).toEqual([{ code: "4006381333931" }]);

    // Garde-fou registre : doublon (tenant, code) impossible.
    await expect(
      pool.query(
        `INSERT INTO product_barcodes (tenant_id, product_id, code) VALUES ($1, $2, '4006381333931')`,
        [t1, p1],
      ),
    ).rejects.toThrow();

    db.backup();
  });
});
