#!/usr/bin/env node
/**
 * migrate-v1-to-v2.js — migrateur de données StockMan V1 → V2.
 *
 * La V1 du Schéma (database/legacy/database.sql + phases 3/4) partage les noms
 * de tables avec la V2 mais avec des structures incompatibles :
 *   - users.pin_code EN CLAIR        → users.pin_hash bcrypt (SEC-10) ;
 *   - UNIQUE(tenant_id, email)       → email globalement unique (connexion) ;
 *   - products dupliqués PAR DÉPÔT avec `quantity` et `expiration_date`
 *     embarqués                            → catalogue tenant + stock_levels +
 *                                            stock_batches (DAT-02/03/07) ;
 *   - licenses.plan_name libre       → licenses.plan_code → plans(code) ;
 *   - sales/sale_items sans colonnes d'idempotence ni unité de vente.
 *
 * Les migrations V2 utilisant CREATE TABLE IF NOT EXISTS, elles NO-OP sur une
 * base V1 : ce script fait d'abord les ALTER nécessaires, rejoue ensuite la
 * chaîne V001→V### pour créer les tables/index manquants, puis migre les
 * données de façon DÉTERMINISTE et ATOMIQUE (une seule transaction).
 *
 * Usage :
 *   DATABASE_URL=postgresql://… node scripts/migrate-v1-to-v2.js --check
 *   DATABASE_URL=postgresql://… node scripts/migrate-v1-to-v2.js --apply [--report chemin.json]
 *
 *   --check   (défaut) analyse en lecture seule : rapport d'écarts SANS rien écrire ;
 *   --apply   applique la migration dans UNE transaction (tout ou rien) ;
 *   --report  sauvegarde le rapport JSON (défaut : ./rapport-migration-v1-v2.json avec --apply).
 *
 * Codes de sortie : 0 succès · 1 erreur · 2 la base n'est pas une V1 (rien à faire).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** Correspondance des anciens libellés de licence vers les codes plans V2. */
const PLAN_ALIASES = {
  TRIAL: "TRIAL",
  ESSAI: "TRIAL",
  FREE: "TRIAL",
  GRATUIT: "TRIAL",
  DEMO: "TRIAL",
  BASIC: "BASIC",
  BASIQUE: "BASIC",
  STARTER: "BASIC",
  ESSENTIEL: "BASIC",
  PRO: "PRO",
  PROFESSIONNEL: "PRO",
  PREMIUM: "PRO",
  BUSINESS: "PRO",
};

/** Plans V2 garantis (identiques à database/seeds/001_plans.sql). */
const DEFAULT_PLANS = [
  { code: "TRIAL", name: "Essai gratuit", maxUsers: 2, maxDepots: 1, price: 0 },
  { code: "BASIC", name: "Basique", maxUsers: 5, maxDepots: 1, price: 5000 },
  {
    code: "PRO",
    name: "Professionnel",
    maxUsers: 20,
    maxDepots: 5,
    price: 15000,
  },
];

// ============================================================================
// Introspection (compatible pg-mem : information_schema uniquement)
// ============================================================================
async function listTables(q) {
  const r = await q.query(
    `SELECT table_name AS t FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  return new Set(r.rows.map((row) => row.t));
}

async function listColumns(q, table) {
  const r = await q.query(
    `SELECT column_name AS c, is_nullable AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return new Map(r.rows.map((row) => [row.c, row.n === "YES"]));
}

/** Détecte une base V1 : tables V1 présentes ET marqueurs structurels V1. */
async function detectState(q) {
  const tables = await listTables(q);
  const columns = new Map();
  for (const t of [
    "users",
    "products",
    "licenses",
    "sale_items",
    "audit_logs",
    "notifications",
    "stock_movements",
    "product_variants",
    "stock_batches",
    "suppliers",
    "units",
    "categories",
    "tenants",
    "depots",
    "sales",
  ]) {
    if (tables.has(t)) columns.set(t, await listColumns(q, t));
  }
  const markers = [];
  if (columns.get("users")?.has("pin_code"))
    markers.push("users.pin_code (PIN en clair)");
  if (columns.get("products")?.has("depot_id"))
    markers.push("products.depot_id (produit rattaché à un dépôt)");
  if (columns.get("products")?.has("quantity"))
    markers.push("products.quantity (stock sur la fiche produit)");
  if (columns.get("licenses")?.has("plan_name"))
    markers.push("licenses.plan_name (plan en texte libre)");
  // NB : audit_logs."timestamp" n'est PAS un marqueur — la colonne historique
  // est volontairement conservée après migration (données reportées dans created_at).
  return { tables, columns, v1: markers.length > 0, markers };
}

// ============================================================================
// Analyse en lecture seule — alimente le rapport d'écarts
// ============================================================================
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

async function analyze(q, state) {
  const r = {
    compteurs: {},
    conflits: { emails: [], codesBarres: [] },
    fusionProduits: [],
    plans: { mappages: [], aCreer: [] },
    alertes: [],
  };

  for (const t of [
    "tenants",
    "users",
    "depots",
    "products",
    "product_variants",
    "sales",
    "sale_items",
    "licenses",
    "suppliers",
    "stock_batches",
    "stock_movements",
    "audit_logs",
    "notifications",
  ]) {
    if (!state.tables.has(t)) continue;
    const c = await q.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    r.compteurs[t] = c.rows[0].n;
  }

  // Emails : unicité GLOBALE requise en V2 (clé de connexion).
  const users = await q.query(
    "SELECT id, tenant_id, email, created_at FROM users ORDER BY lower(email), created_at, id",
  );
  for (const [mail, rows] of groupBy(users.rows, (u) =>
    u.email.trim().toLowerCase(),
  )) {
    if (rows.length > 1) {
      r.conflits.emails.push({
        email: mail,
        comptes: rows.map((u) => ({ id: u.id, tenantId: u.tenant_id })),
        resolution: `conservé : ${rows[0].id} ; les autres sont désactivés et renommés`,
      });
    }
  }

  // Codes-barres produits : uq_products_barcode (tenant_id, barcode) en V2.
  const bc = await q.query(
    `SELECT tenant_id, barcode, id, created_at FROM products
      WHERE barcode IS NOT NULL ORDER BY tenant_id, barcode, created_at, id`,
  );
  for (const [key, rows] of groupBy(
    bc.rows,
    (p) => `${p.tenant_id}|${p.barcode}`,
  )) {
    if (rows.length > 1) {
      r.conflits.codesBarres.push({
        codeBarres: rows[0].barcode,
        produits: rows.map((p) => p.id),
        resolution:
          "conservé sur le plus ancien ; retiré des autres (fusion ou re-saisie)",
      });
    }
  }

  // Fusion des produits dupliqués (catalogue par dépôt → catalogue tenant).
  const prods = await q.query(
    "SELECT id, tenant_id, depot_id, name, barcode, quantity, expiration_date, created_at FROM products ORDER BY tenant_id, lower(name), created_at, id",
  );
  for (const [, rows] of groupBy(
    prods.rows,
    (p) => `${p.tenant_id}|${p.name.trim().toLowerCase()}`,
  )) {
    if (rows.length > 1) {
      r.fusionProduits.push({
        tenantId: rows[0].tenant_id,
        nom: rows[0].name,
        conserve: rows[0].id,
        absorbes: rows.slice(1).map((p) => ({
          id: p.id,
          depotId: p.depot_id,
          quantite: Number(p.quantity),
        })),
        quantiteTotale: rows.reduce((s, p) => s + Number(p.quantity ?? 0), 0),
      });
    }
  }

  // Licences : plan texte libre → code plan.
  if (state.columns.get("licenses")?.has("plan_name")) {
    const plans = await q.query(
      "SELECT DISTINCT plan_name FROM licenses ORDER BY plan_name",
    );
    for (const row of plans.rows) {
      const raw = String(row.plan_name ?? "").trim();
      const code = PLAN_ALIASES[raw.toUpperCase()] ?? null;
      r.plans.mappages.push({
        ancien: raw,
        codeV2:
          code ??
          raw
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "_")
            .slice(0, 30),
        creation: !code,
      });
      if (!code) r.plans.aCreer.push(raw);
    }
  }

  // PINs : ceux qui seront re-hachés / absents.
  if (state.columns.get("users")?.has("pin_code")) {
    const pins = await q.query("SELECT pin_code FROM users");
    const avec = pins.rows.filter(
      (u) => u.pin_code && String(u.pin_code).trim() !== "",
    ).length;
    r.pins = { rehaches: avec, absents: pins.rows.length - avec };
  }

  // Doublons d'unités / fournisseurs (contraintes uniques V2).
  for (const [table, champ] of [
    ["units", "name"],
    ["suppliers", "name"],
    ["categories", "name"],
  ]) {
    if (!state.tables.has(table)) continue;
    const rows = await q.query(
      `SELECT tenant_id, ${champ} AS n FROM "${table}" ORDER BY tenant_id, lower(${champ})`,
    );
    const d = [
      ...groupBy(
        rows.rows,
        (x) => `${x.tenant_id}|${String(x.n).trim().toLowerCase()}`,
      ),
    ].filter(([, g]) => g.length > 1);
    if (d.length > 0)
      r.alertes.push(
        `${table} : ${d.length} groupe(s) de doublons de « ${champ} » seront fusionnés.`,
      );
  }

  // Cohérence ventes V1 : articles sans base_qty.
  const si = await q.query("SELECT COUNT(*)::int AS n FROM sale_items");
  r.compteurs.sale_items = si.rows[0].n;
  r.ventes = { articlesACompleter: si.rows[0].n };

  return r;
}

// ============================================================================
// Application
// ============================================================================
async function addColumnIfMissing(q, state, table, column, ddl) {
  if (!state.tables.has(table)) return false;
  if (state.columns.get(table)?.has(column)) return false;
  await q.query(`ALTER TABLE "${table}" ADD COLUMN ${ddl}`);
  state.columns.get(table)?.set(column, true);
  return true;
}

/** Découpe un fichier SQL en instructions (chaîne simple, littéraux '…' et
 *  commentaires -- / *…* pris en compte ; suffisant pour nos migrations). */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const c2 = sql[i + 1];
    if (c === "'") {
      buf += c;
      i += 1;
      while (i < sql.length && sql[i] !== "'") {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        buf += sql[i];
        i += 1;
      }
      if (i < sql.length) {
        buf += sql[i];
        i += 1;
      }
      continue;
    }
    if (c === "-" && c2 === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && c2 === "*") {
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function runV2Migrations(q, migrationsDir, log) {
  const applied = [];
  const has = await listTables(q);
  if (!has.has("schema_migrations")) {
    await q.query(`CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^V\d+__.+\.sql$/.test(f))
    .sort();
  const existing = await q.query("SELECT version FROM schema_migrations");
  const done = new Set(existing.rows.map((r) => r.version));
  for (const f of files) {
    const version = f.split("__")[0];
    const content = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    const checksum = crypto.createHash("sha256").update(content).digest("hex");
    if (done.has(version)) continue;
    // Sur une base V1, la plupart des tables existent déjà : les CREATE TABLE
    // IF NOT EXISTS correspondants sont des no-op LÉGAUX — on les saute
    // explicitement (pg-mem ne sait pas évaluer ce no-op ; Postgres réel, lui,
    // les ignorerait aussi). Les CREATE INDEX / nouvelles tables passent tels quels.
    for (const stmt of splitStatements(content)) {
      const m = /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?/i.exec(stmt);
      if (m && (await listTables(q)).has(m[1])) continue;
      await q.query(stmt);
    }
    await q.query(
      "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1,$2,$3)",
      [version, f, checksum],
    );
    applied.push(f);
    log(`  ✔ chaîne V2 : ${f}`);
  }
  return applied;
}

async function applyMigration(q, { log, bcryptRounds = 10, migrationsDir }) {
  const state = await detectState(q);
  const baseline = await analyze(q, state);
  // Somme de contrôle du stock V1 (fiches produits + variantes) — à comparer
  // à la somme des stock_levels après migration.
  const stockAvant =
    Number(
      (
        await q.query(
          "SELECT COALESCE(SUM(quantity),0)::float AS q FROM products",
        )
      ).rows[0].q,
    ) +
    (state.columns.get("product_variants")?.has("quantity")
      ? Number(
          (
            await q.query(
              "SELECT COALESCE(SUM(quantity),0)::float AS q FROM product_variants",
            )
          ).rows[0].q,
        )
      : 0);
  const rapport = {
    genereLe: new Date().toISOString(),
    mode: "apply",
    base: "V1 (Schéma legacy)",
    etatInitial: baseline,
    actions: [],
    resultat: {},
  };
  const note = (msg) => {
    rapport.actions.push(msg);
    log(`  ✔ ${msg}`);
  };

  // ---- 1. Élévation de schéma des tables V1 (colonnes V2 manquantes) ------
  log("Étape 1/6 — élévation du Schéma des tables V1…");
  await addColumnIfMissing(q, state, "tenants", "phone", "phone VARCHAR(50)");
  await addColumnIfMissing(
    q,
    state,
    "tenants",
    "currency",
    "currency VARCHAR(10) NOT NULL DEFAULT 'FCFA'",
  );
  await addColumnIfMissing(
    q,
    state,
    "tenants",
    "timezone",
    "timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Douala'",
  );
  await addColumnIfMissing(
    q,
    state,
    "tenants",
    "updated_at",
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  );

  await q.query("UPDATE users SET is_active = TRUE WHERE is_active IS NULL");
  await addColumnIfMissing(q, state, "users", "pin_hash", "pin_hash TEXT");
  // L'unicité V1 (tenant_id, email) bloque le dédoublonnage global V2.
  await q.query(
    "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_id_email_key",
  );

  await addColumnIfMissing(
    q,
    state,
    "licenses",
    "plan_code",
    "plan_code VARCHAR(30)",
  );
  await addColumnIfMissing(q, state, "licenses", "notes", "notes TEXT");
  await addColumnIfMissing(
    q,
    state,
    "licenses",
    "created_at",
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  );
  await addColumnIfMissing(
    q,
    state,
    "licenses",
    "updated_at",
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  );

  await addColumnIfMissing(q, state, "products", "image_url", "image_url TEXT");
  await addColumnIfMissing(
    q,
    state,
    "products",
    "archived_at",
    "archived_at TIMESTAMPTZ",
  );
  await q.query(
    `UPDATE products SET purchase_price = 0 WHERE purchase_price IS NULL`,
  );
  await q.query(
    `UPDATE products SET selling_price = 0 WHERE selling_price IS NULL`,
  );
  await q.query(
    `UPDATE products SET min_stock_level = 0 WHERE min_stock_level IS NULL`,
  );

  await addColumnIfMissing(
    q,
    state,
    "sales",
    "status",
    "status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED'",
  );
  await addColumnIfMissing(
    q,
    state,
    "sales",
    "payment_reference",
    "payment_reference TEXT",
  );
  await addColumnIfMissing(
    q,
    state,
    "sales",
    "client_sale_id",
    "client_sale_id UUID",
  );
  await addColumnIfMissing(
    q,
    state,
    "sales",
    "synced_at",
    "synced_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  );

  // variant_id ne référence product_variants que si la phase 3 V1 était appliquée.
  const variantsDdl = state.tables.has("product_variants")
    ? "variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL"
    : "variant_id UUID";
  await addColumnIfMissing(q, state, "sale_items", "variant_id", variantsDdl);
  await addColumnIfMissing(
    q,
    state,
    "sale_items",
    "unit_id",
    "unit_id UUID REFERENCES units(id) ON DELETE SET NULL",
  );
  await addColumnIfMissing(
    q,
    state,
    "sale_items",
    "base_qty",
    "base_qty NUMERIC(15,2)",
  );

  if (state.columns.get("audit_logs")?.has("timestamp")) {
    await addColumnIfMissing(
      q,
      state,
      "audit_logs",
      "created_at",
      "created_at TIMESTAMPTZ",
    );
    await q.query(
      'UPDATE audit_logs SET created_at = "timestamp" WHERE created_at IS NULL',
    );
    await q.query(
      "UPDATE audit_logs SET created_at = now() WHERE created_at IS NULL",
    );
    note(
      'audit_logs : colonne "timestamp" reportée dans created_at (colonne historique conservée).',
    );
  }
  await addColumnIfMissing(
    q,
    state,
    "notifications",
    "dedupe_key",
    "dedupe_key TEXT",
  );
  await addColumnIfMissing(
    q,
    state,
    "system_configs",
    "is_secret",
    "is_secret BOOLEAN NOT NULL DEFAULT FALSE",
  );
  await addColumnIfMissing(
    q,
    state,
    "categories",
    "sort_order",
    "sort_order INTEGER NOT NULL DEFAULT 0",
  );
  await addColumnIfMissing(
    q,
    state,
    "categories",
    "created_at",
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  );
  await addColumnIfMissing(
    q,
    state,
    "units",
    "created_at",
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  );
  await q.query(
    "UPDATE units SET base_value = 1 WHERE base_value IS NULL OR base_value <= 0",
  );

  if (state.tables.has("suppliers")) {
    await addColumnIfMissing(q, state, "suppliers", "notes", "notes TEXT");
    await addColumnIfMissing(
      q,
      state,
      "suppliers",
      "updated_at",
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    );
  }
  if (state.tables.has("stock_batches")) {
    await addColumnIfMissing(
      q,
      state,
      "stock_batches",
      "depot_id",
      "depot_id UUID REFERENCES depots(id) ON DELETE SET NULL",
    );
    await addColumnIfMissing(
      q,
      state,
      "stock_batches",
      "variant_id",
      "variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL",
    );
    await addColumnIfMissing(
      q,
      state,
      "stock_batches",
      "received_date",
      "received_date DATE",
    );
    await q.query(
      "UPDATE stock_batches SET received_date = CURRENT_DATE WHERE received_date IS NULL",
    );
    // V1 phase 3 : expiry_date NOT NULL — la V2 accepte NULL (non périssable).
    await q
      .query("ALTER TABLE stock_batches ALTER COLUMN expiry_date DROP NOT NULL")
      .catch(() => undefined);
  }
  if (state.tables.has("stock_movements")) {
    // La V2 ajoute le type VOID (annulation de vente).
    await q.query(
      "ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check",
    );
    await q.query(`ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
      CHECK (type IN ('IN','OUT','TRANSFER','ADJUSTMENT','SALE','RETURN','DAMAGE','EXPIRED','VOID'))`);
    await q
      .query("ALTER TABLE stock_movements ALTER COLUMN user_id DROP NOT NULL")
      .catch(() => undefined);
  }
  note(
    "schéma V1 élevé aux colonnes V2 (ALTER TABLE additifs, aucune donnée supprimée à ce stade).",
  );

  // ---- 2. Pré-dédoublonnages requis AVANT les index uniques de la chaîne ---
  log("Étape 2/6 — normalisation des emails et codes-barres…");
  await q.query("UPDATE users SET email = lower(trim(email))");
  const us = await q.query(
    "SELECT id, tenant_id, email, created_at FROM users ORDER BY email, created_at, id",
  );
  let emailsDesactives = 0;
  for (const [, rows] of groupBy(us.rows, (u) => u.email)) {
    if (rows.length < 2) continue;
    for (const dup of rows.slice(1)) {
      // Le compte le plus ancien est conservé ; les doublons sont désactivés et
      // renommés de façon traçable : <email>+migre-<id8>.desactive
      const alias = `${dup.email}+migre-${dup.id.slice(0, 8)}.desactive`;
      await q.query(
        "UPDATE users SET email = $1, is_active = FALSE, updated_at = now() WHERE id = $2",
        [alias, dup.id],
      );
      emailsDesactives += 1;
    }
  }
  if (emailsDesactives > 0)
    note(
      `${emailsDesactives} compte(s) en doublon d'email désactivés (email suffixé « +migre-…』.desactive ») — un admin doit leur réattribuer un email réel.`,
    );

  const bcRows = await q.query(
    "SELECT id, tenant_id, barcode, created_at FROM products WHERE barcode IS NOT NULL ORDER BY tenant_id, barcode, created_at, id",
  );
  let codesNeutralises = 0;
  for (const [, rows] of groupBy(
    bcRows.rows,
    (p) => `${p.tenant_id}|${p.barcode}`,
  )) {
    if (rows.length < 2) continue;
    for (const dup of rows.slice(1)) {
      await q.query("UPDATE products SET barcode = NULL WHERE id = $1", [
        dup.id,
      ]);
      codesNeutralises += 1;
    }
  }
  if (codesNeutralises > 0)
    note(
      `${codesNeutralises} code(s)-barres en double neutralisés (conservé sur la fiche la plus ancienne ; détail dans le rapport).`,
    );

  // ---- 3. Chaîne V2 : tables/index/contraintes manquants ------------------
  log("Étape 3/6 — application de la chaîne de migrations V2…");
  const chaine = await runV2Migrations(
    q,
    migrationsDir ?? path.join(__dirname, "..", "database", "migrations"),
    log,
  );
  note(
    `chaîne V2 appliquée (${chaine.length} fichier(s)) — nouvelles tables : stock_levels, sale_returns, stock_receipts, stock_transfers, refresh_tokens, tenant_configs, notification_settings, plans…`,
  );

  // ---- 4. Migration des données ------------------------------------------
  log("Étape 4/6 — migration des données…");

  // 4a. PIN en clair → hash bcrypt (jamais l'inverse).
  let pins = 0;
  if (state.columns.get("users")?.has("pin_code")) {
    const rows = await q.query(
      "SELECT id, pin_code FROM users WHERE pin_code IS NOT NULL AND pin_hash IS NULL",
    );
    for (const u of rows.rows) {
      const pin = String(u.pin_code).trim();
      if (pin === "") continue;
      const hash = await bcrypt.hash(pin, bcryptRounds);
      await q.query(
        "UPDATE users SET pin_hash = $1, updated_at = now() WHERE id = $2",
        [hash, u.id],
      );
      pins += 1;
    }
    await q.query("ALTER TABLE users DROP COLUMN pin_code");
    note(
      `${pins} code(s) PIN re-hachés en bcrypt ; la colonne pin_code EN CLAIR est supprimée.`,
    );
  }
  rapport.resultat.pinsRehaches = pins;

  // 4b. Licences : plan libre → plan_code référencé.
  let plansCrees = [];
  if ((await listColumns(q, "licenses")).has("plan_name")) {
    for (const p of DEFAULT_PLANS) {
      await q.query(
        "INSERT INTO plans (code, name, max_users, max_depots, monthly_price) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING",
        [p.code, p.name, p.maxUsers, p.maxDepots, p.price],
      );
    }
    const distinct = await q.query(
      "SELECT DISTINCT plan_name, max_users, max_depots FROM licenses",
    );
    for (const row of distinct.rows) {
      const raw = String(row.plan_name ?? "").trim();
      let code = PLAN_ALIASES[raw.toUpperCase()] ?? null;
      if (!raw) code = "TRIAL"; // plan V1 vide → essai, le SA réattribuera
      if (!code) {
        code =
          raw
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 30) || "ANCIEN";
        await q.query(
          "INSERT INTO plans (code, name, max_users, max_depots, monthly_price) VALUES ($1,$2,$3,$4,0) ON CONFLICT (code) DO NOTHING",
          [
            code,
            `Ancien plan « ${raw} »`,
            row.max_users ?? 5,
            row.max_depots ?? 1,
          ],
        );
        plansCrees.push(code);
      }
      await q.query("UPDATE licenses SET plan_code = $1 WHERE plan_name = $2", [
        code,
        row.plan_name,
      ]);
    }
    await q.query(
      "UPDATE licenses SET plan_code = 'TRIAL' WHERE plan_code IS NULL",
    );
    await q.query("ALTER TABLE licenses ALTER COLUMN plan_code SET NOT NULL");
    await q.query("ALTER TABLE licenses DROP COLUMN plan_name");
    note(
      `licences rattachées aux codes plans V2${plansCrees.length ? ` ; plans créés pour correspondre : ${plansCrees.join(", ")}` : ""}.`,
    );
  }
  rapport.resultat.plansCrees = plansCrees;

  // 4c. Doublons d'unités / fournisseurs (unicité V2 par tenant).
  for (const [table, refCols] of [
    [
      "units",
      [
        ["products", "unit_id"],
        ["sale_items", "unit_id"],
      ],
    ],
    ["suppliers", [["stock_batches", "supplier_id"]]],
  ]) {
    if (!state.tables.has(table)) continue;
    const rows = await q.query(
      `SELECT id, tenant_id, name FROM "${table}" ORDER BY tenant_id, lower(name), id`,
    );
    let fusionnes = 0;
    for (const [, g] of groupBy(
      rows.rows,
      (x) => `${x.tenant_id}|${x.name.trim().toLowerCase()}`,
    )) {
      if (g.length < 2) continue;
      const canonique = g[0];
      for (const dup of g.slice(1)) {
        for (const [refTable, refCol] of refCols) {
          if (!(await listTables(q)).has(refTable)) continue;
          await q.query(
            `UPDATE "${refTable}" SET ${refCol} = $1 WHERE ${refCol} = $2`,
            [canonique.id, dup.id],
          );
        }
        await q.query(`DELETE FROM "${table}" WHERE id = $1`, [dup.id]);
        fusionnes += 1;
      }
    }
    await q
      .query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${table}_tenant_name ON "${table}" (tenant_id, lower(name))`,
      )
      .catch(async () => {
        // pg-mem ne sait pas indexer une expression lower() : index simple équivalent
        await q.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS uq_${table}_tenant_name ON "${table}" (tenant_id, name)`,
        );
      });
    if (fusionnes > 0)
      note(
        `${table} : ${fusionnes} doublon(s) de nom fusionnés (références réécrites).`,
      );
  }

  // 4d. Articles de vente : base_qty + unité historique.
  await q.query(
    "UPDATE sale_items SET base_qty = quantity WHERE base_qty IS NULL AND quantity > 0",
  );
  await q.query("UPDATE sale_items SET base_qty = 0.01 WHERE base_qty IS NULL");
  // Unité de vente historique = unité de base de la fiche produit (boucle JS :
  // portable Postgres réel comme pg-mem, pas d'UPDATE…FROM corrélé).
  const itemsSansUnite = await q.query(
    `SELECT si.id, p.unit_id FROM sale_items si JOIN products p ON p.id = si.product_id
      WHERE si.unit_id IS NULL AND p.unit_id IS NOT NULL`,
  );
  for (const it of itemsSansUnite.rows) {
    await q.query("UPDATE sale_items SET unit_id = $1 WHERE id = $2", [
      it.unit_id,
      it.id,
    ]);
  }
  await q.query("ALTER TABLE sale_items ALTER COLUMN base_qty SET NOT NULL");
  note(
    `sale_items : base_qty renseigné (= quantité vendue historique) ; l'unité de vente est reprise de la fiche produit (${itemsSansUnite.rows.length} article(s)).`,
  );

  // 4e. CŒUR : fusion des produits dupliqués + report du stock par dépôt.
  const prodRows = await q.query(
    "SELECT id, tenant_id, depot_id, name, barcode, quantity, expiration_date, created_at FROM products ORDER BY tenant_id, lower(name), created_at, id",
  );
  let produitsSupprimes = 0;
  let niveauxCrees = 0;
  let lotsCrees = 0;
  let mouvementsCrees = 0;
  for (const [, rows] of groupBy(
    prodRows.rows,
    (p) => `${p.tenant_id}|${p.name.trim().toLowerCase()}`,
  )) {
    const canonique = rows[0];
    // Barcode du canonique : si absent, récupérer celui d'un duplicata avant fusion.
    if (!canonique.barcode) {
      const donneur = rows.find((p) => p.barcode);
      if (donneur)
        await q.query(
          "UPDATE products SET barcode = $1 WHERE id = $2 AND barcode IS NULL",
          [donneur.barcode, canonique.id],
        );
    }
    for (const p of rows) {
      const depotId = p.depot_id;
      // Report du stock fiche-produit → stock_levels (produit, dépôt, sans variante).
      const qty = Number(p.quantity ?? 0);
      if (depotId && qty > 0) {
        const prev = await q.query(
          `SELECT quantity FROM stock_levels WHERE product_id=$1 AND depot_id=$2 AND variant_id IS NULL`,
          [canonique.id, depotId],
        );
        if (prev.rows[0]) {
          await q.query(
            "UPDATE stock_levels SET quantity = quantity + $3, updated_at = now() WHERE product_id=$1 AND depot_id=$2 AND variant_id IS NULL",
            [canonique.id, depotId, qty],
          );
        } else {
          await q.query(
            "INSERT INTO stock_levels (product_id, depot_id, variant_id, quantity) VALUES ($1,$2,NULL,$3)",
            [canonique.id, depotId, qty],
          );
          niveauxCrees += 1;
        }
        await q.query(
          `INSERT INTO stock_movements (tenant_id, depot_id, product_id, variant_id, user_id, type, quantity, previous_stock, new_stock, reason)
           VALUES ($1,$2,$3,NULL,NULL,'IN',$4,$5,$6,'Migration V1 — report de stock initial')`,
          [
            canonique.tenant_id,
            depotId,
            canonique.id,
            qty,
            Number(prev.rows[0]?.quantity ?? 0),
            Number(prev.rows[0]?.quantity ?? 0) + qty,
          ],
        );
        mouvementsCrees += 1;
        // Date d'expiration fiche-produit → lot FEFO « LOT-V1 ». Le numéro
        // inclut le dépôt : la même date sur 2 dépôts doit rester possible
        // (unicité V2 produit+variante+numéro).
        if (p.expiration_date) {
          await q.query(
            `INSERT INTO stock_batches (product_id, variant_id, depot_id, batch_number, quantity, expiry_date)
             VALUES ($1,NULL,$2,$3,$4,$5)`,
            [
              canonique.id,
              depotId,
              `LOT-V1-${String(depotId).slice(0, 8)}-${String(p.expiration_date).slice(0, 10)}`,
              qty,
              p.expiration_date,
            ],
          );
          lotsCrees += 1;
        }
      }
      if (p.id === canonique.id) continue;
      // Réécriture de toutes les références vers le produit conservé.
      await q.query(
        "UPDATE sale_items SET product_id = $1 WHERE product_id = $2",
        [canonique.id, p.id],
      );
      await q.query(
        "UPDATE stock_movements SET product_id = $1 WHERE product_id = $2",
        [canonique.id, p.id],
      );
      if (state.tables.has("product_variants")) {
        const vars = await q.query(
          "SELECT id, sku FROM product_variants WHERE product_id = $1",
          [p.id],
        );
        for (const v of vars.rows) {
          if (v.sku) {
            const clash = await q.query(
              "SELECT id FROM product_variants WHERE product_id = $1 AND sku = $2",
              [canonique.id, v.sku],
            );
            if (clash.rows[0])
              await q.query(
                "UPDATE product_variants SET sku = $1 WHERE id = $2",
                [`${v.sku}-v1-${v.id.slice(0, 6)}`, v.id],
              );
          }
          await q.query(
            "UPDATE product_variants SET product_id = $1 WHERE id = $2",
            [canonique.id, v.id],
          );
        }
      }
      if (state.tables.has("stock_batches")) {
        const batches = await q.query(
          "SELECT id, batch_number, variant_id FROM stock_batches WHERE product_id = $1",
          [p.id],
        );
        for (const b of batches.rows) {
          const existants = await q.query(
            "SELECT id, variant_id FROM stock_batches WHERE product_id = $1 AND batch_number = $2",
            [canonique.id, b.batch_number],
          );
          const clash = existants.rows.some(
            (e) =>
              String(e.variant_id ?? ZERO_UUID) ===
              String(b.variant_id ?? ZERO_UUID),
          );
          if (clash)
            await q.query(
              "UPDATE stock_batches SET batch_number = $1 WHERE id = $2",
              [`${b.batch_number}-v1`, b.id],
            );
          await q.query(
            "UPDATE stock_batches SET product_id = $1 WHERE id = $2",
            [canonique.id, b.id],
          );
        }
      }
      await q.query("DELETE FROM products WHERE id = $1", [p.id]);
      produitsSupprimes += 1;
    }
  }
  // Stock des variantes V1 (hors dépôt) → dépôt du produit parent.
  if (state.columns.get("product_variants")?.has("quantity")) {
    const vars = await q.query(
      `SELECT v.id, v.quantity, p.id AS pid, p.tenant_id, p.depot_id
         FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.quantity > 0`,
    );
    for (const v of vars.rows) {
      if (!v.depot_id) continue;
      await q.query(
        "INSERT INTO stock_levels (product_id, depot_id, variant_id, quantity) VALUES ($1,$2,$3,$4)",
        [v.pid, v.depot_id, v.id, Number(v.quantity)],
      );
      await q.query(
        `INSERT INTO stock_movements (tenant_id, depot_id, product_id, variant_id, user_id, type, quantity, previous_stock, new_stock, reason)
         VALUES ($1,$2,$3,$4,NULL,'IN',$5,0,$5,'Migration V1 — stock variante')`,
        [v.tenant_id, v.depot_id, v.pid, v.id, Number(v.quantity)],
      );
      niveauxCrees += 1;
      mouvementsCrees += 1;
    }
    await q.query("ALTER TABLE product_variants DROP COLUMN quantity");
  }
  // Colonnes V1 devenues inutiles sur la fiche produit (stock désormais par dépôt).
  await q.query("ALTER TABLE products DROP COLUMN IF EXISTS quantity");
  await q.query("ALTER TABLE products DROP COLUMN IF EXISTS expiration_date");
  await q.query("ALTER TABLE products DROP COLUMN depot_id");
  // has_variants recalculé depuis les variantes réelles (pas d'EXISTS corrélé).
  const avecVariantes = await q.query(
    "SELECT DISTINCT product_id FROM product_variants",
  );
  for (const row of avecVariantes.rows) {
    await q.query("UPDATE products SET has_variants = TRUE WHERE id = $1", [
      row.product_id,
    ]);
  }
  await q.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_products_tenant_name ON products (tenant_id, name)",
  );
  note(
    `catalogue fusionné : ${produitsSupprimes} fiche(s) en double absorbées, ${niveauxCrees} niveau(x) de stock par dépôt créés, ${lotsCrees} lot(s) « LOT-V1 » (dates d'expiration), ${mouvementsCrees} mouvement(s) « Migration V1 » tracés.`,
  );

  // ---- 5. Durcissements finaux --------------------------------------------
  log("Étape 5/6 — contraintes finales…");
  await q.query("UPDATE licenses SET status = 'TRIAL' WHERE status IS NULL");
  await q.query("ALTER TABLE users ALTER COLUMN email SET NOT NULL");
  // Trace d'audit par tenant (exigence DoD : mutation sensible journalisée).
  const tenants = await q.query("SELECT id FROM tenants");
  for (const t of tenants.rows) {
    await q.query(
      `INSERT INTO audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
       VALUES ($1, NULL, 'migrate-v1-to-v2', 'MIGRATION', 'system', 'v1-v2', $2)`,
      [
        t.id,
        `Migration V1→V2 : ${produitsSupprimes} produits fusionnés, ${niveauxCrees} niveaux de stock, ${pins} PIN re-hachés, ${emailsDesactives} emails désactivés.`,
      ],
    );
  }
  note("entrée « MIGRATION » écrite dans le journal d’audit de chaque tenant.");

  // ---- 6. Rapport -----------------------------------------------------------
  log("Étape 6/6 — mesures finales…");
  rapport.resultat.produitsApres = (
    await q.query("SELECT COUNT(*)::int AS n FROM products")
  ).rows[0].n;
  rapport.resultat.niveauxStockCrees = niveauxCrees;
  rapport.resultat.lotsCrees = lotsCrees;
  rapport.resultat.mouvementsCrees = mouvementsCrees;
  rapport.resultat.emailsDesactives = emailsDesactives;
  rapport.resultat.codesBarresNeutralises = codesNeutralises;
  rapport.resultat.chaineV2 = chaine;
  const stockApres = Number(
    (
      await q.query(
        "SELECT COALESCE(SUM(quantity),0)::float AS q FROM stock_levels",
      )
    ).rows[0].q,
  );
  rapport.resultat.sommeControleStock = {
    v1: stockAvant,
    v2StockLevels: stockApres,
    identiques: Math.abs(stockApres - stockAvant) < 0.001,
  };
  return rapport;
}

// ============================================================================
// CLI
// ============================================================================
function printReport(rapport, out = console.log) {
  out("\n════════════ RAPPORT DE MIGRATION V1 → V2 ════════════");
  out(`Mode : ${rapport.mode} · Généré le ${rapport.genereLe}`);
  if (rapport.etatInitiale || rapport.etatInitial) {
    const e = rapport.etatInitial;
    out("\n— État initial —");
    out(
      `  Compteurs : ${
        Object.entries(e.compteurs)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ") || "(aucune table V1)"
      }`,
    );
    if (e.pins)
      out(
        `  PIN : ${e.pins.rehaches} à re-hacher, ${e.pins.absents} absents (à définir par un admin).`,
      );
    out(`  Produits à fusionner : ${e.fusionProduits.length} groupe(s).`);
    for (const f of e.fusionProduits.slice(0, 10)) {
      out(
        `    • « ${f.nom} » : conservation ${f.conserve.slice(0, 8)}… + ${f.absorbes.length} doublon(s) (stock total ${f.quantiteTotale})`,
      );
    }
    if (e.fusionProduits.length > 10)
      out(`    … et ${e.fusionProduits.length - 10} autre(s) groupe(s).`);
    out(
      `  Conflits d'emails : ${e.conflits.emails.length} · conflits de codes-barres : ${e.conflits.codesBarres.length}`,
    );
    if (e.plans.mappages.length)
      out(
        `  Licences : ${e.plans.mappages.map((m) => `« ${m.ancien} »→${m.codeV2}${m.creation ? " (création)" : ""}`).join(", ")}`,
      );
    for (const a of e.alertes) out(`  ⚠ ${a}`);
  }
  if (rapport.actions) {
    out("\n— Actions réalisées —");
    for (const a of rapport.actions) out(`  ✔ ${a}`);
    out("\n— Résultat —");
    for (const [k, v] of Object.entries(rapport.resultat)) {
      if (typeof v === "object") out(`  ${k} : ${JSON.stringify(v)}`);
      else out(`  ${k} : ${v}`);
    }
  }
  out("═══════════════════════════════════════════════════════\n");
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const reportIdx = args.indexOf("--report");
  const reportPath =
    reportIdx >= 0
      ? args[reportIdx + 1]
      : apply
        ? path.join(process.cwd(), "rapport-migration-v1-v2.json")
        : null;

  if (!process.env.DATABASE_URL) {
    console.error(
      "✖ DATABASE_URL est requis (postgresql://user:pass@host:5432/base).",
    );
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const log = (m) => console.log(m);
  try {
    const client = await pool.connect();
    try {
      const state = await detectState(client);
      if (!state.v1) {
        const hasV2 = state.tables.has("stock_levels");
        console.log(
          hasV2
            ? "ℹ Base déjà au Schéma V2 (stock_levels présent, aucun marqueur V1) — rien à faire."
            : "ℹ Aucun marqueur V1 détecté. Pour une base vide, utilisez : npm run migrate",
        );
        process.exitCode = 2;
        return;
      }
      console.log(`V1 détectée : ${state.markers.join(" · ")}`);
      if (!apply) {
        const analyse = await analyze(client, state);
        const rapport = {
          genereLe: new Date().toISOString(),
          mode: "check",
          etatInitial: analyse,
        };
        printReport(rapport);
        if (reportPath)
          fs.writeFileSync(reportPath, JSON.stringify(rapport, null, 2));
        console.log(
          "Analyse en lecture seule terminée. Relancez avec --apply pour appliquer.",
        );
        return;
      }
      console.log(
        "Application de la migration dans UNE transaction (tout ou rien)…",
      );
      await client.query("BEGIN");
      let rapport;
      try {
        rapport = await applyMigration(client, {
          log,
          bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
        });
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
      printReport(rapport);
      if (reportPath) {
        fs.writeFileSync(reportPath, JSON.stringify(rapport, null, 2));
        console.log(`📄 Rapport JSON enregistré : ${reportPath}`);
        console.log(
          "   → Faites-le valider par le gérant (stocks reportés, emails désactivés).",
        );
      }
      console.log("✔ Migration V1 → V2 terminée.");
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("✖ Échec de la migration :", err.message);
    console.error("  Aucune donnée n’a été modifiée (transaction annulée).");
    process.exit(1);
  });
}

module.exports = { detectState, analyze, applyMigration, printReport };
