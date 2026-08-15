-- =====================================================================
-- V012 — Système code-barres, phase C2 : génération interne EAN-13.
--
-- Articles sans code fabricant (production locale, vrac, bocaux…) : la
-- plateforme émet un EAN-13 « magasin » dans la plage GS1 réservée 20–29
-- (in-store) :  PP(2) + NNNNNNNNNN(10) + K(1 contrôle).
--
--   barcode_sequences : un compteur par (tenant, préfixe), incrémenté
--   atomiquement via INSERT … ON CONFLICT DO UPDATE … RETURNING dans la
--   transaction de génération (pattern éprouvé d'invoice_sequences, V009) —
--   aucune valeur n'est tirée deux fois, même avec deux postes en parallèle.
--
-- Le préfixe magasin est réglable par tenant (clé tenant_configs
-- « barcode_internal_prefix », défaut « 20 », plage 20–29 uniquement).
-- =====================================================================

CREATE TABLE IF NOT EXISTS barcode_sequences (
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    prefix      CHAR(2) NOT NULL DEFAULT '20',
    next_value  BIGINT NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, prefix)
);

-- Plage GS1 magasin 20–29 : comparaison lexicographique (CHAR(2) à largeur
-- fixe) — l'opérateur regex « ~ » n'existe pas sous pg-mem.
ALTER TABLE barcode_sequences DROP CONSTRAINT IF EXISTS barcode_sequences_prefix_check;
ALTER TABLE barcode_sequences ADD CONSTRAINT barcode_sequences_prefix_check
    CHECK (prefix >= '20' AND prefix <= '29');
ALTER TABLE barcode_sequences DROP CONSTRAINT IF EXISTS barcode_sequences_next_value_check;
ALTER TABLE barcode_sequences ADD CONSTRAINT barcode_sequences_next_value_check
    CHECK (next_value BETWEEN 1 AND 9999999999);
