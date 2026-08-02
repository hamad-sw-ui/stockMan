# StockMan — Documentation d'audit & de mise en conformité

Produit : **StockMan**, SaaS multi-tenant de gestion de dépôts / stock / caisse (marché Cameroun — FCFA, MTN MoMo, Orange Money, SMS/WhatsApp).
Rôles : `SUPER_ADMIN` (éditeur) · `ADMIN` (gérant) · `VENDEUR` (caissier).

| Document                                                   | Contenu                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`00_AUDIT_GLOBAL.md`](./00_AUDIT_GLOBAL.md)               | Audit exhaustif : 41 constats classés (🔴 8 bloquants · 🟠 10 critiques · 🟡 15 majeurs · 🔵 8 mineurs) avec preuves fichier/ligne, couvrant architecture, sécurité, données, backend, frontend/UX, DevOps.                                   |
| [`01_MATRICE_INTERFACES.md`](./01_MATRICE_INTERFACES.md)   | Matrice des besoins par interface — **état v2.0 livrée** : 29 écrans ✅, couverture CRUD par ressource, règles métier et endpoints effectivement implémentés.                                                                                 |
| [`02_PLAN_IMPLEMENTATION.md`](./02_PLAN_IMPLEMENTATION.md) | Plan d'implémentation complet en 8 phases estimées (≈ 56 jp) : fondations → schéma V2 → backend → frontend → POS/offline → notifications → SaaS → exploitation, avec quick wins, jalons, risques et Definition of Done. **Appliqué à 100 %.** |
| [`03_EXPLOITATION.md`](./03_EXPLOITATION.md)               | Runbook de production : architecture, déploiement compose/VM, variables d'environnement, comptes privilégiés, sauvegardes/restauration, supervision, tâches planifiées, dépannage, mises à jour, **reprise des données V1**.                  |
| [`04_API.md`](./04_API.md)                                 | Référence API d'intégration : auth & rôles, pagination, erreurs, hors-ligne idempotent, import CSV, licences — + spec OpenAPI 3.0 exhaustive servie sur `GET /api/openapi.json`.                                                              |

> Le cahier des charges n'étant pas présent dans le dépôt, il a été **inféré** des phases visibles dans le code (Phase 3 « Catalogue & Logistique », Phase 4 « Connectivité & Intelligence », console Super Admin) et du schéma de données. Les 8 phases du `02_PLAN_IMPLEMENTATION.md` sont **terminées et testées** (136 tests automatisés, CI en 5 jobs).
