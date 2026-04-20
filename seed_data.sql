-- Récupération du Tenant ID et du User ID (Admin existant)
-- Note: On utilise des sous-requêtes pour l'id du tenant
WITH tenant_info AS (SELECT tenant_id, id FROM users WHERE email = 'admin@stockman.cm' LIMIT 1)
INSERT INTO depots (tenant_id, name, address, phone, owner_id)
SELECT tenant_id, 'Dépôt Principal Douala', 'Akwa, Douala', '677000000', id FROM tenant_info
RETURNING id;

-- Mise à jour du depot_id pour l'admin
UPDATE users 
SET depot_id = (SELECT id FROM depots WHERE name = 'Dépôt Principal Douala' LIMIT 1)
WHERE email = 'admin@stockman.cm';

-- Insertion des catégories
INSERT INTO categories (tenant_id, name, description)
SELECT tenant_id, 'Boissons', 'Toutes les boissons fraîches' FROM users WHERE email = 'admin@stockman.cm' LIMIT 1;

INSERT INTO categories (tenant_id, name, description)
SELECT tenant_id, 'Alimentaire', 'Produits secs et riz' FROM users WHERE email = 'admin@stockman.cm' LIMIT 1;

-- Insertion des unités
INSERT INTO units (tenant_id, name, symbol, base_value, is_base)
SELECT tenant_id, 'Pièce', 'Pce', 1, TRUE FROM users WHERE email = 'admin@stockman.cm' LIMIT 1;

INSERT INTO units (tenant_id, name, symbol, base_value, is_base)
SELECT tenant_id, 'Carton (x12)', 'Ctn', 12, FALSE FROM users WHERE email = 'admin@stockman.cm' LIMIT 1;

-- Insertion des produits
INSERT INTO products (tenant_id, depot_id, name, description, category_id, barcode, purchase_price, selling_price, quantity, min_stock_level, unit_id)
SELECT 
    u.tenant_id, 
    u.depot_id, 
    'Eau Minérale Tangui 1.5L', 
    'Eau naturelle du Cameroun', 
    (SELECT id FROM categories WHERE name = 'Boissons' LIMIT 1),
    '37000001', 
    250, 400, 150, 20, 
    (SELECT id FROM units WHERE name = 'Pièce' LIMIT 1)
FROM users u WHERE u.email = 'admin@stockman.cm';

INSERT INTO products (tenant_id, depot_id, name, description, category_id, barcode, purchase_price, selling_price, quantity, min_stock_level, unit_id)
SELECT 
    u.tenant_id, 
    u.depot_id, 
    'Jus Top Pamplemousse 0.5L', 
    'Brasseries du Cameroun', 
    (SELECT id FROM categories WHERE name = 'Boissons' LIMIT 1),
    '37000002', 
    200, 350, 5, 10, 
    (SELECT id FROM units WHERE name = 'Pièce' LIMIT 1)
FROM users u WHERE u.email = 'admin@stockman.cm';

INSERT INTO products (tenant_id, depot_id, name, description, category_id, barcode, purchase_price, selling_price, quantity, min_stock_level, unit_id)
SELECT 
    u.tenant_id, 
    u.depot_id, 
    'Riz Mémé Cassé 5kg', 
    'Riz parfumé de qualité', 
    (SELECT id FROM categories WHERE name = 'Alimentaire' LIMIT 1),
    '37000003', 
    3500, 4500, 40, 5, 
    (SELECT id FROM units WHERE name = 'Pièce' LIMIT 1)
FROM users u WHERE u.email = 'admin@stockman.cm';
