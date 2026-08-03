import crypto from "crypto";
import { newDb, IMemoryDb, DataType } from "pg-mem";
import type { Pool } from "pg";
import request from "supertest";

/**
 * Base de test en mémoire (pg-mem). Le schéma V2 réel est appliqué par le
 * runner de migrations de production — la chaîne SQL est ainsi couverte par
 * les tests unitaires ET par la CI sur une vraie Postgres.
 */
import { setPool, closePool } from "../../src/config/db";
import { applyMigrations } from "../../src/db/migrations";
import { buildApp } from "../../src/app";

export interface TestContext {
  db: IMemoryDb;
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  agent: ReturnType<typeof request.agent>;
}

/** Fonctions/utilitaires absents de pg-mem, enregistrés pour parité. */
function registerShims(db: IMemoryDb) {
  db.registerExtension("pgcrypto", (schema) => {
    schema.registerFunction({
      name: "gen_random_uuid",
      returns: DataType.uuid,
      implementation: () => crypto.randomUUID(),
      impure: true,
    });
  });
  const { public: pub } = db;
  pub.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  pub.registerFunction({
    name: "pg_try_advisory_lock",
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
    impure: true,
  });
  pub.registerFunction({
    name: "pg_advisory_unlock",
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
    impure: true,
  });

  // --- Transactions SQL réelles (BEGIN/COMMIT/ROLLBACK) --------------------
  // L'adaptateur pg de pg-mem exécute chaque client.query() dans un contexte
  // NEUF : le BEGIN fourché n'est jamais repris par les requêtes suivantes —
  // le ROLLBACK devenait lettre morte et les écritures d'une transaction
  // échouée FUAIENT en base de test (bug masqué pendant longtemps, démasqué
  // par la garde STOCK_RESERVED d'E8). On implémente donc la sémantique
  // transactionnelle via les points de restauration natifs (pile pour le
  // cas — rare — de transactions imbriquées).
  const snapshots: Array<{ restore(): void }> = [];
  pub.interceptQueries((sql) => {
    const stmt = sql.trim().replace(/;+$/, "").toUpperCase();
    if (stmt === "BEGIN" || stmt === "START TRANSACTION") {
      snapshots.push(db.backup());
      return [];
    }
    if (stmt === "COMMIT" || stmt === "END") {
      snapshots.pop(); // engagé : le point de restauration est libéré
      return [];
    }
    if (stmt === "ROLLBACK" || stmt === "ABORT") {
      const snap = snapshots.pop();
      if (snap) snap.restore();
      return [];
    }
    return null; // exécution normale
  });
}

export async function createTestContext(): Promise<TestContext> {
  process.env.NODE_ENV = "test";
  const db = newDb({ autoCreateForeignKeyIndices: true });
  registerShims(db);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  setPool(pool as unknown as Pool);
  await applyMigrations();
  // Plans commerciaux (mêmes valeurs que database/seeds/001_plans.sql, appliqué
  // par la CI sur une vraie Postgres) — requis par la FK licenses.plan_code.
  await pool.query(
    `INSERT INTO plans (code, name, max_users, max_depots, monthly_price) VALUES
       ('TRIAL', 'Essai gratuit', 2, 1, 0),
       ('BASIC', 'Basique', 5, 1, 5000),
       ('PRO', 'Professionnel', 20, 5, 15000)
     ON CONFLICT (code) DO NOTHING`,
  );
  const app = buildApp();
  return { db, pool, app, agent: request.agent(app) };
}

export async function destroyTestContext(ctx: TestContext): Promise<void> {
  await closePool();
  setPool(undefined);
  ctx.db.backup(); // libère les structures internes
}

export interface SeedIds {
  adminToken: string;
  adminId: string;
  tenantId: string;
  depotId: string;
  vendorToken: string;
  vendorId: string;
  unitId: string;
  cartonId: string;
  categoryId: string;
  productId: string;
}

/** Jeu de données complet via l'API (couvre register/login/créations). */
export async function seedTenant(ctx: TestContext): Promise<SeedIds> {
  const { agent, pool } = ctx;
  const email = `admin-${crypto.randomUUID().slice(0, 8)}@test.cm`;
  const password = "Passw0rd!";

  const reg = await agent.post("/api/auth/register").send({
    tenantName: "SARL Test",
    userName: "Admin Test",
    email,
    password,
  });
  if (reg.status !== 201)
    throw new Error("register échoué: " + JSON.stringify(reg.body));
  const adminToken: string = reg.body.accessToken;
  const adminId: string = reg.body.user.id;
  const tenantId: string = reg.body.user.tenantId;

  const auth = { Authorization: `Bearer ${adminToken}` };

  const depots = await agent.get("/api/depots").set(auth);
  const depotId: string = depots.body[0].id;

  const units = await agent.get("/api/units").set(auth);
  const unitId: string = units.body.find(
    (u: { symbol: string }) => u.symbol === "Pce",
  ).id;
  const cartonId: string = units.body.find(
    (u: { symbol: string }) => u.symbol === "Ctn",
  ).id;

  const cat = await agent
    .post("/api/categories")
    .set(auth)
    .send({ name: "Boissons" });
  const categoryId: string = cat.body.id;

  // Vendeur affecté au dépôt (PIN 4321)
  const vendor = await agent
    .post("/api/users")
    .set(auth)
    .send({
      name: "Vendeur Test",
      email: `vendeur-${crypto.randomUUID().slice(0, 8)}@test.cm`,
      role: "VENDEUR",
      depotId,
      password: "Vendeur1!",
      pin: "4321",
    });
  if (vendor.status !== 201)
    throw new Error("création vendeur: " + JSON.stringify(vendor.body));
  const vendorEmail: string = vendor.body.email;
  const vendorId: string = vendor.body.id;
  // TRIAL = 2 utilisateurs max → la création du vendeur peut buter sur le plafond licence ;
  // on élargit la licence en SQL pour les seeds volumineuses.
  await pool.query(
    "UPDATE licenses SET max_users = 50, max_depots = 10 WHERE tenant_id=$1",
    [tenantId],
  );

  const vLogin = await agent
    .post("/api/auth/login")
    .send({ email: vendorEmail, password: "Vendeur1!" });
  const vendorToken: string = vLogin.body.accessToken;

  // Produit sans stock initial (le stock arrive via réceptions)
  const prod = await agent.post("/api/products").set(auth).send({
    name: "Eau Test 1.5L",
    barcode: "6100000000011",
    purchasePrice: 200,
    sellingPrice: 400,
    minStockLevel: 5,
    unitId,
    categoryId,
  });
  if (prod.status !== 201)
    throw new Error("création produit: " + JSON.stringify(prod.body));
  const productId: string = prod.body.id;

  return {
    adminToken,
    adminId,
    tenantId,
    depotId,
    vendorToken,
    vendorId,
    unitId,
    cartonId,
    categoryId,
    productId,
  };
}

/** Réceptionne du stock sur le produit (avec lot optionnel). */
export async function receiveStock(
  ctx: TestContext,
  ids: SeedIds,
  quantity: number,
  opts: {
    unitId?: string;
    batchNumber?: string;
    expiryDate?: string;
    depotId?: string;
  } = {},
): Promise<void> {
  const res = await ctx.agent
    .post("/api/stock/receipts")
    .set("Authorization", `Bearer ${ids.adminToken}`)
    .send({
      depotId: opts.depotId ?? ids.depotId,
      reference: "TEST-RCV",
      items: [
        {
          productId: ids.productId,
          quantity,
          unitId: opts.unitId ?? ids.unitId,
          unitCost: 200,
          batchNumber: opts.batchNumber,
          expiryDate: opts.expiryDate,
        },
      ],
    });
  if (res.status !== 201)
    throw new Error("réception échouée: " + JSON.stringify(res.body));
}
