-- ============================================================================
-- V009 — Fiscalité Cameroun (E7) : TVA par produit (19,25 % / exonéré),
--        ventilation HT/TVA figée sur chaque ligne de vente (prix = TTC),
--        factures à numérotation légale CONTINUE par dépôt/série/année
--        (séquence verrouillée en transaction), facture immuable, avoir
--        (note de crédit) émis automatiquement à l'annulation ou au retour,
--        mentions obligatoires du tenant (raison sociale, NIU, RCCM).
--
--        DÉCISION : la numérotation légale DÉMARRE à la migration (les ventes
--        antérieures conservent leur reçu et leur ventilation recalculée mais
--        ne reçoivent pas de n° de facture rétroactif — continuité garantie à
--        partir de l'activation, sans trou, par séquence verrouillée).
-- ============================================================================

-- 1. TVA par produit (taux en % — 19,25 normal, 0 exonéré ; tout taux
--    intermédiaire reste possible, ex. dispositifs sectoriels).
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 19.25;
ALTER TABLE products
    DROP CONSTRAINT IF EXISTS products_tax_rate_check;
ALTER TABLE products
    ADD CONSTRAINT products_tax_rate_check CHECK (tax_rate >= 0 AND tax_rate <= 100);

-- 2. Mentions légales du tenant (imprimées sur factures et reçus).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS niu VARCHAR(50);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rccm VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS invoice_footer VARCHAR(500);

-- 3. Ventilation HT/TVA FIGÉE sur les lignes et les ventes (prix catalogue =
--    TTC ; HT = TTC / (1+taux), TVA = TTC − HT, par ligne, 2 décimales).
ALTER TABLE sale_items
    ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2);
ALTER TABLE sale_items
    ADD COLUMN IF NOT EXISTS total_ht NUMERIC(15,2);
ALTER TABLE sale_items
    ADD COLUMN IF NOT EXISTS total_vat NUMERIC(15,2);
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS total_ht NUMERIC(15,2);
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS total_vat NUMERIC(15,2);

-- Backfill historique (approximation documentée : les produits historiques
-- viennent de recevoir 19,25 % par défaut ; les prix ont toujours été TTC).
-- NB : arrondi laissé au typmod NUMERIC(15,2) de Postgres (l'arrondi exact
-- ligne par ligne s'applique aux nouvelles ventes, calculé application).
UPDATE sale_items SET tax_rate = 19.25 WHERE tax_rate IS NULL;
UPDATE sale_items
   SET total_ht  = total_price / 1.1925,
       total_vat = total_price - (total_price / 1.1925)
 WHERE total_ht IS NULL;
UPDATE sales SET total_ht = total_amount / 1.1925,
                 total_vat = total_amount - (total_amount / 1.1925)
 WHERE total_ht IS NULL;

-- 4. Séquences de facturation verrouillées (continuité légale) :
--    une ligne par (tenant, dépôt, série, année), incrémentée FOR UPDATE dans
--    la transaction d'émission → numérotation strictement croissante, sans
--    trou ni réutilisation (un rollback annule aussi l'incrément).
CREATE TABLE IF NOT EXISTS invoice_sequences (
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id    UUID NOT NULL REFERENCES depots(id) ON DELETE CASCADE,
    series      VARCHAR(4) NOT NULL CHECK (series IN ('FAC','AV')),
    year        INT NOT NULL,
    last_number INT NOT NULL DEFAULT 0 CHECK (last_number >= 0),
    PRIMARY KEY (tenant_id, depot_id, series, year)
);

-- 5. Factures : IMMUABLES (jamais modifiées ni supprimées — l'annulation
--    émet un AVOIR lié : parent_invoice_id). customer_name/depot_label et
--    noms de produits = instantanés figés à l'émission.
CREATE TABLE IF NOT EXISTS invoices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    depot_id          UUID NOT NULL REFERENCES depots(id) ON DELETE RESTRICT,
    depot_label       VARCHAR(10) NOT NULL,           -- slug figé (numéro)
    kind              VARCHAR(12) NOT NULL CHECK (kind IN ('INVOICE','CREDIT_NOTE')),
    series            VARCHAR(4) NOT NULL CHECK (series IN ('FAC','AV')),
    year              INT NOT NULL,
    seq               INT NOT NULL CHECK (seq > 0),
    number            VARCHAR(40) NOT NULL,           -- FAC-DEP-2026-000123
    sale_id           UUID REFERENCES sales(id) ON DELETE RESTRICT,
    sale_return_id    UUID REFERENCES sale_returns(id) ON DELETE RESTRICT,
    parent_invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
    customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name     VARCHAR(255),
    total_ht          NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_vat         NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_ttc         NUMERIC(15,2) NOT NULL DEFAULT 0,
    note              TEXT,
    issued_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, depot_id, series, year, seq),
    UNIQUE (tenant_id, number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_sale ON invoices(sale_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_date ON invoices(tenant_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS invoice_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name VARCHAR(255) NOT NULL,      -- instantané (immuabilité)
    variant_name VARCHAR(255),
    unit_symbol  VARCHAR(20),
    quantity     NUMERIC(15,2) NOT NULL,     -- qté en unité de vente
    unit_price   NUMERIC(15,2) NOT NULL,     -- prix/base TTC
    tax_rate     NUMERIC(5,2) NOT NULL,
    total_ht     NUMERIC(15,2) NOT NULL,
    total_vat    NUMERIC(15,2) NOT NULL,
    total_ttc    NUMERIC(15,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
