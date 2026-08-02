const { Client } = require('pg');
require('dotenv').config();

async function listUsers() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log("👥 Liste des utilisateurs en base :");
    const res = await client.query('SELECT id, email, role, tenant_id FROM users');
    console.table(res.rows);
  } catch (err) {
    console.error("❌ Erreur:", err);
  } finally {
    await client.end();
  }
}

listUsers();
