-- V006 — Approvisionnement professionnel (phase E4)
-- =============================================================================
-- Bons de commande fournisseurs à cycle complet (BROUILLON → ENVOYÉE →
-- RÉCEPTION_PARTIELLE → CLÔTURÉE / ANNULÉE) avec suivis produit par produit :
-- reliquats calculés, motifs d'écart codifiés, délai prévu/réel (OTIF),
-- réceptions rattachées et flux de retour fournisseur valorisé au coût réel
-- du lot. La récéption d'une commande réutilise le moteur de réception
-- existant (CUMP repondéré, lots créés/fusionnés) : coûts réels garantis.
-- =============================================================================

-- ----------------------------------- Fournisseurs ---------------------------
-- Délai d'approvisionnement habituel (jours) : alimente le prédictif et l'OTIF.
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS default_lead_time_days INTEGER NOT NULL DEFAULT 3
  CHECK (default_lead_time_days >= 0);

-- ------------------------------ Bons de commande ----------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    supplier_id   UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    depot_id      UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    status        VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                  ('DRAFT','SENT','PARTIALLY_RECEIVED','CLOSED','CANCELLED')),
    reference     VARCHAR(100),
    expected_at   DATE,               -- livraison prévue (défaut : création + lead time fournisseur)
    first_received_at TIMESTAMPTZ,    -- première réception rattachée (délai réel)
    close_reason  VARCHAR(40) CHECK (close_reason IS NULL OR close_reason IN
                  ('DELIVERED','SUPPLIER_SHORTAGE','CANCELLED_BY_SUPPLIER','PRICE_DISPUTE','OTHER')),
    note          TEXT,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    sent_at       TIMESTAMPTZ,
    closed_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_tenant ON purchase_orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(tenant_id, supplier_id, status);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id          UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id     UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id     UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    quantity       NUMERIC(15,2) NOT NULL CHECK (quantity > 0),     -- commandé (unités de base)
    received_qty   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
    unit_cost      NUMERIC(15,2) NOT NULL CHECK (unit_cost >= 0)    -- coût négocié/attendu
);
CREATE INDEX IF NOT EXISTS idx_poi_po ON purchase_order_items(po_id);

-- Une réception peut être rattachée à une commande (avancement des reliquats)
ALTER TABLE stock_receipts
  ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_po ON stock_receipts(purchase_order_id);

-- Ligne de réception ↔ ligne de commande (permet les compteurs exacts) et
-- motif d'écart codifié quand la quantité livrée diffère de l'attendu.
ALTER TABLE stock_receipt_items
  ADD COLUMN IF NOT EXISTS po_item_id UUID REFERENCES purchase_order_items(id) ON DELETE SET NULL;
ALTER TABLE stock_receipt_items
  ADD COLUMN IF NOT EXISTS discrepancy_reason VARCHAR(40) CHECK (discrepancy_reason IS NULL OR discrepancy_reason IN
                 ('NONE','SHORT_DELIVERY','DAMAGED','WRONG_PRODUCT','QUALITY','PRICE_CHANGE','OTHER'));

-- ----------------------------- Retours fournisseur --------------------------
CREATE TABLE IF NOT EXISTS supplier_returns (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    supplier_id  UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    depot_id     UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    receipt_id   UUID REFERENCES stock_receipts(id) ON DELETE SET NULL, -- retour rattaché à une livraison
    reason       VARCHAR(40) NOT NULL DEFAULT 'OTHER' CHECK (reason IN
                 ('DAMAGED','EXPIRED','WRONG_PRODUCT','QUALITY','OVERDELIVERY','OTHER')),
    note         TEXT,
    total_cost   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sr_tenant ON supplier_returns(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_return_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id   UUID NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    batch_id    UUID REFERENCES stock_batches(id) ON DELETE SET NULL,
    quantity    NUMERIC(15,2) NOT NULL CHECK (quantity > 0),  -- unités de base
    unit_cost   NUMERIC(15,2) NOT NULL CHECK (unit_cost >= 0) -- coût réel du lot renvoyé
);
CREATE INDEX IF NOT EXISTS idx_sri_return ON supplier_return_items(return_id);

-- Type de mouvement dédié : le journal distingue un retour fournisseur d'une
-- simple sortie manuelle (audit, valorisation des écarts).
-- NB : deux DROP car le nom auto diffère — Postgres réel : *_type_check ;
-- pg-mem (tests) : *_constraint_1 (ordre DDL V003 figé). Le CHK quantité
-- positive (*_constraint_2) est préservé.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_constraint_1;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('IN','OUT','TRANSFER','ADJUSTMENT','SALE','RETURN','DAMAGE','EXPIRED','VOID','SUPPLIER_RETURN'));
