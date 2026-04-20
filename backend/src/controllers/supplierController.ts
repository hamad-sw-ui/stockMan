import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

export const getSuppliers = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const result = await pool.query(
      'SELECT * FROM suppliers WHERE tenant_id = $1 ORDER BY name ASC',
      [tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Erreur récupération fournisseurs' });
  }
};

export const createSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const { name, email, phone, address, depot_id } = req.body;

    const result = await pool.query(
      `INSERT INTO suppliers (tenant_id, depot_id, name, email, phone, address) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, depot_id, name, email, phone, address]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Erreur création fournisseur' });
  }
};
