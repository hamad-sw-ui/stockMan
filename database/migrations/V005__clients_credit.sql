-- ============================================================================
-- V005 — Clients, crédit et devis (Phase E3 de docs/05_AUDIT_EXPERT_STOCK.md) :
--  • fiche client avec limite de crédit et solde maintenu par l'application ;
--  • vente à crédit / partielle / mixte : versements multiples par vente,
--    idempotents hors-ligne (client_payment_id) ;
--  • devis / facture proforma (B2B demi-gros) convertible en vente au prix
--    figé du devis, avec date de validité.
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name         VARCHAR(255) NOT NULL,
    phone        VARCHAR(50),
    email        VARCHAR(255),
    address      TEXT,
    notes        TEXT,
    credit_limit NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0), -- 0 = aucune limite
    balance      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),      -- solde dû courant
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_name ON customers(tenant_id, name);

-- Vente : client, statut de paiement et échéance.
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS customer_id UUID NULL,
    ADD COLUMN IF NOT EXISTS due_date DATE NULL,
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
    ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);
ALTER TABLE sales DROP CONSTRAINT IF EXISTS fk_sales_customer;
ALTER TABLE sales ADD CONSTRAINT fk_sales_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_status_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_status_check
    CHECK (payment_status IN ('PAID','PARTIAL','CREDIT'));
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(tenant_id, customer_id);

-- Les ventes déjà payées intégralement (avant V005) sont marquées soldées.
UPDATE sales SET amount_paid = total_amount
 WHERE payment_status = 'PAID' AND amount_paid = 0;

-- Versements (un à n par vente) : paiement mixte, avances, règlements
-- d'échéance. client_payment_id = idempotence de la synchro hors-ligne.
CREATE TABLE IF NOT EXISTS sale_payments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sale_id           UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL, -- dénormalisé (soldes, relances)
    method            VARCHAR(20) NOT NULL CHECK (method IN ('CASH','MTN_MOMO','ORANGE_MONEY')),
    amount            NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    reference         TEXT,
    received_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    client_payment_id UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_payments_client
    ON sale_payments(tenant_id, client_payment_id) WHERE client_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_sale ON sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON sale_payments(tenant_id, customer_id, created_at DESC);

-- Les ventes historiques déjà soldées reçoivent leur versement (cohérence
-- du Z de caisse calculé sur les encaissements réels).
INSERT INTO sale_payments (tenant_id, sale_id, method, amount, received_by, created_at)
SELECT s.tenant_id, s.id, s.payment_method, s.total_amount, s.vendor_id, s.created_at
  FROM sales s
  LEFT JOIN sale_payments p ON p.sale_id = s.id
 WHERE s.status = 'COMPLETED' AND s.amount_paid > 0 AND p.id IS NULL;

-- Devis / proforma (le prix est figé au jour du devis — il engage le vendeur).
CREATE TABLE IF NOT EXISTS quotes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id          UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','CONVERTED','CANCELLED')),
    total_amount      NUMERIC(15,2) NOT NULL CHECK (total_amount >= 0),
    note              TEXT,
    valid_until       DATE,
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    converted_sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotes_tenant ON quotes(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quote_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id    UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    unit_id     UUID REFERENCES units(id) ON DELETE SET NULL,
    quantity    NUMERIC(15,2) NOT NULL CHECK (quantity > 0),
    base_qty    NUMERIC(15,2) NOT NULL CHECK (base_qty > 0),
    unit_price  NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(15,2) NOT NULL CHECK (total_price >= 0)
);
