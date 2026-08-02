# StockMan — Matrice des besoins par interface

> **État au 02/08/2026 — v2.0 LIVRÉE.** Les statuts reflètent désormais
> l'existant **implémenté et testé** (81 tests API + 55 tests web, chaîne de
> migrations rejouée en CI sur Postgres 16, fumée Docker Compose). Les besoins
> exprimés ci-dessous étaient la checklist du CDC ; chaque ligne est ✅.

**Légende statut :** ✅ existant et sain · 🟨 partiel/cassé · ❌ inexistant.

---

## 0. Exigences transverses (valables pour **toutes** les interfaces) — ✅

| Besoin                | Implémentation livrée                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentification      | Access JWT (10 min, mémoire) + refresh opaque **rotatif** httpOnly (7 j, table `refresh_tokens`, réutilisation = révocation famille) ; redirection login sur 401 avec file single-flight |
| Rôles                 | Menus filtrés par rôle **et** `requireRole`/`requireSuperAdmin` côté API ; tests RBAC croisés tenant≠tenant                                                                              |
| États UI obligatoires | `loading` (skeleton/spinner), `empty` (EmptyState + CTA), `error` (ErrorState + réessayer), `offline` (bandeau + indicateur de file) sur chaque écran                                    |
| Retours utilisateur   | Toasts succès/erreur/info, ConfirmModal sur toute action destructive                                                                                                                     |
| Données               | Pagination serveur (page/size), **curseur** pour mouvements, recherche débouncée 400 ms, filtres persistés dans l'URL                                                                    |
| Formats               | `Intl.NumberFormat('fr-FR') + " FCFA"`, dates `Intl.DateTimeFormat` fr, fuseau tenant configurable (défaut `Africa/Douala`)                                                              |
| Accessibilité         | Navigation clavier, ARIA sur lignes cliquables, focus management des modales, contrastes AA                                                                                              |
| Encodage              | UTF-8 strict (zéro mojibake — vérifié par test), aucun asset externe                                                                                                                     |
| Offline               | File IndexedDB (ventes) avec `client_sale_id` UUID v4, rejeu idempotent serveur (`duplicate:true`), badge de sync                                                                        |
| Impression            | Reçus thermiques 80 mm (POS & historique) + **étiquettes code-barres A4 (Code 39, 0 dépendance)**                                                                                        |

---

## 1. Espace public / Onboarding

### 1.1 Inscription tenant — ✅

- **Route :** `POST /api/auth/register` — **une transaction** : tenant + compte ADMIN + licence TRIAL (14 j) + dépôt « Principal » + unités par défaut (Pièce, Carton×12, Kg, L). Personnalisation ensuite côté Paramètres (logo, couleur, téléphone).
- Email **globalement unique** (clé de connexion, normalisé minuscules) → 409 `EMAIL_TAKEN` ; politique de mot de passe (8+, lettre+chiffre) zod.
- **Acceptation :** après inscription, l'utilisateur crée un produit et vend immédiatement (couvert par `seedTenant` des tests).

### 1.2 Connexion — ✅

- `login` (tous rôles), `pin` (kiosque vendeur, bcrypt, rate-limit dédié), `refresh` **rotatif**, `logout` (révocation serveur), `forgot-password`/`reset-password` (jeton à usage unique, réponse non révélatrice), `change-password` (révoque les autres sessions).
- Blocages explicites : compte désactivé, tenant suspendu, licence expirée (message + page Abonnement).

---

## 2. Espace ADMIN (gérant)

### 2.1 Tableau de bord — ✅

`GET /api/reports/dashboard` : CA jour/semaine/mois, nb ventes, panier moyen, alertes stock bas cliquables, **lots proches péremption (30 j)**, série 14 j (graphique SVG), top produits, top vendeurs ; fuseau tenant côté calcul.

### 2.2 Catalogue & Stock (produits) — ✅

- CRUD : C ✅ (variantes + stock initial tracé) · R ✅ (pagination, recherche serveur nom/code-barres/catégorie, pas de N+1) · U ✅ (PATCH complet) · D = **archivage/restauration** (`archived_at`, historique conservé).
- Fiche : prix achat/vente + marge, seuil, **stock par dépôt**, onglets Variantes / **Lots FEFO** / Journal des mouvements (20 derniers).
- **Import CSV** (`POST /api/products/import`, ≤ 500 lignes, upsert code-barres/nom, audit IMPORT) + **export CSV** ; **étiquettes Code 39 A4** imprimables (produit ou variante).
- Règles : code-barres unique/tenant (index partiel), prix ≥ 0, SKU variante unique/produit, Σ variantes = stock recalculé serveur.

### 2.3 Catégories — ✅

`GET/POST /api/categories`, `PATCH/DELETE /:id` — liste avec nb produits, suppression bloquée si utilisée (`409 CATEGORY_IN_USE`), ordre d'affichage (`sort_order`).

### 2.4 Unités & conversions — ✅

CRUD complet (dont `PATCH`, `409 UNIT_IN_USE`) ; **la caisse vend en unité dérivée et le serveur convertit `base_value × qté`** (tests dédiés) ; une seule unité `is_base` par tenant, unicité `(tenant, name)`.

### 2.5 Dépôts — ✅

CRUD complet (`GET/POST /api/depots`, `PATCH /:id` avec activation) ; vue **stock par dépôt** (`GET /:id/stock`) ; **transferts inter-dépôts à double validation** (`POST /api/stock/transfers` → `POST /:id/receive`, annulation avec réintégration) ; `max_depots` licence appliqué à la création (403 `LICENSE_DEPOT_LIMIT`).

### 2.6 Fournisseurs — ✅

CRUD complet (`GET/POST/PATCH/DELETE`) ; fiche avec **historique des réceptions** ; association aux lots (`stock_batches.supplier_id`) — suppression tolérante (réceptions conservées, `SET NULL`).

### 2.7 Entrées de stock / Réceptions fournisseurs — ✅

Écran Réception : fournisseur, lignes produit/variante, quantités **multi-unités converties serveur**, n° lot + péremption, coût d'achat → mouvements `IN` + lots + `stock_levels` **atomiques** ; liste paginée + détail (lots créés). Le coût alimente les **marges**.

### 2.8 Ajustements & Inventaire physique — ✅

`POST /api/stock/adjust` : comptage cible + **motif obligatoire** → mouvement `ADJUSTMENT` signé + audit ; écran inventaire guidé (liste à compter par dépôt, écarts appliqués en rafale) ; réservé ADMIN.

### 2.9 Journal des mouvements — ✅

`GET /api/stock/movements` : **pagination par curseur**, filtres type/produit/dépôt/période ; types couverts `IN/OUT/TRANSFER/ADJUSTMENT/SALE/RETURN/DAMAGE/EXPIRED/VOID`.

### 2.10 Ventes (historique & détail) — ✅

Liste paginée + filtres période/dépôt/vendeur/paiement/statut ; **détail** (lignes avec unité/variante, retours) ; **annulation** `POST /:id/void` (statut VOIDED, restock `VOID`, motif tracé) ; **retours partiels** `POST /:id/returns` (restock `RETURN`) ; reçu ré-imprimable + **lien WhatsApp** ; badge ventes re-synchronisées offline.

### 2.11 Équipe / Vendeurs — ✅

CRUD : liste, création (rôle/dépôt/PIN haché), `PATCH /:id`, `reset-password` (sessions révoquées), `reset-pin`, `deactivate`/`activate` — jamais de suppression si ventes liées ; `max_users` licence appliqué ; jamais de PIN dans les réponses ; performance vendeur via rapport ventes.

### 2.12 Rapports — ✅

`GET /api/reports/sales|margin|stock-valuation|expiry|predictive` (période/dépôt, **`format=csv`**) : ventes par dépôt/vendeur/paiement + série, **marges** (mise à jour du coût d'achat courant), valorisation, péremptions FEFO, **prédictif** (vélocité 30 j corrigée) ; envoi programmé du rapport quotidien (notifications §2.13).

### 2.13 Centre de notifications — ✅

Cloche Shell + page historique paginée (statuts SENT/FAILED/READ, marquer lu/tout lire) ; paramètres destinataires SMS/WhatsApp **par tenant** (`notification_settings`), seuils et heure du rapport quotidien ; bouton **test d'envoi** ; drivers Africa's Talking + WhatsApp Cloud (mock en dev/test).

### 2.14 Paramètres tenant — ✅

Profil entreprise (nom, téléphone, logo **data-URL**, couleur → thème white-label), fuseau/devise, page **Abonnement** (plan, échéance, usage vs plafonds, grille tarifaire), compte propre (mot de passe + PIN).

### 2.15 Journal d'audit — ✅

Helper `writeAudit` sur **toutes** les mutations sensibles (catalogue, stock, ventes/void/retours, utilisateurs, configs, licences, impersonation, imports, migration) avec `previous_state`/`new_state` ; écran read-only filtré (entité/action/utilisateur/période) paginé.

---

## 3. Espace VENDEUR (caisse mobile-first)

### 3.1 Caisse / POS — ✅ (l'écran cœur de métier)

- Recherche + **douchette USB** (saisie Entrée) + **scan caméra** (`BarcodeDetector` natif, amélioration progressive documentée) ; favoris, filtres catégorie.
- Panier : quantité **en unité ou dérivée** (conversion auto serveur), variante, remise ligne, total FCFA ; paiements **CASH (monnaie à rendre) / MTN_MOMO / ORANGE_MONEY** (référence opérateur).
- **Hors-ligne complet** : catalogue bootstrap mis en cache IndexedDB, vente en file (`client_sale_id`), **rejeu automatique** au retour réseau avec `duplicate:true` (aucun doublon), file consultable/purgeable.
- Reçu 80 mm imprimé + **partage WhatsApp** (wa.me) ; verrou PIN (connexion par PIN) ; prix/total **recalculés serveur** ; FEFO automatique ; rupture → blocage message clair.

### 3.2 Mes ventes — ✅

`/caisse/mes-ventes` : `GET /api/sales?mine=1` — **filtre forcé** `vendorId = utilisateur connecté` côté API (impossible de voir autrui), totals espèces/mobile, détail + ré-impression ; l'**annulation est effectuée par l'ADMIN** (`POST /:id/void`) — contrôle plus strict que le circuit de demande.

### 3.3 Consultation stock (lecture seule) — ✅

`/caisse/stock` : disponibilités de son dépôt en lecture seule (aucune écriture vendeur).

### 3.4 Clôture de journée (Z de caisse) — ✅

`GET /api/reports/z-report?date=&depotId=` : CA, nb ventes, ventilation par paiement, annulations ; écran imprimable + envoi automatique 20 h (scheduler).

---

## 4. Espace SUPER_ADMIN (console SaaS)

### 4.1 Dashboard global — ✅

`GET /api/reports/superadmin/stats` : tenants (total/actifs/utilisateurs), CA plateforme (mois + cumul), **MRR**, essais expirant ≤ 7 j, **échecs de notifications 24 h**, nouveaux tenants 30 j, top tenants par CA.

### 4.2 Tenants — ✅

Liste + recherche + filtre statut ; création (provisionnement gérant + licence) ; **détail complet** (gérant, dépôts, usage, ventes 30 j) ; édition ; **suspendre/réactiver** ; **reset mot de passe gérant** ; **impersonation journalisée** (audit IMPERSONATE + bandeau dans l'app).

### 4.3 Licences & plans — ✅

Plans CRUD (`max_users`, `max_depots`, prix) ; licences liste (filtre statut, tri échéance), attribution, **renouvellement** (`POST /:id/renew`) ; middleware **`requireActiveLicense`** bloquant l'API (423, grâce `LICENSE_GRACE_DAYS=3 j`) — règlement MoMo/OM géré hors plateforme (modèle de facturation v2).

### 4.4 Configurations système — ✅

`system_configs` (**secrets masqués** en lecture, `is_secret`) + `tenant_configs` ; édition avec audit CONFIG ; **test de connectivité** SMS/WhatsApp (`POST /api/notifications/test`).

### 4.5 Supervision notifications — ✅

`GET /api/notifications/supervision` : envois tous tenants, filtres statut/canal, réponses providers ; compteur d'échecs 24 h remonté au dashboard SA ; `GET /api/audit-logs/supervision`.

---

## 5. Couverture API — synthèse par ressource (état v2.0)

| Ressource             |                 C                  |         R (liste)         |    R (détail)     |        U        |         D          | Endpoints spéciaux                       | Statut |
| --------------------- | :--------------------------------: | :-----------------------: | :---------------: | :-------------: | :----------------: | ---------------------------------------- | ------ |
| Auth / session        |                 ✅                 |             –             |      ✅ (me)      | ✅ (change-pwd) |     ✅ logout      | refresh **rotatif** · pin · forgot/reset | ✅     |
| Tenant                |              ✅ (SA)               |          ✅ (SA)          |        ✅         |       ✅        |     suspendre      | current · impersonate (audit)            | ✅     |
| Licence / plan        |                 ✅                 |            ✅             |        ✅         |       ✅        |         –          | renew · **middleware licence**           | ✅     |
| Utilisateur / vendeur |                 ✅                 |            ✅             |        ✅         |       ✅        | ✅ (désactivation) | reset pwd/pin                            | ✅     |
| Dépôt                 |                 ✅                 |            ✅             |    ✅ + stock     |       ✅        | ✅ (désactivation) | **transferts double validation**         | ✅     |
| Catégorie             |                 ✅                 |     ✅ (+nb produits)     |         –         |       ✅        |     ✅ (garde)     | –                                        | ✅     |
| Unité                 |                 ✅                 |            ✅             |         –         |       ✅        |     ✅ (garde)     | **conversion serveur en vente**          | ✅     |
| Produit               |                 ✅                 |  ✅ (paginé, recherche)   |        ✅         |       ✅        |   ✅ (archivage)   | barcode · **import/export CSV**          | ✅     |
| Variante              |                 ✅                 |            ✅             |        ✅         |       ✅        |  ✅ (garde usage)  | SKU unique                               | ✅     |
| Lot / batch           |                 ✅                 |         ✅ (FEFO)         |        ✅         |       ✅        |   ✅ (si épuisé)   | réception liée · fournisseur             | ✅     |
| Fournisseur           |                 ✅                 |            ✅             | ✅ (+ réceptions) |       ✅        |         ✅         | –                                        | ✅     |
| Réception stock       |                 ✅                 |            ✅             |        ✅         |        –        |         –          | lots auto + coûts                        | ✅     |
| Vente                 | ✅ (**idempotente**, prix serveur) |       ✅ (filtres)        |        ✅         |        –        |      ✅ void       | reçu · **retours** · offline-idempotent  | ✅     |
| Mouvement stock       |                 ✅                 | ✅ (**curseur**, filtres) |         –         |        –        |         –          | 9 types couverts                         | ✅     |
| Notification          |           ✅ (scheduler)           |            ✅             |        ✅         |  ✅ (settings)  |         –          | test d'envoi · dedupe exactly-once       | ✅     |
| Config système        |                 ✅                 |   ✅ (secrets masqués)    |         –         |       ✅        |         –          | global + par-tenant                      | ✅     |
| Audit log             |      ✅ (mutations sensibles)      |            ✅             |         –         |        –        |         –          | exportable · supervision SA              | ✅     |
| Rapports              |                 –                  |      ✅ (6 + Z + SA)      |         –         |        –        |         –          | marges · **exports CSV** · Z caisse      | ✅     |

**Écrans livrés : 29 / 25 prévus** (public 4 · admin 19 · vendeur 5 · console SA 7, certaines entrées de la matrice étant couvertes par des écrans enrichis). Chaque ligne est couverte par des tests (81 API / 55 web) et documentée dans `docs/04_API.md` + `GET /api/openapi.json`.
