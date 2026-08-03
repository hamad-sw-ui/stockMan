-- V007 — Inventaire physique professionnel (phase E5)
-- =============================================================================
-- Campagnes d'inventaire à cycle complet : BROUILLON → COMPTAGE (théorique
-- figé au lancement, coût CUMP figé pour la valorisation des écarts) →
-- REVUE (écarts calculés, motif codifié exigé par ligne d'écart) → CLÔTURÉE
-- (ajustements postés par le moteur de stock existant, audités).
-- Garde-fous métier : le validateur ne peut pas être le compteur ; comptage
-- aveugle optionnel (le théorique est masqué via l'API pendant le comptage) ;
-- gel optionnel des mouvements du dépôt pendant le comptage ; inventaire
-- tournant ABC (périmètres A/B/C avec échéancier suivi).
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventory_campaigns (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id      UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    status        VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                  ('DRAFT','COUNTING','REVIEW','CLOSED','CANCELLED')),
    scope         VARCHAR(10) NOT NULL DEFAULT 'ALL' CHECK (scope IN
                  ('ALL','SELECTION','ABC_A','ABC_B','ABC_C')),
    blind         BOOLEAN NOT NULL DEFAULT false, -- comptage aveugle
    freeze_stock  BOOLEAN NOT NULL DEFAULT false, -- gel des mouvements du dépôt
    note          TEXT,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at    TIMESTAMPTZ,
    validated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    validated_at  TIMESTAMPTZ,
    closed_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_campaigns ON inventory_campaigns(tenant_id, created_at DESC);
-- Une seule campagne active (gel effectif) par dépôt à la fois
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_active_depot
    ON inventory_campaigns(depot_id) WHERE status IN ('DRAFT','COUNTING','REVIEW');

-- Périmètre explicite (scope SELECTION) : produits retenus pour la campagne
CREATE TABLE IF NOT EXISTS inventory_campaign_products (
    campaign_id UUID NOT NULL REFERENCES inventory_campaigns(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, product_id)
);

CREATE TABLE IF NOT EXISTS inventory_count_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES inventory_campaigns(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id      UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    theoretical_qty NUMERIC(15,2) NOT NULL DEFAULT 0,   -- figé au lancement
    theoretical_cost NUMERIC(15,2) NOT NULL DEFAULT 0,  -- CUMP figé au lancement
    counted_qty     NUMERIC(15,2),                      -- saisi au comptage
    reason          VARCHAR(30) CHECK (reason IS NULL OR reason IN
                    ('MISCOUNT','BREAKAGE','THEFT','EXPIRY','SUPPLIER_ERROR','DATA_ERROR','OTHER')),
    counted_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    counted_at      TIMESTAMPTZ,
    variance_qty    NUMERIC(15,2),                      -- calculé à la revue
    applied         BOOLEAN NOT NULL DEFAULT false,     -- ajustement posté
    applied_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_inv_count_items ON inventory_count_items(campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_item
    ON inventory_count_items(campaign_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'));

-- Motif codifié d'ajustement (quick-win : tout ajustement manuel peut porter
-- un code d'analyse ; les campagnes l'exigent sur chaque ligne d'écart).
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS reason_code VARCHAR(30);
