import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

export const createSale = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    const { depotId, items, paymentMethod, totalAmount, createdAt } = req.body;

    // Début de la Transaction (Tout ou Rien)
    await client.query('BEGIN');

    // 1. Enregistrer la Vente (Utiliser createdAt si fourni pour les syncs offline)
    const saleRes = await client.query(
      `INSERT INTO sales (tenant_id, depot_id, vendor_id, total_amount, payment_method, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [tenantId, depotId, userId, totalAmount, paymentMethod, createdAt || new Date()]
    );
    const saleId = saleRes.rows[0].id;

// Traiter chaque article (Décrémenter Stock + Ligne de vente)
    for (const item of items) {
      const { productId, variantId, quantity, unitPrice } = item;
      const lineTotal = quantity * unitPrice;
      let remainingToDeduct = parseFloat(quantity);

      // A. Si c'est une variante, décrémenter le stock spécifique de la variante
      if (variantId) {
        const variantRes = await client.query(
          'UPDATE product_variants SET quantity = quantity - $1 WHERE id = $2 AND product_id = $3 RETURNING quantity',
          [quantity, variantId, productId]
        );

        if (variantRes.rows.length === 0) {
          throw new Error(`Variante introuvable : ${variantId}`);
        }

        if (parseFloat(variantRes.rows[0].quantity) < 0) {
          throw new Error(`Stock insuffisant pour la variante ${variantId}`);
        }
      }

      // B. Vérifier le stock actuel et les lots (FEFO)
      const batchesRes = await client.query(
        `SELECT id, quantity, expiry_date 
         FROM stock_batches 
         WHERE product_id = $1 AND quantity > 0 
         ORDER BY expiry_date ASC 
         FOR UPDATE`,
        [productId]
      );

      if (batchesRes.rows.length > 0) {
        // Logique FEFO : On déduit des lots par ordre d'expiration
        for (const batch of batchesRes.rows) {
          if (remainingToDeduct <= 0) break;

          const batchQty = parseFloat(batch.quantity);
          const deductFromBatch = Math.min(batchQty, remainingToDeduct);

          await client.query(
            'UPDATE stock_batches SET quantity = quantity - $1 WHERE id = $2',
            [deductFromBatch, batch.id]
          );

          remainingToDeduct -= deductFromBatch;
        }

        if (remainingToDeduct > 0) {
          throw new Error(`Stock insuffisant dans les lots pour le produit ID ${productId}`);
        }
      }

      // C. Décrémenter le stock global du produit
      const productBeforeRes = await client.query(
        'SELECT quantity FROM products WHERE id = $1 FOR UPDATE',
        [productId]
      );
      const previousStock = parseFloat(productBeforeRes.rows[0].quantity);
      const newStock = previousStock - parseFloat(quantity);

      const productRes = await client.query(
        'UPDATE products SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3 RETURNING quantity',
        [newStock, productId, tenantId]
      );

      if (productRes.rows.length === 0) {
        throw new Error(`Produit introuvable : ${productId}`);
      }

      if (parseFloat(productRes.rows[0].quantity) < 0) {
        throw new Error(`Stock global insuffisant pour le produit ID ${productId}`);
      }

      // E. Enregistrer le mouvement de stock (TRAÇABILITÉ v1.0)
      await client.query(
        `INSERT INTO stock_movements (tenant_id, depot_id, product_id, variant_id, user_id, type, quantity, previous_stock, new_stock, reference_id)
         VALUES ($1, $2, $3, $4, $5, 'SALE', $6, $7, $8, $9)`,
        [tenantId, depotId, productId, variantId || null, userId, quantity, previousStock, newStock, saleId]
      );

      // D. Ajouter la ligne de vente (avec variantId si présent)
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [saleId, productId, variantId || null, quantity, unitPrice, lineTotal]
      );
    }

    // Valider la transaction
    await client.query('COMMIT');

    res.status(201).json({ message: 'Vente enregistrée avec succès', saleId });

  } catch (err: any) {
    if (client) await client.query('ROLLBACK');
    console.error('Erreur Vente:', err);
    res.status(400).json({ message: err.message || 'Erreur lors de la vente' });
  } finally {
    client.release();
  }
};

export const getSalesHistory = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    
    // Récupérer les 50 dernières ventes
    const result = await pool.query(
      `SELECT s.*, u.name as vendor_name 
       FROM sales s
       JOIN users u ON s.vendor_id = u.id
       WHERE s.tenant_id = $1
       ORDER BY s.created_at DESC
       LIMIT 50`,
      [tenantId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur historique ventes' });
  }
};
