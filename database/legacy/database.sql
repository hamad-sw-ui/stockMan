-- Extension pour la génération de UUID si nécessaire
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TABLE TENANTS (Clients SaaS)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(100) UNIQUE,
    logo TEXT,
    primary_color VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. TABLE USERS (Utilisateurs avec RBAC)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'VENDEUR')),
    depot_id UUID,
    pin_code VARCHAR(10),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, email)
);

-- 3. TABLE LICENSES
CREATE TABLE licenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_name VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'TRIAL',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    max_depots INTEGER DEFAULT 1,
    max_users INTEGER DEFAULT 5,
    last_verified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. TABLE DEPOTS
CREATE TABLE depots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    owner_id UUID REFERENCES users(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ajout de la contrainte circulaire
ALTER TABLE users ADD CONSTRAINT fk_user_depot FOREIGN KEY (depot_id) REFERENCES depots(id);

-- 5. TABLE CATEGORIES
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    UNIQUE(tenant_id, name)
);

-- 6. TABLE UNITS
CREATE TABLE units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    base_value DECIMAL DEFAULT 1,
    is_base BOOLEAN DEFAULT TRUE
);

-- 7. TABLE PRODUCTS
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id UUID REFERENCES depots(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category_id UUID REFERENCES categories(id),
    barcode VARCHAR(100),
    purchase_price DECIMAL(15,2) DEFAULT 0,
    selling_price DECIMAL(15,2) DEFAULT 0,
    quantity DECIMAL(15,2) DEFAULT 0,
    min_stock_level DECIMAL(15,2) DEFAULT 5,
    unit_id UUID REFERENCES units(id),
    has_variants BOOLEAN DEFAULT FALSE,
    expiration_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. TABLE SALES
CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id UUID NOT NULL REFERENCES depots(id),
    vendor_id UUID NOT NULL REFERENCES users(id),
    total_amount DECIMAL(15,2) NOT NULL,
    payment_method VARCHAR(50) CHECK (payment_method IN ('CASH', 'MTN_MOMO', 'ORANGE_MONEY')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. TABLE SALE_ITEMS
CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity DECIMAL(15,2) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    total_price DECIMAL(15,2) NOT NULL
);

-- 10. TABLE AUDIT_LOGS
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    user_name VARCHAR(255),
    action VARCHAR(255) NOT NULL,
    entity VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100),
    previous_state JSONB,
    new_state JSONB,
    details TEXT,
    depot_id UUID,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexation
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_sales_tenant ON sales(tenant_id);
CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id);
