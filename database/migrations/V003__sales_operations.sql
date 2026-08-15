-- ============================================================================
-- V003 — Opérations : ventes idempotentes offline (SEC-06/07), items avec
--        variante + unité de vente (DAT-01/04), retours/avoirs, réceptions
--        fournisseurs, transferts inter-dépôts, journal des mouvements.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id          UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    vendor_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status            VARCHAR(20) NOT NULL DEFAULT 'COMPLETED'
                      CHECK (status IN ('COMPLETED','VOIDED')),
    total_amount      NUMERIC(15,2) NOT NULL CHECK (total_amount >= 0),
    payment_method    VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH','MTN_MOMO','ORANGE_MONEY')),
    payment_reference TEXT,
    client_sale_id    UUID,             -- idempotence offline (SEC-07)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(), -- date métier (bornée serveur)
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()  -- réalité serveur
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_client
    ON sales(tenant_id, client_sale_id) WHERE client_sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON sales(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_depot_date ON sales(tenant_id, depot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_vendor_date ON sales(tenant_id, vendor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sale_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id     UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL, -- DAT-01 corrigé
    unit_id     UUID REFERENCES units(id) ON DELETE SET NULL,            -- unité de vente
    quantity    NUMERIC(15,2) NOT NULL CHECK (quantity > 0),             -- qté en unité de vente
    base_qty    NUMERIC(15,2) NOT NULL CHECK (base_qty > 0),             -- qté convertie en unité de base
    unit_price  NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),          -- prix/base, calculé serveur
    total_price NUMERIC(15,2) NOT NULL CHECK (total_price >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

-- Retours / avoirs partiels (vente conservée, traçabilité totale)
CREATE TABLE IF NOT EXISTS sale_returns (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id    UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    reason     TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sale_return_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id  UUID NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    base_qty   NUMERIC(15,2) NOT NULL CHECK (base_qty > 0),
    unit_price NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0)
);

-- Réceptions fournisseurs (mouvements IN, création de lots, coût d'achat)
CREATE TABLE IF NOT EXISTS stock_receipts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id    UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    received_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reference   VARCHAR(100),
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receipts_tenant ON stock_receipts(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stock_receipt_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES stock_receipts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    batch_id   UUID REFERENCES stock_batches(id) ON DELETE SET NULL,
    base_qty   NUMERIC(15,2) NOT NULL CHECK (base_qty > 0),
    unit_cost  NUMERIC(15,2) NOT NULL CHECK (unit_cost >= 0)
);

-- Transferts inter-dépôts à double validation (émission puis réception)
CREATE TABLE IF NOT EXISTS stock_transfers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    from_depot  UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    to_depot    UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    status      VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','RECEIVED','CANCELLED')),
    note        TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    received_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_at TIMESTAMPTZ,
    CHECK (from_depot <> to_depot)
);
CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    quantity    NUMERIC(15,2) NOT NULL CHECK (quantity > 0) -- en unités de base
);

-- Journal append-only de tous les flux de stock
CREATE TABLE IF NOT EXISTS stock_movements (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id       UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    product_id     UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id     UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    type           VARCHAR(20) NOT NULL CHECK (type IN
                   ('IN','OUT','TRANSFER','ADJUSTMENT','SALE','RETURN','DAMAGE','EXPIRED','VOID')),
    quantity       NUMERIC(15,2) NOT NULL CHECK (quantity > 0),
    previous_stock NUMERIC(15,2),
    new_stock      NUMERIC(15,2),
    reason         TEXT,
    reference_id   UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_tenant_time ON stock_movements(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(tenant_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_type ON stock_movements(tenant_id, type);
