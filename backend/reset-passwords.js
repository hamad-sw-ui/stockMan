const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function resetAllPasswords() {
  console.log('🔄 Réinitialisation de tous les mots de passe...');
  
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);

    const result = await pool.query(
      'UPDATE users SET password_hash = $1 RETURNING email',
      [hashedPassword]
    );

    console.log(`✅ Succès ! ${result.rowCount} utilisateurs mis à jour.`);
    result.rows.forEach(row => console.log(`👉 Mot de passe réinitialisé pour : ${row.email}`));
    
    console.log('\n🔑 Nouveaux identifiants :');
    console.log('-------------------------');
    console.log('Utilisateur : admin@stockman.cm');
    console.log('Mot de passe : admin123');
    console.log('-------------------------');

  } catch (err) {
    console.error('❌ Erreur lors de la réinitialisation :', err.message);
  } finally {
    await pool.end();
    process.exit();
  }
}

resetAllPasswords();
