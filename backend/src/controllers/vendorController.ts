import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';
import bcrypt from 'bcryptjs';

// Récupérer les vendeurs du tenant
export const getVendors = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const result = await pool.query(
      'SELECT id, name, email, role, pin_code, is_active, created_at FROM users WHERE tenant_id = $1 AND role = $2',
      [tenantId, 'VENDEUR']
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération vendeurs' });
  }
};

// Créer un vendeur
export const createVendor = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const { name, email, password, pin_code, depot_id } = req.body;

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role, pin_code, depot_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, email`,
      [tenantId, name, email, passwordHash, 'VENDEUR', pin_code, depot_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur création vendeur' });
  }
};
