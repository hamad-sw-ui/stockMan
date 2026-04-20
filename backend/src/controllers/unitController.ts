import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

// Récupérer toutes les unités du tenant
export const getUnits = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const result = await pool.query(
      'SELECT * FROM units WHERE tenant_id = $1 ORDER BY is_base DESC, name ASC',
      [tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération unités' });
  }
};

// Créer une unité
export const createUnit = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const { name, symbol, base_value, is_base } = req.body;

    const result = await pool.query(
      `INSERT INTO units (tenant_id, name, symbol, base_value, is_base) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, name, symbol, base_value, is_base]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur création unité' });
  }
};

// Supprimer une unité
export const deleteUnit = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;

    // Vérifier si l'unité est utilisée par des produits
    const checkUsed = await pool.query('SELECT COUNT(*) FROM products WHERE unit_id = $1', [id]);
    if (parseInt(checkUsed.rows[0].count) > 0) {
      return res.status(400).json({ message: 'Cette unité est utilisée par des produits et ne peut être supprimée.' });
    }

    await pool.query('DELETE FROM units WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    res.json({ message: 'Unité supprimée' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur suppression' });
  }
};
