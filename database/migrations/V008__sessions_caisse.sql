-- ============================================================================
-- V008 — Sessions de caisse (E6) : fond d'ouverture, attendu par méthode,
--        compté physique à la clôture, écart, Z de caisse figé (immuable),
--        journée métier verrouillée après clôture.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cash_sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id       UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    status         VARCHAR(10) NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN','CLOSED')),
    -- Journée métier (fuseau du tenant, calculée application) : la clôture
    -- du Z la verrouille définitivement pour le dépôt.
    business_date  DATE NOT NULL,
    opened_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    opening_float  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
    note           TEXT,
    closed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    closed_at      TIMESTAMPTZ,
    -- Compté physique déclaré à la clôture (espèces obligatoires, soldes
    -- MoMo/OM optionnels). NULL tant que la session est ouverte.
    counted_cash   NUMERIC(15,2) CHECK (counted_cash IS NULL OR counted_cash >= 0),
    counted_mtn    NUMERIC(15,2) CHECK (counted_mtn IS NULL OR counted_mtn >= 0),
    counted_om     NUMERIC(15,2) CHECK (counted_om IS NULL OR counted_om >= 0),
    -- Z de caisse : photographie immuable générée à la clôture (attendus par
    -- méthode, CA, encaissements, écarts). Jamais modifié ensuite.
    z_report       JSONB
);
-- Une seule session OUVERTE à la fois par dépôt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_session_open
    ON cash_sessions(tenant_id, depot_id) WHERE status = 'OPEN';
-- Une seule journée métier par dépôt : après clôture, impossible de rouvrir
-- la même journée (journée verrouillée).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_session_day
    ON cash_sessions(tenant_id, depot_id, business_date);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_list
    ON cash_sessions(tenant_id, depot_id, opened_at DESC);

-- Rattachement des ventes et des encaissements à la session de caisse active.
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS cash_session_id UUID
    REFERENCES cash_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_session ON sales(cash_session_id);

ALTER TABLE sale_payments
    ADD COLUMN IF NOT EXISTS cash_session_id UUID
    REFERENCES cash_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_session ON sale_payments(cash_session_id);
