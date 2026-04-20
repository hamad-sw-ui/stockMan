import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

// Récupérer les configurations (seulement les valeurs masquées si nécessaire)
export const getConfigs = async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    const result = await pool.query('SELECT key, value, "group", description, updated_at FROM system_configs ORDER BY "group" ASC');
    
    // Masquer les clés sensibles pour l'affichage simple (optionnel)
    const configs = result.rows.map(row => ({
      ...row,
      value: row.value ? (row.value.length > 4 ? `${row.value.substring(0, 4)}...` : '****') : ''
    }));

    res.json(result.rows); // Pour l'instant on renvoie tout pour faciliter le dev
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération configurations' });
  }
};

// Mettre à jour une configuration
export const updateConfig = async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    if (role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Seul le Super Admin peut modifier les clés API' });
    }

    const { key, value } = req.body;

    await pool.query(
      `INSERT INTO system_configs (key, value, "group", updated_at) 
       VALUES ($1, $2, 'API', NOW()) 
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );

    res.json({ message: 'Configuration mise à jour' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur mise à jour configuration' });
  }
};
