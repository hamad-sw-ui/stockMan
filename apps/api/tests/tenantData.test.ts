import crypto from "crypto";
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
 * D1/D2 — Export intégral & restauration des données du tenant (docs/07) :
 * ACL + manifeste + exclusions de sécurité (jamais password_hash ni secrets),
 * preview sans écriture, round-trip export→destruction→replace à l'identique,
 * reprise des séquences, rabattement des utilisateurs inconnus, transaction
 * tout-ou-rien sur ligne corrompue, journal d'audit EXPORT/IMPORT.
 */

let ctx: TestContext;
let ids: SeedIds;
const auth = (t?: string) => ({
  Authorization: `Bearer ${t ?? ids.adminToken}`,
});
/** Snapshot capturé à l'état « boutique pleine » (partagé entre les tests,
 *  l'ordre du describe est volontaire). */
let snapshot: {
  format: string;
  version: number;
  tenant: { name: string | null };
  counts: Record<string, number>;
  data: Record<string, Array<Record<string, unknown>>>;
};

/** Compte les lignes du tenant — les tables sans tenant_id passent par le
 *  produit parent (stock_levels, stock_batches…). */
const countTable = async (table: string) => {
  if (["stock_levels", "stock_batches"].includes(table)) {
    const prods = await ctx.pool.query(
      `SELECT id FROM products WHERE tenant_id=$1`,
      [ids.tenantId],
    );
    if (prods.rows.length === 0) return 0;
    const list = prods.rows.map((p) => `'${p.id}'`).join(",");
    const r = await ctx.pool.query(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE product_id IN (${list})`,
    );
    return r.rows[0].n as number;
  }
  const r = await ctx.pool.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id=$1`,
    [ids.tenantId],
  );
  return r.rows[0].n as number;
};

describe("D1/D2 — Export & restauration des données du tenant", () => {
  beforeAll(async () => {
    ctx = await createTestContext();
    ids = await seedTenant(ctx);
    // Boutique « pleine » : stock + un code interne généré (séquence) + secret.
    await receiveStock(ctx, ids, 10);
    const gen = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth())
      .send({ productId: ids.productId });
    expect(gen.status).toBe(201);
    await ctx.pool.query(
      `INSERT INTO tenant_configs (tenant_id, key, value, is_secret)
       VALUES ($1,'sms_api_key','TOPSECRET-NE-JAMAIS-EXPORTER',true)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value=EXCLUDED.value, is_secret=true`,
      [ids.tenantId],
    );
  });
  afterAll(() => destroyTestContext(ctx));

  it("vendeur : export et import refusés (403)", async () => {
    const v = { Authorization: `Bearer ${ids.vendorToken}` };
    expect((await ctx.agent.get("/api/tenant/export").set(v)).status).toBe(403);
    expect(
      (await ctx.agent.post("/api/tenant/import").set(v).send({})).status,
    ).toBe(403);
  });

  it("export D1 : manifeste conforme, compteurs exacts vs base", async () => {
    const r = await ctx.agent.get("/api/tenant/export").set(auth());
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("application/json");
    expect(r.headers["content-disposition"]).toContain("stockman-export-");
    snapshot = r.body;
    expect(snapshot.format).toBe("stockman-export");
    expect(snapshot.version).toBe(1);
    expect(snapshot.tenant.name).toBe("SARL Test");
    // Sections clés présentes et compteurs = réalité SQL
    for (const t of ["products", "stock_levels", "depots", "units"]) {
      expect(snapshot.data[t], `section ${t}`).toBeDefined();
      expect(snapshot.counts[t]).toBe(await countTable(t));
    }
    expect(snapshot.counts.products).toBeGreaterThanOrEqual(1);
    // Séquences exportées (reprise de numérotation à la restauration)
    expect(snapshot.counts.barcode_sequences).toBe(1);
  });

  it("export D1 : aucun secret ne fuit (password_hash, clé SMS)", async () => {
    const blob = JSON.stringify(snapshot);
    expect(blob).not.toContain("password_hash");
    expect(blob).not.toContain("TOPSECRET-NE-JAMAIS-EXPORTER");
    expect(blob).not.toContain("sms_api_key");
    expect(blob).not.toContain("refresh_token");
    // tables exclues par conception
    expect(snapshot.data.users).toBeUndefined();
    expect(snapshot.data.audit_logs).toBeUndefined();
    expect(snapshot.data.licenses).toBeUndefined();
  });

  it("preview D2 : rapport détaillé… et AUCUNE écriture", async () => {
    const before = await countTable("products");
    const r = await ctx.agent
      .post("/api/tenant/import?mode=preview")
      .set(auth())
      .send(snapshot);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.mode).toBe("preview");
    expect(r.body.report.ok).toBe(true);
    expect(r.body.report.tables.products).toBe(snapshot.counts.products);
    expect(r.body.report.remappedUserRefs).toBe(0); // mêmes comptes : rien à rabattre
    expect(await countTable("products")).toBe(before);
  });

  it("refus net : mauvais marqueur, mauvaise version, colonne tordue", async () => {
    const bad1 = await ctx.agent
      .post("/api/tenant/import?mode=preview")
      .set(auth())
      .send({ hello: "world" });
    expect(bad1.status).toBe(400);
    expect(bad1.body.error.code).toBe("IMPORT_FORMAT");

    const bad2 = await ctx.agent
      .post("/api/tenant/import?mode=preview")
      .set(auth())
      .send({ ...snapshot, version: 99 });
    expect(bad2.status).toBe(400);
    expect(bad2.body.error.code).toBe("IMPORT_VERSION");

    const twisted = JSON.parse(JSON.stringify(snapshot));
    twisted.data.products[0]["drop table"]; // clé illégale
    twisted.data.products[0]["drop table"] = 1;
    const bad3 = await ctx.agent
      .post("/api/tenant/import?mode=preview")
      .set(auth())
      .send(twisted);
    expect(bad3.status).toBe(400);
    expect(bad3.body.error.code).toBe("IMPORT_FORMAT");
  });

  it("round-trip : destruction volontaire puis restauration à l'identique", async () => {
    // État de référence : 10 pièces en stock, 1 produit, séquence à 2.
    expect(snapshot.counts.products).toBe(1);
    // ☠️ Destruction ciblée, dans l'ordre FK (les RESTRICT sur les FK vers
    // products exigent de vider d'abord mouvements/réceptions) — simule la
    // casse que la restauration doit intégralement réparer.
    await ctx.pool.query(`DELETE FROM stock_movements WHERE tenant_id=$1`, [
      ids.tenantId,
    ]);
    await ctx.pool.query(`DELETE FROM stock_receipts WHERE tenant_id=$1`, [
      ids.tenantId,
    ]);
    await ctx.pool.query(`DELETE FROM products WHERE tenant_id=$1`, [
      ids.tenantId,
    ]);
    await ctx.pool.query(`DELETE FROM barcode_sequences WHERE tenant_id=$1`, [
      ids.tenantId,
    ]);
    expect(await countTable("products")).toBe(0);
    expect(await countTable("stock_levels")).toBe(0); // cascadé

    const r = await ctx.agent
      .post("/api/tenant/import?mode=replace")
      .set(auth())
      .send(snapshot);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.mode).toBe("replace");
    expect(r.body.report.applied).toBe(true);

    // Tout est revenu à l'identique (compteurs + contenu)
    for (const t of [
      "products",
      "depots",
      "units",
      "categories",
      "product_barcodes",
      "barcode_sequences",
      "stock_levels",
      "stock_batches",
      "stock_movements",
      "stock_receipts",
    ]) {
      expect(await countTable(t), t).toBe(snapshot.counts[t]);
    }
    // Configs NON secrètes restaurées (les secrets, eux, sont restés en place)
    const nonSecret = await ctx.pool.query(
      `SELECT COUNT(*)::int AS n FROM tenant_configs
        WHERE tenant_id=$1 AND is_secret=false`,
      [ids.tenantId],
    );
    expect(nonSecret.rows[0].n).toBe(snapshot.counts.tenant_configs);
    const lvl = await ctx.pool.query(
      `SELECT quantity::float AS q FROM stock_levels
        WHERE product_id=$1 AND depot_id=$2`,
      [ids.productId, ids.depotId],
    );
    expect(lvl.rows[0].q).toBe(10);
    const seq = await ctx.pool.query(
      `SELECT next_value::int AS n FROM barcode_sequences WHERE tenant_id=$1`,
      [ids.tenantId],
    );
    expect(seq.rows[0].n).toBe(2); // séquence restaurée
    // Le secret n'a PAS été écrasé (les secrets ne voyagent jamais)
    const sec = await ctx.pool.query(
      `SELECT value FROM tenant_configs WHERE tenant_id=$1 AND key='sms_api_key'`,
      [ids.tenantId],
    );
    expect(sec.rows[0]?.value).toBe("TOPSECRET-NE-JAMAIS-EXPORTER");
  });

  it("sécurité post-restauration : le générateur EAN re-tire sur collision", async () => {
    // La séquence restaurée dit « prochain = 2 » mais le code de série 2…
    // n'existe plus (registre restauré) : le tirage doit donner 2 sans heurt.
    const gen = await ctx.agent
      .post("/api/products/barcodes/generate")
      .set(auth())
      .send({ productId: ids.productId });
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);
    expect(gen.body.code).toMatch(/^2\d{12}$/);
  });

  it("rabattement utilisateur : vendeur inconnu → admin important", async () => {
    // Fichier modifié : la réception référence un utilisateur d'ailleurs.
    const clone = JSON.parse(JSON.stringify(snapshot));
    const stranger = crypto.randomUUID();
    for (const row of clone.data.stock_receipts) row.received_by = stranger;
    const pre = await ctx.agent
      .post("/api/tenant/import?mode=preview")
      .set(auth())
      .send(clone);
    expect(pre.status).toBe(200);
    expect(pre.body.report.remappedUserRefs).toBe(1);

    // On 💥 vide puis on restaure le fichier « étranger » :
    await ctx.pool.query(`DELETE FROM stock_receipts WHERE tenant_id=$1`, [
      ids.tenantId,
    ]);
    const rep = await ctx.agent
      .post("/api/tenant/import?mode=replace")
      .set(auth())
      .send(clone);
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    const r2 = await ctx.pool.query(
      `SELECT received_by FROM stock_receipts WHERE tenant_id=$1 LIMIT 1`,
      [ids.tenantId],
    );
    expect(r2.rows[0].received_by).toBe(ids.adminId);
  });

  it("ligne corrompue : 400 IMPORT_ROW_INVALID et RIEN n'a bougé", async () => {
    const broken = JSON.parse(JSON.stringify(snapshot));
    broken.data.products[0].id = "pas-un-uuid";
    const before = await countTable("products");
    const r = await ctx.agent
      .post("/api/tenant/import?mode=replace")
      .set(auth())
      .send(broken);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("IMPORT_ROW_INVALID");
    expect(r.body.error.message).toContain("aucune donnée n'a été modifiée");
    expect(await countTable("products")).toBe(before); // rollback total
    const lvl = await ctx.pool.query(
      `SELECT quantity::float AS q FROM stock_levels
        WHERE product_id=$1 AND depot_id=$2`,
      [ids.productId, ids.depotId],
    );
    expect(lvl.rows[0].q).toBe(10);
  });

  it("journal d'audit : EXPORT et IMPORT tracés", async () => {
    const r = await ctx.pool.query(
      `SELECT action, COUNT(*)::int AS n FROM audit_logs
        WHERE tenant_id=$1 AND action IN ('EXPORT','IMPORT') GROUP BY action`,
      [ids.tenantId],
    );
    const by = Object.fromEntries(
      r.rows.map((x) => [x.action as string, x.n as number]),
    );
    expect(by.EXPORT ?? 0).toBeGreaterThanOrEqual(1);
    expect(by.IMPORT ?? 0).toBeGreaterThanOrEqual(1);
  });
});
