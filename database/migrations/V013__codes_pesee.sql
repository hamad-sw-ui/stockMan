-- V013 — C5 : articles à pesée (balances étiqueteuses GS1, préfixes 20–29).
--
-- Un produit marqué is_weighed porte dans `barcode` le code ARTICLE à 7
-- chiffres « PPAAAAA » (préfixe magasin 20–29 + code article 5 chiffres) tel
-- que programmé dans la balance. L'étiquette EAN-13 émise par la balance est
-- « PP AAAAA VVVVV K » : VVVVV = prix en FCFA (mode PRICE) ou poids en
-- grammes (mode WEIGHT) — décodé à la caisse (docs/06 § C5).
--
-- Additif : défaut false ⇒ aucun impact sur l'existant.

ALTER TABLE products ADD COLUMN is_weighed BOOLEAN NOT NULL DEFAULT false;
