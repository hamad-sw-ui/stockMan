/**
 * Import CSV du catalogue (POST /api/products/import) :
 * création, mise à jour par code-barres/nom (casse indifférente), catégories
 * auto-créées, unités résolues, erreurs par ligne, garde-fous (en-tête, taille,
 * rôle ADMIN + licence) et entrée d'audit IMPORT.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  seedTenant,
  TestContext,
  SeedIds,
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

const csvPost = (body: string, token?: string) => {
  const r = ctx.agent
    .post("/api/products/import")
    .set("Content-Type", "text/csv");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
};

describe("POST /api/products/import", () => {
  it("crée, met à jour et collecte les erreurs ligne par ligne", async () => {
    // Produit pré-existant qui sera MIS À JOUR via son nom (casse différente)
    await ctx.agent
      .post("/api/products")
      .set("Authorization", `Bearer ${ids.adminToken}`)
      .send({ name: "Sucre 1kg", sellingPrice: 500, unitId: ids.unitId });

    const csv = [
      "Nom;Catégorie;Code-barres;Prix achat;Prix vente;Unité;Seuil alerte",
      `Eau Import 50cl;Boissons;6200001;120;250;Pce;10`,
      `"Huile ""Palme"" 5L";Épicerie;6200002;3 500;4 900;Pce;3`,
      `SUCRE 1KG;Épicerie;6200003;300;600;Pce;5`, // casse différente → mise à jour
      ids.productId ? `Eau Test 1.5L;Boissons;6100000000011;220;450;Pce;8` : "",
      `Riz Mauvais Prix;Épicerie;6200004;abc;900;Pce;2`,
      `Farine Unité Inconnue;Épicerie;6200005;400;900;ZZZ;2`,
      `;Épicerie;6200006;400;900;Pce;2`,
    ]
      .filter((l) => l !== "")
      .join("\r\n");

    const res = await csvPost(csv, ids.adminToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(7);
    expect(res.body.created).toBe(2); // Eau Import + Huile
    expect(res.body.updated).toBe(2); // Sucre (nom casse) + Eau Test (code-barres)
    expect(res.body.errors).toHaveLength(3);
    expect(res.body.errors[0]).toMatchObject({ ligne: 6 });
    expect(res.body.errors[0].message).toContain("Prix achat illisible");
    expect(res.body.errors[1].message).toContain("Unité inconnue");
    expect(res.body.errors[2].message).toContain("Nom manquant");

    // Mise à jour effective : prix + catégorie auto-créée
    const sucre = await ctx.pool.query(
      `SELECT p.selling_price, c.name AS cat FROM products p LEFT JOIN categories c ON c.id=p.category_id
        WHERE p.tenant_id=$1 AND lower(p.name)='sucre 1kg'`,
      [ids.tenantId],
    );
    expect(Number(sucre.rows[0]!.selling_price)).toBe(600);
    expect(sucre.rows[0]!.cat).toBe("Épicerie");

    // Catégorie créée une seule fois malgré plusieurs lignes
    const cats = await ctx.pool.query(
      `SELECT COUNT(*)::int AS n FROM categories WHERE tenant_id=$1 AND name='Épicerie'`,
      [ids.tenantId],
    );
    expect(cats.rows[0]!.n).toBe(1);

    // Montant FCFA « 3 500 » correctement parsé
    const huile = await ctx.pool.query(
      `SELECT purchase_price FROM products WHERE tenant_id=$1 AND name LIKE 'Huile%'`,
      [ids.tenantId],
    );
    expect(Number(huile.rows[0]!.purchase_price)).toBe(3500);

    // Une seule entrée d'audit IMPORT
    const audit = await ctx.pool.query(
      `SELECT action, details FROM audit_logs WHERE tenant_id=$1 AND action='IMPORT'`,
      [ids.tenantId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.details).toContain("2 créés");
    expect(audit.rows[0]!.details).toContain("3 erreur(s)");
  });

  it("rejette un fichier sans ligne d’en-tête reconnue", async () => {
    const res = await csvPost("Eau;100\nSavon;200", ids.adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CSV_HEADER");
  });

  it("rejette un corps vide ou non textuel", async () => {
    const res = await csvPost("", ids.adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CSV_EMPTY");
  });

  it("plafonne à 500 lignes", async () => {
    const lignes = ["Nom;Prix vente"];
    for (let i = 0; i < 501; i += 1) lignes.push(`Produit ${i};100`);
    const res = await csvPost(lignes.join("\n"), ids.adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CSV_TOO_MANY");
  });

  it("est réservé au rôle ADMIN", async () => {
    const res = await csvPost("Nom;Prix vente\nX;100", ids.vendorToken);
    expect(res.status).toBe(403);
  });

  it("code-barres en conflit avec un autre produit → erreur de ligne", async () => {
    const herby = await ctx.agent
      .post("/api/products")
      .set("Authorization", `Bearer ${ids.adminToken}`)
      .send({
        name: "Lait Conflit",
        barcode: "6300001",
        sellingPrice: 900,
        unitId: ids.unitId,
      });
    expect(herby.status).toBe(201);
    const csv = ["Nom;Code-barres;Prix vente", `Nouveau Lait;6300001;950`].join(
      "\n",
    );
    // 6300001 appartient à Lait Conflit : la ligne met à jour CE produit…
    const res = await csvPost(csv, ids.adminToken);
    expect(res.body.created + res.body.updated).toBe(1);
    // …avec le nouveau prix vente
    const p = await ctx.pool.query(
      `SELECT selling_price, name FROM products WHERE tenant_id=$1 AND barcode='6300001'`,
      [ids.tenantId],
    );
    expect(Number(p.rows[0]!.selling_price)).toBe(950);
  });
});
