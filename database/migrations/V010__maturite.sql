-- ============================================================================
-- V010 — Maturité (E8) :
--   • Transferts v2 : réception partielle, motifs d'écart (DAMAGE/LOSS)
--     valorisés, reliquat, stock en transit ;
--   • Sérialisation IMEI (électronique/téléphonie) : produit sérialisé,
--     vente = numéro précis ;
--   • Prix : historique des changements, grille gros/détail, plafond de
--     remise par utilisateur, promotions datées ;
--   • Pilotage par dépôt : seuil d'alerte par dépôt + rayonnage (bin
--     location), stock RÉSERVÉ (non vendable) ;
--   • Confort : colonnes nécessaires aux rapports KPI (ABC, rotation,
--     couverture, dormant) et à l'import/export.
--
--   NOTE TECHNIQUE (compat pg-mem des tests) : les CHECKs sont TOUJOURS
--   posés en contraintes NOMMÉES de niveau table, regroupées EN FIN DE
--   FICHIER après DROP ... IF EXISTS — un ALTER ... ADD COLUMN portant un
--   CHECK en ligne déclenche un bug « Corrupted alias » de pg-mem dès
--   qu'un DROP CONSTRAINT l'a précédé (Postgres réel n'est pas concerné).
-- ============================================================================

-- ---------------------------------------------------------------- Transferts
-- Suivi par ligne : reçu / perdu / motif d'écart (DAMAGE casse, LOSS perte).
ALTER TABLE stock_transfer_items
    ADD COLUMN IF NOT EXISTS received_qty NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE stock_transfer_items
    ADD COLUMN IF NOT EXISTS lost_qty NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE stock_transfer_items
    ADD COLUMN IF NOT EXISTS discrepancy_reason VARCHAR(20);

-- ----------------------------------------------------------------- Séries
-- Produit vendu À L'UNITÉ identifiée (IMEI téléphones, n° série électroménager).
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS requires_serial BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS product_serials (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    depot_id    UUID NOT NULL REFERENCES depots(id) ON DELETE CASCADE,
    serial      VARCHAR(120) NOT NULL,
    status      VARCHAR(10) NOT NULL DEFAULT 'IN_STOCK'
                CHECK (status IN ('IN_STOCK','SOLD')),
    sale_item_id UUID REFERENCES sale_items(id) ON DELETE SET NULL,
    sold_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, product_id, serial)
);
CREATE INDEX IF NOT EXISTS idx_serials_stock
    ON product_serials(tenant_id, depot_id, product_id, status);
CREATE INDEX IF NOT EXISTS idx_serials_lookup ON product_serials(tenant_id, serial);

-- -------------------------------------------------------------------- Prix
-- Historique des changements de prix (qui, quand, ancien → nouveau).
CREATE TABLE IF NOT EXISTS price_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    field       VARCHAR(12) NOT NULL DEFAULT 'DETAIL'
                CHECK (field IN ('DETAIL','WHOLESALE')),
    old_price   NUMERIC(15,2),
    new_price   NUMERIC(15,2), -- NULL = grille de gros retirée (WHOLESALE)
    changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (old_price IS NOT NULL OR new_price IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_price_history_product
    ON price_history(product_id, created_at DESC);

-- Grille tarifaire : prix de GROS (demi-gros) avec quantité seuil.
ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(15,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_min_qty NUMERIC(15,2)
    NOT NULL DEFAULT 0;
-- Canal de prix du client (détail / gros).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_channel VARCHAR(10)
    NOT NULL DEFAULT 'DETAIL';

-- Plafond de remise manuelle par utilisateur (NULL = défaut du rôle :
-- 10 % vendeur, 100 % admin) — encadre les remises négociées à la caisse.
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_discount_pct NUMERIC(5,2);

-- Promotions datées (produit précis, ou globale si product_id NULL) :
-- remise automatique dans la fenêtre, figée sur la ligne de vente.
CREATE TABLE IF NOT EXISTS promotions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id   UUID REFERENCES products(id) ON DELETE CASCADE, -- NULL = tout le catalogue
    name         VARCHAR(160) NOT NULL,
    discount_pct NUMERIC(5,2) NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
    starts_at    TIMESTAMPTZ NOT NULL,
    ends_at      TIMESTAMPTZ NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_promotions_active
    ON promotions(tenant_id, is_active, starts_at, ends_at);

-- La remise promotionnelle appliquée est figée sur la ligne (preuve du prix).
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS promo_pct NUMERIC(5,2);

-- ------------------------------------------------------------ Par dépôt
-- Seuil d'alerte surchargeable par dépôt + rayonnage (bin location).
CREATE TABLE IF NOT EXISTS product_depot_settings (
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    depot_id        UUID NOT NULL REFERENCES depots(id) ON DELETE CASCADE,
    min_stock_level NUMERIC(15,2),
    bin_location    VARCHAR(60),
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, depot_id)
);

-- Stock RÉSERVÉ (commande client confirmée non livrée) : le disponible à la
-- vente = quantity − reserved_qty (contrôlé serveur à la caisse).
ALTER TABLE stock_levels
    ADD COLUMN IF NOT EXISTS reserved_qty NUMERIC(15,2) NOT NULL DEFAULT 0;

-- ============================================================================
-- CONTRAINTES CHECK — nommées, en fin de fichier (cf. note d'en-tête).
-- ============================================================================

ALTER TABLE stock_transfer_items DROP CONSTRAINT IF EXISTS stock_transfer_items_received_qty_check;
ALTER TABLE stock_transfer_items ADD CONSTRAINT stock_transfer_items_received_qty_check
    CHECK (received_qty >= 0);
ALTER TABLE stock_transfer_items DROP CONSTRAINT IF EXISTS stock_transfer_items_lost_qty_check;
ALTER TABLE stock_transfer_items ADD CONSTRAINT stock_transfer_items_lost_qty_check
    CHECK (lost_qty >= 0);
ALTER TABLE stock_transfer_items DROP CONSTRAINT IF EXISTS stock_transfer_items_discrepancy_reason_check;
ALTER TABLE stock_transfer_items ADD CONSTRAINT stock_transfer_items_discrepancy_reason_check
    CHECK (discrepancy_reason IS NULL OR discrepancy_reason IN ('DAMAGE','LOSS'));

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_wholesale_price_check;
ALTER TABLE products ADD CONSTRAINT products_wholesale_price_check
    CHECK (wholesale_price IS NULL OR wholesale_price >= 0);
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_wholesale_min_qty_check;
ALTER TABLE products ADD CONSTRAINT products_wholesale_min_qty_check
    CHECK (wholesale_min_qty >= 0);

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_price_channel_check;
ALTER TABLE customers ADD CONSTRAINT customers_price_channel_check
    CHECK (price_channel IN ('DETAIL','WHOLESALE'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_max_discount_pct_check;
ALTER TABLE users ADD CONSTRAINT users_max_discount_pct_check
    CHECK (max_discount_pct IS NULL OR (max_discount_pct >= 0 AND max_discount_pct <= 100));

ALTER TABLE stock_levels DROP CONSTRAINT IF EXISTS stock_levels_reserved_qty_check;
ALTER TABLE stock_levels ADD CONSTRAINT stock_levels_reserved_qty_check
    CHECK (reserved_qty >= 0);

ALTER TABLE product_depot_settings DROP CONSTRAINT IF EXISTS product_depot_settings_min_stock_level_check;
ALTER TABLE product_depot_settings ADD CONSTRAINT product_depot_settings_min_stock_level_check
    CHECK (min_stock_level IS NULL OR min_stock_level >= 0);

-- Statut intermédiaire des transferts : réception partielle en cours.
-- Noms de contraintes : Postgres réel = stock_transfers_status_check ;
-- pg-mem (tests) = stock_transfers_constraint_1 (ordre DDL V003 figé).
ALTER TABLE stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check;
ALTER TABLE stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_constraint_1;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_status_check
    CHECK (status IN ('PENDING','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'));
