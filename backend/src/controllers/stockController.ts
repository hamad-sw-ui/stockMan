import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

/**
 * Ajustement manuel du stock (Inventaire Physique)
 */
export const adjustStock = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    const { productId, variantId, depotId, newQuantity, reason, type = 'ADJUSTMENT' } = req.body;

    await client.query('BEGIN');

    // 1. Récupérer le stock actuel (Verrouillage pour update)
    const currentRes = await client.query(
      'SELECT quantity FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [productId, tenantId]
    );

    if (currentRes.rows.length === 0) {
      throw new Error('Produit introuvable');
    }

    const previousStock = parseFloat(currentRes.rows[0].quantity);
    const diff = parseFloat(newQuantity) - previousStock;

    // 2. Mettre à jour le stock du produit
    await client.query(
      'UPDATE products SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newQuantity, productId]
    );

    // 3. Si variante, mettre à jour le stock de la variante
    if (variantId) {
      await client.query(
        'UPDATE product_variants SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newQuantity, variantId] // Note: Dans un système complexe, on gérerait la somme des variantes
      );
    }

    // 4. Enregistrer le mouvement de stock
    await client.query(
      `INSERT INTO stock_movements (tenant_id, depot_id, product_id, variant_id, user_id, type, quantity, previous_stock, new_stock, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [tenantId, depotId, productId, variantId || null, userId, type, Math.abs(diff), previousStock, newQuantity, reason]
    );

    await client.query('COMMIT');
    res.json({ message: 'Stock ajusté avec succès', newQuantity });

  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Erreur Ajustement Stock:', err);
    res.status(400).json({ message: err.message || 'Erreur lors de l\'ajustement' });
  } finally {
    client.release();
  }
};

/**
 * Récupérer l'historique des mouvements de stock
 */
export const getStockMovements = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const { productId } = req.query;

    let query = `
      SELECT sm.*, p.name as product_name, u.name as user_name
      FROM stock_movements sm
      JOIN products p ON sm.product_id = p.id
      JOIN users u ON sm.user_id = u.id
      WHERE sm.tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (productId) {
      query += ` AND sm.product_id = $2`;
      params.push(productId);
    }

    query += ` ORDER BY sm.created_at DESC LIMIT 100`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Erreur historique mouvements' });
  }
};
