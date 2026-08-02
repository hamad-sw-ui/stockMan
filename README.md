# StockMan

**SaaS multi-tenant de gestion de dépôts, de stock et de caisse** — conçu pour le
marché camerounais (FCFA, MTN Mobile Money, Orange Money, alertes SMS/WhatsApp,
usage mobile avec connectivité intermittente).

Trois rôles : **SUPER_ADMIN** (éditeur SaaS) · **ADMIN** (gérant d'entreprise) ·
**VENDEUR** (caissier). Chaque entreprise (tenant) est strictement isolée en base.

---

## Démarrage rapide (Docker — production)

Prérequis : Docker + Docker Compose.

```bash
git clone <ce dépôt> && cd stockMan

# 1. Secrets OBLIGATOIRES (le boot échoue sans eux)
cp .env.example .env
#  → générer deux secrets hex de 96 caractères, par ex. :
#    openssl rand -hex 48   (à mettre dans JWT_SECRET et REFRESH_SECRET)

# 2. Build et lancement de la pile (db + api + web)
docker compose up -d --build

# 3. Vérifier
curl http://localhost:5000/api/health        # {"status":"ok","db":true,…}
curl http://localhost:8080/api/health        # même app via le proxy nginx web

# 4. Créer le compte Super Admin (console éditeur /sa)
docker compose exec api node scripts/create-superadmin.js
#  → mot de passe fort affiché UNE seule fois
```

L'application web écoute sur **http://localhost:8080** (l'API sur :5000).
Les migrations SQL s'appliquent seules au démarrage de l'API (chaîne
`database/migrations/V###__*.sql`, idempotente, checksumée).

## Démarrage développement (sans Docker)

Prérequis : Node 20+, npm 10+, PostgreSQL 15+.

```bash
export DATABASE_URL=postgresql://stockman:stockman@localhost:5432/stockman
export JWT_SECRET=$(openssl rand -hex 48)
export REFRESH_SECRET=$(openssl rand -hex 48)

npm ci
npm run migrate      # chaîne SQL sur la base
npm run seed:dev     # jeu de démonstration (jamais en production)
npm run dev:api      # API sur :5000 (tsx watch)
npm run dev:web      # Web sur :5173 (vite, proxy → :5000)
```

**Comptes de démonstration** (seed dev uniquement) :

| Rôle                | Email             | Mot de passe | PIN caisse |
| ------------------- | ----------------- | ------------ | ---------- |
| SUPER_ADMIN         | `sa@stockman.cm`  | `Demo1234!`  | —          |
| ADMIN (Démo SARL)   | `admin@demo.cm`   | `Demo1234!`  | —          |
| VENDEUR (Démo SARL) | `vendeur@demo.cm` | `Demo1234!`  | `4321`     |

## Fonctionnalités

- **Caisse (PWA hors-ligne)** : catalogue en cache IndexedDB, scan douchette +
  caméra (`BarcodeDetector` natif), panier multi-unités (pièce/carton converti
  serveur), variantes, remises, espèces/MoMo/OM (réf. opérateur), vente mise en
  file sans réseau (`client_sale_id`) et **rejeu idempotent** (aucun doublon),
  reçu thermique 80 mm + partage WhatsApp, rapport Z de clôture.
- **Admin** : dashboard (CA, top produits, alertes), catalogue CRUD +
  **import/export CSV** + **étiquettes code-barres A4 (Code 39)**, catégories,
  unités, dépôts & transferts à double validation, fournisseurs & réceptions
  (lots FEFO), ajustements d'inventaire tracés, journal des mouvements (curseur),
  ventes (annulation motifée, retours partiels, reçu), équipe (PIN bcrypt),
  6 rapports (ventes, marges, valorisation, péremptions, prédictif 30 j, Z) avec
  export CSV, centre de notifications, paramètres white-label, abonnement,
  journal d'audit complet.
- **Console éditeur** : tenants (provisionnement, suspension, impersonation
  auditée), licences & plans (plafonds appliqués API-side, middleware 423 après
  grâce), configurations globales (secrets jamais renvoyés), supervision des
  notifications SMS/WhatsApp, stats (MRR, essais, CA plateforme).
- **Notifications** : alertes stock bas / péremption / rapport quotidien 20 h —
  Africa's Talking (SMS) + WhatsApp Cloud API, exactly-once par clé de dédup,
  historique des envois.

## Qualité & tests

| Commande                        | Contenu                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                      | **136 tests** : 81 API (vitest + pg-mem, schéma V2 réel) + 55 web                                                                                                                   |
| `npm run typecheck`             | TypeScript strict, zéro `any` non maîtrisé                                                                                                                                          |
| `npm run build`                 | API (tsc → dist/) + Web (vite → dist/)                                                                                                                                              |
| `npm run format`                | Prettier sur tout le dépôt                                                                                                                                                          |
| CI (`deploy/ci.yml`) | migrations ×2 sur **vraie Postgres 16**, seed rejouable, tests API/web, build, **migration V1→V2 bout-en-bout**, **fumée `docker compose` complète** (register → login → API → web) |

Sécurité par conception : RBAC testé croisé-tenant, isolation multi-tenant en SQL,
rate-limiting (global + auth), PIN/mots de passe bcrypt, refresh tokens rotatifs
révocables, audit de toute mutation sensible, CSP/headers nginx, secrets par
variables d'environnement uniquement.

## Reprendre une installation V1 (données legacy)

```bash
DATABASE_URL=… node scripts/migrate-v1-to-v2.js --check   # rapport d'écarts, lecture seule
DATABASE_URL=… node scripts/migrate-v1-to-v2.js --apply   # migration atomique + rapport JSON
```

PIN re-hachés, catalogue par dépôt fusionné en `stock_levels` + lots FEFO,
licences rattachées aux plans, contrôle de somme du stock, entrée `MIGRATION`
dans l'audit. Détail : `docs/03_EXPLOITATION.md` §11.

## Structure

```
apps/api          Node 22 + Express 4 + TypeScript strict + pg (pool), zod
apps/web          React 18 + Vite + PWA (Service Worker, IndexedDB), CSS custom
database/         migrations V001-V003, seeds, legacy/ (Schéma V1 figé, reprise)
scripts/          create-superadmin, reset-user-password, backup.sh, migrate-v1-to-v2
deploy/           exemple nginx public (TLS), compose.yml racine
docs/             audit, matrice des interfaces, plan, runbook, référence API
deploy/ci.yml     Définition CI complète (5 jobs) — à activer, voir encadré ci-dessous
```

## Documentation

| Document                                                           | Contenu                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`docs/00_AUDIT_GLOBAL.md`](docs/00_AUDIT_GLOBAL.md)               | Audit initial (41 constats) qui a motivé la refonte                         |
| [`docs/01_MATRICE_INTERFACES.md`](docs/01_MATRICE_INTERFACES.md)   | 29 écrans livrés, couverture CRUD par ressource                             |
| [`docs/02_PLAN_IMPLEMENTATION.md`](docs/02_PLAN_IMPLEMENTATION.md) | Plan en 8 phases — appliqué à 100 %                                         |
| [`docs/03_EXPLOITATION.md`](docs/03_EXPLOITATION.md)               | Runbook prod : déploiement, sauvegardes, secrets, dépannage, **reprise V1** |
| [`docs/04_API.md`](docs/04_API.md)                                 | Guide d'intégration API (+ spec OpenAPI 3 servie sur `/api/openapi.json`)   |

## Variables d'environnement (essentielles)

| Variable                                      | Défaut | Rôle                                                     |
| --------------------------------------------- | ------ | -------------------------------------------------------- |
| `DATABASE_URL`                                | —      | PostgreSQL 15+ (`postgresql://user:pass@host:5432/base`) |
| `JWT_SECRET` / `REFRESH_SECRET`               | —      | **Obligatoires**, ≥ 32 caractères, distincts             |
| `CORS_ORIGIN`                                 | —      | Origines web autorisées (liste `,`)                      |
| `PORT`                                        | `5000` | Port API                                                 |
| `BCRYPT_ROUNDS`                               | `10`   | Coût de hachage                                          |
| `LICENSE_GRACE_DAYS`                          | `3`    | Grâce d'écriture après expiration licence                |
| `NOTIF_DRIVER`                                | `mock` | `live` pour envois SMS/WhatsApp réels                    |
| `AT_API_KEY` / `AT_USERNAME` / `AT_SENDER_ID` | —      | Africa's Talking                                         |
| `WA_TOKEN` / `WA_PHONE_ID`                    | —      | WhatsApp Cloud API                                       |

Licence : usage interne de l'éditeur — tous droits réservés.

> **Activation CI :** le workflow est livré dans [`deploy/ci.yml`](deploy/ci.yml).
> Pour l'activer sur GitHub Actions, copiez-le vers `.github/workflows/ci.yml`
> (l'ajout d'un workflow exige la permission « workflows » sur le jeton Git
> utilisé — l'exécuter avec un compte mainteneur). Les 5 jobs tournent ensuite à
> chaque push/PR : tests API (Postgres 16 réelle), tests Web, audit npm,
> migration V1→V2 de bout en bout et fumée Docker Compose.
