const { Client } = require('pg');

const commonPasswords = [
  'postgres',
  'admin',
  'root',
  '1234',
  '123456',
  'password',
  'admin123',
  'stockman'
];

async function testConnection() {
  console.log("🔄 Tentative de connexion automatique à PostgreSQL...");

  for (const password of commonPasswords) {
    const client = new Client({
      user: 'postgres',
      host: 'localhost',
      database: 'postgres', // On se connecte à la DB par défaut pour tester
      password: password,
      port: 5432,
    });

    try {
      await client.connect();
      console.log(`✅ SUCCÈS ! Mot de passe trouvé : "${password}"`);
      console.log(`📝 Mise à jour du fichier .env...`);
      
      const fs = require('fs');
      const envContent = `PORT=5000\nDATABASE_URL=postgres://postgres:${password}@localhost:5432/stockman_db\nJWT_SECRET=votre_cle_secrete_ultra_securisee_12345\nNODE_ENV=development`;
      
      fs.writeFileSync('.env', envContent);
      console.log("✅ Fichier .env mis à jour !");
      
      // Tenter de créer la base de données stockman_db si elle n'existe pas
      try {
        await client.query('CREATE DATABASE stockman_db');
        console.log("✅ Base de données 'stockman_db' créée.");
      } catch (e) {
        if (e.code === '42P04') {
            console.log("ℹ️ La base de données 'stockman_db' existe déjà.");
        } else {
            console.log("⚠️ Impossible de créer la base de données (peut-être qu'elle existe déjà).");
        }
      }

      await client.end();
      process.exit(0);
    } catch (err) {
      // Échec pour ce mot de passe, on continue
      // console.log(`❌ Échec avec "${password}"`);
    }
  }

  console.error("❌ Impossible de trouver le mot de passe automatiquement.");
  console.error("👉 Vous devez modifier le fichier 'backend/.env' manuellement.");
  process.exit(1);
}

testConnection();
