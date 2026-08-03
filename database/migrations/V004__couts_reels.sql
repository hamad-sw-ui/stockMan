-- ============================================================================
-- V004 — Coûts réels et traçabilité des lots (Phases E1/E2 de
--        docs/05_AUDIT_EXPERT_STOCK.md) :
--  • CUMP (coût unitaire moyen pondéré) par produit, recalculé à chaque entrée
--    (référentiel SYSCOHADA) — `products.avg_cost` ;
--  • coût FIGÉ par ligne de vente (`sale_items.unit_cost`) : la marge
--    historique ne bouge plus quand le prix d'achat change ;
--  • coût mémorisé par lot (`stock_batches.unit_cost`) et traçabilité lot des
--    sorties (`sale_items.batch_id`, `stock_movements.batch_id` + coûts) —
--    base du rapport de rappel et du FEFO factuel ;
--  • flag produit « gestion par lot obligatoire » (pharma/dénrées datées).
-- Le CUMP est tenu au niveau PRODUIT (tous dépôts confondus) — convention
-- documentée dans docs/06_PLAN_EXPERT.md.
-- ============================================================================

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS avg_cost NUMERIC(15,2) NOT NULL DEFAULT 0
        CHECK (avg_cost >= 0),
    ADD COLUMN IF NOT EXISTS track_batch BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE stock_batches
    ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15,2) NOT NULL DEFAULT 0
        CHECK (unit_cost >= 0);

-- Ligne de vente : coût figé à l'instant T + lot prélevé (FEFO ou manuel).
ALTER TABLE sale_items
    ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15,2) NULL,
    ADD COLUMN IF NOT EXISTS batch_id UUID NULL;
ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS fk_sale_items_batch;
ALTER TABLE sale_items ADD CONSTRAINT fk_sale_items_batch
    FOREIGN KEY (batch_id) REFERENCES stock_batches(id) ON DELETE SET NULL;

-- Journal des mouvements : lot + coût du flux (valorisation complète).
ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS batch_id UUID NULL,
    ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15,2) NULL;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS fk_movements_batch;
ALTER TABLE stock_movements ADD CONSTRAINT fk_movements_batch
    FOREIGN KEY (batch_id) REFERENCES stock_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sale_items_batch ON sale_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_movements_batch ON stock_movements(batch_id);

-- Retours client rattachés à la ligne de vente d'origine (coût + lot exacts).
ALTER TABLE sale_return_items
    ADD COLUMN IF NOT EXISTS sale_item_id UUID NULL,
    ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15,2) NULL,
    ADD COLUMN IF NOT EXISTS batch_id UUID NULL;
ALTER TABLE sale_return_items DROP CONSTRAINT IF EXISTS fk_return_items_sale_item;
ALTER TABLE sale_return_items ADD CONSTRAINT fk_return_items_sale_item
    FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE SET NULL;

-- Amorçage même-table uniquement (portable) : le CUMP initial = dernier coût
-- catalogue ; la revalorisation croisée complète de l'historique est assurée
-- par costingService.revalueTenantCosts() (boucle applicative, idempotente).
UPDATE products SET avg_cost = purchase_price WHERE avg_cost = 0;

-- Transferts préservant les lots (E2) : allocation FEFO détaillée de chaque
-- ligne de transfert, rejouée à l'identique à la réception/annulation.
CREATE TABLE IF NOT EXISTS stock_transfer_item_batches (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_item_id UUID NOT NULL REFERENCES stock_transfer_items(id) ON DELETE CASCADE,
    batch_id         UUID REFERENCES stock_batches(id) ON DELETE SET NULL, -- lot source
    batch_number     VARCHAR(100) NOT NULL, -- figé (le lot source peut disparaître)
    expiry_date      DATE,
    unit_cost        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    quantity         NUMERIC(15,2) NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_tib_item ON stock_transfer_item_batches(transfer_item_id);

-- Un lot physique peut légitimement exister dans PLUSIEURS dépôts (après un
-- transfert, c'est le même lot !). L'unicité du numéro de lot devient donc
-- (produit, dépôt, variante, numéro) — avant elle incluait tout le tenant et
-- rendait impossible la présence du même lot sur deux sites.
DROP INDEX IF EXISTS uq_batches_product_number;
CREATE UNIQUE INDEX IF NOT EXISTS uq_batches_product_number
    ON stock_batches(product_id, depot_id,
                     COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'),
                     batch_number);
