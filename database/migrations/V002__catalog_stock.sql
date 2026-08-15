-- ============================================================================
-- V002 — Catalogue dissocié du stock (DAT-02/DAT-03) : produits niveau tenant,
--        variantes, niveaux de stock PAR DÉPÔT, lots FEFO, fournisseurs,
--        catégories, unités avec conversion (DAT-04).
-- ============================================================================

CREATE TABLE IF NOT EXISTS categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS units (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name       VARCHAR(100) NOT NULL,
    symbol     VARCHAR(20) NOT NULL,
    base_value NUMERIC(15,4) NOT NULL DEFAULT 1 CHECK (base_value > 0), -- ex. Carton×12 = 12
    is_base    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS suppliers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name       VARCHAR(255) NOT NULL,
    email      VARCHAR(255),
    phone      VARCHAR(50),
    address    TEXT,
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
    barcode         VARCHAR(100),
    purchase_price  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
    selling_price   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
    min_stock_level NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (min_stock_level >= 0),
    unit_id         UUID REFERENCES units(id) ON DELETE RESTRICT,  -- unité de BASE
    has_variants    BOOLEAN NOT NULL DEFAULT FALSE,
    image_url       TEXT,
    archived_at     TIMESTAMPTZ,                    -- soft-delete (DAT-05)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_barcode
    ON products(tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_tenant_active
    ON products(tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

CREATE TABLE IF NOT EXISTS product_variants (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name             VARCHAR(255) NOT NULL,        -- ex. « Bleu / XL »
    sku              VARCHAR(100),
    barcode          VARCHAR(100),
    additional_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    attributes       JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_variants_sku
    ON product_variants(product_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

-- Stock par produit × dépôt × variante. UUID zéro = « sans variante ».
-- Niveaux de stock : une ligne par (produit, dépôt, variante) ; variant_id NULL
-- = produit sans variante (DAT-04). L'unicité tolérante au NULL passe par un
-- index d'expression COALESCE (un PK ne peut pas contenir de colonne nullable,
-- et le sentinelle casserait la FK vers product_variants).
CREATE TABLE IF NOT EXISTS stock_levels (
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    depot_id   UUID NOT NULL REFERENCES depots(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
    quantity   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_levels
    ON stock_levels (product_id, depot_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'));
CREATE INDEX IF NOT EXISTS idx_stock_levels_depot ON stock_levels(depot_id);

-- Lots pour FEFO ; expiry NULL = non périssable (DAT-07)
CREATE TABLE IF NOT EXISTS stock_batches (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id    UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    depot_id      UUID REFERENCES depots(id) ON DELETE SET NULL,
    supplier_id   UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    batch_number  VARCHAR(100) NOT NULL,
    quantity      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    expiry_date   DATE,
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_batches_product_number
    ON stock_batches(product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'), batch_number);
CREATE INDEX IF NOT EXISTS idx_batches_product_expiry ON stock_batches(product_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON stock_batches(expiry_date) WHERE quantity > 0;
