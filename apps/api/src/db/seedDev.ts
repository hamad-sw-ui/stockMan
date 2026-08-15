#!/usr/bin/env node
import bcrypt from "bcryptjs";
import { closePool, getPool } from "../config/db";
import { applyMigrations } from "./migrations";
import { logger } from "../lib/logger";

/**
 * Seed de DÉVELOPPEMENT (idempotent) : tenant « Démo SARL », comptes de test,
 * dépôts, catalogue réaliste. Jamais exécuté en production (garde NODE_ENV).
 *   npm run seed:dev
 * Mot de passe commun des comptes démo : Demo1234!  · PIN vendeur : 4321
 */
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SA_TENANT = "00000000-0000-4000-8000-000000000001";
const DEPOT_A = "22222222-2222-4222-8222-222222222222";
const DEPOT_B = "33333333-3333-4333-8333-333333333333";

async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed DEV interdit en production.");
  }
  await applyMigrations();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO plans (code, name, max_users, max_depots, monthly_price) VALUES
        ('TRIAL','Essai gratuit',2,1,0), ('BASIC','Basique',5,1,5000), ('PRO','Professionnel',20,5,15000)
       ON CONFLICT (code) DO NOTHING`,
    );

    // Tenant système + Super Admin
    await client.query(
      `INSERT INTO tenants (id, name, subdomain) VALUES ($1, 'StockMan Éditeur', 'system')
       ON CONFLICT (id) DO NOTHING`,
      [SA_TENANT],
    );
    await client.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role)
       VALUES ($1, 'Super Admin', 'sa@stockman.cm', $2, 'SUPER_ADMIN')
       ON CONFLICT (email) DO NOTHING`,
      [SA_TENANT, bcrypt.hashSync("Demo1234!", 10)],
    );

    // Tenant démo
    await client.query(
      `INSERT INTO tenants (id, name, subdomain, phone, primary_color) VALUES
        ($1, 'Démo SARL', 'demo', '+237 690 00 00 00', '#059669')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_ID],
    );
    await client.query(
      `INSERT INTO licenses (tenant_id, plan_code, status, start_date, end_date, max_users, max_depots)
       VALUES ($1, 'PRO', 'ACTIVE', CURRENT_DATE - 10, CURRENT_DATE + 355, 20, 5)
       ON CONFLICT DO NOTHING`,
      [TENANT_ID],
    );
    await client.query(
      `INSERT INTO notification_settings (tenant_id, alert_phone, alert_whatsapp)
       VALUES ($1, '+237690000000', '+237690000000') ON CONFLICT (tenant_id) DO NOTHING`,
      [TENANT_ID],
    );

    await client.query(
      `INSERT INTO depots (id, tenant_id, name, address) VALUES
        ($2, $1, 'Dépôt Akwa', 'Akwa, Douala'),
        ($3, $1, 'Dépôt Bonabéri', 'Bonabéri, Douala')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_ID, DEPOT_A, DEPOT_B],
    );

    const hash = bcrypt.hashSync("Demo1234!", 10);
    const pin = bcrypt.hashSync("4321", 10);
    await client.query(
      `INSERT INTO users (tenant_id, depot_id, name, email, password_hash, role) VALUES
        ($1, NULL, 'Gertrude Moukoko', 'admin@demo.cm', $2, 'ADMIN')
       ON CONFLICT (email) DO NOTHING`,
      [TENANT_ID, hash],
    );
    await client.query(
      `INSERT INTO users (tenant_id, depot_id, name, email, password_hash, role, pin_hash) VALUES
        ($1, $2, 'Junior Etame', 'vendeur@demo.cm', $3, 'VENDEUR', $4)
       ON CONFLICT (email) DO NOTHING`,
      [TENANT_ID, DEPOT_A, hash, pin],
    );

    // Référentiels
    const cats = ["Boissons", "Alimentaire", "Hygiène"];
    for (const [i, c] of cats.entries()) {
      await client.query(
        `INSERT INTO categories (tenant_id, name, sort_order) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [TENANT_ID, c, i],
      );
    }
    await client.query(
      `INSERT INTO units (tenant_id, name, symbol, base_value, is_base) VALUES
        ($1,'Pièce','Pce',1,true), ($1,'Carton','Ctn',12,false), ($1,'Kilogramme','Kg',1,true)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [TENANT_ID],
    );

    // Produits + niveaux de stock initiaux
    const piece = await client.query(
      `SELECT id FROM units WHERE tenant_id=$1 AND symbol='Pce'`,
      [TENANT_ID],
    );
    const boissons = await client.query(
      `SELECT id FROM categories WHERE tenant_id=$1 AND name='Boissons'`,
      [TENANT_ID],
    );
    const alim = await client.query(
      `SELECT id FROM categories WHERE tenant_id=$1 AND name='Alimentaire'`,
      [TENANT_ID],
    );
    const unitId = piece.rows[0].id;

    const products: Array<
      [string, string, number, number, number, string, number]
    > = [
      [
        "Eau Tangui 1.5L",
        boissons.rows[0].id,
        250,
        400,
        20,
        "6111250900015",
        150,
      ],
      [
        "Jus Top Pamplemousse 50cl",
        boissons.rows[0].id,
        200,
        350,
        10,
        "6111250900022",
        4,
      ],
      ["Riz Mémé 5kg", alim.rows[0].id, 3500, 4500, 5, "6111250900039", 40],
    ];
    for (const [name, catId, pa, pv, seuil, barcode, qty] of products) {
      const p = await client.query(
        `INSERT INTO products (tenant_id, name, category_id, barcode, purchase_price, selling_price, min_stock_level, unit_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, name) DO UPDATE SET barcode = EXCLUDED.barcode
         RETURNING id`,
        [TENANT_ID, name, catId, barcode, pa, pv, seuil, unitId],
      );
      await client.query(
        `INSERT INTO stock_levels (product_id, depot_id, quantity) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [p.rows[0].id, DEPOT_A, qty],
      );
    }

    await client.query("COMMIT");
    logger.info(
      "✅ Seed dev terminé — admin@demo.cm / vendeur@demo.cm (Demo1234!, PIN 4321) · sa@stockman.cm",
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .catch((err) => {
    logger.error("Seed dev échoué", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  })
  .finally(() => closePool());
