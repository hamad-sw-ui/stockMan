import fs from 'fs';
import path from 'path';
import pool from './config/db';

async function migrate() {
  console.log('🚀 Démarrage des migrations...');
  
  const migrationFiles = [
    '../../migration_phase3.sql',
    '../../migration_phase4.sql'
  ];

  const client = await pool.connect();

  try {
    for (const file of migrationFiles) {
      const filePath = path.join(__dirname, file);
      if (fs.existsSync(filePath)) {
        console.log(`📄 Exécution de : ${file}`);
        const sql = fs.readFileSync(filePath, 'utf8');
        await client.query(sql);
        console.log(`✅ ${file} appliqué avec succès.`);
      } else {
        console.warn(`⚠️ Fichier non trouvé : ${filePath}`);
      }
    }
    console.log('✨ Toutes les migrations ont été appliquées.');
  } catch (err) {
    console.error('❌ Erreur lors de la migration :', err);
  } finally {
    client.release();
    process.exit();
  }
}

migrate();
