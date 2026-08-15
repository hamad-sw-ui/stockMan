# 05 — Audit expert en gestion de stock : manquements et plan de conformité

> **Mise à jour 03/08/2026 — ✅ PLAN INTÉGRALEMENT LIVRÉ.** Les phases E1→E8
> sont implémentées, testées (181 tests API + 64 web, suites dédiées :
> `costs`, `batches`, `customers`, `quotes`, `procurement`, `inventory`,
> `cashSessions`, `invoicing`, `serials`, `pricing`, `transfers2`,
> `stockKpis`) et documentées. Voir **§ D bis — État de livraison** en bas de
> document. Le texte ci-dessous conserve l'audit d'origine pour mémoire.

> Rédigé le 02/08/2026, à la suite de l'achèvement des 8 phases du plan initial
> (`02_PLAN_IMPLEMENTATION.md`). Regard : **expert métier en gestion de stock /
> supply chain, contexte camerounais (commerce de gros/demi-gros, pharmacies,
> agroalimentaire, téléphonie), référentiel SYSCOHADA (OHADA).**
> Chaque constat est vérifié contre le code livré (migrations V001–V003, routes
> API, écrans). Les rapports existants déjà livrés (valorisation, marge,
> péremption, prédictif, Z) sont cités pour éviter toute fausse affirmation.

---

## A. Ce qui est déjà au niveau (pour mémoire)

Un expert reconnaît des fondations sérieuses, rarement présentes dans les
solutions locales :

- **Multi-dépôts réel** avec niveaux par dépôt/variante (`stock_levels`),
  **interdiction du stock négatif** (CHECK `quantity >= 0`), **journal des
  mouvements avec stock avant/après** (`stock_movements.previous_stock/new_stock`).
- **Lots avec dates d'expiration** (`stock_batches`) et **rapport de péremption**.
- **Unités de conversion** (carton ×12…) avec `units.base_value` et `base_qty`
  calculé serveur à la vente.
- **Caisse hors-ligne** idempotente (`client_sale_id`), reçus, annulations
  (VOID) tracées, **rapports** : valorisation, marge, prédictif, Z, ventes.
- **Traçabilité d'audit** par utilisateur, ajustements avec motif (`reason`),
  alertes SMS/WhatsApp (seuil bas, expiration, rapport quotidien).

Ces bases sont bonnes. Elles sont justement ce qui rend exigeant l'expert : le
produit est proche du niveau « logiciel de gestion professionnel », et c'est là
que commencent les exigences suivantes.

---

## B. Les manquements qu'un expert exigerait de corriger

Échelle : 🔴 **bloquant** (aucun pro n'accepte) · 🟠 **fortement attendu** ·
🟡 **maturité** · 🟦 **confort**.

### B.1 🔴 Valorisation au coût réel (CUMP) et coût historique par vente

**Le manquement le plus grave doit être dit clairement.**

- `sale_items` n'a **pas de `unit_cost`** : chaque vente est enregistrée **sans
  son coût**. Le rapport de marge (`/api/reports/margin`) calcule
  `Σ total_price − Σ base_qty × purchase_price` avec le prix d'achat **actuel**
  du produit. Dès qu'un prix d'achat change (inflation, change), **toutes les
  marges historiques deviennent fausses** — et il est _impossible_ de revenir
  en arrière : **chaque jour qui passe, la donnée de coût est perdue
  définitivement**.
- La valorisation (`/api/reports/stock-valuation`) vaut `quantité ×
purchase_price courant`. Or les réceptions enregistrent déjà un coût réel
  (`stock_receipt_items.unit_cost`) : il n'est **jamais exploité**. Aucune
  méthode de valorisation reconnue (CUMP/FIFO) n'existe.
- En référentiel **SYSCOHADA**, le CUMP après chaque entrée est la pratique
  attendue ; l'inventaire valorisé figure au bilan. Un expert-comptable
  rejettera une valorisation « prix du jour ».

**Exigences** : coût figé par ligne de vente (`sale_items.unit_cost`), CUMP par
produit (+ variante) recalculé à chaque entrée (`nouveau_cump = (stock×cump +
qté×coût) / (stock+qté)`), valorisation au CUMP, écarts d'inventaire **valorisés**,
rapport COGS/marge refait sur coûts historiques.

### B.2 🔴 Traçabilité lot de bout en bout et FEFO

- Les lots sont capturés à la **réception** (`batch_id` dans
  `stock_receipt_items`)… mais **jamais aux sorties** : ni `sale_items`, ni
  `stock_movements` (OUT/SALE/EXPIRED) ne référencent de lot.
- Conséquences métier inacceptables pour tout produit daté (pharma, cosmétique,
  alimentaire) :
  - **Rappel de lot impossible** : « quel lot est parti chez quel client, quand,
    par quelle vente ? » — question vitale en cas de rappel fournisseur ;
  - **pas de FEFO** à la caisse : le vendeur peut vendre le lot qui expire en
    dernier et créer de la péremption évitable ;
  - **aucun blocage** : un article issu d'un lot **périmé** peut être vendu,
    car la caisse raisonne sur `stock_levels` sans lot.
- Le mouvement `EXPIRED` existe mais reste une saisie manuelle, sans contrôle
  de cohérence avec les lots réellement en rayon.

**Exigences** : allocation FEFO automatique à la vente (avec choix manuel
possible), `batch_id` aux lignes de vente/mouvements de sortie, blocage serveur
de la vente d'un lot périmé, rapport « traçabilité lot → ventes » (rappel),
flag produit « gestion par lot obligatoire/optionnelle ».

### B.3 🔴 Clients, ventes à crédit et « carnet de dettes »

- Il n'existe **aucune table clients**. C'est un manque rédhibitoire au
  Cameroun : le commerce de proximité et le demi-gros vivent du **crédit** et
  du carnet de dettes.
- Manquent donc : fiche client (nom, téléphone — indispensable pour la relance
  SMS), vente à crédit, **paiement partiel**, **paiement mixte** (une partie
  cash, une partie MoMo — pratique quotidienne), échéances, soldes et
  **antériorité de la dette** (30/60/90 jours), versements successifs,
  **relance SMS/WhatsApp** (les connecteurs Africa's Talking/WhatsApp sont
  déjà livrés — le socle est là, il manque le métier).
- Sans client, pas de devis/proforma non plus (B2B demi-gros : la facture
  proforma est un standard local).

**Exigences** : module clients, statut de paiement (PAYÉ/PARTIEL/CRÉDIT),
table des versements (idempotente hors-ligne : `client_payment_id`), vieillissement
des créances, relances, reçu affichant le « reste à payer », devis convertible
en vente.

### B.4 🟠 Cycle d'approvisionnement complet (commandes fournisseurs)

- `stock_receipts` est une **entrée directe** : il n'y a pas de **bon de
  commande fournisseur**. Impossible de commander 500, recevoir 300, et suivre
  les 200 restants (**backorder / reliquat**) ; impossible de tracer les écarts
  commandé/reçu, ni la **fiabilité fournisseur** (taux de service, délai
  réel vs délai annoncé).
- Le rapport prédictif est anticipatif mais n'aboutit à rien : pas d'action
  « transformer la suggestion en commande ».
- Pas de **retour fournisseur** (marchandise défectueuse renvoyée) lié au
  fournisseur et à la réception d'origine — les types de mouvement n'en
  comportent pas.

**Exigences** : `purchase_orders` (BROUILLON/ENVOYÉE/RÉCEPTION_PARTIELLE/
CLÔTURÉE/ANNULÉE), réceptions rattachées avec tolérance et motifs d'écart,
reliquats, délai fournisseur, performance OTIF, génération de commande depuis
le prédictif, flux retour fournisseur.

### B.5 🟠 Inventaire physique professionnel

- `InventoryPage` est une **saisie d'ajustement** (ADJUSTMENT/DAMAGE/EXPIRED) à
  partir d'une feuille de comptage. Un expert exige le **processus** :
  - **campagne d'inventaire** datée et verrouillée (périmètre : dépôt,
    catégories ; option « gel des mouvements » pendant le comptage) ;
  - **comptage aveugle** (le compteur ne voit pas le stock théorique) ;
  - **double validation** : celui qui compte ≠ celui qui valide (séparation des
    tâches — fraude interne = démarque n°1 au détail) ;
  - rapport d'**écarts valorisés au CUMP** (la démarque a un coût, elle doit
    être chiffrée pour SYSCOHADA : stocks → variation de stock) ;
  - **inventaire tournant** (comptage rotatif ABC : les A chaque mois, les C
    chaque trimestre).
- Le `reason` libre existe mais il faut une **liste de motifs** codifiée (casse,
  vol, erreur de livraison, usage interne…) pour piloter la démarque.

### B.6 🟠 Sessions de caisse et Z verrouillé

- Le **Z de caisse** (`/api/reports/z-report`) est un rapport **calculé à la
  volée**, pas une clôture : aucune **session de caisse** (ouverture avec fond
  de caisse, rattachement des ventes à la session, **comptage physique**
  comparé au théorique, **écart de caisse**, **clôture et verrouillage** de la
  journée).
- Sans session, l'argent comptant n'est jamais « arrêté » : pas de preuve
  d'écart, pas de responsabilité du caissier sur sa caisse.

**Exigences** : `cash_sessions` (fond d'ouverture, totaux attendus par mode de
paiement, compté, écart, heure de clôture, verrou), vente impossible sans
session ouverte (configurable), Z édité à la clôture.

### B.7 🟠 Fiscalité camerounaise (TVA et facturation)

- Aucune gestion de la **TVA (19,25 %)** : ni taux par produit, ni HT/TTC, ni
  journal de TVA collectée. Le reçu n'est pas une **facture** : numérotation
  légale **série continue et infalsifiable** par dépôt/année, mentions
  obligatoires (raison sociale, NIU/n° contribuable, RCCM) absentes.
- Pas d'**export vers la comptabilité** (SYSCOHADA) : au minimum CSV du journal
  des ventes, des créances clients, de l'inventaire valorisé.

**Exigences** : TVA paramétrable par produit (taux normal 19,25 % / exonéré),
prix affiché TTC avec ventilation HT/TVA, séquence de numérotation des factures
verrouillée, facture PDF conforme, exports comptables CSV.

### B.8 🟠 Transferts : transit et réception avec écarts

- Les transferts PENDING → RECEIVED n'admettent **ni réception partielle ni
  écart** (casse/perte en transit = qui est responsable ?), et le **stock en
  transit** n'est pas visualisable : entre le départ et l'arrivée, la
  marchandise « disparaît » du pilotage (elle n'existe plus au dépôt source,
  pas encore au dépôt cible).

**Exigences** : vue « stock en transit », réception partielle avec motifs
d'écart (DAMAGE/LOSS valorisés), reliquat de transfert.

### B.9 🟡 Sérialisation (IMEI) pour l'électronique/téléphonie

Nombre de boutiques cibles vendent des téléphones : l'exigence est le **numéro
de série/IMEI** par article (garantie, vol, SAV), vendu = IMEI précis, pas « un
produit parmi 50 ». Les SKU de variantes ne suffisent pas.

### B.10 🟡 Prix, remises et promotions

- Un seul `selling_price` : pas d'**historique des prix** (qui a changé le prix,
  quand, ancien/nouveau), pas de **remise** ligne ou ticket (la remise négocier
  fait partie de la vente au Cameroun), pas de **grille tarifaire** (gros vs
  détail), pas de promotions datées. Toute remise aujourd'hui = vendre au « bon »
  prix à la main, sans trace.

### B.11 🟡 Pilotage par dépôt : seuils, réservation, ABC

- `min_stock_level` est **global au produit** : le seuil d'alerte doit être
  **par dépôt** (un entrepôt central et une boutique n'ont pas le même seuil).
- Pas de **stock réservé** (commande client confirmée non encore livrée → le
  stock affiché surestime le disponible à vendre).
- À confirmer/compléter sur le prédictif : **classification ABC**, **taux de
  rotation**, **couverture en jours** par article, **stock dormant**
  (produits sans sortie depuis X jours = cash immobilisé).

### B.12 🟦 Confort

Emplacements/rayonnages dans les dépôts (bin locations), unités d'achat propres
au fournisseur, étiquettes EAN-13 (le Code 39 livré est correct pour usage
interne ; l'EAN est attendu pour les produits codifiés), **export Excel/CSV
de tous les rapports**, import CSV du stock initial (l'import produits existe,
pas l'inventaire d'ouverture).

---

## C. Plan de mise au niveau « exigences d'un expert »

Phases indépendantes mais ordonnées par valeur métier et dépendances. Chacune
suit le standard DoD du projet : migration `V00x` explicitement nommée, routes

- tests Vitest/pg-mem (organisés en suite dédiée), écrans React FR, mise à jour
  OpenAPI + matrice des interfaces + doc d'exploitation, CI verte, zéro régression.

### Phase E1 — Coûts réels : CUMP et coût figé par vente 🔴 _(fondatrice — à faire en premier)_

|                           |                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Schéma**                | `V004__costing.sql` : `products.avg_cost` (CUMP), `sale_items.unit_cost` (figé à la vente), `stock_movements.unit_cost` + `cump_after` ; `stock_batches.unit_cost` |
| **Logique**               | Recalcul CUMP sur IN/RETCLIENT/TRANSFERT-entrant ; consommation au CUMP du jour sur SALE/DAMAGE/EXPIRED/TRANSFERT-sortant ; tout dans la transaction existante     |
| **Reprise**               | Script de revalorisation de l'historique (rejoue les réceptions `unit_cost` documenté, fallback `purchase_price`)                                                  |
| **Rapports**              | marge/valorisation/Z basculent sur coûts réels ; ajout COGS par période                                                                                            |
| **Tests**                 | CUMP après entrées successives, marge à coût figé après changement de prix d'achat, valorisation = Σ CUMP×qté, annulation de vente réintègre au même coût          |
| **Critère d'acceptation** | Modifier `purchase_price` aujourd'hui ne change **plus** la marge des ventes d'hier                                                                                |

> ⚠️ **Action immédiate** même en attendant la phase complète : ajouter et
> remplir `sale_items.unit_cost` dès maintenant. Chaque vente faite sans ce
> champ détruit de la donnée irrécupérable.

### Phase E2 — Lots bout-en-bout et FEFO 🔴

`batch_id` sur `sale_items`/`stock_movements` (sorties) ; allocation FEFO
automatique à la caisse (choix manuel avec motif) ; **blocage serveur** de la
vente d'un lot périmé ; produit « lot obligatoire » (pharma) vs « sans lot » ;
rapport de traçabilité lot → ventes (rappel) ; déclaration de péremption
décrémentant lot et niveau d'un seul geste cohérent. _Dépend de E1 (coût du lot)._

### Phase E3 — Clients, crédit et relances 🔴

`customers`, `sales.customer_id`, `sale_payments` (versements multiples,
méthodes mixtes, idempotence hors-ligne), statut PAYÉ/PARTIEL/CRÉDIT, échéances,
vieillissement 30/60/90, relance SMS/WhatsApp (connecteurs existants), reçu
avec « reste à payer », devis/proforma convertible. Écran clients admin +
sélection client à la caisse (fonctionne hors-ligne, cache local).

### Phase E4 — Approvisionnement par commandes 🟠

`purchase_orders` + lignes ; réceptions rattachées, réception partielle et
reliquats ; motifs d'écart ; délai fournisseur (délai prévu/réel), taux de
service (OTIF) ; bouton « commander » depuis le rapport prédictif ; flux retour
fournisseur (mouvement dédié, valorisé au coût réel du lot).

### Phase E5 — Inventaire physique professionnel 🟠

`inventory_campaigns` (BROUILLON/COMPTAGE/VALIDATION/CLÔTURÉ) + lignes de
comptage ; comptage aveugle optionnel ; qui compte ≠ qui valide ; rapport
d'écarts **valorisés CUMP** ; inventaire tournant par échéancier ABC ; motifs
codifiés d'ajustement ; gel optionnel des mouvements du périmètre.

### Phase E6 — Sessions de caisse 🟠

`cash_sessions` (fond d'ouverture, attendu par méthode, compté, écart,
clôture) ; vente rattachée à la session ; interdiction de vendre hors session
(config) ; Z émis à la clôture et journée verrouillée ; écarts visibles par le
gérant.

### Phase E7 — Fiscalité Cameroun 🟠

TVA par produit (19,25 %/exonéré), HT/TTC partout (prix catalogue = TTC),
factures à numérotation légale continue par dépôt/année (table de séquence
verrouillée, facture immuable — VOID émet un avoir), mentions obligatoires,
journal de TVA, exports CSV SYSCOHADA (ventes, créances, inventaire valorisé).

### Phase E8 — Maturité 🟡/🟦 _(au rythme des retours terrain)_

Transferts v2 (transit visible, réception partielle avec écarts) · sérialisation
IMEI · historique de prix + remises encadrées (plafond par rôle) + grilles
gros/détail + promos datées · seuils **par dépôt** + stock réservé · rapports
ABC/rotation/couverture/stock dormant · import CSV stock initial · exports
Excel · rayonnages · étiquettes EAN-13.

### Quick wins (< 1 j chacun, à glisser dès E1)

1. `sale_items.unit_cost` rempli immédiatement (cf. E1 ⚠️) ;
2. liste de motifs codifiée obligatoire sur tout ajustement ;
3. blocage serveur de la vente dépassant le stock disponible **déjà effectif**
   — ajouter en plus le refus des lots périmés (E2) ;
4. export CSV sur chaque écran de rapport ;
5. seuil d'alerte surchargeable par dépôt.

---

## D. Récapitulatif — ce qu'un expert signe avant mise en production

| Exigence d'expert                                    | Aujourd'hui                    | Phase |
| ---------------------------------------------------- | ------------------------------ | ----- |
| Marge et valeur de stock au **coût réel historique** | ❌ prix du jour                | E1    |
| Coût figé à la vente                                 | ❌ données perdues chaque jour | E1    |
| Rappel de lot / FEFO / blocage périmé                | ❌ lots non tracés en sortie   | E2    |
| Crédit client, paiement partiel/mixte, relance       | ❌ pas de clients              | E3    |
| Commande fournisseur → reliquat                      | ❌ réception directe           | E4    |
| Inventaire à double validation chiffrée              | ⚠️ ajustement manuel           | E5    |
| Caisse clôturée avec écart                           | ⚠️ Z non verrouillé            | E6    |
| Facture TVA légale, exports comptables               | ❌                             | E7    |
| Transit, IMEI, promos, seuils par dépôt, ABC         | ❌/⚠️                          | E8    |

**Verdict d'expert** : la plateforme livrée est un excellent socle
multi-tenant (traçabilité, hors-ligne, multi-dépôts, alertes) — supérieur à la
plupart des outils utilisés sur place. Mais sur la **discipline de gestion de
stock proprement dite**, trois chantiers sont non négociables avant de la
présenter comme « prête pour un usage professionnel exigeant » : **E1 (coûts
réels)**, **E2 (lots/FEFO)**, **E3 (clients/crédit)**. Le reste consolide et
différencie.

---

## D bis. État de livraison (03/08/2026) — ✅ phases E1→E8 implémentées

| Phase                            | Statut | Livrables principaux                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1 Coûts réels (CUMP)**        | ✅     | `products.avg_cost` recalculé à chaque entrée ; `sale_items.unit_cost` figé ; marge/valorisation/Z/rapports sur coûts réels ; `GET /api/reports/cogs` ; revalorisation initiale `POST /api/reports/costs-revalue`. **Critère d'acceptation vérifié par test : modifier `purchase_price` aujourd'hui ne change plus la marge des ventes d'hier.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **E2 Lots bout-en-bout / FEFO**  | ✅     | `batch_id` sur lignes de vente et sorties (unit_cost du lot) ; allocation FEFO automatique à la caisse (choix manuel avec motif) ; **blocage serveur des lots périmés** ; produit « lot obligatoire » vs « sans lot » ; transferts préservant les lots (`stock_transfer_item_batches`) ; `GET /api/reports/batch-trace` (rappel lot → ventes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **E3 Clients, crédit, relances** | ✅     | `customers` (+ plafond, canal gros/détail) ; statut PAYÉ/PARTIEL/CRÉDIT ; `sale_payments` idempotents hors-ligne ; paiement mixte ; vieillissement 30/60/90 ; relance SMS/WhatsApp `POST /api/customers/:id/remind` ; reçu « reste à payer » ; devis/proforma convertibles à prix figés (`quotes`). Écrans admin Clients & Devis + sélection client à la caisse (cache hors-ligne).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **E4 Approvisionnement**         | ✅     | `purchase_orders` (BROUILLON/ENVOYÉE/RÉCEPTION_PARTIELLE/CLÔTURÉE/ANNULÉE) ; réceptions rattachées partielles + reliquats + motifs d'écart ; retours fournisseur au coût réel du lot ; délai prévu/réel + **OTIF** (`GET /api/purchase-orders/otif`) ; « commander » depuis le prédictif. Écran Achats fournisseurs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **E5 Inventaire physique pro**   | ✅     | `inventory_campaigns` (BROUILLON/COMPTAGE/VALIDATION/CLÔTURÉ/ANNULÉ) ; comptage **aveugle** ; **qui compte ≠ qui valide** (403) ; écarts **valorisés au CUMP** appliqués atomiquement ; **inventaire tournant ABC** (`/abc-schedule`) ; motifs codifiés obligatoires ; gel optionnel du périmètre. Écran Inventaire refondu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **E6 Sessions de caisse**        | ✅     | `cash_sessions` (fond, attendu par méthode, compté, **écart**, clôture + verrou) ; vente rattachée ; config `cash_session_required` (gate caisse) ; Z émis à la clôture. Écrans admin (suivi des écarts) + vendeur (`/caisse/session`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **E7 Fiscalité Cameroun**        | ✅     | TVA par produit (19,25 % / exonéré, ventilation HT/TVA, prix TTC) ; **factures à numérotation légale continue** par série/année (`invoice_sequences` verrouillée) ; facture immuable — VOID → avoir, retour partiel → avoir partiel ; mentions NIU/RCCM (Paramètres) ; journal de TVA ; **exports CSV SYSCOHADA** (ventes, créances 411, inventaire 311). Écran Factures & avoirs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **E8 Maturité**                  | ✅     | Transferts v2 (transit visible `GET /api/stock/transit`, réception partielle avec écarts DAMAGE/LOSS valorisés, reliquat) ; **sérialisation IMEI** (`product_serials`, capture obligatoire à la caisse — suggestions + saisie hors-ligne, lookup garantie/SAV) ; **historique des prix** + remises plafonnées par rôle (403 `DISCOUNT_LIMIT_EXCEEDED`) + **grille gros/détail** (canal client + quantité seuil) + **promotions datées** (produit > globale) ; **seuils par dépôt + rayonnages** (`product_depot_settings`) + **stock réservé** ; rapports **ABC/rotation/couverture/stock dormant** (`/api/reports/stock-kpis`) ; **import CSV du stock initial** (`POST /api/stock/import` + écran Réceptions) ; exports CSV sur tous les rapports ; étiquettes **EAN-13** (Code 39 conservé). Écrans Promotions, onglets fiche produit (Séries / Prix / Paramètres dépôt). |

**Quick wins** : les 5 raccourcis annoncés en § C sont également en place
(coût figé immédiat, motifs codifiés, blocage stock + lots périmés, export CSV
sur chaque rapport, seuil surchargeable par dépôt).
