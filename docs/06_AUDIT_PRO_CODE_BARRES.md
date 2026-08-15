# 06 — Audit « usage professionnel » & plan du système code-barres

> Rédigé le 03/08/2026, après livraison des phases E1→E8 (`05_AUDIT_EXPERT_STOCK.md`).
> Regard : **expert retail / supply chain, terrain camerounais** (supérettes,
> demi-grossistes, pharmacies, boutiques téléphonie). Chaque constat est
> vérifié contre le code livré (preuves `fichier:ligne`).
> Question posée : _« que manque-t-il pour un usage complet et professionnel,
> et comment doter StockMan d'un vrai système d'identification par codes-barres
> (génération + enregistrement) sans rien casser ? »_

---

## A. Réponse directe : où en est le projet ?

Après les phases E1→E8, le socle « gestion » est **au niveau professionnel** :
coûts réels (CUMP), lots FEFO bout-en-bout, clients/crédit/dettes, achats avec
reliquats, inventaires à double validation, sessions de caisse verrouillées,
facturation TVA légale avec avoirs, exports comptables SYSCOHADA, IMEI,
promotions, seuils par dépôt, KPIs ABC/rotation/dormant. **245 tests
automatisés** (181 API + 64 web) passent ; la couverture fonctionnelle dépasse
les outils couramment utilisés sur le marché.

**Le dernier maillon faible est l'identification physique des produits** — les
codes-barres. C'est précisément ce qui relie l'écran à la réalité du magasin :
doucher/photographier au lieu de taper. Ce document audite ce domaine et livre
un plan d'implémentation complet, additivement conçu pour ne **jamais** casser
l'existant (colonnes, endpoints et les 245 tests restent intacts).

| Domaine                           | Niveau | Commentaire court                                   |
| --------------------------------- | :----: | --------------------------------------------------- |
| Ventes / caisse / hors-ligne      |   ✅   | POS PWA, idempotent, scan OK, sessions de caisse    |
| Stock, lots, coûts, inventaires   |   ✅   | E1/E2/E5 livrés                                     |
| Crédit client, achats, fiscalité  |   ✅   | E3/E4/E7 livrés                                     |
| Pilotage (KPIs, exports, alertes) |   ✅   | E8 livré                                            |
| **Identification code-barres**    |   🟠   | **ce document** — génération et multi-codes absents |
| **Étiquetage**                    |   🟠   | étiquettes unitaires OK ; pas de flux pro (B8)      |
| Équipements point de vente        |   🟡   | douchette/caméra OK ; imprimantes ZPL pas encore    |
| Confort interopérabilité          |   🔵   | DGI normalisée, multi-langue : hors périmètre ici   |

---

## B. Ce qui existe déjà (preuves — à ne surtout pas reconstruire)

| Capacité                                                              | Preuve                                                                                                             | Limite actuelle                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Code-barres produit, unique par tenant                                | `database/migrations/V002:47,59-60` (`barcode VARCHAR(100)` + `uq_products_barcode` partiel)                       | un seul code ; format libre                   |
| Code-barres variante                                                  | `V002:70` (`product_variants.barcode`)                                                                             | **sans contrainte d'unicité** (voir C2)       |
| Recherche exacte par code (POS)                                       | `apps/api/src/routes/products.ts:106-136` (`GET /barcode/:code`, produit **puis** variante, 404 `BARCODE_UNKNOWN`) | pas d'alias, pas de conditionnement           |
| Scan caméra multi-symbologies                                         | `apps/web/src/components/CameraScanner.tsx:60` (`ean_13, ean_8, code_39, code_128, upc_a, qr_code`)                | caisse uniquement                             |
| Scan douchette USB (touche Entrée)                                    | `apps/web/src/pages/vendor/PosPage.tsx` — `addByBarcode()`                                                         | caisse uniquement                             |
| Encodage graphique Code 39 + EAN-13 (zéro dépendance)                 | `apps/web/src/lib/barcode.ts:64-221` (`code39Bars`, `ean13Bits/Bars`, `ean13Checksum`, `isValidEan13`)             | côté rendu seulement                          |
| Étiquettes A4 (nom + code + prix, grille 6→96, auto EAN-13 si valide) | `apps/web/src/pages/admin/ProductDetailPage.tsx:320-334,1014-1107`                                                 | par produit, jamais en masse                  |
| Caisse hors-ligne : correspondance code locale                        | `PosPage.tsx` (`addByBarcode` sur bootstrap)                                                                       | le bootstrap ne connaît que le code principal |
| Import CSV : colonne code-barres + anti-doublon                       | `apps/api/src/routes/products.ts:225-365` + 409 `BARCODE_TAKEN`                                                    | pas de validation de chiffre de contrôle      |
| Saisie IMEI à la caisse (suggestions + hors-ligne)                    | `PosPage.tsx` — modale `SerialPickerModal` (v2.1)                                                                  | saisie manuelle, pas de scan                  |
| Réception avec numéros de série (API)                                 | `apps/api/src/services/receiptService.ts:125-145`                                                                  | **UI absente** (voir C7)                      |

Ces fondations sont saines : encodeurs purs **déjà testés** (12 tests
`tests/barcode.test.ts`), endpoint de lookup existant, gestion des conflits
409, caméra native progressive. Le plan part de là.

---

## C. Les manquements précis (chiffrés, avec impact métier)

Échelle : 🔴 bloque un usage pro sérieux · 🟠 fortement attendu · 🟡 maturité.

### C1 🔴 Aucune génération de codes-barres internes

Un produit arrive sans code EAN fournisseur (marché Sandaga, production
locale, vrac reconditionné) : aujourd'hui il faut **inventer un code à la
main** dans la fiche (`ProductFormPage.tsx:262`, simple champ texte), sans
normalisation, sans garantie de non-collision avec un autre produit, sans
respector la convention GS1 « usage interne » (préfixes **200–299** réservés
aux codes magasin). Résultat terrain : codes saisis au hasard
(`123`, `abc`, doublons entre magasins d'un même tenant), étiquettes
impossibles à fiabiliser, conflits découverts tard (409 à l'enregistrement).

**Exigence** : bouton « Générer » produisant un **EAN-13 interne valide**
(préfixe `20`–`29` configurable par tenant, séquence atomique en base, chiffre
de contrôle calculé), attribué immédiatement, avec re-tirage anti-collision ;
option « Code 39 interne » pour compatibilité vieilles douchettes.

### C2 🔴 Unicité incomplète : les codes **variantes** ne sont **pas** uniques

`V002:65-79` : `product_variants` a `uq_variants_sku (product_id, sku)`… mais
**aucune contrainte sur `barcode`**. Deux variantes — y compris de produits
différents — peuvent porter le même code. Le lookup `products.ts:120-124`
retourne alors la **première trouvée** (`LIMIT 1`) : **le scan vend un article
pour un autre** — erreur d'inventaire, de prix et de fidélité, silencieuse.
C'est un défaut de niveau correctif immédiat (contrainte + backfill contrôlé).

### C3 🔴 Un seul code par cible : pas d'alias fournisseurs ni historique

Le même produit est livré par plusieurs fournisseurs avec des EAN différents ;
les emballages changent (ancien/nouveau code). Aujourd'hui : changer
`products.barcode` = perdre l'ancien code (les étiquettes déjà collées deviennent
mortes) ou créer un doublon de produit (stock éclaté, rapports faussés).
**Exigence** : table d'alias `product_barcodes` (N codes → 1 produit/variante),
code « principal » pointé sur la colonne legacy, supersession sans perte.

### C4 🟠 Pas de code par conditionnement (carton ≠ pièce)

`units` (`V002:17+`) n'a pas de code : le **carton de 12** a son propre EAN chez
tout grossiste ; scanné à la réception ou en gros, il doit résoudre
`produit × facteur 12`. Aujourd'hui : rien — on retape la quantité à la main,
avec erreurs de conversion en prime. Le modèle d'alias du C3 doit porter
`unit_id` et retourner le **facteur de conversion**.

### C5 🟠 Validation/normalisation quasi nulle à la saisie

Serveur : `barcode: z.string().trim().max(100)` (`products.ts:483,492`) — tout
passe, y compris `éà 12,3`. Pourtant la lib web **sait déjà** valider un EAN-13
(`ean13Checksum`, `barcode.ts:126`). Manquent : rejet/formatage des chiffres
de contrôle (EAN-13/EAN-8/UPC-A), conversion **UPC-A → EAN-13** (préfixe 0),
normalisation Code 39 (majuscules, rejet caractères hors alphabet), message de
conflit **nommant le produit détenteur** du code (aujourd'hui : 409 générique).

### C6 🟠 Le scan est cantonné à la caisse

Aucun champ de scan dans Réceptions, Transferts, Inventaires/campagnes,
Devis (`grep` négatif sur ces écrans) — alors que `CameraScanner` est
**déjà** un composant autonome. Conséquence : la saisie retourne au clavier
exactement là où le volume est le plus élevé (entrées de stock, comptages).
**Exigence** : composant `ScanField` mutualisé (douchette + caméra) posé sur
tous les écrans de flux physique, adossé à un **résolveur serveur unique**.

### C7 🔴 Pluriel manquant : réceptionner un produit sérialisé est impossible via l'UI

`receiptService.ts:139-142` **exige** les numéros de série à la réception d'un
produit sérialisé (autant de numéros que d'articles) — mais `ReceiptsPage.tsx`
n'a **aucun champ IMEI** : la réception échoue systématiquement côté écran
(seule l'API directe fonctionne). Reste de E8 côté back-office (le côté caisse
a été corrigé en v2.1). Le fix rejoint naturellement C6 : scan IMEI
(Code 128) à la réception + champ multi-numéros.

### C8 🟠 Étiquettes : pas de flux de production

- Impression **par fiche produit** uniquement — jamais « j'imprime les
  étiquettes de ce que je viens de recevoir » (cas d'usage n°1 : à chaque
  livraison) ni sélection multiple depuis la liste produits.
- Gabarit unique A4 6→96 ; pas de petits formats (50×30 / 38×25 mm) ni marges
  configurables ; pas de nom de dépôt/enseigne sur l'étiquette.
- Pas d'export **ZPL/TSPL** : les imprimantes thermiques d'étiquettes
  (Zebra GK420/TSC TE244 — standard du retail) restent inutilisables.

### C9 🟡 Codes à pesée (prix/poids embarqués) non décodés

Préfixes GS1 **20–29** avec prix ou poids embarqué (balances de boucherie,
poissonnerie, légumerie) : la caméra lit l'EAN-13, mais l'application ne
décode pas la partie variable. À la caisse, un tel code devrait résoudre
« produit + quantité/prix » automatiquement.

---

## D. Plan d'implémentation — phases C1 → C5

Même standard DoD que les plans 02/05 : migration `V###` nommée, routes +
suites Vitest/pg-mem dédiées, écrans React FR, OpenAPI + matrice + runbook à
jour, **les 245 tests existants doivent rester verts sans modification**,
zéro régression de schéma (colonnes legacy conservées).

### Phase C1 — Socle : registre multi-codes + unicité variantes 🔴 _(fondatrice)_

|                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Schéma**                | `V011__codes_barres.sql` : ① `product_barcodes(id, tenant_id, product_id, variant_id?, unit_id?, code, symbology, source GENERATED/REGISTERED/IMPORTED/SUPPLIER, is_primary, created_by, created_at)` — `UNIQUE(tenant_id, code)` + index `(product_id)` ; ② `UNIQUE` cross-cible pour `product_variants.barcode` (join products → tenant) après **backfill de dédoublonnage** scripté (conflits listés, suffixe `-DUP2` journalisé en audit) ; ③ vue/résolution : priorité **produit > variante > alias > conditionnement** |
| **API**                   | `GET /api/products/lookup/:code` (résolveur unique produit/variante/alias/unité, renvoie `{product, variantId, unitId, unitFactor, unitSymbol}`) — l'ancien `GET /barcode/:code` **délégué** au résolveur (compat ascendante garantie par les tests existants) · `GET /api/products/:id/barcodes` · `DELETE /api/barcodes/:id` (ADMIN, jamais le code principal)                                                                                                                                                             |
| **Sync legacy**           | règle d'écriture unique : tout code marqué `is_primary` alimente `products.barcode` / `product_variants.barcode` (write-through) → aucun écran ni test existant ne change de comportement                                                                                                                                                                                                                                                                                                                                    |
| **Tests**                 | suite `tests/barcodes.test.ts` : enregistrement alias, doublon 409 **nommant le détenteur**, priorité de résolution, lookup unité → facteur 12, suppression alias (pas le principal), unicité variante désormais bloquante, migration rejouée sur doublons injectés (backfill déterministe)                                                                                                                                                                                                                                  |
| **Critère d'acceptation** | un même code scanné ne peut plus jamais désigner deux articles ; les 245 tests existants passent sans modification                                                                                                                                                                                                                                                                                                                                                                                                           |

### Phase C2 — Génération & validation 🔴

|                           |                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Schéma**                | `barcode_sequences(tenant_id, prefix CHAR(2), next_value BIGINT)` — sélection `FOR UPDATE` (pattern déjà éprouvé pour `invoice_sequences`), tenant-config `barcode_internal_prefix` (défaut `20`)                                                                                                                                                                           |
| **API**                   | `POST /api/products/barcodes/generate {productId, variantId?, unitId?}` → code EAN-13 interne `2P…` + chiffre de contrôle, **re-tirage sur collision**, source `GENERATED` ; validation centralisée `detectAndValidateBarcode()` : EAN-13/EAN-8/UPC-A avec checksum, Code 39 normalisé, Code 128, UPC-A → EAN-13 ; messages FR précis (« chiffre de contrôle attendu : 7 ») |
| **UI**                    | bouton « 🎲 Générer » dans fiche produit (et grille variantes, ligne unité) + badge de symbologie détectée en saisie + erreur de conflit avec **lien vers le produit détenteur**                                                                                                                                                                                            |
| **Import CSV**            | codes invalides relatés ligne à ligne (ne bloquent plus l'upsert si colonne dédiée absente) ; normalisation appliquée ; rapport enrichi                                                                                                                                                                                                                                     |
| **Tests**                 | génération : 2 appels concurrents ≠ même code ; séquence croissante ; checksum toujours valide ; collision injectée → re-tirage ; validation : EAN-13 bon/mauvais chiffre, UPC-A→EAN-13, Code 39 normalisé (`abc-12` → `ABC-12`), refus caractères hors alphabet avec message ; préfixe tenant personnalisé                                                                 |
| **Critère d'acceptation** | « Générer » produit un code **imprimable EAN-13 valide** en un clic, jamais en conflit ; l'import refuse explicitement les codes invalides                                                                                                                                                                                                                                  |

### Phase C3 — Scan universel (flux physiques) 🟠

|                                   |                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web**                           | composant `ScanField` (input douchette Entrée + bouton caméra réutilisant `CameraScanner`) posé sur : Réceptions (ajout de ligne), Transferts (création + réception), Campagnes (saisie des comptages), Retours fournisseur, Devis, recherche Produits admin                                                          |
| **API**                           | tous ces écrans passent par `GET /lookup/:code` (C1) : alias et conditionnements (facteur auto-rempli) résolus partout                                                                                                                                                                                                |
| **Caisse**                        | bootstrap POS étendu : liste `barcodes` alias (plafond 5 000, sinon lookup en ligne à la volée — règle documentée) ; `addByBarcode` tente la résolution multi-codes                                                                                                                                                   |
| **Réception sérialisée (fix C7)** | grille IMEI dans la modale Réception pour produits sérialisés (scan Code 128 ou saisie, anti-doublon, compteur quantité = numéros attendus) — débloque la réception UI des téléphones                                                                                                                                 |
| **Tests**                         | API : lookup via alias/conditionnement depuis les 5 flux (codes existants sur `products.barcode` continuant de répondre à l'identique) ; web : `ScanField` (entrée douchette, debounce, callback), modale IMEI réception (ajout/retrait/compteur) ; non-régression : suite `sales.test.ts` + `batches.test.ts` vertes |
| **Critère d'acceptation**         | réception complète « zéro clavier » : scan carton → ligne pré-remplie ×12 ; scan IMEI ×N sur produit sérialisé ; les 245 tests historiques verts                                                                                                                                                                      |

### Phase C4 — Étiquettes professionnelles 🟠

|                           |                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Flux métier**           | « Imprimer les étiquettes de cette réception » (détail réception → quantité = qté reçue par ligne, modifiables) ; multi-sélection liste produits → file d'impression ; options : prix TTC oui/non, enseigne (nom tenant/logo), dépôt |
| **Gabarits**              | A4 grille (existant) + 50×30 mm + 38×25 mm (CSS `@page`/print dédiés) avec aperçu fidèle ; choix symbologie auto (EAN-13 si valide, Code 39 sinon, Code 128 pour IMEI)                                                               |
| **Thermique**             | export **ZPL** (`.zpl` téléchargeable — Zebra/TSC) généré par gabarit (nom/prix/code), documenté pour copie USB/réseau                                                                                                               |
| **Tests**                 | web : rendu gabarit (nb étiquettes = quantités), contenu (prix/masqué, enseigne), choix de symbologie par code ; générateur ZPL pur testé (`^XA…^XZ`, échappements, `^BY`); API : listing « lignes à étiqueter » d'une réception     |
| **Critère d'acceptation** | après réception de 3 produits ×24, **un clic** imprime 72 étiquettes conformes ; un fichier `.zpl` valide est généré                                                                                                                 |

### Phase C5 — Codes à pesée & lecteurs GS1 (maturité) 🟡

|                           |                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fonction**              | décodage GS1 préfixes 20–29 à la caisse : EAN-13 `2 PPPPP [PPPPP                                                                                         | PPCCC] K`→ produit + **prix ou poids embarqué** (config tenant`barcode_weighted_mode = PRICE | WEIGHT | OFF`) ; quantité/prix auto-rempli, verrouillés sur la ligne |
| **Compat**                | réservé aux produits marqués « article à pesée » (flag produit) — aucune collision avec les EAN classiques (préfixe 2 + flag requis)                     |
| **Tests**                 | parseur pur (prix/poids, checksum du corps, arrondis FCFA 25), POS : ligne issue d'un code à pesée, config OFF = code non reconnu, collision flag absent |
| **Critère d'acceptation** | scan d'une étiquette de balance `2600123001507` → produit + 1 500 FCFA (ou 1,500 kg) sans saisie                                                         |

---

## E. Matrice des tests à ajouter (engagement chiffré)

| Suite                                                        | Tests précis (extraits)                                                                                                                                                                                                |  Nb |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --: |
| `api/tests/barcodes.test.ts`                                 | alias CRUD · doublon 409 nommé (produit & variante & alias) · priorité produit>variante>alias>unité · facteur unité 12 · unicité variante · backfill doublons · suppression protégée du principal · lookup inconnu 404 | ~14 |
| `api/tests/barcodeGenerate.test.ts`                          | génération unique ×2 concurrents · checksum EAN-13 · préfixe tenant · re-tirage collision · séquence persistante (2 tenants indépendants)                                                                              |  ~6 |
| `api/tests/barcodeValidate.test.ts` _(ou dossier ci-dessus)_ | EAN-13/8/UPC-A checksums · UPC→EAN13 · Code39 normalisation · refus accents · import CSV code invalide relaté                                                                                                          |  ~8 |
| `api/tests/scanFlows.test.ts`                                | réception par scan (alias + carton ×12) · transfert réceptionné au scan · comptage campagne au scan · réception sérialisée UI-compatible (serials)                                                                     |  ~6 |
| `web/tests/barcode.test.ts` _(étendu)_                       | EAN-8 checksum · détection de symbologie · parseur pesée (prix/poids/arrondi) · normalisation Code 39                                                                                                                  |  ~8 |
| `web/tests/labels.test.ts`                                   | gabarits 50×30/38×25 · masquage prix · enseigne · quantités réception · générateur ZPL                                                                                                                                 |  ~6 |
| **Garde-fou non-régression**                                 | les **245 tests actuels** passent **sans retouche** ; `migrateV1.test.ts` rejoue V001→V011 ; OpenAPI étendu et testé (`openapi.test.ts`)                                                                               |  ✅ |

**Cible : ≈ 293 tests (245 + ~48 nouveaux), tous verts.**

## F. Risques & garde-fous

| Risque                                     | Probabilité | Mitigation                                                                                                    |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------- |
| Casser le lookup existant                  | faible      | endpoint legacy **conservé** (délègue au résolveur) ; tests existants inchangés + tests d'équivalence ajoutés |
| Doublons de codes déjà en base (variantes) | moyen       | backfill déterministe `-DUPn` + audit + rapport dans la migration ; contrainte posée **après** nettoyage      |
| Volumétrie bootstrap caisse (alias)        | moyenne     | plafond 5 000 alias + lookup en ligne à la volée ; mesure payload testée                                      |
| Concurrence génération (2 postes)          | faible      | séquence `FOR UPDATE` en transaction (pattern `invoice_sequences` éprouvé) + re-tirage                        |
| pg-mem vs Postgres réel                    | faible      | chaîne CI rejoue sur **vraie Postgres 16** (`deploy/ci.yml`) en plus de pg-mem                                |
| Impression thermique hétérogène            | moyenne     | ZPL gabarit unique documenté + PDF/CSS en secours                                                             |

## G. Estimation & ordre (charges indicatives, jp = jour-personne)

| Phase | Objet                               |    Charge    | Valeur                                           |
| ----- | ----------------------------------- | :----------: | ------------------------------------------------ |
| C1    | registre multi-codes + unicité      |     3 j      | 🔴 fondation                                     |
| C2    | génération + validation             |     2 j      | 🔴 le demandé « génère »                         |
| C3    | scan universel + fix réception IMEI |     3 j      | 🟠 le demandé « facilite la gestion »            |
| C4    | étiquettes pro + ZPL                |     2 j      | 🟠 le demandé « impression »                     |
| C5    | codes à pesée                       |    1,5 j     | 🟡 différenciant retail                          |
|       | **Total**                           | **≈ 11,5 j** | jalons : C1+C2 = v2.2 · C3+C4 = v2.3 · C5 = v2.4 |

> ⚠️ **Action immédiate indépendante du plan** (quick win, < 1 j, dès C1) :
> poser l'unicité du code **variante** (C2) et livrer la grille IMEI de
> réception (C7) — deux défauts 🔴 corrigeables sans attendre le reste.

---

## H. État de livraison (15/08/2026) — ✅ PLAN INTÉGRALEMENT LIVRÉ

| Phase  | Livrable effectivement implémenté                                                                                                                                                                                                                                                                                                                                                         | Tests ajoutés  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------: |
| **C1** | Registre `product_barcodes` (V011) multi-cibles produit/variante/alias, unicité globale par tenant nommant le détenteur, résolveur unique `GET /api/products/lookup/:code` (+ endpoint legacy compat), validation GS1 (EAN-13/EAN-8/UPC-A/Code 39/Code 128), write-through fiche/variante/import CSV, dédoublonnage contrôlé `-DUP-` à la migration                                       |     18 API     |
| **C2** | Génération interne EAN-13 (`barcode_sequences` V012, préfixe magasin 20–29 configurable, re-tirage anti-collision), boutons 🎲 formulaires produit/variante, badge de symbologie en direct, erreur `BARCODE_TAKEN` + lien vers le détenteur                                                                                                                                               | 10 API + 4 web |
| **C3** | `ScanField` universel (douchette Entrée, auto-envoi 350 ms sans suffixe, caméra progressive) posé sur réceptions, transferts, campagnes, devis, achats, recherche produits ; caisse multi-codes (bootstrap alias 5 000 + `barcodesComplete`, résolveur pur `posScan`, secours en ligne) ; **fix C7** : grille IMEI de réception (chips anti-doublon, compteur n/attendu)                  | 8 API + 17 web |
| **C4** | Modale partagée `LabelsPrintModal` : détail réception (quantités reçues modifiables) + multi-sélection produits, gabarits A4 grille / 50×30 / 38×25, options prix/enseigne/dépôt, symbologie auto (EAN-13/Code 39/Code 128), export **ZPL** `.zpl`                                                                                                                                        |     6+ web     |
| **C5** | Codes à pesée GS1 20–29 : flag produit `is_weighed` (V013), préférence `barcode_weighted_mode` OFF/PRICE/WEIGHT (validée + carte Paramètres), parseur `weightedBarcode` (checksum EAN-13, anti-collision flag+préfixe), résolution caisse hors-ligne (WEIGHT = grammes→kg ; PRICE = prix÷prix catalogue, arrondi au gramme), cumul de pesées identiques ; bootstrap expose mode + drapeau | 6 API + 12 web |

**Suites vertes à la livraison : API 223/223 · web 98/98** (types stricts + build). Le
critère C5 se vérifie sur l'étiquette `2600123015004` (préfixe 26, article 00123,
valeur 01500, contrôle 4) → **1,500 kg** en mode WEIGHT, **1 500 FCFA → 0,5 kg à
3 000 F/kg** en mode PRICE. (Le code cité en exemple au § C5, `…00150 7`, portait
un chiffre de contrôle incohérent avec la valeur affichée : la référence de test
retenue est l'étiquette à checksum valide ci-dessus.)
