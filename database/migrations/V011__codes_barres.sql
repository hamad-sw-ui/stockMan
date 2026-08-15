-- =====================================================================
-- V011 — Système code-barres, phase C1 : registre multi-cibles.
--
-- Constats corrigés (docs/06_AUDIT_PRO_CODE_BARRES.md) :
--   C2 🔴 product_variants.barcode n'avait AUCUNE unicité → scan ambigu ;
--   C3 🔴 un seul code par produit/variante → alias fournisseurs impossibles ;
--   C4 🟠 aucun code par conditionnement (carton ×12 ≠ pièce).
--
-- Ce que fait la migration :
--   1. product_barcodes : N codes → 1 produit (± variante, ± unité de
--      conditionnement), UNIQUE(tenant_id, code) = garde-fou global ;
--   2. dédoublonnage contrôlé des codes variantes historiques (le plus
--      ancien conserve, les suivants suffixés « -DUP-xxxxxxxx », déterministe) ;
--   3. backfill des codes existants (products.barcode / product_variants.barcode)
--      comme entrées « is_primary » — les colonnes legacy DEMEURENT la source
--      d'affichage principale (compat ascendante totale,write-through en C1 app).
--
-- Note pg-mem : pas de fonctions fenêtres ni de sous-requêtes corrélées, et
-- le FROM d'un UPDATE n'accepte qu'UNE source (ni JOIN ANSI ni virgules) →
-- le dédoublonnage passe par un sous-select complet non corrélé ; substring()
-- remplace left() (absente de pg-mem) ; les contraintes CHECK sont posées en
-- fin de fichier (DROP + ADD nommées), pattern des migrations V006/V009.
-- =====================================================================

CREATE TABLE IF NOT EXISTS product_barcodes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    -- Variante précise scannée (NULL = produit entier) :
    variant_id  UUID REFERENCES product_variants(id) ON DELETE CASCADE,
    -- Conditionnement codifié (NULL = unité catalogue) : scanner ce code
    -- revient à saisir « quantité × base_value(unité) ».
    unit_id     UUID REFERENCES units(id) ON DELETE CASCADE,
    code        VARCHAR(100) NOT NULL,
    symbology   VARCHAR(10) NOT NULL DEFAULT 'CODE39',
    source      VARCHAR(12) NOT NULL DEFAULT 'REGISTERED',
    -- Code « principal » = miroir de la colonne legacy (dernier gagne) :
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_barcodes_code
    ON product_barcodes(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_product
    ON product_barcodes(product_id);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_variant
    ON product_barcodes(variant_id) WHERE variant_id IS NOT NULL;

-- ② Dédoublonnage des codes variantes (même tenant, deux variantes
-- distinctes avec le même code). Le plus ancien (created_at, id) conserve
-- le code ; les suivants reçoivent un suffixe unique traçable.
-- Forme pg-mem-compatible : UNE seule source en FROM (sous-select complet,
-- non corrélé — pg-mem ne supporte ni JOIN ANSI ni multi-tables dans le
-- FROM d'un UPDATE, ni les sous-requêtes corrélées), cible visée par son nom.
UPDATE product_variants
   SET barcode = product_variants.barcode || '-DUP-'
                 || substring(product_variants.id::text from 1 for 8),
       updated_at = now()
  FROM (
    SELECT v2.id AS dup_id
      FROM product_variants v2
      JOIN products p2 ON p2.id = v2.product_id
      JOIN product_variants v1
        ON v1.barcode = v2.barcode AND v1.id <> v2.id
      JOIN products p1
        ON p1.id = v1.product_id AND p1.tenant_id = p2.tenant_id
     WHERE v1.created_at < v2.created_at
        OR (v1.created_at = v2.created_at AND v1.id < v2.id)
  ) d
 WHERE product_variants.id = d.dup_id;

-- ③a Backfill : codes principaux des PRODUITS (prioritaires au lookup).
INSERT INTO product_barcodes (tenant_id, product_id, code, symbology, source, is_primary)
SELECT p.tenant_id, p.id, p.barcode,
       CASE length(p.barcode)
            WHEN 13 THEN 'EAN13'
            WHEN 12 THEN 'UPCA'
            WHEN 8  THEN 'EAN8'
            ELSE 'CODE39'
       END,
       'REGISTERED', true
  FROM products p
 WHERE p.barcode IS NOT NULL
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ③b Backfill : codes principaux des VARIANTES.
INSERT INTO product_barcodes (tenant_id, product_id, variant_id, code, symbology, source, is_primary)
SELECT p.tenant_id, v.product_id, v.id, v.barcode,
       CASE length(v.barcode)
            WHEN 13 THEN 'EAN13'
            WHEN 12 THEN 'UPCA'
            WHEN 8  THEN 'EAN8'
            ELSE 'CODE39'
       END,
       'REGISTERED', true
  FROM product_variants v
  JOIN products p ON p.id = v.product_id
 WHERE v.barcode IS NOT NULL
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Contraintes nommées (pattern fin-de-fichier, cf. en-tête) :
ALTER TABLE product_barcodes DROP CONSTRAINT IF EXISTS product_barcodes_symbology_check;
ALTER TABLE product_barcodes ADD CONSTRAINT product_barcodes_symbology_check
    CHECK (symbology IN ('EAN13', 'EAN8', 'UPCA', 'CODE39', 'CODE128'));
ALTER TABLE product_barcodes DROP CONSTRAINT IF EXISTS product_barcodes_source_check;
ALTER TABLE product_barcodes ADD CONSTRAINT product_barcodes_source_check
    CHECK (source IN ('GENERATED', 'REGISTERED', 'IMPORTED', 'SUPPLIER'));
