const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createAdmin() {
  const email = 'admin@stockman.cm';
  const password = 'admin123';
  const name = 'Administrateur Système';
  const role = 'SUPER_ADMIN';

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 1. S'assurer que le tenant système existe
    await pool.query(
      "INSERT INTO tenants (id, name, is_active) VALUES ('00000000-0000-0000-0000-000000000000', 'Système', true) ON CONFLICT DO NOTHING"
    );

    // 2. Créer l'admin
    const query = `
      INSERT INTO users (tenant_id, email, password_hash, name, role, is_active)
      VALUES ('00000000-0000-0000-0000-000000000000', $1, $2, $3, $4, true)
      ON CONFLICT (tenant_id, email) 
      DO UPDATE SET password_hash = $2
      RETURNING id;
    `;

    const res = await pool.query(query, [email, hashedPassword, name, role]);
    console.log('✅ Utilisateur Admin créé/mis à jour avec succès !');
    console.log('📧 Email : ' + email);
    console.log('🔑 Mot de passe : ' + password);
  } catch (err) {
    console.error('❌ Erreur :', err);
  } finally {
    pool.end();
  }
}

createAdmin();
