/**
 * Tests du migrateur V1 → V2 (scripts/migrate-v1-to-v2.js).
 *
 * Une base LEGACY V1 complète est reconstruite à partir des vrais fichiers
 * database/legacy/*.sql (Schéma historique), garnie d'un jeu de données
 * volontairement tordu (doublons, conflits d'emails, PIN en clair…), puis le
 * migrateur est exécuté en mode analyse (--check, lecture seule) puis en mode
 * application (--apply) avec vérifications exhaustives — y compris la somme de
 * contrôle du stock avant/après.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { newDb, IMemoryDb, DataType } from "pg-mem";
import type { Pool, PoolClient } from "pg";
import bcrypt from "bcryptjs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

// Le migrateur est un script Node CJS partagé avec la production (scripts/)
// — require direct (tsconfig module:CommonJS) plutôt qu'un import ESM.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrator = require("../../../scripts/migrate-v1-to-v2.js") as {
  detectState: (q: Queriable) => Promise<{ v1: boolean; markers: string[] }>;
  analyze: (
    q: Queriable,
    state: Awaited<ReturnType<typeof migrator.detectState>>,
  ) => Promise<V1Analysis>;
  applyMigration: (
    q: Queriable,
    opts: {
      log: (m: string) => void;
      bcryptRounds: number;
      migrationsDir: string;
    },
  ) => Promise<V1Report>;
};

interface Queriable {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, any>[]; rowCount?: number }>;
}

interface V1Analysis {
  compteurs: Record<string, number>;
  conflits: {
    emails: Array<{ email: string }>;
    codesBarres: Array<{ codeBarres: string }>;
  };
  fusionProduits: Array<{
    nom: string;
    absorbes: unknown[];
    quantiteTotale: number;
  }>;
  plans: {
    mappages: Array<{ ancien: string; codeV2: string; creation: boolean }>;
    aCreer: string[];
  };
  pins: { rehaches: number; absents: number };
  alertes: string[];
}

interface V1Report {
  actions: string[];
  resultat: {
    pinsRehaches: number;
    plansCrees: string[];
    produitsApres: number;
    niveauxStockCrees: number;
    lotsCrees: number;
    mouvementsCrees: number;
    emailsDesactives: number;
    sommeControleStock: {
      v1: number;
      v2StockLevels: number;
      identiques: boolean;
    };
  };
}

// ---------------------------------------------------------------------------
// Base V1 legacy (pg-mem)
// ---------------------------------------------------------------------------
const LEGACY_DIR = path.join(__dirname, "..", "..", "..", "database", "legacy");
const MIGRATIONS_DIR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "database",
  "migrations",
);

function loadLegacySchema(): string {
  const files = [
    "database.sql",
    "migration_phase3.sql",
    "migration_phase3_movements.sql",
    "migration_phase4.sql",
  ];
  return (
    files
      .map((f) => {
        let sql = fs.readFileSync(path.join(LEGACY_DIR, f), "utf8");
        if (f === "migration_phase3_movements.sql") {
          // Ce fichier redéfinit product_variants / stock_batches déjà créés par
          // migration_phase3.sql. pg-mem ne supporte pas le no-op CREATE TABLE
          // IF NOT EXISTS d'une table existante (bug de couverture AST) : on
          // retire les blocs redondants — le Schéma résultant est IDENTIQUE.
          sql = sql
            .replace(
              /CREATE TABLE IF NOT EXISTS product_variants \([\s\S]*?\n\);/i,
              "",
            )
            .replace(
              /CREATE TABLE IF NOT EXISTS stock_batches \([\s\S]*?\n\);/i,
              "",
            )
            // Nomme explicitement le CHECK de « type » : Postgres réel le nomme
            // déjà exactement « stock_movements_type_check » (auto-nomination) ;
            // pg-mem ne peut retrouver une contrainte anonyme que si elle est nommée.
            .replace(
              /type\s+VARCHAR\(50\)\s+NOT NULL\s+CHECK/i,
              "type VARCHAR(50) NOT NULL CONSTRAINT stock_movements_type_check CHECK",
            );
        }
        return sql;
      })
      .join("\n")
      // Adaptations pg-mem (analyse statique du Schéma legacy, PG réel non concerné) :
      .replace(/CREATE\s+EXTENSION[^;]*;/gi, "") // extension simulée par le shim
      .replace(/\bDECIMAL\s*\(/gi, "NUMERIC(")
  ); // alias inconnu de pg-mem
}

// Identifiants fixes pour des assertions stables
const T_A = "11111111-1111-4111-8111-111111111111";
const T_B = "22222222-2222-4222-8222-222222222222";
const D_A1 = "31111111-1111-4111-8111-111111111111";
const D_A2 = "32222222-2222-4222-8222-222222222222";
const D_B1 = "33333333-3333-4333-8333-333333333333";
const U_ADMIN_A = "41111111-1111-4111-8111-111111111111";
const U_VEND_A = "42222222-2222-4222-8222-222222222222";
const U_ADMIN_B = "43333333-3333-4333-8333-333333333333";
const P_EAU_1 = "51111111-1111-4111-8111-111111111111"; // canonique (créée en premier)
const P_EAU_2 = "52222222-2222-4222-8222-222222222222"; // doublon dépôt annexe
const P_SAVON = "53333333-3333-4333-8333-333333333333";
const P_SAVON_L = "54444444-4444-4444-8444-444444444444";
const P_RIZ = "55555555-5555-4555-8555-555555555555";

let db: IMemoryDb;
let pool: Pool;
let client: PoolClient;
let q: Queriable;

const noop = () => undefined;

async function seedV1(q: Queriable) {
  // Tenants & dépôts
  await q.query(
    `INSERT INTO tenants (id, name, subdomain) VALUES ($1,'SARL Alpha','alpha'),($2,'Quincaillerie Bêta','beta')`,
    [T_A, T_B],
  );
  await q.query(
    `INSERT INTO depots (id, tenant_id, name) VALUES ($1,$3,'Principal'),($2,$3,'Annexe'),($4,$5,'Dépôt Bêta')`,
    [D_A1, D_A2, T_A, D_B1, T_B],
  );
  // Utilisateurs : PIN EN CLAIR ; un email dupliqué entre 2 tenants (casse différente)
  await q.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, depot_id, pin_code, created_at) VALUES
      ($1,$4,'Admin@Alpha.CM','hash','Admin Alpha','ADMIN',NULL,'4321','2024-01-01'),
      ($2,$4,'vendeur@alpha.cm','hash','Vendeur Alpha','VENDEUR',$5,'9876','2024-01-02'),
      ($3,$6,'admin@alpha.cm','hash','Admin Bêta','ADMIN',NULL,'1111','2024-02-01'),
      (gen_random_uuid(),$6,'vendeur@beta.cm','hash','Vendeur Bêta','VENDEUR',NULL,NULL,'2024-02-02')`,
    [U_ADMIN_A, U_VEND_A, U_ADMIN_B, T_A, D_A1, T_B],
  );
  // Licences historiques : libellés libres
  await q.query(
    `INSERT INTO licenses (id, tenant_id, plan_name, status, start_date, end_date) VALUES
      (gen_random_uuid(),$1,'Professionnel','ACTIVE','2025-01-01','2027-01-01'),
      (gen_random_uuid(),$2,'Gold','ACTIVE','2025-01-01','2027-01-01')`,
    [T_A, T_B],
  );
  // Unités avec doublon de libellé + catégorie + fournisseurs avec doublon
  await q.query(
    `INSERT INTO units (id, tenant_id, name, symbol) VALUES
    ('61111111-1111-4111-8111-111111111111',$1,'Pièce','Pce'),
    ('62222222-2222-4222-8222-222222222222',$1,'pièce','pce')`,
    [T_A],
  );
  await q.query(
    `INSERT INTO categories (id, tenant_id, name) VALUES (gen_random_uuid(),$1,'Boissons')`,
    [T_A],
  );
  await q.query(
    `INSERT INTO suppliers (id, tenant_id, name) VALUES
    ('71111111-1111-4111-8111-111111111111',$1,'FournA'),
    ('72222222-2222-4222-8222-222222222222',$1,'fourna')`,
    [T_A],
  );
  // Produits dupliqués par dépôt : même nom (casse différente), même code-barres,
  // stock et date d'expiration sur la fiche. + 2 codes-barres en conflit (Savon).
  await q.query(
    `INSERT INTO products (id, tenant_id, depot_id, name, barcode, purchase_price, selling_price, quantity, min_stock_level, unit_id, expiration_date, created_at) VALUES
      ($1,$5,$7,'Eau 1.5L','6001',200,400,100,5,$9,'2026-12-01','2024-03-01'),
      ($2,$5,$8,'EAU 1.5L','6001',200,400,50,5,$9,'2026-12-01','2024-03-02'),
      ($3,$5,$7,'Savon','7001',100,200,25,5,$9,NULL,'2024-03-03'),
      ($4,$5,$7,'Savon Liquide','7001',150,300,5,5,$9,NULL,'2024-03-04'),
      ($6,$10,$11,'Riz 25kg',NULL,9000,11000,10,2,NULL,NULL,'2024-03-05')`,
    [
      P_EAU_1,
      P_EAU_2,
      P_SAVON,
      P_SAVON_L,
      T_A,
      P_RIZ,
      D_A1,
      D_A2,
      "62222222-2222-4222-8222-222222222222",
      T_B,
      D_B1,
    ],
  );
  // Variante sur la fiche canonique avec son propre stock V1
  await q.query(
    `INSERT INTO product_variants (id, product_id, name, sku, additional_price, quantity) VALUES
      ('81111111-1111-4111-8111-111111111111',$1,'Pack de 6','PACK6',1900,12)`,
    [P_EAU_1],
  );
  // Lots V1 : un sur chaque fiche, MÊME numéro → collision au moment de la fusion
  await q.query(
    `INSERT INTO stock_batches (id, product_id, batch_number, quantity, expiry_date, supplier_id) VALUES
      (gen_random_uuid(),$1,'LOT-OLD',7,'2026-06-01',$3),
      (gen_random_uuid(),$2,'LOT-OLD',20,'2026-07-01',$4)`,
    [
      P_EAU_1,
      P_EAU_2,
      "71111111-1111-4111-8111-111111111111",
      "72222222-2222-4222-8222-222222222222",
    ],
  );
  // Ventes historiques dont une article sur le doublon de produit
  await q.query(
    `INSERT INTO sales (id, tenant_id, depot_id, vendor_id, total_amount, payment_method, created_at) VALUES
      ('91111111-1111-4111-8111-111111111111',$1,$2,$3,400,'CASH','2024-04-01'),
      ('92222222-2222-4222-8222-222222222222',$1,$2,$3,200,'CASH','2024-04-02')`,
    [T_A, D_A1, U_VEND_A],
  );
  await q.query(
    `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, total_price) VALUES
      (gen_random_uuid(),'91111111-1111-4111-8111-111111111111',$1,2,200,400),
      (gen_random_uuid(),'92222222-2222-4222-8222-222222222222',$2,1,200,200)`,
    [P_EAU_2, P_SAVON],
  );
  // Mouvement + audit + notification historiques
  await q.query(
    `INSERT INTO stock_movements (id, tenant_id, depot_id, product_id, user_id, type, quantity, reason) VALUES
      (gen_random_uuid(),$1,$2,$3,$4,'IN',100,'Stock initial')`,
    [T_A, D_A1, P_EAU_1, U_ADMIN_A],
  );
  await q.query(
    `INSERT INTO audit_logs (id, tenant_id, user_id, user_name, action, entity, entity_id, details, "timestamp") VALUES
      (gen_random_uuid(),$1,$2,'Admin Alpha','CREATE','product',$3,'création V1','2024-03-01 08:00')`,
    [T_A, U_ADMIN_A, P_EAU_1],
  );
  await q.query(
    `INSERT INTO notifications (id, tenant_id, phone, type, channel, message, status) VALUES
      (gen_random_uuid(),$1,'+237600000000','STOCK_ALERT','SMS','alerte','SENT')`,
    [T_A],
  );
}

beforeAll(async () => {
  db = newDb({ autoCreateForeignKeyIndices: true });
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
    name: "uuid_generate_v4",
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  // trim() existe sur Postgres réel ; pg-mem ne l'implémente pas.
  db.public.registerFunction({
    name: "trim",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (v: string) => v.trim(),
    impure: false,
  });
  const { Pool: MemPool } = db.adapters.createPg();
  pool = new MemPool();
  await pool.query(loadLegacySchema());
  await seedV1(pool as unknown as Queriable);
  client = await pool.connect();
  q = client as unknown as Queriable;
});

afterAll(async () => {
  client?.release();
  db.backup();
});

describe("migrateur V1 → V2", () => {
  it("détecte une base V1 et ses marqueurs", async () => {
    const state = await migrator.detectState(q);
    expect(state.v1).toBe(true);
    expect(state.markers.join(" ")).toContain("pin_code");
    expect(state.markers.join(" ")).toContain("plan_name");
  });

  it("--check : rapport d’écarts complet SANS modifier la base", async () => {
    const state = await migrator.detectState(q);
    const rapport = await migrator.analyze(q, state);
    // Analyse attendue
    expect(rapport.pins.rehaches).toBe(3);
    expect(rapport.pins.absents).toBe(1);
    expect(rapport.conflits.emails).toHaveLength(1);
    expect(rapport.conflits.emails[0]!.email).toBe("admin@alpha.cm");
    expect(rapport.conflits.codesBarres.length).toBeGreaterThanOrEqual(2); // 6001 ×2, 7001 ×2
    expect(rapport.fusionProduits).toHaveLength(1);
    expect(rapport.fusionProduits[0]!.absorbes).toHaveLength(1);
    expect(rapport.plans.mappages).toContainEqual({
      ancien: "Professionnel",
      codeV2: "PRO",
      creation: false,
    });
    expect(rapport.plans.aCreer).toEqual(["Gold"]);
    // Pureté du mode check : rien n'a bougé
    const again = await migrator.detectState(q);
    expect(again.v1).toBe(true);
    const u = await q.query("SELECT email, pin_code FROM users WHERE id = $1", [
      U_ADMIN_A,
    ]);
    expect(u.rows[0]!.email).toBe("Admin@Alpha.CM"); // toujours en clair / casse d'origine
    expect(u.rows[0]!.pin_code).toBe("4321");
  });

  let rapport: V1Report;

  it("--apply : migration complète en une transaction", async () => {
    await client.query("BEGIN");
    try {
      rapport = await migrator.applyMigration(q, {
        log: noop,
        bcryptRounds: 4,
        migrationsDir: MIGRATIONS_DIR,
      });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    expect(rapport.resultat.sommeControleStock.identiques).toBe(true);
  });

  it("PIN re-hachés bcrypt, colonne en clair supprimée", async () => {
    const r = await q.query("SELECT pin_hash FROM users WHERE id = $1", [
      U_ADMIN_A,
    ]);
    expect(bcrypt.compareSync("4321", r.rows[0]!.pin_hash)).toBe(true);
    const cols = await q.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='users'`,
    );
    expect(cols.rows.map((c) => c.column_name)).not.toContain("pin_code");
    expect(rapport.resultat.pinsRehaches).toBe(3);
  });

  it("emails normalisés ; doublon inter-tenant désactivé et renommé", async () => {
    const a = await q.query(
      "SELECT email, is_active FROM users WHERE id = $1",
      [U_ADMIN_A],
    );
    expect(a.rows[0]!.email).toBe("admin@alpha.cm");
    expect(a.rows[0]!.is_active).toBe(true);
    const b = await q.query(
      "SELECT email, is_active FROM users WHERE id = $1",
      [U_ADMIN_B],
    );
    expect(b.rows[0]!.is_active).toBe(false);
    expect(b.rows[0]!.email).toMatch(
      /^admin@alpha\.cm\+migre-[0-9a-f]{8}\.desactive$/,
    );
    expect(rapport.resultat.emailsDesactives).toBe(1);
  });

  it("licences rattachées aux codes plans (plan inconnu créé)", async () => {
    const la = await q.query(
      "SELECT plan_code FROM licenses WHERE tenant_id = $1",
      [T_A],
    );
    const lb = await q.query(
      "SELECT plan_code FROM licenses WHERE tenant_id = $1",
      [T_B],
    );
    expect(la.rows[0]!.plan_code).toBe("PRO");
    expect(lb.rows[0]!.plan_code).toBe("GOLD");
    const p = await q.query(`SELECT code FROM plans WHERE code = 'GOLD'`);
    expect(p.rows).toHaveLength(1);
    expect(rapport.resultat.plansCrees).toEqual(["GOLD"]);
  });

  it("catalogue fusionné : doublon dépôt absorbé, ventes réécrites", async () => {
    const prods = await q.query(
      "SELECT id, name, barcode FROM products ORDER BY name",
    );
    expect(prods.rows).toHaveLength(4);
    const eau = prods.rows.find((p) => p.id === P_EAU_1)!;
    expect(eau.name).toBe("Eau 1.5L");
    expect(eau.barcode).toBe("6001");
    expect(rapport.resultat.produitsApres).toBe(4);
    // Plus de colonnes V1 sur la fiche produit
    const cols = await q.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='products'`,
    );
    const names = cols.rows.map((c) => c.column_name);
    expect(names).not.toContain("depot_id");
    expect(names).not.toContain("quantity");
    expect(names).not.toContain("expiration_date");
    // Le doublon de code-barres « Savon » a été neutralisé
    const savonL = await q.query("SELECT barcode FROM products WHERE id = $1", [
      P_SAVON_L,
    ]);
    expect(savonL.rows[0]!.barcode).toBeNull();
    // Articles de vente repointés vers le produit conservé, base_qty renseigné
    const items = await q.query(
      "SELECT product_id, quantity, base_qty FROM sale_items ORDER BY quantity DESC",
    );
    expect(items.rows[0]!.product_id).toBe(P_EAU_1);
    expect(Number(items.rows[0]!.base_qty)).toBe(2);
    expect(items.rows[1]!.product_id).toBe(P_SAVON);
    // Variante déplacée sur le canonique
    const v = await q.query(
      "SELECT product_id, sku FROM product_variants WHERE sku = $1",
      ["PACK6"],
    );
    expect(v.rows[0]!.product_id).toBe(P_EAU_1);
  });

  it("stock reporté par dépôt : niveaux, lots FEFO, mouvements tracés", async () => {
    const a1 = await q.query(
      "SELECT quantity FROM stock_levels WHERE product_id=$1 AND depot_id=$2 AND variant_id IS NULL",
      [P_EAU_1, D_A1],
    );
    const a2 = await q.query(
      "SELECT quantity FROM stock_levels WHERE product_id=$1 AND depot_id=$2 AND variant_id IS NULL",
      [P_EAU_1, D_A2],
    );
    expect(Number(a1.rows[0]!.quantity)).toBe(100);
    expect(Number(a2.rows[0]!.quantity)).toBe(50);
    const vari = await q.query(
      "SELECT quantity FROM stock_levels WHERE variant_id = $1",
      ["81111111-1111-4111-8111-111111111111"],
    );
    expect(Number(vari.rows[0]!.quantity)).toBe(12);
    // Lots : 2 « LOT-V1-<dépôt>-<date> » + 2 lots historiques (dont un renommé pour collision)
    const lots = await q.query(
      "SELECT batch_number, quantity FROM stock_batches WHERE product_id=$1 ORDER BY batch_number",
      [P_EAU_1],
    );
    const numeros = lots.rows.map((l) => l.batch_number);
    expect(numeros.filter((n) => n.startsWith("LOT-V1-"))).toHaveLength(2);
    expect(numeros).toContain("LOT-OLD");
    expect(numeros).toContain("LOT-OLD-v1");
    expect(rapport.resultat.lotsCrees).toBe(2);
    // Mouvements « Migration V1 » : 5 fiches + 1 variante
    const m = await q.query(
      `SELECT COUNT(*)::int AS n FROM stock_movements WHERE reason LIKE 'Migration V1%' AND type='IN'`,
    );
    expect(m.rows[0]!.n).toBe(6);
    expect(rapport.resultat.mouvementsCrees).toBe(6);
    // Stock V1 total : 100+50+25+5+10 (produits) + 12 (variante) = 202
    expect(rapport.resultat.sommeControleStock.v1).toBe(202);
    expect(rapport.resultat.sommeControleStock.v2StockLevels).toBe(202);
  });

  it("doublons d’unités et de fournisseurs fusionnés", async () => {
    const u = await q.query(
      "SELECT COUNT(*)::int AS n FROM units WHERE tenant_id=$1",
      [T_A],
    );
    expect(u.rows[0]!.n).toBe(1);
    const p = await q.query("SELECT unit_id FROM products WHERE id=$1", [
      P_EAU_1,
    ]);
    expect(p.rows[0]!.unit_id).toBe("61111111-1111-4111-8111-111111111111");
    const s = await q.query("SELECT id FROM suppliers WHERE tenant_id=$1", [
      T_A,
    ]);
    expect(s.rows).toHaveLength(1);
    const b = await q.query(
      `SELECT supplier_id FROM stock_batches WHERE batch_number='LOT-OLD-v1'`,
    );
    expect(b.rows[0]!.supplier_id).toBe("71111111-1111-4111-8111-111111111111");
  });

  it("chaîne V2 rejouée : nouvelles tables + historique audit préservé", async () => {
    const mig = await q.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(mig.rows.map((r) => r.version)).toEqual([
      "V001",
      "V002",
      "V003",
      "V004",
      "V005",
      "V006",
      "V007",
      "V008",
      "V009",
      "V010",
    ]);
    for (const t of [
      "stock_levels",
      "stock_receipts",
      "refresh_tokens",
      "plans",
      "sale_returns",
      "tenant_configs",
    ]) {
      const r = await q.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}'`,
      );
      expect(r.rows).toHaveLength(1);
    }
    // created_at repris de la colonne « timestamp » historique
    const a = await q.query(
      `SELECT created_at FROM audit_logs WHERE action='CREATE'`,
    );
    expect(new Date(a.rows[0]!.created_at).toISOString()).toContain(
      "2024-03-01",
    );
    // Entrée MIGRATION par tenant
    const m = await q.query(
      `SELECT COUNT(*)::int AS n FROM audit_logs WHERE action='MIGRATION'`,
    );
    expect(m.rows[0]!.n).toBe(2);
    // Contraintes POS V2 : le type VOID existe désormais
    await q.query(
      `INSERT INTO stock_movements (tenant_id, depot_id, product_id, user_id, type, quantity) VALUES ($1,$2,$3,NULL,'VOID',1)`,
      [T_A, D_A1, P_EAU_1],
    );
  });

  it("base déjà V2 : plus aucun marqueur V1 (rejouable sans effet)", async () => {
    const state = await migrator.detectState(q);
    expect(state.v1).toBe(false);
  });
});
