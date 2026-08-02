# StockMan — Documentation d'audit & de mise en conformité

Produit : **StockMan**, SaaS multi-tenant de gestion de dépôts / stock / caisse (marché Cameroun — FCFA, MTN MoMo, Orange Money, SMS/WhatsApp).
Rôles : `SUPER_ADMIN` (éditeur) · `ADMIN` (gérant) · `VENDEUR` (caissier).

| Document | Contenu |
|---|---|
| [`00_AUDIT_GLOBAL.md`](./00_AUDIT_GLOBAL.md) | Audit exhaustif : 41 constats classés (🔴 8 bloquants · 🟠 10 critiques · 🟡 15 majeurs · 🔵 8 mineurs) avec preuves fichier/ligne, couvrant architecture, sécurité, données, backend, frontend/UX, DevOps. |
| [`01_MATRICE_INTERFACES.md`](./01_MATRICE_INTERFACES.md) | Vue globale des besoins de **chaque interface** (≈ 25 écrans) : rôle, CRUD, fonctionnalités clés, règles métier, endpoints existants/manquants, critères d'acceptation + tableau de couverture API par ressource. |
| [`02_PLAN_IMPLEMENTATION.md`](./02_PLAN_IMPLEMENTATION.md) | Plan d'implémentation complet en 8 phases estimées (≈ 56 jp) : fondations → schéma V2 → backend → frontend → POS/offline → notifications → SaaS → exploitation, avec quick wins, jalons, risques et Definition of Done. |

> Le cahier des charges n'étant pas présent dans le dépôt, il a été **inféré** des phases visibles dans le code (Phase 3 « Catalogue & Logistique », Phase 4 « Connectivité & Intelligence », console Super Admin) et du schéma de données. **Action requise : faire valider `01_MATRICE_INTERFACES.md` par le commanditaire (jalon M1 du plan).**
