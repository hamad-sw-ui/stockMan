# StockMan — Matrice des besoins par interface

**But :** donner la vue globale, écran par écran, des besoins (CRUD, fonctionnalités clés, règles métier, endpoints API, états UI) pour que l'implémentation couvre **intégralement** le cahier des charges (CDC inféré : SaaS multi-tenant de gestion de dépôts, 3 rôles `SUPER_ADMIN` / `ADMIN` / `VENDEUR`, marché Cameroun : FCFA, MTN MoMo, Orange Money, SMS/WhatsApp, usage mobile, connectivité intermittente).

**Légende statut :** ✅ existant et sain · 🟨 partiel/cassé · ❌ inexistant.

---

## 0. Exigences transverses (valables pour **toutes** les interfaces)

| Besoin | Détail |
|---|---|
| Authentification | Session via access token JWT (15 min) + refresh httpOnly rotatif ; redirection login si 401 ; `X-Tenant` implicite via token |
| Rôles | Menus et actions filtrés par rôle **et** par permissions côté API (jamais côté UI seul) |
| États UI obligatoires | `loading` (skeleton), `empty` (illustration locale + CTA), `error` (message + réessayer), `offline` (bandeau) — sur chaque écran |
| Retours utilisateur | Toasts de succès/erreur, confirmations pour toute action destructive, undo quand possible |
| Données | Pagination serveur (page/size, cursor pour mouvements), recherche débouncée, filtres persistés dans l'URL |
| Formats | Monnaie `Intl.NumberFormat('fr-FR') + " FCFA"`, dates `date-fns` locale `fr`, fuseau tenant `Africa/Douala` configurable |
| Accessibilité | Navigation clavier, rôles ARIA sur lignes cliquables, contrastes AA |
| Encodage | UTF-8 strict partout (corriger FRN-01), aucun asset externe non maîtrisé (corriger FRN-02) |
| Offline | File d'attente IndexedDB (ventes, ajustements) avec `client_sale_id` UUID, rejeu idempotent, indicateur de sync |
| Impression | Reçus thermiques 80 mm (POS) + étiquettes code-barres A4 (catalogue) |

---

## 1. Espace public / Onboarding

### 1.1 Inscription tenant — ❌ API partielle 🟨, UI ❌
- **Rôle :** visiteur. **Route :** `POST /api/auth/register`.
- **CRUD :** create (tenant + compte ADMIN).
- **Fonctionnalités clés :** formulaire validé (zod) : nom entreprise, nom gérant, email, mot de passe (politique de force), téléphone (indicatif +237) ; création **en une transaction** : tenant + utilisateur ADMIN + **licence TRIAL (14 j)** + **dépôt « Principal »** + **unités par défaut (Pièce, Carton×12, Kg, L)** ; email de bienvenue ; erreur métier « email déjà utilisé » (409, pas 500).
- **Règles métier :** unicité email par tenant ; au 1ᵉʳ login → assistant de configuration (logo, couleur, devise, téléphone).
- **Critères d'acceptation :** après inscription, l'utilisateur peut immédiatement créer un produit et vendre (corrige BCK-05).

### 1.2 Connexion — UI ❌, API ✅🟨
- **CRUD :** n/a. **Endpoints :** `login` ✅, `logout` 🟨 (pas de révocation serveur), `refresh` 🟨 (pas de rotation), **mot de passe oublié / réinitialisation ❌**, **changement de mot de passe ❌**.
- **Fonctionnalités clés :** verrouillage/rate-limit après N échecs ; bascule **connexion rapide par PIN** (kiosque vendeur) `POST /api/auth/pin` ; blocage si `user.is_active=false`, `tenant.is_active=false` ou licence expirée (message clair + lien support).
- **Règles métier :** refresh token rotatif + table de révocation (corrige SEC-08) ; PIN hashé (bcrypt) et jamais renvoyé par l'API (corrige SEC-10).

---

## 2. Espace ADMIN (gérant)

### 2.1 Tableau de bord — ❌ UI, API 🟨
- **Endpoint :** `GET /api/reports/dashboard` 🟨 (+ filtres `depotId`, `from`, `to` à ajouter ; corriger libellés mois anglais DAT-08).
- **Fonctionnalités clés :** CA du jour/période, nb ventes, panier moyen ; alertes stock bas (liste cliquable) ; **produits proches péremption (FEFO, 30 j)** ; graphe 7/30 j par dépôt ; top 5 produits ; top vendeurs ; état file de sync offline.
- **Règles métier :** fuseau horaire tenant pour « du jour » ; données par dépôt si filtre.

### 2.2 Catalogue & Stock (produits) — UI 🟨 (seul écran existant, à refondre), API 🟨
- **CRUD :** C ✅ · R 🟨 (pas de pagination, N+1, pas de recherche serveur) · U 🟨 (partiel : catégorie/unité/code-barres ignorés) · D 🟨 (DELETE dur non confirmé, casse l'historique → **archivage** obligatoire).
- **Fonctionnalités clés :** recherche nom/code-barres/catégorie **réelle** (corrige FRN-03) ; filtres (catégorie, dépôt, statut) ; fiche produit : prix achat/vente, marge, seuil d'alerte, **stock par dépôt** (nouveau modèle DAT-02) ; onglets Variantes / Lots (FEFO) / **Journal des mouvements du produit** ; import/export Excel/CSV ; export PDF ; impression étiquettes (service local) ; **archiver/restaurer** ; images produit (option).
- **Règles métier :** code-barres unique par tenant ; prix ≥ 0 ; suppression remplacée par `archived_at` ; unicité SKU variante ; Σ variantes = stock produit recalculé serveur (DAT-03).
- **Endpoints (cible) :** `GET /api/products?search=&categoryId=&depotId=&page=` · `GET /api/products/:id` · `POST` · `PATCH /:id` · `POST /:id/archive` · `GET /api/products/barcode/:code` (scan POS)· `POST /:id/variants` · `PATCH/DELETE /variants/:vid` · `POST /:id/batches` · `PATCH/DELETE /batches/:bid` · `POST /api/products/import` · `GET /api/products/export`.

### 2.3 Catégories — ❌ (aucune API)
- **CRUD complet :** liste (avec nb produits), créer, renommer, supprimer **bloquée si utilisée** ; ordre d'affichage.
- **Endpoints :** `GET/POST /api/categories`, `PATCH/DELETE /:id`.

### 2.4 Unités & conversions — UI ❌ (lien mort dans Stock.tsx), API 🟨
- **CRUD :** C ✅ · R ✅ · U ❌ (ajouter `PATCH`) · D ✅ (garde « utilisée » ok, à généraliser).
- **Fonctionnalités clés :** unité de base + dérivées (Carton ×12) ; **la caisse vend en unité dérivée et déduit `base_value × qté`** (corrige DAT-04) ; unicité `(tenant, name)`.
- **Règles métier :** une seule unité `is_base` par « famille » de produit ; interdire la suppression/modif de `base_value` si des ventes existent (ou historiser le facteur).

### 2.5 Dépôts — ❌ (aucune API, table seule)
- **CRUD complet** (ADMIN) : nom, adresse, téléphone, responsable (`owner_id`), actif/inactif.
- **Fonctionnalités clés :** vue stock par dépôt ; **transfert inter-dépôts** (mouvement `TRANSFER` : OUT dépôt A / IN dépôt B en une transaction, à double validation) ; affectation des vendeurs ; limite `max_depots` de la licence contrôlée à la création.
- **Endpoints :** `GET/POST /api/depots`, `PATCH /:id`, `POST /:id/deactivate`, `POST /api/stock/transfer`.

### 2.6 Fournisseurs — API 🟨 (GET/POST seuls), UI ❌
- **CRUD complet :** ajouter `PATCH /:id`, `DELETE /:id` (ou archivage si réceptions liées).
- **Fonctionnalités clés :** fiche (contacts, adresse) ; historique des réceptions/commandes du fournisseur ; association aux **lots** (`stock_batches.supplier_id`).
- **Endpoints cible :** `GET/POST /api/suppliers`, `GET /:id` (avec stats), `PATCH`, `DELETE`.

### 2.7 Entrées de stock / Réceptions fournisseurs — ❌
- **Besoin :** écran « Réception » : choisir fournisseur, produits, quantités, **n° de lot + date d'expiration**, prix d'achat ; génère mouvements `IN`, met à jour lots et `stock_levels`, et optionnellement le prix d'achat catalogue.
- **Règles métier :** transaction atomique ; réception possible sur variante ; impression du bon de réception ; le coût d'achat alimente le calcul de marge.
- **Endpoints :** `POST /api/stock/receipts`, `GET /api/stock/receipts` (+ détail).

### 2.8 Ajustements & Inventaire physique — UI 🟨, API 🟨
- **Fonctionnalités clés :** ajustement avec **motif obligatoire** (`ADJUSTMENT`, `DAMAGE`, `EXPIRED`) ciblant produit/variante **et dépôt** ; mode « inventaire » : feuille de comptage (export → saisie compté → écarts) ; chaque écart = 1 mouvement tracé + entrée `audit_logs`.
- **Règles métier :** réservé ADMIN (ou vendeur avec approbation) — corrige SEC-05 ; ne jamais écraser le stock variante avec la quantité produit (corrige BCK-05).

### 2.9 Journal des mouvements — ❌ UI, API 🟨
- **Fonctionnalités clés :** liste paginée + **filtres** (type, produit, dépôt, utilisateur, période) ; export CSV ; entrée `reference_id` cliquable (→ vente ou transfert).
- **Endpoint cible :** `GET /api/stock/movements?type=&productId=&depotId=&userId=&from=&to=&cursor=` (remplacer le LIMIT 100 dur).

### 2.10 Ventes (historique & détail) — UI ❌, API 🟨
- **CRUD :** R liste 🟨 (LIMIT 50 dur, zéro filtre) · **R détail ❌** · annulation/avoir ❌ · retour ❌.
- **Fonctionnalités clés :** filtres période/dépôt/vendeur/paiement ; détail vente (lignes, unité de vente, variante, vendeur, reçu ré-imprimable/exportable PDF) ; **annulation** = vente d'avoir liée (mouvement `RETURN`, restock via lots d'origine si pertinent), traçabilité totale ; distinction vente synchronisée offline (badge).
- **Endpoints :** `GET /api/sales?from=&to=&depotId=&vendorId=&method=&page=` · `GET /api/sales/:id` · `POST /api/sales/:id/void` · `POST /api/sales/:id/returns`.

### 2.11 Équipe / Vendeurs — UI ❌, API 🟨 (GET/POST seuls)
- **CRUD complet :** `PATCH /:id` (nom, dépôt, actif), réinitialisation mot de passe + PIN (ADMIN), désactivation (jamais de DELETE si ventes liées).
- **Fonctionnalités clés :** affectation dépôt ; remise à zéro PIN ; performance du vendeur (ventes, panier moyen) ; **jamais** de `pin_code` dans les réponses (corrige SEC-10) ; respect `max_users` licence.
- **Endpoints :** `GET/POST /api/vendors`, `PATCH /:id`, `POST /:id/reset-password`, `POST /:id/reset-pin`, `POST /:id/deactivate`.

### 2.12 Rapports — UI ❌, API 🟨
- **Fonctionnalités clés :** rapports par période/dépôt : ventes (brut, par vendeur, par produit, par paiement), **marges** (CA − coûts d'achat), stock valorisé, péremptions à venir, **prédictif corrigé** (fenêtre 30 j — BCK-02) ; exports Excel/PDF ; envoi programmé (lié à § notifications).
- **Endpoints :** `GET /api/reports/sales`, `/margin`, `/stock-valuation`, `/expiry`, `/predictive` (corrigé) — tous avec `from,to,depotId,format(csv|pdf)`.

### 2.13 Centre de notifications — ❌
- **Fonctionnalités clés :** historique des envois (table `notifications` alimentée à chaque tentative : statut SENT/FAILED + réponse provider) ; configuration destinataires (téléphone gérant par tenant !) ; canaux SMS/WhatsApp/in-app ; seuils et horaires configurables par tenant.
- **Endpoints :** `GET /api/notifications`, `GET/PUT /api/notification-settings`.
- **Prérequis :** réparer BCK-01 (table `system_configs` sans tenant ni par-tenant config).

### 2.14 Paramètres tenant — ❌
- **Fonctionnalités clés :** profil entreprise (nom, logo, couleur → **thème appliqué à toute l'UI** : white-label CDC), devise/langue, fuseau, numéro d'alerte, préférences ticket de caisse (en-tête/pied), gestion de l'**abonnement** (plan, échéance, renouvellement/paiement).
- **Endpoints :** `GET/PATCH /api/tenants/current`, `POST /api/tenants/current/logo`, `GET /api/licenses/current`.

### 2.15 Journal d'audit — ❌ (table seule, rien n'écrit)
- **Besoin :** middleware `audit()` branché sur toutes les mutations sensibles (produits, stocks, ventes/annulations, utilisateurs, configs) avec `previous_state`/`new_state` ; écran read-only filtré (entité, utilisateur, période, dépôt) ; export.
- **Endpoint :** `GET /api/audit-logs?entity=&userId=&from=&to=` — corrige DAT-06.

---

## 3. Espace VENDEUR (caisse mobile-first)

### 3.1 Caisse / POS — ❌ (l'écran **cœur de métier**, totalement absent)
- **Fonctionnalités clés :** recherche/scan code-barres (caméra + douchette USB), grille de favoris ; panier avec quantité **en unité ou dérivée** (pièce/carton → conversion auto), variante au besoin, remise ligne (droits), total en FCFA ; paiements **CASH / MTN_MOMO / ORANGE_MONEY** (référence transaction opérateur) ; **mode hors-ligne complet** : vente mise en file (`client_sale_id` UUID), rejeu automatique au retour réseau (idempotent côté serveur — corrige SEC-07) ; reçu thermique 80 mm (impression + partage WhatsApp du ticket) ; verrou caisse par **PIN** ; synchronisation du catalogue au démarrage (delta).
- **Règles métier :** prix et total **recalculés serveur** (corrige SEC-06) ; déduction FEFO automatique ; blocage stock insuffisant avec message clair ; une vente offline ne peut pas être rejouée en double.
- **Endpoints :** `GET /api/pos/bootstrap` (catalogue compact + prix + stocks du dépôt du vendeur) · `POST /api/sales` (idempotent, serveur-authoritatif) · `GET /api/sales/:id/receipt`.

### 3.2 Mes ventes — ❌
- Liste des ventes **du vendeur connecté** (jour/semaine), total espèces vs mobile, détail + ré-impression, demande d'annulation (soumise à ADMIN).
- **Endpoint :** `GET /api/sales/my?from=&to=` (filtrage forcé `vendorId=req.user.id`).

### 3.3 Consultation stock (lecture seule) — ❌
- Disponibilité d'un produit **dans son dépôt** (pas de modification possible — corrige SEC-05).

### 3.4 Clôture de journée (Z de caisse) — ❌
- Récap journalier du vendeur/dépôt (ventes, paiements, file offline restante), exportable/imprimable, transmis au gérant (notification 20 h — le TODO vide de `SchedulerService`).

---

## 4. Espace SUPER_ADMIN (console SaaS)

### 4.1 Dashboard global — ❌ UI, API ✅🟨
- `GET /api/reports/superadmin/stats` existe : compléter avec MRR/abonnements actifs, essais en cours/échéances, taux d'échec de notifications, croissance (nouveaux tenants/mois).

### 4.2 Tenants — UI ❌, API 🟨 (liste + toggle)
- **CRUD cible :** créer (onboarding manuel), détail complet (gérant, dépôts, nb utilisateurs, volume ventes), éditer, **suspendre/réactiver** (existe), réinitialiser le mot de passe du gérant, impersonation journalisée (support).
- **Endpoints :** `GET /api/tenants/:id` · `POST /api/tenants` · `PATCH /:id` · `POST /:id/impersonate`.

### 4.3 Licences & plans — ❌ (table seule)
- **Fonctionnalités clés :** plans (TRIAL/BASIC/PRO : `max_users`, `max_depots`, prix) ; attribution/renouvellement/licence expirée → **middleware `requireActiveLicense`** qui bloque l'API tenant (sauf consultation) : corrige DAT-06 ; journal des paiements (MOMO/OM ou manuel).
- **Endpoints :** `GET/POST/PATCH /api/licenses`, `GET /api/licenses/plans`, `POST /api/licenses/:id/renew`.

### 4.4 Configurations système — UI ❌, API 🟨
- **Corriger SEC-04** (masquer réellement les secrets) ; rendre les clés **par tenant** ou clairement globales (`system_configs` + table `tenant_configs`) ; tester la connectivité (bouton « Tester WhatsApp/SMS »).

### 4.5 Supervision notifications — ❌
- Vue globale des envois (tous tenants), files d'échec avec relance, santé des providers (quota, dernières erreurs).

---

## 5. Couverture API — synthèse par ressource

| Ressource | C | R (liste) | R (détail) | U | D | Endpoints spéciaux | Statut actuel |
|---|:-:|:-:|:-:|:-:|:-:|---|---|
| Auth / session | ✅ | – | ❌ (me) | ❌ (pwd) | ✅ logout | refresh-rotation ❌ · pin ❌ · forgot ❌ | 🟨 |
| Tenant | ❌ | ✅ (SA) | ❌ | ❌ | – | current/profile ❌ · impersonate ❌ | 🟨 |
| Licence / plan | ❌ | ❌ | ❌ | ❌ | – | renew ❌ · middleware licence ❌ | ❌ (table seule) |
| Utilisateur / vendeur | ✅ | ✅ | ❌ | ❌ | ❌ | reset pwd/pin ❌ · deactivate ❌ | 🟨 |
| Dépôt | ❌ | ❌ | ❌ | ❌ | ❌ | transfer ❌ · stock par dépôt ❌ | ❌ |
| Catégorie | ❌ | ❌ | – | ❌ | ❌ | – | ❌ |
| Unité | ✅ | ✅ | – | ❌ | ✅ | conversion en vente ❌ | 🟨 |
| Produit | ✅ | 🟨 (N+1, pas de pagination) | ❌ | 🟨 (partiel) | 🟨 (dur) | barcode ❌ · archive ❌ · import/export ❌ | 🟨 |
| Variante | 🟨 (créée avec produit) | 🟨 | ❌ | ❌ | ❌ | SKU unique ❌ | 🟨 |
| Lot / batch | 🟨 (créé avec produit) | 🟨 | ❌ | ❌ | ❌ | réception ❌ · fournisseur lié ❌ | 🟨 |
| Fournisseur | ✅ | ✅ | ❌ | ❌ | ❌ | historique réceptions ❌ | 🟨 |
| Réception stock | ❌ | ❌ | ❌ | – | ❌ | bon de réception ❌ | ❌ |
| Vente | 🟨 (non idempotent, total client) | 🟨 (LIMIT 50, 0 filtre) | ❌ | – | ❌ (void) | reçu ❌ · retour ❌ · offline-idempotent ❌ | 🟨 |
| Mouvement stock | 🟨 (ADJUSTMENT seul) | 🟨 (LIMIT 100, 0 filtre) | – | – | – | TRANSFER/IN/RETURN/DAMAGE ❌ | 🟨 |
| Notification | – | ❌ | – | ❌ (settings) | – | settings destinataire ❌ | ❌ (service cassé) |
| Config système | ✅ | 🟨 (fuite secrets) | – | ✅ | – | test provider ❌ | 🟨 |
| Audit log | ❌ (rien n'écrit) | ❌ | – | – | – | export ❌ | ❌ (table seule) |
| Rapports | – | 🟨 (dashboard, prédictif faux, SA) | – | – | – | marges ❌ · exports ❌ · Z caisse ❌ | 🟨 |

**Écrans existants / prévus : 1 / 25.** Cette matrice sert de checklist de couverture : le CDC ne sera considéré comme respecté que lorsque chaque ligne UI et chaque ligne API ci-dessus sera ✅ avec tests.
