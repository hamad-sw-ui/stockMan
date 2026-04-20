const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function debugDB() {
  console.log('🔍 Connexion à la base de données : ' + process.env.DATABASE_URL.split('@')[1]);
  
  try {
    const tenants = await pool.query('SELECT id, name FROM tenants');
    console.log('\n🏢 TENANTS TROUVÉS (' + tenants.rowCount + ') :');
    tenants.rows.forEach(t => console.log(`- [${t.id}] ${t.name}`));

    const users = await pool.query('SELECT id, email, role, tenant_id FROM users');
    console.log('\n👤 UTILISATEURS TROUVÉS (' + users.rowCount + ') :');
    users.rows.forEach(u => console.log(`- ${u.email} (Rôle: ${u.role}, TenantID: ${u.tenant_id})`));

    const products = await pool.query('SELECT COUNT(*) FROM products');
    console.log('\n📦 PRODUITS EN STOCK : ' + products.rows[0].count);

  } catch (err) {
    console.error('❌ ERREUR DE CONNEXION :', err.message);
  } finally {
    pool.end();
  }
}

debugDB();
