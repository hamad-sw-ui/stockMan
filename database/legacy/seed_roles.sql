-- Hachage Bcrypt pour 'password123'
-- $2a$10$8.K.fmkp37S399ZGVWdf6uXit.7.7.7.7.7.7.7.7.7.7.7.7.7.7.7 est un exemple, 
-- mais je vais utiliser une requête UPDATE simple avec le hachage de l'admin existant pour être sûr.

-- 1. Créer le Tenant Système
INSERT INTO tenants (name, subdomain) VALUES ('StockMan System', 'system') ON CONFLICT DO NOTHING;

-- 2. Créer le Super Admin en copiant le mot de passe de l'admin existant (pour être sûr qu'il marche)
INSERT INTO users (tenant_id, name, email, password_hash, role)
SELECT 
    (SELECT id FROM tenants WHERE subdomain = 'system' LIMIT 1),
    'Super Administrateur',
    'superadmin@stockman.cm',
    (SELECT password_hash FROM users WHERE email = 'admin@stockman.cm' LIMIT 1),
    'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- 3. Créer le Vendeur
INSERT INTO users (tenant_id, depot_id, name, email, password_hash, role, pin_code)
SELECT 
    tenant_id,
    depot_id,
    'Vendeur Douala',
    'vendeur@stockman.cm',
    password_hash,
    'VENDEUR',
    '1234'
FROM users WHERE email = 'admin@stockman.cm' LIMIT 1
ON CONFLICT DO NOTHING;
