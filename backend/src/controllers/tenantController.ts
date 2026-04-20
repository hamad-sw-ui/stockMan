import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

// Lister tous les tenants (Réservé SUPER_ADMIN)
export const getAllTenants = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Accès réservé au Super Administrateur' });
    }

    const result = await pool.query(
      `SELECT t.*, 
       (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) as user_count,
       (SELECT COUNT(*) FROM depots d WHERE d.tenant_id = t.id) as depot_count
       FROM tenants t 
       ORDER BY t.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération tenants' });
  }
};

// Activer/Désactiver un tenant
export const toggleTenantStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Interdit' });
    
    const { id } = req.params;
    const { is_active } = req.body;

    await pool.query('UPDATE tenants SET is_active = $1 WHERE id = $2', [is_active, id]);
    res.json({ message: 'Statut mis à jour' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur mise à jour tenant' });
  }
};
