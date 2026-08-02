#!/usr/bin/env node
/**
 * create-superadmin.js — crée (ou réinitialise) le compte Super Admin éditeur.
 *
 * Usage SÉCURISÉ (aucun identifiant codé en dur, rien dans l'historique shell) :
 *   SA_EMAIL=sa@stockman.cm node scripts/create-superadmin.js
 *   → mot de passe fort généré et affiché UNE fois, ou fourni via SA_PASSWORD.
 *
 * Variables : DATABASE_URL (obligatoire), SA_EMAIL, SA_PASSWORD (optionnel),
 *             BCRYPT_ROUNDS (défaut 10).
 */
'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const SA_TENANT = '00000000-0000-4000-8000-000000000001';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✖ DATABASE_URL est requis (postgresql://user:pass@host:5432/base).');
    process.exit(1);
  }
  const email = (process.env.SA_EMAIL || 'sa@stockman.cm').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`✖ SA_EMAIL invalide : ${email}`);
    process.exit(1);
  }
  const generated = !process.env.SA_PASSWORD;
  const password = process.env.SA_PASSWORD || crypto.randomBytes(9).toString('base64url');
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    console.error('✖ SA_PASSWORD doit faire 8+ caractères avec au moins une lettre et un chiffre.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 10);
    await pool.query(
      `INSERT INTO tenants (id, name, subdomain, is_active) VALUES ($1, 'StockMan Éditeur', 'system', true)
       ON CONFLICT (id) DO NOTHING`,
      [SA_TENANT],
    );
    const existing = await pool.query('SELECT id, role FROM users WHERE lower(email) = $1', [email]);
    if (existing.rows[0]) {
      if (existing.rows[0].role !== 'SUPER_ADMIN') {
        console.error(`✖ ${email} existe déjà avec un rôle non SUPER_ADMIN. Refus par sécurité.`);
        process.exit(1);
      }
      await pool.query('UPDATE users SET password_hash=$2, is_active=true, updated_at=now() WHERE id=$1', [existing.rows[0].id, hash]);
      console.log(`✔ Mot de passe Super Admin réinitialisé : ${email}`);
    } else {
      await pool.query(
        `INSERT INTO users (tenant_id, name, email, password_hash, role, is_active)
         VALUES ($1, 'Super Admin', $2, $3, 'SUPER_ADMIN', true)`,
        [SA_TENANT, email, hash],
      );
      console.log(`✔ Compte Super Admin créé : ${email}`);
    }
    if (generated) {
      console.log(`\n🔑 Mot de passe (affiché UNE SEULE FOIS) : ${password}\n   Conservez-le en lieu sûr et changez-le après la première connexion.\n`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('✖ Échec :', err.message);
  process.exit(1);
});
