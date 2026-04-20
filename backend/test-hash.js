const bcrypt = require('bcryptjs');
const { Client } = require('pg');
require('dotenv').config();

async function testHash() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    const res = await client.query("SELECT password_hash FROM users WHERE email = 'admin@stockman.cm'");
    
    if (res.rows.length === 0) {
        console.log("❌ Utilisateur non trouvé");
        return;
    }

    const hash = res.rows[0].password_hash;
    const password = 'password123';
    
    console.log(`🔑 Test de comparaison pour 'admin@stockman.cm'`);
    console.log(`#️⃣ Hash en base : ${hash.substring(0, 20)}...`);
    
    const isMatch = await bcrypt.compare(password, hash);
    console.log(`✅ Résultat bcrypt.compare('${password}', hash) : ${isMatch}`);

  } catch (err) {
    console.error("❌ Erreur:", err);
  } finally {
    await client.end();
  }
}

testHash();
