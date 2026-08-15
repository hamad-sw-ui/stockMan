import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  seedTenant,
  receiveStock,
  TestContext,
  SeedIds,
} from "./helpers/app";

/**
 * D3 — CSV complémentaires : import/export clients & fournisseurs (miroir du
 * pattern produits : en-têtes tolérants, upsert, compteurs + lignes rejetées
 * avec motif) et export CSV du journal des ventes (RBAC vendeur = ses ventes).
 */

let ctx: TestContext;
let ids: SeedIds;
const auth = (t?: string) => ({
  Authorization: `Bearer ${t ?? ids.adminToken}`,
});
const sendCsv = (url: string, csv: string, token?: string) =>
  ctx.agent
    .post(url)
    .set(auth(token))
    .set("Content-Type", "text/csv")
    .send(csv);

describe("D3 — CSV clients, fournisseurs et journal des ventes", () => {
  beforeAll(async () => {
    ctx = await createTestContext();
    ids = await seedTenant(ctx);
  });
  afterAll(() => destroyTestContext(ctx));

  it("clients : import crée les fiches, ligne fautive rejetée avec motif", async () => {
    const csv = [
      "Nom;Téléphone;Email;Adresse;Plafond crédit;Canal prix;Notes",
      "Mme Aïcha Mbarga;699112233;aicha@example.cm;Mvog-Ada;50000;gros;Cliente fidèle",
      "Boulangerie Le Fournil;;contact@fournil.cm;;;;",
      "Sans Nom ;;;;pasunmontant;;;", // → plafond illisible
      ";699000000;;;;;;", // → nom manquant
    ].join("\r\n");
    const r = await sendCsv("/api/customers/import", csv);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.created).toBe(2);
    expect(r.body.updated).toBe(0);
    expect(r.body.errors).toHaveLength(2);
    expect(r.body.errors[0].ligne).toBe(4);
    expect(r.body.errors[0].message).toContain("Plafond");
    expect(r.body.errors[1].message).toContain("Nom");

    const c = await ctx.pool.query(
      `SELECT credit_limit::float AS l, price_channel AS ch FROM customers
        WHERE tenant_id=$1 AND name='Mme Aïcha Mbarga'`,
      [ids.tenantId],
    );
    expect(c.rows[0].l).toBe(50000);
    expect(c.rows[0].ch).toBe("WHOLESALE"); // « gros » compris
  });

  it("clients : ré-import = mise à jour par téléphone (aucun doublon)", async () => {
    const csv = [
      "Nom;Téléphone;Plafond crédit",
      "Mme A. Mbarga (nouvelle adresse);699112233;75000",
    ].join("\r\n");
    const r = await sendCsv("/api/customers/import", csv);
    expect(r.body.created).toBe(0);
    expect(r.body.updated).toBe(1);
    const n = await ctx.pool.query(
      `SELECT COUNT(*)::int AS n FROM customers WHERE tenant_id=$1 AND phone='699112233'`,
      [ids.tenantId],
    );
    expect(n.rows[0].n).toBe(1);
    const c = await ctx.pool.query(
      `SELECT credit_limit::float AS l FROM customers
        WHERE tenant_id=$1 AND phone='699112233'`,
      [ids.tenantId],
    );
    expect(c.rows[0].l).toBe(75000);
  });

  it("clients : export CSV (en-têtes FR + contenu), import refusé au vendeur", async () => {
    const r = await ctx.agent.get("/api/customers/export/csv").set(auth());
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.text).toContain('"Nom";"Téléphone";"Email"');
    expect(r.text).toContain("Aïcha Mbarga");
    expect(r.text).toContain("75000");
    expect(
      (await sendCsv("/api/customers/import", "Nom\nX", ids.vendorToken))
        .status,
    ).toBe(403);
  });

  it("fournisseurs : import (en-têtes FR tolérants) + upsert par nom", async () => {
    const csv = [
      "Nom;Email;Téléphone;Adresse;Délai livraison (jours);Notes",
      "Brasseries du Littoral;contact@brasslitt.cm;677889900;Bonabéri;7;Compte pro",
      "Quincaillerie Centrale;;;;3;",
    ].join("\r\n");
    const r = await sendCsv("/api/suppliers/import", csv);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.created).toBe(2);
    // Ré-import avec délai modifié : update, pas de doublon
    const r2 = await sendCsv(
      "/api/suppliers/import",
      "Nom;Délai\nBrasseries du Littoral;5",
    );
    expect(r2.body.updated).toBe(1);
    const s = await ctx.pool.query(
      `SELECT default_lead_time_days AS d FROM suppliers
        WHERE tenant_id=$1 AND name='Brasseries du Littoral'`,
      [ids.tenantId],
    );
    expect(s.rows[0].d).toBe(5);
    const n = await ctx.pool.query(
      `SELECT COUNT(*)::int AS n FROM suppliers WHERE tenant_id=$1`,
      [ids.tenantId],
    );
    expect(n.rows[0].n).toBe(2);
  });

  it("fournisseurs : export CSV", async () => {
    const r = await ctx.agent.get("/api/suppliers/export/csv").set(auth());
    expect(r.status).toBe(200);
    expect(r.text).toContain("Délai livraison");
    expect(r.text).toContain("Brasseries du Littoral");
    expect(r.text).toContain(';"5";');
  });

  it("ventes : export CSV du journal (admin = tout, vendeur = ses ventes)", async () => {
    // Une vente admin et une vente vendeur pour vérifier le filtrage RBAC.
    await receiveStock(ctx, ids, 20);
    const v1 = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 2 }],
        paymentMethod: "CASH",
      });
    expect(v1.status, JSON.stringify(v1.body)).toBe(201);
    const v2 = await ctx.agent
      .post("/api/sales")
      .set(auth())
      .send({
        depotId: ids.depotId,
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);

    const all = await ctx.agent.get("/api/sales/export/csv").set(auth());
    expect(all.status).toBe(200);
    expect(all.text).toContain('"Date";"Ticket";"Client";"Vendeur"');
    const today = new Date().toISOString().slice(0, 10);
    const filtered = await ctx.agent
      .get(`/api/sales/export/csv?from=${today}&to=${today}`)
      .set(auth());
    const lines = filtered.text.trim().split("\r\n");
    expect(lines.length).toBe(3); // en-tête + 2 ventes du jour
    expect(filtered.text).toContain("SOLDÉE");

    const mine = await ctx.agent
      .get("/api/sales/export/csv")
      .set(auth(ids.vendorToken));
    const mineLines = mine.text.trim().split("\r\n");
    expect(mineLines.length).toBe(2); // en-tête + sa seule vente
    expect(mine.text).toContain("Vendeur Test");
  });
});
