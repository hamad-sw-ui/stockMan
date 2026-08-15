#!/usr/bin/env node
/**
 * reset-user-password.js — réinitialise le mot de passe d'un utilisateur,
 * avec VERROUILLAGE DANGER (double confirmation explicite).
 *
 * Usage : node scripts/reset-user-password.js utilisateur@exemple.cm
 * Puis tapez exactement : RESET utilisateur@exemple.cm
 *
 * Révoque aussi toutes les sessions (refresh tokens) du compte.
 */
"use strict";

const crypto = require("crypto");
const readline = require("readline");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(
      "Usage : node scripts/reset-user-password.js utilisateur@exemple.cm",
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("✖ DATABASE_URL est requis.");
    process.exit(1);
  }

  // Verrou : confirmation interactive obligatoire (jamais de reset « par accident »)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const confirmation = await new Promise((resolve) =>
    rl.question(
      `⚠️  Pour confirmer, tapez exactement : RESET ${email}\n> `,
      resolve,
    ),
  );
  rl.close();
  if (confirmation.trim() !== `RESET ${email}`) {
    console.log("Annulé (confirmation non conforme).");
    process.exit(0);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const user = await pool.query(
      "SELECT id, name, role FROM users WHERE lower(email) = $1",
      [email],
    );
    if (!user.rows[0]) {
      console.error(`✖ Aucun utilisateur ${email}.`);
      process.exit(1);
    }
    const temp = crypto.randomBytes(6).toString("base64url") + "1A";
    const hash = await bcrypt.hash(
      temp,
      Number(process.env.BCRYPT_ROUNDS) || 10,
    );
    await pool.query(
      "UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1",
      [user.rows[0].id, hash],
    );
    // Révocation de toutes les sessions actives (correction SEC : vol de session)
    await pool.query(
      "UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [user.rows[0].id],
    );
    console.log(
      `✔ Mot de passe réinitialisé pour ${user.rows[0].name} (${email}) — sessions révoquées.`,
    );
    console.log(
      `\n🔑 Mot de passe temporaire (transmettez-le en privé) : ${temp}\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("✖ Échec :", err.message);
  process.exit(1);
});
