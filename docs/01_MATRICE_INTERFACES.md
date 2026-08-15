# StockMan — Matrice des besoins par interface

> **État au 03/08/2026 — v2.1 « conformité expert » LIVRÉE.** Les statuts
> reflètent l'existant **implémenté et testé** (181 tests API + 64 tests web,
> chaîne de migrations V001→V010 rejouée en CI sur Postgres 16, fumée Docker
> Compose). La v2.0 couvrait la checklist du CDC ; la **v2.1 ajoute les
> exigences métier de l'audit expert** (`05_AUDIT_EXPERT_STOCK.md`, phases
> E1→E8) : coûts réels CUMP, lots bout-en-bout FEFO, clients & crédit,
> commandes fournisseurs, campagnes d'inventaire, sessions de caisse,
> fiscalité Cameroun (TVA/factures) et maturité (IMEI, promos, seuils par
> dépôt, exports comptables…). Chaque ligne est ✅.

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
- Fiche : prix achat/vente + marge, seuil, **stock par dépôt**, onglets Variantes / **Lots FEFO** / Journal des mouvements / **N° de série (IMEI)** / **Historique des prix** / **Paramètres par dépôt** (seuil surchargé + rayonnage) ; **coût moyen pondéré (CUMP)** affiché, drapeaux « géré par lots » et « sérialisé (IMEI) », **prix de gros** (grille gros/détail), **taux de TVA** par produit (19,25 % ou exonéré).
- **Import CSV** (`POST /api/products/import`, ≤ 500 lignes, upsert code-barres/nom, audit IMPORT) + **export CSV** ; **étiquettes Code 39 / EAN-13 A4** imprimables (produit ou variante, auto-détection du format).
- Règles : code-barres unique/tenant (index partiel), prix ≥ 0, SKU variante unique/produit, Σ variantes = stock recalculé serveur, historisation horodatée de tout changement de prix avec motif (`price_history`).

### 2.3 Catégories — ✅

`GET/POST /api/categories`, `PATCH/DELETE /:id` — liste avec nb produits, suppression bloquée si utilisée (`409 CATEGORY_IN_USE`), ordre d'affichage (`sort_order`).

### 2.4 Unités & conversions — ✅

CRUD complet (dont `PATCH`, `409 UNIT_IN_USE`) ; **la caisse vend en unité dérivée et le serveur convertit `base_value × qté`** (tests dédiés) ; une seule unité `is_base` par tenant, unicité `(tenant, name)`.

### 2.5 Dépôts — ✅

CRUD complet (`GET/POST /api/depots`, `PATCH /:id` avec activation) ; vue **stock par dépôt** (`GET /:id/stock` — seuil effectif par dépôt, rayonnage, **stock réservé**) ; **transferts inter-dépôts à double validation** v2 : `POST /api/stock/transfers` → réception **partielle avec écarts** (`POST /:id/receive` — motifs casse/perte valorisés au coût réel), **annulation avec restitution du reliquat** (`POST /:id/cancel`), **vue « stock en transit »** (`GET /api/stock/transit` — marchandise entre deux dépôts, valeur au CUMP) ; `max_depots` licence appliqué à la création (403 `LICENSE_DEPOT_LIMIT`).

### 2.6 Fournisseurs — ✅

CRUD complet (`GET/POST/PATCH/DELETE`) ; fiche avec **historique des réceptions** ; association aux lots (`stock_batches.supplier_id`) — suppression tolérante (réceptions conservées, `SET NULL`). **Transferts CSV** (D3) : export (`GET /api/suppliers/export/csv`, format maison BOM/`;` listé ci-dessous) et **import/upsert** par nom (`POST /api/suppliers/import`, compte-rendu créés/mis à jour/refusés en modale).

### 2.7 Entrées de stock / Réceptions fournisseurs — ✅

Écran Réception : fournisseur, lignes produit/variante, quantités **multi-unités converties serveur**, n° lot + péremption, **numéros de série obligatoires pour les produits sérialisés**, coût d'achat → mouvements `IN` + lots + `stock_levels` **atomiques** ; liste paginée + détail (lots créés). Le coût **réel** saisi recalcule le **CUMP** du produit et alimente les **marges historiques** (le prix d'achat catalogue n'altère plus les ventes passées). **Import CSV du stock initial** (`POST /api/stock/import`, prise d'inventaire d'ouverture : une réception groupée atomique, erreurs rapportées ligne à ligne).

### 2.8 Ajustements & Inventaire physique — ✅

`POST /api/stock/adjust` : comptage cible + **motif codifié obligatoire** → mouvement `ADJUSTMENT` signé + audit. **Campagnes d'inventaire** (`/api/inventory-campaigns`) : périmètre dépôt/categories daté, **gel optionnel des mouvements** pendant le comptage, **comptage aveugle** (`PUT /:id/counts` — le compteur ne voit pas le théorique), **double validation** (qui compte ≠ qui valide — 403 sinon), rapport d'**écarts valorisés au CUMP** appliqué à la clôture, **inventaire tournant ABC** (`GET /abc-schedule` : A chaque mois, C chaque trimestre), annulation possible jusqu'à validation ; écran guidé par onglets (ajustements libres / campagnes).

### 2.9 Journal des mouvements — ✅

`GET /api/stock/movements` : **pagination par curseur**, filtres type/produit/dépôt/période ; types couverts `IN/OUT/TRANSFER/ADJUSTMENT/SALE/RETURN/DAMAGE/EXPIRED/VOID`.

### 2.10 Ventes (historique & détail) — ✅

Liste paginée + filtres période/dépôt/vendeur/paiement/statut ; **détail** (lignes avec unité/variante, lots consommés FEFO, **coût figé par ligne**, numéros de série vendus, retours) ; **annulation** `POST /:id/void` (statut VOIDED, restock `VOID` au même coût, motif tracé — émet un **avoir** si la vente était facturée) ; **retours partiels** `POST /:id/returns` (restock `RETURN`) ; **versements** `POST /:id/payments` (crédit client : encaissements successifs, idempotents hors-ligne via `client_payment_id`, reçu « reste à payer ») ; reçu ré-imprimable + **lien WhatsApp** ; badge ventes re-synchronisées offline. **Export CSV du journal** (D3) : `GET /api/sales/export/csv?from&to` — plafond 20 000 lignes, le vendeur ne reçoit que ses propres ventes, audit `EXPORT`.

### 2.11 Équipe / Vendeurs — ✅

CRUD : liste, création (rôle/dépôt/PIN haché), `PATCH /:id`, `reset-password` (sessions révoquées), `reset-pin`, `deactivate`/`activate` — jamais de suppression si ventes liées ; `max_users` licence appliqué ; jamais de PIN dans les réponses ; performance vendeur via rapport ventes.

### 2.12 Rapports — ✅

`GET /api/reports/sales|margin|stock-valuation|expiry|predictive|cogs|stock-kpis|batch-trace|vat-journal|z-report` (période/dépôt, **`format=csv`**) : ventes par dépôt/vendeur/paiement + série, **marges au coût réel historique** (le prix d'achat du jour ne change plus les marges d'hier), valorisation **au CUMP**, péremptions FEFO, prédictif (vélocité 30 j corrigée), **COGS par période**, **KPIs de stock** (classification ABC, rotation, couverture en jours, **stock dormant**), **traçabilité lot → ventes** (rappel), **journal de TVA** ; **exports comptables SYSCOHADA** (`/api/reports/exports/syscohada-sales|syscohada-receivables|syscohada-inventory`) ; bouton « commander » depuis le prédictif ; envoi programmé du rapport quotidien (notifications §2.13).

### 2.13 Centre de notifications — ✅

Cloche Shell + page historique paginée (statuts SENT/FAILED/READ, marquer lu/tout lire) ; paramètres destinataires SMS/WhatsApp **par tenant** (`notification_settings`), seuils et heure du rapport quotidien ; bouton **test d'envoi** ; drivers Africa's Talking + WhatsApp Cloud (mock en dev/test).

### 2.14 Paramètres tenant — ✅

Profil entreprise (nom, téléphone, logo **data-URL**, couleur → thème white-label), fuseau/devise, page **Abonnement** (plan, échéance, usage vs plafonds, grille tarifaire), compte propre (mot de passe + PIN). **Carte « Sauvegarde & restauration » (D1/D2)** : export JSON intégral du tenant (`GET /api/tenant/export`, snapshot `stockman-export` v1), restauration guidée en trois temps — fichier → **prévisualisation** (`mode=preview` : compteurs par table, avertissements, références utilisateurs rabattues) → saisie de « RESTAURER » → **remplacement transactionnel** (`mode=replace`) puis rechargement ; codes-barres : préfixe interne GS1 magasin et **décodage des balances à pesée** (OFF/PRICE/WEIGHT).

### 2.15 Journal d'audit — ✅

Helper `writeAudit` sur **toutes** les mutations sensibles (catalogue, stock, ventes/void/retours, utilisateurs, configs, licences, impersonation, imports, migration, **versements, relances, devis, commandes, campagnes, sessions, factures, promotions, séries**) avec `previous_state`/`new_state` ; écran read-only filtré (entité/action/utilisateur/période) paginé.

### 2.16 Clients & crédit (carnet de dettes) — ✅

CRUD (`GET/POST /api/customers`, `PATCH /:id`) ; fiche avec **solde, plafond de crédit, historique des ventes à crédit et des versements**, **vieillissement des créances 30/60/90** ; **relance SMS/WhatsApp** (`POST /:id/remind` — connecteurs existants, tracée) ; canal tarifaire **détail/gros** par client ; blocage vente à crédit au-delà du plafond. **Transferts CSV** (D3) : export (`GET /api/customers/export/csv`) et **import/upsert** par téléphone sinon nom (`POST /api/customers/import` — le canal tarifaire n'est modifié que s'il est explicitement fourni).

### 2.17 Devis & proforma — ✅

`GET/POST /api/quotes` : devis daté à **prix figés**, envoi au client, **conversion en vente** (`POST /:id/convert` — réutilise les prix négociés), annulation (`POST /:id/cancel`) ; standard B2B demi-gros local.

### 2.18 Commandes fournisseurs (approvisionnement) — ✅

`GET/POST /api/purchase-orders` : bons de commande (BROUILLON/ENVOYÉE/RÉCEPTION_PARTIELLE/CLÔTURÉE/ANNULÉE), **réceptions rattachées partielles avec reliquats** (`POST /:id/receive` — motifs d'écart), **retours fournisseur** valorisés au coût réel du lot (`/returns`), **performance OTIF** (`GET /otif` — délai prévu/réel, taux de service), génération depuis le rapport prédictif.

### 2.19 Sessions de caisse — ✅

`GET/POST /api/cash-sessions` : ouverture avec **fond de caisse**, ventes rattachées à la session, **clôture par comptage physique** (`POST /:id/close` — attendu par méthode vs compté, **écart de caisse**), Z émis à la clôture et journée **verrouillée** ; config `cash_session_required` = interdiction de vendre/encaisser hors session (gate caisse) ; suivi ADMIN des écarts par dépôt/vendeur.

### 2.20 Factures, TVA & comptabilité — ✅

Facture légale par vente : **numérotation continue infalsifiable par série/année** (séquence verrouillée `invoice_sequences`, facture immuable — VOID émet un **avoir**, retour partiel → avoir partiel), **TVA par produit** (19,25 % ou exonéré, ventilation HT/TVA sur ticket TTC), mentions obligatoires (raison sociale, NIU/contribuable, RCCM — Paramètres tenant) ; `GET /api/invoices` (+`/by-sale/:saleId`), journal de TVA et **exports CSV SYSCOHADA** (ventes, créances clients 411, inventaire valorisé 311).

### 2.21 Promotions & politique de prix — ✅

`GET/POST /api/pricing/promotions`, `PATCH/DELETE /:id` : remises **datées** globales ou ciblées produit (la promo produit prime sur la globale) appliquées **automatiquement à la caisse** ; **plafond de remise manuelle par rôle/utilisateur** (403 `DISCOUNT_LIMIT_EXCEEDED` au dépassement) ; grille **gros/détail** (prix de gros par produit + quantité seuil, déclenchée par le canal du client) ; **historique des prix** horodaté avec motif (`GET /api/pricing/price-history/:productId`) ; **stock réservé** et **seuils d'alerte par dépôt + rayonnages** (`GET/PUT /api/products/:id/depot-settings`) ; **numéros de série/IMEI** (`/api/serials` : enregistrement à la réception, capture à la caisse, `GET /lookup` pour garantie/SAV).

---

## 3. Espace VENDEUR (caisse mobile-first)

### 3.1 Caisse / POS — ✅ (l'écran cœur de métier)

- Recherche + **douchette USB** (saisie Entrée) + **scan caméra** (`BarcodeDetector` natif, amélioration progressive documentée) ; favoris, filtres catégorie.
- Panier : quantité **en unité ou dérivée** (conversion auto serveur), variante, remise ligne, total FCFA ; paiements **CASH (monnaie à rendre) / MTN_MOMO / ORANGE_MONEY** (référence opérateur).
- **Hors-ligne complet** : catalogue bootstrap mis en cache IndexedDB, vente en file (`client_sale_id`), **rejeu automatique** au retour réseau avec `duplicate:true` (aucun doublon), file consultable/purgeable.
- Reçu 80 mm imprimé + **partage WhatsApp** (wa.me) ; verrou PIN (connexion par PIN) ; prix/total **recalculés serveur** ; FEFO automatique (blocage des lots périmés) ; rupture → blocage message clair ; **promotions datées auto-appliquées**, **plafond de remise par rôle** (message explicite au dépassement), **prix de gros automatique** selon le canal du client ; **capture IMEI obligatoire** pour les produits sérialisés (suggestions des numéros en stock, saisie hors-ligne vérifiée à la sync) ; **vente à crédit / paiement mixte** avec sélection client, « reste à payer » et **plafond de crédit** ; **gate session de caisse** (ouverture exigée si configurée).

### 3.2 Mes ventes — ✅

`/caisse/mes-ventes` : `GET /api/sales?mine=1` — **filtre forcé** `vendorId = utilisateur connecté` côté API (impossible de voir autrui), totals espèces/mobile, détail + ré-impression ; l'**annulation est effectuée par l'ADMIN** (`POST /:id/void`) — contrôle plus strict que le circuit de demande.

### 3.3 Consultation stock (lecture seule) — ✅

`/caisse/stock` : disponibilités de son dépôt en lecture seule (aucune écriture vendeur).

### 3.4 Clôture de journée (Z de caisse) — ✅

`GET /api/reports/z-report?date=&depotId=` : CA, nb ventes, ventilation par paiement, annulations ; écran imprimable + envoi automatique 20 h (scheduler).

### 3.5 Session de caisse (ouverture → comptage → clôture) — ✅

`/caisse/session` : ouverture avec **fond de caisse**, suivi en direct (attendu par méthode : fond + encaissements), **clôture par comptage physique** qui calcule l'**écart** et verrouille la journée ; le vendeur n'encaisse dans aucun écran hors session quand le gérant l'exige.

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

## 5. Couverture API — synthèse par ressource (état v2.1 « conformité expert »)

| Ressource             |                 C                  |         R (liste)         |      R (détail)      |        U        |         D          | Endpoints spéciaux                                                                  | Statut |
| --------------------- | :--------------------------------: | :-----------------------: | :------------------: | :-------------: | :----------------: | ----------------------------------------------------------------------------------- | ------ |
| Auth / session        |                 ✅                 |             –             |       ✅ (me)        | ✅ (change-pwd) |     ✅ logout      | refresh **rotatif** · pin · forgot/reset                                            | ✅     |
| Tenant                |              ✅ (SA)               |          ✅ (SA)          |          ✅          |       ✅        |     suspendre      | current · impersonate (audit)                                                       | ✅     |
| Licence / plan        |                 ✅                 |            ✅             |          ✅          |       ✅        |         –          | renew · **middleware licence**                                                      | ✅     |
| Utilisateur / vendeur |                 ✅                 |            ✅             |          ✅          |       ✅        | ✅ (désactivation) | reset pwd/pin                                                                       | ✅     |
| Dépôt                 |                 ✅                 |            ✅             |      ✅ + stock      |       ✅        | ✅ (désactivation) | **transferts double validation**                                                    | ✅     |
| Catégorie             |                 ✅                 |     ✅ (+nb produits)     |          –           |       ✅        |     ✅ (garde)     | –                                                                                   | ✅     |
| Unité                 |                 ✅                 |            ✅             |          –           |       ✅        |     ✅ (garde)     | **conversion serveur en vente**                                                     | ✅     |
| Produit               |                 ✅                 |  ✅ (paginé, recherche)   |          ✅          |       ✅        |   ✅ (archivage)   | barcode · **import/export CSV**                                                     | ✅     |
| Variante              |                 ✅                 |            ✅             |          ✅          |       ✅        |  ✅ (garde usage)  | SKU unique                                                                          | ✅     |
| Lot / batch           |                 ✅                 |         ✅ (FEFO)         |          ✅          |       ✅        |   ✅ (si épuisé)   | réception liée · fournisseur                                                        | ✅     |
| Fournisseur           |                 ✅                 |            ✅             |  ✅ (+ réceptions)   |       ✅        |         ✅         | –                                                                                   | ✅     |
| Réception stock       |                 ✅                 |            ✅             |          ✅          |        –        |         –          | lots auto + coûts                                                                   | ✅     |
| Vente                 | ✅ (**idempotente**, prix serveur) |       ✅ (filtres)        |          ✅          |        –        |      ✅ void       | reçu · **retours** · offline-idempotent · **versements** · **coût figé** · **IMEI** | ✅     |
| Client / crédit       |                 ✅                 |            ✅             | ✅ (solde, 30/60/90) |       ✅        |         –          | **relance SMS/WhatsApp** · plafond · canal gros                                     | ✅     |
| Versement             |   ✅ (**idempotent** hors-ligne)   |            ✅             |          –           |        –        |         –          | méthodes mixtes · reçu « reste à payer »                                            | ✅     |
| Devis / proforma      |                 ✅                 |            ✅             |          ✅          |        –        |     ✅ annuler     | **convertir en vente** (prix figés)                                                 | ✅     |
| Commande fournisseur  |                 ✅                 |            ✅             |          ✅          |        –        |     ✅ annuler     | envoyer · **réceptions partielles + reliquat** · clôturer · **retours** · **OTIF**  | ✅     |
| Campagne d'inventaire |                 ✅                 |            ✅             |          ✅          |  ✅ comptages   |     ✅ annuler     | **aveugle** · **qui compte ≠ qui valide** · écarts **CUMP** · **ABC tournant**      | ✅     |
| Session de caisse     |                 ✅                 |            ✅             |          ✅          |        –        |         –          | **clôture comptée + écart** · verrou journée                                        | ✅     |
| Facture / avoir       |        ✅ (auto à la vente)        |            ✅             |          ✅          |    immuable     |         –          | **numérotation continue** · **avoirs** · TVA                                        | ✅     |
| Promotion             |                 ✅                 |            ✅             |          –           |       ✅        |         ✅         | fenêtre datée · produit > globale                                                   | ✅     |
| N° de série (IMEI)    |       ✅ (réception, admin)        |     ✅ (par produit)      |    ✅ **lookup**     |        –        |         –          | capture caisse · garantie/SAV                                                       | ✅     |
| Mouvement stock       |                 ✅                 | ✅ (**curseur**, filtres) |          –           |        –        |         –          | 9 types couverts                                                                    | ✅     |
| Notification          |           ✅ (scheduler)           |            ✅             |          ✅          |  ✅ (settings)  |         –          | test d'envoi · dedupe exactly-once                                                  | ✅     |
| Config système        |                 ✅                 |   ✅ (secrets masqués)    |          –           |       ✅        |         –          | global + par-tenant                                                                 | ✅     |
| Audit log             |      ✅ (mutations sensibles)      |            ✅             |          –           |        –        |         –          | exportable · supervision SA                                                         | ✅     |
| Rapports              |                 –                  |      ✅ (6 + Z + SA)      |          –           |        –        |         –          | marges · **exports CSV** · Z caisse                                                 | ✅     |

**Écrans livrés : 42** (public 4 · admin 25 · vendeur 6 · console SA 7 — certaines entrées de la matrice étant couvertes par des écrans enrichis). Chaque ligne est couverte par des tests (181 API / 64 web) et documentée dans `docs/04_API.md` + `GET /api/openapi.json`. Les exigences métier de l'audit expert (E1→E8 : CUMP, FEFO/rappel, crédit client, commandes fournisseurs, campagnes d'inventaire, sessions de caisse, TVA/factures, IMEI/promos/seuils par dépôt/ABC) sont **toutes livrées** — voir `05_AUDIT_EXPERT_STOCK.md` § D.
