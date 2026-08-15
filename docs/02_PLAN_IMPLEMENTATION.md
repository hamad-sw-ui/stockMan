# StockMan — Plan d'implémentation complet

**Objectif :** mener l'application de son état actuel (fragments non exécutables) à un produit conforme au cahier des charges, en couvrant **sans négligence** : architecture, sécurité, données, backend, frontend/UX, offline, notifications, SaaS, QA et exploitation.
Chaque tâche référence les constats de `00_AUDIT_GLOBAL.md` (ARC/SEC/DAT/BCK/FRN/OPS-##) qu'elle corrige.

**Hypothèses :** équipe 2 devs full-stack + revue croisée ; estimations en jours-personnes (jp), à affiner après Phase 0 ; PostgreSQL ≥ 14 ; déploiement VPS + nginx (existant dans `deploy/`).

---

## Phase 0 — Fondations & gouvernance (≈ 3 jp, prérequis de tout le reste)

| #   | Tâche                                                                                                                                                                                                                                                                                                                                                                     | Corrige                | Livrable                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------- |
| 0.1 | Réécrire `README.md` : vision, stack, prérequis, installation `docker compose up`, comptes de démo, scripts                                                                                                                                                                                                                                                               | ARC-02                 | README complet                      |
| 0.2 | Restructurer le mono-repo : `/apps/api` (backend), `/apps/web` (frontend), `/database/migrations`, `/database/seeds`, `/deploy`, `/docs`, `/scripts` ; déplacer/retirer les scripts risqués (`test-db-connection.js`, `reset-passwords.js` → `scripts/` avec garde `NODE_ENV≠production`) ; supprimer `git_push.bat`, `package-lock.json` racine vide, `Stock.tsx` racine | ARC-03, ARC-06, ARC-07 | Arborescence propre                 |
| 0.3 | Outillage qualité : ESLint + Prettier + husky/lint-staged (backend **et** frontend), script `typecheck`, UTF-8 enforced (`.editorconfig`, pass d'encodage sur `Stock.tsx`)                                                                                                                                                                                                | FRN-01, ARC-07         | `npm run lint/typecheck` verts      |
| 0.4 | docker-compose dev : Postgres 16 + API + Web (hot reload) + adminer ; `.env.example` complété, **refus de démarrage si secrets absents** (`zod` sur `process.env`)                                                                                                                                                                                                        | SEC-01, OPS-01         | Env dev reproductible en 1 commande |
| 0.5 | CI GitHub Actions : lint → typecheck → tests → build → migrations sur Postgres éphémère (service container)                                                                                                                                                                                                                                                               | OPS-02                 | Pipeline verte sur chaque push      |

**DoD Phase 0 :** un nouvel arrivant lance l'app en < 15 min en suivant le README ; CI verte.

---

## Phase 1 — Schéma de données cible & migrations (≈ 5 jp)

**Principe :** une seule chaîne de migrations versionnée, idempotente, cross-plateforme (node-pg-migrate ou SQL numérotées `V001…V00n`), rejouable de zéro (shadow DB en CI). Les fichiers SQL actuels sont archivés dans `/database/legacy` et remplacés.

### 1.1 Schéma V2 (changements structurants)

```sql
-- Catalogue dissocié du stock (corrige DAT-02 / DAT-03) -----------------------
CREATE TABLE products (                       -- catalogue, niveau TENANT
  id UUID PK, tenant_id FK NOT NULL,
  name, description, category_id FK, barcode, -- UNIQUE(tenant_id, barcode)
  purchase_price NUMERIC(15,2) CHECK >= 0,
  selling_price  NUMERIC(15,2) CHECK >= 0,
  min_stock_level NUMERIC(15,2) DEFAULT 0,
  unit_id FK NOT NULL,                        -- unité de base
  has_variants BOOLEAN, image_url,
  archived_at TIMESTAMPTZ,                    -- soft-delete (corrige DAT-05)
  created_at, updated_at
);

CREATE TABLE stock_levels (                   -- stock par produit × dépôt (× variante)
  product_id FK, depot_id FK, variant_id FK NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (product_id, depot_id, variant_id)
);
CREATE INDEX idx_stock_levels_product ON stock_levels(product_id);

-- Ventes : intégrité & offline (corrige DAT-01, SEC-06, SEC-07) --------------
ALTER TABLE sale_items ADD COLUMN variant_id UUID REFERENCES product_variants(id);
ALTER TABLE sale_items ADD COLUMN unit_id UUID REFERENCES units(id);   -- unité de vente
ALTER TABLE sale_items ADD COLUMN base_qty NUMERIC(15,2) NOT NULL;     -- qté convertie (corrige DAT-04)
ALTER TABLE sales ADD COLUMN client_sale_id UUID;                      -- idempotence offline
CREATE UNIQUE INDEX uq_sales_client ON sales(tenant_id, client_sale_id) WHERE client_sale_id IS NOT NULL;
ALTER TABLE sales ADD COLUMN status VARCHAR(20) DEFAULT 'COMPLETED'    -- COMPLETED/VOIDED
  CHECK (status IN ('COMPLETED','VOIDED'));
ALTER TABLE sales ADD COLUMN synced_at TIMESTAMPTZ;                    -- date réelle de sync

CREATE TABLE sale_returns ( id PK, sale_id FK, reason, created_by FK, created_at );
CREATE TABLE sale_return_items ( id PK, return_id FK, product_id, variant_id, base_qty, unit_price );

-- Auth & sécurité (corrige SEC-08, SEC-10) ------------------------------------
CREATE TABLE refresh_tokens (
  id PK, user_id FK, tenant_id FK, token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, replaced_by UUID, created_at
);
ALTER TABLE users ALTER COLUMN pin_code TYPE TEXT;                     -- hash bcrypt, plus de clair

-- Multi-tenant configs & notifications réparées (corrige BCK-01) --------------
CREATE TABLE tenant_configs ( tenant_id FK, key, value, is_secret BOOL,
  PRIMARY KEY (tenant_id, key) );                                      -- clés chiffrées (pgcrypto / KMS)
CREATE TABLE notification_settings (
  tenant_id PK/FK, alert_phone VARCHAR(50), alert_whatsapp VARCHAR(50),
  low_stock_enabled BOOL DEFAULT TRUE, daily_report_enabled BOOL DEFAULT TRUE,
  daily_report_time TIME DEFAULT '20:00' );

-- Achats / réceptions (corrige BCK-03 §2.7) ------------------------------------
CREATE TABLE stock_receipts ( id PK, tenant_id FK, depot_id FK, supplier_id FK NULL,
  received_by FK, reference, created_at );
CREATE TABLE stock_receipt_items ( id PK, receipt_id FK, product_id FK, variant_id NULL,
  batch_id FK NULL, base_qty NUMERIC(15,2) NOT NULL, unit_cost NUMERIC(15,2) );

-- Audit & licences activées (corrige DAT-06) -----------------------------------
CREATE TABLE plans ( code PK, name, max_users INT, max_depots INT, price NUMERIC(15,2) );
ALTER TABLE licenses ADD COLUMN plan_code REFERENCES plans(code);
ALTER TABLE licenses ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
CREATE INDEX idx_audit_entity ON audit_logs(tenant_id, entity, entity_id);

-- Renforts ---------------------------------------------------------------------
ALTER TABLE stock_movements ADD CONSTRAINT fk_movement_variant
  FOREIGN KEY (variant_id) REFERENCES product_variants(id);
ALTER TABLE units ADD CONSTRAINT uq_units_tenant_name UNIQUE (tenant_id, name);
ALTER TABLE stock_batches ALTER COLUMN expiry_date DROP NOT NULL;      -- produits non périssables
ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id);
ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
CREATE INDEX idx_products_tenant_active ON products(tenant_id) WHERE archived_at IS NULL;
CREATE INDEX idx_sales_tenant_date ON sales(tenant_id, created_at DESC);
CREATE INDEX idx_sales_items_product ON sale_items(product_id);
```

| #   | Tâche                                                                                                                                                                | Corrige |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1.2 | Migration de **données** V1→V2 : `products.quantity,depot_id` → lignes `stock_levels` (script idempotent + rapport d'écarts)                                         | DAT-02  |
| 1.3 | Consolidation des migrations contradictoires (`product_variants`, `stock_batches` ×2) en une définition unique                                                       | ARC-05  |
| 1.4 | Runner de migration unique (`npm run migrate` Node, utilisé par dev **et** CI **et** prod) + `migrate status` ; supprimer la duplication `apply.ps1` vs `migrate.ts` | ARC-04  |
| 1.5 | Seeds séparés : `seed:dev` (données démo filtrées par tenant) / `seed:prod` (plans, unités système) — plus de lookup par nom sans tenant                             | OPS-03  |
| 1.6 | Trigger `updated_at` générique ; contraintes CHECK quantités/prix                                                                                                    | DAT-07  |

**DoD Phase 1 :** `dropdb && createdb && migrate && seed:dev` rejouable en CI ; audit des écarts V1→V2 = 0 non justifié.

---

## Phase 2 — Backend : sécurité, intégrité & API complète (≈ 15 jp)

| #    | Bloc                | Tâches clés                                                                                                                                                                                                                                                                                                                                     | Corrige                        |
| ---- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 2.1  | **Socle HTTP**      | `helmet`, rate-limit (`/auth/*` strict, global modéré), `express-validator`/`zod` par route (schémas partagés avec le front), gestionnaire d'erreurs global + codes métier (`EMAIL_TAKEN`…), handler 404, `pino` + request-id, `trust proxy`, limite payload                                                                                    | SEC-09, SEC-11, BCK-06         |
| 2.2  | **Auth**            | Échec au boot sans secrets ; rotation refresh + table de révocation + révocation à la déconnexion ; `GET /auth/me` ; forgot/reset password (jeton signé à usage unique) ; change password ; **login PIN** (hash bcrypt, rate-limit spécial) ; blocage `is_active` user/tenant à chaque refresh ; jamais de secret fallback                      | SEC-01, SEC-02, SEC-08, SEC-10 |
| 2.3  | **Licences & RBAC** | `requireActiveLicense` (trial expirée → lecture seule + bannière), `requireRole` appliqué **à toutes les routes** (VENDEUR : POS + consultation uniquement), plans limitent `max_users`/`max_depots` à la création                                                                                                                              | SEC-05, DAT-06                 |
| 2.4  | **Ventes**          | Total **recalculé serveur** depuis prix en base ; `createdAt` borné (≤ 24 h, flag `synced_at`) ; idempotence via `client_sale_id` (409 + renvoi de l'existant) ; FEFO transactionnel sur `stock_levels`+lots ; détail vente + reçu ; annulation (avoir) + retours (mouvements `RETURN`) ; pagination + filtres                                  | SEC-06, SEC-07, BCK-03         |
| 2.5  | **Stock**           | CRUD produits complet (PATCH réel, archivage), recherche serveur + pagination, endpoint `barcode/:code`, variantes CRUD (SKU unique), lots CRUD, **réceptions fournisseurs** (`IN`), **transferts inter-dépôts** (`TRANSFER` atomique), ajustements avec motif obligatoire, journal filtré/paginé ; suppression du N+1 (jointures/JSON aggrégé) | BCK-03, BCK-04, DAT-04, DAT-05 |
| 2.6  | **Unités**          | Conversion réelle en vente/réception (`base_qty = qty × base_value`) ; PATCH unités ; unicité                                                                                                                                                                                                                                                   | DAT-04                         |
| 2.7  | **Référentiels**    | CRUD dépôts, catégories (garde suppression), fournisseurs (PATCH/DELETE, historique), vendeurs (PATCH, reset pwd/PIN, désactivation ; `pin_code` masqué partout)                                                                                                                                                                                | BCK-03, SEC-10                 |
| 2.8  | **Audit**           | Middleware `audit()` sur mutations sensibles (écrit `previous_state`/`new_state`,`depot_id`), endpoint lecture filtrée                                                                                                                                                                                                                          | DAT-06                         |
| 2.9  | **Rapports**        | Fix prédictif (fenêtre 30 j réelle) ; rapports ventes/marges/stock valorisé/péremptions, filtres période-dépôt, exports CSV/PDF serveur ; fuseau tenant ; mois FR                                                                                                                                                                               | BCK-02, DAT-08                 |
| 2.10 | **Tests**           | intégration (supertest + Postgres éphémère) sur : vente (+variante, hors-ligne double-envoi, stock insuffisant), transfert, réception, licence expirée, RBAC vendeur — **couverture ≥ 70 % des use-cases métier**                                                                                                                               | OPS-02                         |

**DoD Phase 2 :** OpenAPI (`/docs`) générée et à jour ; tous les endpoints de la colonne « cible » de `01_MATRICE_INTERFACES.md §5` existent, testés, rôles contrôlés.

---

## Phase 3 — Frontend : socle & parcours utilisateurs (≈ 18 jp, à chevaucher avec le backend dès Phase 2 livrée par lots)

| #   | Bloc                               | Tâches clés                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Corrige                |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 3.1 | **Socle**                          | Vite + React + TS dans `/apps/web` ; Tailwind + shadcn/ui ; React Router avec gardes par rôle ; React Query (cache/retries/offline) ; Zustand pour panier/session ; thème piloté par `primary_color` tenant (tokens CSS) — plus de `emerald-600` en dur ; i18n-ready (FR d'abord) ; formats `fr-FR`/FCFA/date-fns `fr`                                                                                                                                          | FRN-05, FRN-06         |
| 3.2 | **Auth**                           | Login (email/mdp + onglet PIN kiosque), forgot/reset, écran licence expirée, layout public                                                                                                                                                                                                                                                                                                                                                                      | §1.2                   |
| 3.3 | **Shell ADMIN**                    | Layout (sidebar responsive, breadcrumb, switch dépôt, bandeau offline, centre de notifications), composants états (Empty/Loading/Error) **avec assets locaux**                                                                                                                                                                                                                                                                                                  | FRN-02                 |
| 3.4 | **Modules ADMIN** (cf. matrice §2) | Dashboard · Produits (refonte complète de l'écran existant : recherche réelle, pagination, archivage confirmé, onglets variantes/lots/mouvements, import/export, étiquettes locales) · Catégories · Unités · Dépôts (+ transferts) · Fournisseurs · Réceptions · Inventaire/ajustements · Mouvements · Ventes (liste filtrée, détail, annulation, reçu PDF) · Vendeurs · Rapports (exports) · Paramètres tenant (logo/couleur → thème réel, abonnement) · Audit | FRN-03, FRN-04, FRN-05 |
| 3.5 | **Modules VENDEUR** (mobile-first) | POS (§3.1 ci-dessous si non reporté Phase 4) · Mes ventes · Stock consultatif · Z de caisse                                                                                                                                                                                                                                                                                                                                                                     | matrice §3             |
| 3.6 | **Console SUPER_ADMIN**            | Dashboard global · Tenants (détail, suspendre, reset gérant, impersonation) · Plans & licences · Configs système (secrets réellement masqués, bouton « tester ») · Supervision notifications                                                                                                                                                                                                                                                                    | SEC-04                 |
| 3.7 | **Qualité UI**                     | Tests composants (Vitest + Testing Library) sur formulaires critiques ; Playwright E2E : parcours inscription→premier produit→vente ; correction encodage intégrale ; a11y pass (axe-core)                                                                                                                                                                                                                                                                      | FRN-01, OPS-02         |

**DoD Phase 3 :** les 25 écrans de la matrice existent avec leurs 4 états UI ; E2E du « happy path » vert en CI.

---

## Phase 4 — POS & hors-ligne (≈ 8 jp) — _cœur de métier vendeur_

| #   | Tâche                    | Détail                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | **Mode offline**         | PWA (manifest, service worker) ; catalogue du dépôt en IndexedDB (sync delta au boot) ; file de ventes avec `client_sale_id` UUID généré **avant** envoi ; rejeu séquentiel avec backoff ; indicateurs (badge de statut par vente : _locale / en file / synchronisée / conflit_) ; résolution de conflit (stock insuffisant au rejeu → vente marquée + notification gérant) |
| 4.2 | **Caisse**               | Scan code-barres (caméra via getUserMedia + douchette HID), favoris, panier multi-unités (pièce/carton), remise ligne autorisée, paiements CASH / MTN_MOMO / ORANGE_MONEY (saisie référence), rendu monnaie, PIN de déverrouillage rapide (changement de caissier sans re-login complet)                                                                                    |
| 4.3 | **Impression & partage** | Reçu 80 mm (CSS print dédié + WebUSB/Bluetooth ESC/POS si disponible), partage du ticket par WhatsApp (lien `wa.me` avec texte préformaté), étiquettes produits A4 générées **localement**                                                                                                                                                                                  |
| 4.4 | **Resilience**           | Tests E2E hors-ligne (Playwright réseau coupé : 3 ventes → reconnexion → exactement 3 ventes serveur, jamais 6)                                                                                                                                                                                                                                                             |

**DoD Phase 4 :** le test E2E offline ci-dessus prouve l'absence de doublons et de pertes (corrige SEC-07 end-to-end).

---

## Phase 5 — Notifications & intelligence (≈ 6 jp)

| #   | Tâche                                                                                                                                                                                                              | Corrige        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 5.1 | Réparer `NotificationService` : lecture `tenant_configs`, destinataire réel (plus de `PHONE_NUMBER_HERE`), écriture `notifications` (SENT/FAILED + payload provider), secrets chiffrés                             | BCK-01, SEC-04 |
| 5.2 | Intégrations réelles derrière interfaces (`SmsProvider` Africa's Talking, `WhatsAppProvider` Meta Cloud API) avec simulation configurable en dev (`NOTIF_DRIVER=mock`)                                             | BCK-01         |
| 5.3 | Jobs : alerte stock bas horaire **dédupliquée** (pas de spam : 1 alerte/produit/jour), rapport 20 h (CA, top produits, écarts inventaire) au gérant, alerte expirations J-30/J-7, supervision des échecs + relance | BCK-07         |
| 5.4 | Prédictif corrigé + seuils par produit ; badge « réappro » sur le dashboard                                                                                                                                        | BCK-02         |
| 5.5 | File de jobs robuste (pg-boss ou BullMQ) avec reprises plutôt que cron en mémoire                                                                                                                                  | BCK-07         |

**DoD Phase 5 :** en environnement de test provider-sandbox, une alerte stock bas SMS/WhatsApp arrive au numéro du gérant, tracée dans le centre de notifications.

---

## Phase 6 — SaaS commercialisation (≈ 4 jp)

Onboarding trial 14 j de bout en bout (inscription → licence → blocage doux à expiration) ; écran abonnement + paiement (MOMO/OM ou saisie manuelle par SUPER_ADMIN) ; impersonation support journalisée ; métriques console (MRR, essais, churn, santé notifications). **DoD :** scénario E2E « trial expiré » vérifie la lecture seule et le renouvellement débloque l'écriture.

---

## Phase 7 — Exploitation & mise en production (≈ 5 jp, continu)

| #   | Tâche                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | Dockerfiles prod (API, Web) + compose/ou manifests ; nginx HTTPS (Let's Encrypt), headers sécurité, compression                                |
| 7.2 | Sauvegardes PostgreSQL automatisées (dump quotidien + WAL/PITR), **test de restauration** documenté dans un runbook (RPO ≤ 24 h, objectif 1 h) |
| 7.3 | Observabilité : Sentry (front+back), healthchecks exposés au monitoring, alertes (job failed, disque, erreurs 5xx), logs centralisés           |
| 7.4 | Runbook exploitation (déploiement, rollback, rotation secrets, purge refresh_tokens/notifications, procédure incident offline massif)          |
| 7.5 | Durcissement final : revue OWASP Top 10, scan dépendances (npm audit / Trivy) en CI, pentest léger avant ouverture commerciale                 |

---

## Quick wins (livrables dès la semaine 1, avant les phases lourdes)

1. Supprimer les fallbacks JWT et créer des comptes par défaut forts (SEC-01, SEC-02).
2. Corriger l'encodage de `Stock.tsx` et retirer l'image externe (FRN-01, FRN-02).
3. Brancher `authorize('ADMIN')` sur POST/PUT/DELETE produits-unités-stock (SEC-05) — 30 lignes.
4. Masquer réellement les secrets dans `getConfigs` (SEC-04) — 5 lignes.
5. Recalculer `totalAmount` côté serveur dans `createSale` (SEC-06).
6. Ajouter `variant_id` à `sale_items` (migration) pour débloquer les ventes à variantes (DAT-01).
7. Fixer le JOIN temporel du rapport prédictif (BCK-02) — 3 lignes SQL.
8. Ajouter `IF NOT EXISTS`/runner unique aux migrations (ARC-04, ARC-05).
9. Ajouter `client_sale_id` + index unique (SEC-07).
10. Cadrer `getProducts` : pagination + jointures (BCK-04).

---

## Planning indicatif & dépendances

```
S1        S2-S3        S3-S6            S4-S9                S8-S10      S10-S11     S11-S12     S12+
────────  ─────────    ─────────────    ─────────────────    ─────────   ─────────   ────────    ─────
Phase 0   Phase 1      Phase 2 backend   Phase 3 frontend     Phase 4     Phase 5     Phase 6     Phase 7 (continu)
(3 jp)    (5 jp)       (15 jp)          (18 jp)              POS/offline Notifs      SaaS        Ops
                       └─ lots API livrés par priorit├: auth/stock/ventes → référentiels → rapports
```

**Total : ≈ 56 jp** (soit ~6 semaines à 2 développeurs avec overlap, hors marge), + 20 % de buffer imprévu = **≈ 8-9 semaines**. Jalons : **M1** fin S3 (schéma V2 + auth saine), **M2** fin S6 (API complète couverte de tests), **M3** fin S9 (parité écrans CDC), **M4** fin S11 (POS offline + notifications réelles), **M5** S12+ (go-live durci).

## Risques & parades

| Risque                                                                | Impact                  | Parade                                                                                                |
| --------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Migration V1→V2 des données existantes (produits dupliqués par dépôt) | Perte/écarts de stock   | Script migrateur avec **rapport d'écarts validé par le gérant** avant bascule ; double-run en staging |
| Offline complexe (conflits)                                           | Ventes perdues/doublées | Idempotence `client_sale_id` d'abord, résolution de conflit UX ensuite ; E2E réseau coupé obligatoire |
| Coût/délai providers SMS/WhatsApp au Cameroun                         | Phase 5 bloquée         | Interface provider + mock dès le départ ; sandbox Africa's Talking en CI                              |
| Régression périmètre (CDC complet réel différent de l'inféré)         | Re-planification        | Validation de `01_MATRICE_INTERFACES.md` avec le commanditaire **avant** Phase 3 (jalon M1)           |
| Données multidevises/fuseaux                                          | Rapports faux           | Fuseau tenant en paramétrage dès Phase 1                                                              |

## Definition of Done (globale, chaque lot)

Code revu (PR) · lint/typecheck/tests CI verts · migration rejouable · endpoint documenté (OpenAPI) · rôles vérifiés par test · écran avec 4 états UI · chaîne FR sans faute/encodage correct (revue UI) · entrée audit si mutation sensible · aucun secret/log sensible · mise à jour de `01_MATRICE_INTERFACES.md` (🟨→✅).
