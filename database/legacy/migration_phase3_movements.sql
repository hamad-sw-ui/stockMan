-- MIGRATION PHASE 3 : TRAÇABILITÉ STOCK PRO (v1.0)

-- 1. Table des mouvements de stock
CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id UUID NOT NULL REFERENCES depots(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id UUID, -- Optionnel si pas de variantes
    user_id UUID NOT NULL REFERENCES users(id),
    
    type VARCHAR(50) NOT NULL CHECK (
        type IN ('IN', 'OUT', 'TRANSFER', 'ADJUSTMENT', 'SALE', 'RETURN', 'DAMAGE', 'EXPIRED')
    ),
    quantity DECIMAL(15,2) NOT NULL, -- Toujours positif, le type détermine le sens
    previous_stock DECIMAL(15,2),
    new_stock DECIMAL(15,2),
    
    reason TEXT,
    reference_id UUID, -- ID de la vente, du transfert, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Ajout de variantes de produits (si pas déjà fait via migration précédente)
CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100),
    additional_price DECIMAL(15,2) DEFAULT 0,
    quantity DECIMAL(15,2) DEFAULT 0,
    attributes JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Ajout de lots (Stock Batches) pour FEFO
CREATE TABLE IF NOT EXISTS stock_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    batch_number VARCHAR(100) NOT NULL,
    quantity DECIMAL(15,2) NOT NULL,
    expiry_date DATE,
    received_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexation pour performance
CREATE INDEX idx_movements_product ON stock_movements(product_id);
CREATE INDEX idx_movements_tenant ON stock_movements(tenant_id);
CREATE INDEX idx_movements_type ON stock_movements(type);
