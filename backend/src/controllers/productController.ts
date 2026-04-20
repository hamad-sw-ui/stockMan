import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

// Récupérer tous les produits du Tenant avec Variantes et Lots
export const getProducts = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;

    // 1. Récupérer les produits de base
    const productsRes = await pool.query(
      `SELECT p.*, c.name as category_name, u.symbol as unit_symbol, u.name as unit_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN units u ON p.unit_id = u.id
       WHERE p.tenant_id = $1
       ORDER BY p.name ASC`,
      [tenantId]
    );

    const products = productsRes.rows;

    // 2. Pour chaque produit, récupérer ses variantes et ses lots
    const productsWithDetails = await Promise.all(products.map(async (product) => {
      const variantsRes = await pool.query(
        'SELECT * FROM product_variants WHERE product_id = $1',
        [product.id]
      );
      
      const batchesRes = await pool.query(
        'SELECT * FROM stock_batches WHERE product_id = $1 ORDER BY expiry_date ASC',
        [product.id]
      );

      return {
        ...product,
        variants: variantsRes.rows,
        batches: batchesRes.rows
      };
    }));

    res.json(productsWithDetails);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur récupération produits' });
  }
};

// Créer un produit avec ses variantes et ses lots (Phase 3)
export const createProduct = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const tenantId = req.user?.tenantId;
    const { 
      depot_id, name, description, category_id, barcode, 
      purchase_price, selling_price, quantity, min_stock_level, 
      unit_id, has_variants, variants, batches 
    } = req.body;

    await client.query('BEGIN');

    // 1. Insertion du produit principal
    const productResult = await client.query(
      `INSERT INTO products 
       (tenant_id, depot_id, name, description, category_id, barcode, purchase_price, selling_price, quantity, min_stock_level, unit_id, has_variants)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [tenantId, depot_id, name, description, category_id, barcode, purchase_price, selling_price, quantity, min_stock_level, unit_id, has_variants]
    );

    const productId = productResult.rows[0].id;

    // 2. Insertion des variantes si présentes
    if (has_variants && variants && Array.isArray(variants)) {
      for (const variant of variants) {
        await client.query(
          `INSERT INTO product_variants (product_id, name, sku, additional_price, quantity, attributes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [productId, variant.name, variant.sku, variant.additional_price || 0, variant.quantity || 0, variant.attributes || {}]
        );
      }
    }

    // 3. Insertion des lots si présents
    if (batches && Array.isArray(batches)) {
      for (const batch of batches) {
        await client.query(
          `INSERT INTO stock_batches (product_id, batch_number, quantity, expiry_date, received_date)
           VALUES ($1, $2, $3, $4, $5)`,
          [productId, batch.batchNumber, batch.quantity, batch.expiryDate, batch.receivedDate || new Date()]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(productResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Erreur création produit' });
  } finally {
    client.release();
  }
};

// Modifier un produit
export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;
    const updates = req.body;

    const query = `
      UPDATE products 
      SET name = $1, description = $2, purchase_price = $3, selling_price = $4, 
          quantity = $5, min_stock_level = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7 AND tenant_id = $8
      RETURNING *`;

    const result = await pool.query(query, [
      updates.name, updates.description, updates.purchase_price, updates.selling_price,
      updates.quantity, updates.min_stock_level, id, tenantId
    ]);

    if (result.rows.length === 0) return res.status(404).json({ message: 'Produit non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur modification produit' });
  }
};

// Supprimer un produit
export const deleteProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;

    await pool.query('DELETE FROM products WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    res.json({ message: 'Produit supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur suppression produit' });
  }
};
