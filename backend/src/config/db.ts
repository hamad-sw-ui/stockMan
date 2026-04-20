import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test de connexion immédiat
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Erreur de connexion PostgreSQL:', err.stack);
  } else {
    console.log('✅ PostgreSQL connecté avec succès');
  }
});

export default pool;
