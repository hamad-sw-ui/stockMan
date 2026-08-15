# StockMan — Documentation d'audit & de mise en conformité

Produit : **StockMan**, SaaS multi-tenant de gestion de dépôts / stock / caisse (marché Cameroun — FCFA, MTN MoMo, Orange Money, SMS/WhatsApp).
Rôles : `SUPER_ADMIN` (éditeur) · `ADMIN` (gérant) · `VENDEUR` (caissier).

| Document                                                                     | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`00_AUDIT_GLOBAL.md`](./00_AUDIT_GLOBAL.md)                                 | Audit exhaustif : 41 constats classés (🔴 8 bloquants · 🟠 10 critiques · 🟡 15 majeurs · 🔵 8 mineurs) avec preuves fichier/ligne, couvrant architecture, sécurité, données, backend, frontend/UX, DevOps.                                                                                                                                                                                                                                       |
| [`01_MATRICE_INTERFACES.md`](./01_MATRICE_INTERFACES.md)                     | Matrice des besoins par interface — **état v2.1 livrée** : 42 écrans ✅, couverture CRUD par ressource, règles métier et endpoints effectivement implémentés (y compris modules E1→E8).                                                                                                                                                                                                                                                           |
| [`02_PLAN_IMPLEMENTATION.md`](./02_PLAN_IMPLEMENTATION.md)                   | Plan d'implémentation complet en 8 phases estimées (≈ 56 jp) : fondations → schéma V2 → backend → frontend → POS/offline → notifications → SaaS → exploitation, avec quick wins, jalons, risques et Definition of Done. **Appliqué à 100 %.**                                                                                                                                                                                                     |
| [`03_EXPLOITATION.md`](./03_EXPLOITATION.md)                                 | Runbook de production : architecture, déploiement compose/VM, variables d'environnement, comptes privilégiés, sauvegardes/restauration, supervision, tâches planifiées, dépannage, mises à jour, **reprise des données V1**, **points d'exploitation des modules E1→E8** (§ 8bis).                                                                                                                                                                |
| [`04_API.md`](./04_API.md)                                                   | Référence API d'intégration : auth & rôles, pagination, erreurs, hors-ligne idempotent, import CSV, licences, **domaines v2.1 (clients/crédit, commandes, campagnes, sessions, factures/TVA, promos, IMEI)** — + spec OpenAPI 3.0 exhaustive servie sur `GET /api/openapi.json`.                                                                                                                                                                  |
| [`05_AUDIT_EXPERT_STOCK.md`](./05_AUDIT_EXPERT_STOCK.md)                     | Audit **métier** post-livraison (regard expert gestion de stock, contexte CM/SYSCOHADA) : 12 manquements classés (valorisation CUMP, FEFO/rappel de lot, crédit client…), constats vérifiés dans le code, plan de conformité en phases **E1→E8 — intégralement livré** (état au § D bis).                                                                                                                                                         |
| [`06_AUDIT_PRO_CODE_BARRES.md`](./06_AUDIT_PRO_CODE_BARRES.md)               | Audit « usage professionnel » du domaine **code-barres** : 9 constats chiffrés avec preuves (absence de génération de codes internes, unicité variante manquante, alias/conditionnements, scan universel, étiquettes pro/ZPL, codes à pesée) + **plan C1→C5 — intégralement livré** (registre multi-cibles, unicité, génération interne EAN-13, scan universel/IMEI, étiquettes pro + ZPL, balances à pesée) — état au § H.                       |
| [`07_PLAN_DONNEES_RESPONSIVE_I18N.md`](./07_PLAN_DONNEES_RESPONSIVE_I18N.md) | État des lieux vérifié + plan **D1–D3 / R1–R3 / I1–I5** : export intégral & restauration des données par tenant (snapshot JSON transactionnel, CSV clients/fournisseurs/ventes), responsive 42 écrans (modales plein écran, listes → cartes, QA mobile), internationalisation **FR/EN** (i18next, FR langue source, parité testée) — avec matrice de non-régression par phase. **D1–D3 · R1–R3 · I1–I5 intégralement livrées** (état aux §§ 7–9). |

> Le cahier des charges n'étant pas présent dans le dépôt, il a été **inféré** des phases visibles dans le code (Phase 3 « Catalogue & Logistique », Phase 4 « Connectivité & Intelligence », console Super Admin) et du schéma de données. Les 8 phases du `02_PLAN_IMPLEMENTATION.md` **et** les 8 phases de conformité expert (E1→E8, `05_AUDIT_EXPERT_STOCK.md`) sont **terminées et testées** ; le plan code-barres C1→C5 (`06`) et le plan données / responsive / i18n **D1–D3 · R1–R3 · I1–I5** (`07`) sont également **intégralement livrés** — **374 tests automatisés : 239 API + 135 web**, CI en 5 jobs (`deploy/ci.yml`, à copier vers `.github/workflows/`).

## Internationalisation (FR/EN) — règles de contribution

L'interface est **bilingue français ⇄ anglais** (i18next, ressources bundlées localement : la caisse reste fonctionnelle hors-ligne) ; bascule à chaud via le sélecteur de langue de la topbar ou la carte « Langue de l'interface » des Paramètres. Le **français est la langue source** : les valeurs de `apps/web/src/i18n/locales/fr.json` reproduisent à l'octet près les chaînes historiques, et `en.json` en est le miroir intégral — la **parité stricte des clés** (1 902 par langue) et l'absence de valeur vide sont testées.

**Règle d'or : toute nouvelle chaîne visible à l'écran passe par `t()` ou `<Trans>`** — jamais de libellé français littéral dans le JSX. Le garde-fou `apps/web/tests/noHardcodedFr.test.ts` balaye `src/**/*.tsx` et fait échouer la suite sinon (liste blanche anti-péremption limitée aux imprimés légaux, cf. ci-dessous).

Conventions détaillées :

- **Clés** : `pages.<page>.*` par défaut ; mutualisées `common.*`, `fields.*`, `csv.*`, `format.*`, `licenseStatus.*`. Interpolation `{{var}}` ; gras intercalé via `<Trans i18nKey values components={{ b: <strong /> }} />`.
- **Formats** : dates, monnaies et quantités passent par `lib/format.ts` (Intl recréé à la bascule fr-FR ⇄ en-US ; la devise affichée reste « FCFA »). Jamais de `.replace(".", ",")` à l'écran.
- **Erreurs API** : `translateApiError(code, messageServeur)` (`lib/http.ts`) mappe `errors.<CODE>` quand la clé existe, avec **repli sur le message serveur** — l'API reste francophone en v1 (les clients existants ne cassent pas ; `Accept-Language` côté serveur : v2, hors champ).
- **Restent volontairement en français** (commentaire « hors champ i18n v1 ») : les en-têtes CSV du contrat d'import (parsés par l'API), les documents d'impression légaux (facture NIU/RCCM, HT/TVA/TTC ; reçus TOTAL / Paiement / remerciement) et les SMS/WhatsApp envoyés aux clients finaux. La marque « StockMan » est un nom propre, jamais traduite.
- **Tests** : `tests/setup.ts` force le FR pour toutes les suites ; tout test qui bascule la langue la **restaure en FR** à la fin (les suites métier assertent les textes français à l'identique).

### Glossaire métier FR ⇄ EN (référence)

| Français (source)                  | Anglais (produit)                         |
| ---------------------------------- | ----------------------------------------- |
| dépôt                              | **depot** (jamais _warehouse_ ni _store_) |
| réception (de stock)               | **goods receipt** / supplier receipt      |
| session de caisse                  | **till session** (jamais _shift_)         |
| clôture Z / rapport Z              | **till closing (Z)** / Z report           |
| CUMP                               | **CUMP** (conservé tel quel)              |
| SYSCOHADA                          | **SYSCOHADA** (conservé tel quel)         |
| enseigne                           | shop name                                 |
| vendeur / caissier                 | vendor                                    |
| gérant                             | manager                                   |
| approvisionnement                  | purchase orders / restock                 |
| facture / avoir                    | invoice / **credit note**                 |
| devis (proforma)                   | quote (pro forma)                         |
| mouvement de stock                 | stock movement                            |
| inventaire tournant (ABC)          | cycle count (ABC)                         |
| seuil d'alerte                     | (low-stock) threshold                     |
| fond d'ouverture                   | opening float                             |
| écart (caisse, inventaire)         | variance                                  |
| chiffre d'affaires (CA)            | revenue                                   |
| panier moyen                       | average basket                            |
| tiers (clients / fournisseurs)     | third parties (customers / suppliers)     |
| crédit client (encours)            | customer credit (outstanding)             |
| lot / série (IMEI)                 | batch / **serial** (IMEI)                 |
| code à pesée                       | weighed barcode                           |
| étiquette / gabarit                | label / template                          |
| quittance / reçu                   | receipt                                   |
| sauvegarde / restauration (tenant) | tenant backup / restore                   |
