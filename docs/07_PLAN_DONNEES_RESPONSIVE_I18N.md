# 07 — Plan : Export/Import des données · Responsive · Internationalisation (FR/EN)

> Demande utilisateur (14/08/2026) : « dites-moi si la base de données est importable et exportable […]
> j'aimerais aussi que l'application soit responsive et que le contenu soit en anglais et en français.
> Faites un plan d'implémentation qui ne compromet pas les fonctionnalités déjà opérationnelles. »
>
> Méthode : chaque affirmation de l'état des lieux est vérifiée dans le code (fichier:ligne).
> Aucune phase ne démarre sans que la suite complète des tests soit verte ; chaque phase se termine
> par les mêmes portes de qualité (§ 4).

---

## 0. Résumé exécutif

| Demande                      | Verdict aujourd'hui                             | Réponse du plan                                                                                                                                                |
| ---------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BDD **exportable** ?         | ⚠️ **Partiellement**                            | Sauvegarde serveur complète (pg_dump) + 5 exports CSV ciblés, mais **aucun export intégral par tenant depuis l'interface** → phases **D1–D2**.                 |
| BDD **importable** ?         | ⚠️ **Partiellement**                            | Import CSV produits (≤ 500 l.) + import stock initial, mais **aucune restauration/snapshot in-app** → phase **D2**, compléments CSV → **D3**.                  |
| Application **responsive** ? | ⚠️ **Fondations réelles, couverture partielle** | Drawer mobile, grilles adaptatives, tableaux défilants existent ; 8 blocs `@media` pour 42 écrans, modales et listes denses non optimisées → phases **R1–R3**. |
| Contenu **FR + EN** ?        | ❌ **Inexistant**                               | 0 infrastructure i18n, ~1 261 chaînes FR en dur, API 100 % FR → phases **I1–I5** (i18next, FR langue source, EN miroir, parité testée).                        |

**Séquencement recommandé (non négociable pour la non-régression) :**

1. **Terminer d'abord le plan 06 (C3→C5)** — travail en vol sur 8 pages admin + POS, non committé.
2. **D1 → D3** (données) — additif, indépendant des pages.
3. **R1 → R3** (responsive) — retouches CSS/markup additives.
4. **I1 → I5** (i18n) **en dernier** — réécrit toutes les pages : à faire sur un code figé pour éviter tout conflit de fusion.

---

## 1. État des lieux factuel

### 1.1 Données : importable / exportable ?

**Ce qui existe déjà (exploité, testé) :**

| Fonction                           | Preuve                                                                 | Périmètre                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Export catalogue produits (CSV)    | `apps/api/src/routes/products.ts:450` (`GET /api/products/export/csv`) | nom, catégorie, code-barres, prix achat/vente, quantité totale, unité, seuil d'alerte     |
| Import produits (CSV)              | `apps/api/src/routes/products.ts:512` (`POST /api/products/import`)    | ≤ 500 lignes, upsert par code-barres sinon nom — testé (`productsImport.test.ts`)         |
| Import stock initial (CSV)         | `apps/api/src/routes/stockOps.ts:386` (`POST /api/stock/import`)       | Produit;Quantité;Coût;Lot;Expiration — crée des réceptions traçables                      |
| Exports comptables SYSCOHADA (CSV) | `apps/api/src/routes/reports.ts:1266`, `:1425`, `:1522`                | journal des ventes, créances clients, inventaire valorisé                                 |
| Helper CSV générique               | `apps/api/src/routes/reports.ts:~25`                                   | en-têtes `text/csv` + BOM, échappement `""`                                               |
| **Sauvegarde serveur complète**    | `scripts/backup.sh`                                                    | `pg_dump` format custom compressé, rétention glissante 14 j, cron documenté               |
| **Restauration serveur**           | `docs/03_EXPLOITATION.md` § 6                                          | `pg_restore --clean` + rattrapage des migrations — **tous tenants**, accès serveur requis |
| Reprise legacy V1 → V2             | `scripts/migrate-v1-to-v2.js`                                          | `--check` en lecture seule + `--apply` **en une transaction** + rapport JSON              |

**Ce qui manque (constats chiffrés) :**

| #   | Manque                                                                                                                                                                                                  | Conséquence métier                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| D-a | Aucun **export intégral par tenant** depuis l'interface (49 tables dont ~35 métier : ventes, lignes, paiements, devis, commandes, réceptions, transferts, mouvements, sessions, clients, fournisseurs…) | Le gérant ne peut ni archiver, ni clôturer un exercice, ni migrer seul ses données  |
| D-b | Aucune **restauration in-app** : le seul chemin est `pg_restore` côté serveur, qui écrase **tous les tenants**                                                                                          | Restauration impossible sans infogérance ; risque d'écrasement des autres boutiques |
| D-c | Aucun import/export CSV pour **clients** et **fournisseurs**                                                                                                                                            | Saisie manuelle obligatoire au démarrage                                            |
| D-d | Aucune UI « Sauvegarde & restauration » (SettingsPage a 5 cartes, aucune dédiée)                                                                                                                        | Fonction invisible pour l'utilisateur                                               |

**Réponse directe :** _la base est sauvegardable et restaurable au niveau serveur (documenté, test de restauration mensuel prescrit), et partiellement importable/exportable au niveau applicatif. Pour qu'elle soit pleinement importable/exportable **par l'utilisateur**, il faut les phases D1–D3 ci-dessous._

### 1.2 Responsive

**Fondations présentes (vérifiées) :**

- `apps/web/index.html` : viewport correct (`width=device-width, initial-scale=1.0, viewport-fit=cover`), manifest PWA.
- Navigation mobile : drawer avec bouton ☰ + scrim (`apps/web/src/components/Shell.tsx:389–537` ; CSS `global.css:1502+`, bascule ≤ 860 px).
- POS : passe en 1 colonne ≤ 1080 px (`global.css:1493`), panier dé-épinglé.
- Grilles utilitaires : `.grid-2/3/4` replient à 1000 px puis 640 px (`global.css:357–380`).
- Tableaux : `.table-wrap { overflow-x: auto }` (`global.css:294`).
- Modales : `max-width: 560/780 px`, `max-height: 88vh`, défilement interne (`global.css:410–435`).
- Médias print dédiés (étiquettes, masquage shell).

**Lacunes (vérifiées) :**

| #   | Lacune                                                                                                                                      | Preuve                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| R-a | Couverture limitée : **8 blocs `@media`** pour 42 écrans, aucun audit page par page                                                         | `grep -c "@media" global.css` → 8                      |
| R-b | Modales jamais plein écran sur petit mobile (padding backdrop 18 px conservé, formulaires longs → rognés)                                   | `global.css:410–435`                                   |
| R-c | Aucun pattern « tableau → cartes empilées » : sur ≤ 480 px, les tableaux à 7+ colonnes restent un défilement horizontal pénible             | —                                                      |
| R-d | Barres de filtres/toolbars denses sans politique de repli uniforme (retour à la ligne au cas par cas)                                       | pages `ReportsPage`, `SalesPage`, `PurchaseOrdersPage` |
| R-e | Cibles tactiles non uniformisées (pas de hauteur minimale `@media (pointer: coarse)`) ; risque d'auto-zoom iOS si `font-size` input < 16 px | —                                                      |
| R-f | Aucune checklist QA mobile documentée (contrairement au runbook qui documente tout le reste)                                                | `docs/03_EXPLOITATION.md`                              |

### 1.3 Internationalisation (FR/EN)

**Constat : infrastructure totalement absente.**

- Dépendances web : `react`, `react-dom`, `react-router-dom` — **aucune lib i18n** (`apps/web/package.json`).
- **~1 261 chaînes FR en dur** dans `apps/web/src/pages` + `components` (estimation par grep sur accents/chaînes JSX).
- API : messages d'erreur FR en dur (zod + `HttpError`), aucun en-tête `Accept-Language` lu (`grep accept-language apps/api/src` → 0).
- `apps/web/src/lib/format.ts:1–17` : formateurs `Intl` figés sur `fr-FR`.
- `apps/web/index.html` : `<html lang="fr">` statique.
- **Paramètre clé de non-régression** : les 68 tests web existants assertent le texte français affiché. Toute solution doit donc garder le FR **à l'identique** par défaut ; le point d'injection global existe déjà (`apps/web/tests/setup.ts`).

---

## 2. Principes directeurs (non-compromission)

1. **Additif d'abord** : aucun contrat d'API existant n'est modifié ; nouveaux endpoints, nouvelles colonnes avec défaut, nouvelles classes CSS (jamais de renommage destructeur).
2. **Gates à chaque phase** (exécutés et collés dans le compte-rendu) :
   - API : `npm run typecheck` + `npx vitest run` (référence actuelle : **209/209**, travaux C3 en vol exclus).
   - Web : `npx tsc --noEmit` + `npx vitest run` + `npm run build` (référence actuelle : **68/68**).
   - `npm run format` (prettier) à la racine avant chaque commit.
3. **Un commit par phase**, messages en français, poussé sur la branche de session, PR #1 mise à jour.
4. **FR = langue source exacte** : les chaînes françaises existantes sont _déménagées telles quelles_ dans les ressources ; les 68 tests web doivent passer **sans la moindre retouche** (initialisation i18n dans `tests/setup.ts`).
5. **Zéro nouvelle dépendance lourde** : export/import en JSON natif (pas de lib ZIP) ; CSS maison conservé (pas de framework UI) ; seule exception justifiée : i18next/react-i18next (§ I1).
6. **Séquencement** : C3→C5 d'abord, puis D, puis R, puis I (i18n en dernier car il touche les 42 écrans).

---

## 3. Plan détaillé par phases

### Track D — Données : export intégral, restauration, CSV complémentaires

#### Phase D1 — Export intégral du tenant (snapshot JSON versionné)

- **Endpoint** : `GET /api/tenant/export` — rôle `ADMIN` uniquement, journalisé (`audit_logs`, action `DATA_EXPORT`).
- **Format** : un fichier `stockman-export-<boutique>-<AAAAMMJJ-HHMM>.json`, UTF-8, structuré :
  ```json
  {
    "format": "stockman-export",
    "version": 1,
    "exportedAt": "…ISO…",
    "appVersion": "2.0.0",
    "tenant": { "name": "…" },
    "counts": { "products": 123, "sales": 456, "…": "…" },
    "data": { "depots": [ … ], "categories": [ … ], "products": [ … ] }
  }
  ```
- **Tables exportées** (Annexe A, ordre FK parents → enfants) : toutes les tables métier du tenant, **y compris** `product_barcodes` et `barcode_sequences` (plan 06). `tenant_id` exporté puis ignoré à l'import (toujours forcé au tenant courant).
- **Exclusions de sécurité** : `users.password_hash` **jamais exporté** (les comptes eux-mêmes restent hors champ v1 — voir D2), `refresh_tokens`, `plans`, `licenses`, `system_configs`, `audit_logs` (journal immuable).
- **Limite** : 5 000 lignes par liste dans le bootstrap POS existe déjà ; ici pas de pagination (snapshot), mais garde-fou : refus au-delà de ~100 000 lignes cumulées avec message explicite (cas réel : quelques Mo).
- **UI** : `SettingsPage` — nouvelle carte « Sauvegarde & restauration » avec bouton « ⬇ Exporter toutes mes données » + rappel de la procédure serveur (pg_dump).

#### Phase D2 — Restauration in-app (import du snapshot)

- **Endpoint** : `POST /api/tenant/import?mode=preview|replace` — `ADMIN`, corps JSON (≤ 25 Mo), journalisé (`DATA_IMPORT`).
- **`mode=preview` (défaut, rien n'est écrit)** : validation stricte du manifeste (zod : `format`/`version` connus), contrôle de cohérence par section, rapport : compteurs par table, avertissements (références utilisateurs inconnues → rabattues sur l'admin important), verdict « importable oui/non ». Même philosophie que `migrate-v1-to-v2.js --check`.
- **`mode=replace`** : purge ciblée des tables métier **du tenant courant uniquement** (ordre FK inverse), insertion dans l'ordre FK, **le tout dans UNE transaction** (tout ou rien) ; `audit_logs` conservés (immuables) ; séquences (`invoice_sequences`, `barcode_sequences`) restaurées pour continuer la numérotation.
- **Rabattement des utilisateurs** : toute clé étrangère `*_by`/`user_id` inconnue est remplacée par l'identifiant de l'admin qui lance l'import (v1 : comptes non migrés — sécurité mots de passe ; documenté).
- **Verrous** : version inconnue → `400 IMPORT_VERSION` ; ligne corrompue → rollback complet + message localisé ; double-clic → verrou optimiste par tenant (comparaison du `exportedAt` + statut en cours en mémoire).

#### Phase D3 — CSV complémentaires + UI finale

- **Clients** et **fournisseurs** : `GET …/export/csv` + `POST …/import` en miroir exact du pattern produits (≤ 500 lignes, en-têtes tolérants aux accents, upsert par téléphone/nom, rapport de lignes refusées avec motif).
- **Export ventes CSV** (période `from/to`) sur `SalesPage` (en-têtes FR ; utile comptabilité, complète SYSCOHADA).
- **UI** : boutons Import/Export sur `CustomersPage` et `SuppliersPage` (même ergonomie que `ProductsPage` : modale de résultat avec compteurs et motifs), carte Settings finalisée (export D1 + dropzone import D2 avec rapport preview → confirmation explicite par saisie du nom de la boutique).
- **Documentation** : `docs/03_EXPLOITATION.md` § 6 enrichi (triple niveau : serveur pg_dump / snapshot tenant in-app / CSV ciblés) + `docs/04_API.md` (endpoints) + OpenAPI.

### Track R — Responsive

#### Phase R1 — Fondations & composants transverses

- Unifier les breakpoints en en-tête commenté (`360 / 640 / 860 / 1000 / 1080`) — valeurs existantes conservées pour ne rien casser.
- **Modales plein écran ≤ 640 px** : `.modal-backdrop { padding: 0 }`, `.modal { max-width: 100%; min-height: 100dvh; border-radius: 0 }` ; opt-out `.modal-keep` pour les confirmations courtes.
- Topbar et barres de filtres : `flex-wrap: wrap` + espacement réduit ≤ 640 px ; classe utilitaire `.filters-row` réutilisable.
- **Cibles tactiles** : `@media (pointer: coarse)` → `.btn`, `.chip`, lignes de menu ≥ 40 px ; inputs `font-size ≥ 16 px` ≤ 640 px (anti auto-zoom iOS).
- États vides et bannières hors-ligne : repli propre sur 360 px.

#### Phase R2 — Pages denses (listes → cartes empilées)

- Pattern additif `.table-cards` : à ≤ 760 px, `thead` masqué, chaque `<td data-label="…">` devient une ligne « libellé : valeur » via `td::before { content: attr(data-label) }`. **Additif** : ajout d'attributs `data-label` et d'une classe — aucune logique métier modifiée.
- Application aux 6 listes les plus consultées sur mobile : Ventes, Produits, Clients, Fournisseurs, Commandes d'achat, Réceptions.
- POS ≤ 480 px : panier en panneau bas repliable (classe dédiée), barre d'outils compacte — la logique existante (grille produits, scan) est conservée à l'identique.
- Formulaires : audit `ProductFormPage`, devis, commandes → 1 colonne ≤ 640 px partout.

#### Phase R3 — QA mobile & durcissement

- **Grille d'audit des 42 écrans × {360, 768, 1280 px}** intégrée à `docs/03_EXPLOITATION.md` (état à cocher : navigation, lecture, action principale atteignable, aucun débordement horizontal).
- Vérification des impressions (étiquettes, rapports) non affectées par les retouches `@media print` existantes.
- Correctifs résiduels constatés pendant l'audit.

### Track I — Internationalisation FR/EN

#### Phase I1 — Infrastructure i18n (sans toucher aux libellés métier)

- Dépendances : `i18next` + `react-i18next` (standards, ~45 ko gzip, ressources **bundlées en local** → fonctionne hors-ligne au POS, aucune requête réseau). Alternative écartée : provider maison (réinventer pluriels/interpolation = dette).
- `apps/web/src/i18n/index.ts` : initialisation ; ressources `locales/fr.json` (source) et `locales/en.json` ; `fallbackLng: "fr"`.
- **Résolution de la langue** : `localStorage("stockman.lang")` → `navigator.language` → `fr`. `<html lang>` synchronisé par effet.
- `lib/format.ts` : formateurs `Intl` recréés sur changement de langue (mémoïsés) — FCFA conservé, `fr-FR` ⇄ `en-US`.
- **UI** : sélecteur « Langue / Language » dans la topbar (menu utilisateur) + carte Settings + page de connexion.
- **Tests** : initialisation FR dans `apps/web/tests/setup.ts` → les 68 tests existants passent **sans modification** ; nouveaux tests : bascule FR→EN d'un composant, `lang` du document, format monétaire EN.
- Convention de clés : chemins stables `shell.nav.dashboard`, `pages.products.title`, `errors.BARCODE_TAKEN`… — **jamais la phrase elle-même** ; phrases complètes (pas de concaténation) + interpolation `{{var}}`.

#### Phase I2 — Socle transverse (~15 % des chaînes)

Shell/navigation, composants `ui.tsx`/`Barcode`/`CameraScanner`/`ScanField`/`CashSessionGate`, pages d'authentification (connexion, inscription, mots de passe), toasts et erreurs communes, libellés de dates/tableaux vides.

#### Phase I3 — Lot admin « Catalogue & Stock »

ProductsPage, ProductDetailPage, ProductFormPage, CategoriesPage, UnitsPage, DepotsPage, ReceiptsPage, MovementsPage, StockPage (vendeur), InventoryPage — extraction 1:1 des chaînes FR vers `fr.json` + création miroir `en.json` au fil de l'eau.

#### Phase I4 — Lot admin « Ventes, Achats & Pilotage » + console SA

SalesPage, SaleDetailPage, QuotesPage, InvoicesPage, CustomersPage, SuppliersPage, PurchaseOrdersPage, CashSessionsPage, PromotionsPage, VendorsPage, ReportsPage, DashboardPage, NotificationsPage, AuditPage, SettingsPage, SubscriptionPage + 7 écrans `/sa`.

#### Phase I5 — POS/caisse + erreurs API + verrouillage qualité

- POS vendeur (PosPage, PaymentsPage, CashSessionPage, SyncQueuePage, ZReportPage) — vocabulaire court, gros caractères en priorité.
- **Messages API** : le front mappe `ApiError.code` → `t("errors.<CODE>")` avec **repli sur le message serveur** (les ~codes déjà stables : `BARCODE_TAKEN`, `CSV_HEADER`, `SERIAL_COUNT_MISMATCH`…) ; l'API reste FR côté serveur (pas de casse des clients existants). Lecture d'`Accept-Language` : v2, hors champ.
- **Test de parité** (vitest) : charge `fr.json` et `en.json`, compare strictement l'ensemble des clés et refuse les valeurs vides ; garde-fou « aucune chaîne FR en dur » (script grep avec liste blanche).
- **Glossaire métier** FR⇄EN dans le doc (dépôt ≠ warehouse/store, réception = goods receipt, session de caisse = shift…) + règle de contribution : toute nouvelle chaîne passe par `t()`.
- Hors champ v1 (documenté) : traduction des SMS/WhatsApp envoyés **aux clients finaux** (restent FR), écrans d'impression PDF, autres langues que FR/EN, RTL.

---

## 4. Matrice de non-régression et portes de qualité

Référence intouchable : **suite verte actuelle** (API 209/209 · Web 68/68 au point C2, + tests C3→C5 une fois livrés). Chaque phase ajoute ses propres tests et laisse l'existant intact.

| Phase | Livrable principal                                | Fichiers neufs / touchés (ordre d'idée)                 | Tests ajoutés (cible)                                                                                                                                                        | DoD                                             |
| ----- | ------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| D1    | Export JSON tenant + UI Settings                  | `routes/tenantData.ts`, SettingsPage                    | API ~6 : 403 non-admin, manifeste, sections FK complètes, **aucun `password_hash`**, compteurs exacts, audit                                                                 | Gates § 2 vertes + OpenAPI à jour               |
| D2    | Restauration preview/replace transactionnelle     | `routes/tenantData.ts`, `services/tenantImport.ts`      | API ~9 : preview sans écriture, **round-trip export→replace→compteurs identiques**, rollback sur ligne corrompue, version inconnue 400, rabattement user, séquences reprises | Idem + runbook § 6 maj                          |
| D3    | CSV clients/fournisseurs/ventes + UI              | routes customers/suppliers/sales, pages associées       | API ~6 + web ~2 : miroir des tests import produits                                                                                                                           | Idem + matrice 01 maj                           |
| R1    | Modales plein écran, breakpoints, cibles tactiles | `global.css`, Shell.tsx                                 | web ~2 (smoke modale/classe)                                                                                                                                                 | Gates vertes, aucune modif de logique           |
| R2    | `.table-cards` sur 6 listes + POS ≤ 480           | `global.css`, 6 pages listes, PosPage                   | web ~2 (attributs `data-label` présents)                                                                                                                                     | Grille d'audit R3 pré-remplie sur ces pages     |
| R3    | Audit 42×3 + correctifs                           | `docs/03_EXPLOITATION.md`, CSS                          | — (QA documentée)                                                                                                                                                            | Checklist 100 % cochée, prints intacts          |
| I1    | Infra i18next + sélecteur + tests/setup           | `src/i18n/*`, Shell, SettingsPage, LoginPage, format.ts | web ~4 : bascule FR→EN, `document.lang`, monnaie EN, repli clé manquante                                                                                                     | **68 tests existants intacts** + nouveaux verts |
| I2    | Socle transverse traduit                          | ui.tsx, composants, auth                                | existants verts                                                                                                                                                              | grep : 0 chaîne FR en dur dans le périmètre     |
| I3    | Lot catalogue/stock                               | 9 pages                                                 | existants verts                                                                                                                                                              | Parité clés FR=EN maintenue                     |
| I4    | Lot ventes/achats/pilotage + SA                   | 16 pages + 7 écrans SA                                  | existants verts                                                                                                                                                              | Idem                                            |
| I5    | POS + erreurs API + parité + glossaire            | 5 pages vendor, `lib/http.ts` mapping, test parité      | web ~5 : parité stricte, mapping codes → traduction, repli message serveur                                                                                                   | 100 % FR+EN, règle `t()` documentée dans README |

**Cible finale indicative : ~310 tests automatisés** (245 → 277 après C1–C2 → ~290 après C3–C5 → +~30 ci-dessus), toutes portes vertes à chaque commit de phase.

---

## 5. Risques & mitigations

| Risque                                                                 | Impact | Mitigation                                                                                              |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| Conflits avec C3→C5 en vol (8 pages admin + POS modifiées)             | Élevé  | **Ordre imposé** : D/R/I ne démarrent qu'après commit de C3→C5 ; i18n strictement en dernier            |
| Snapshot d'import malveillant ou corrompu                              | Élevé  | zod strict, ≤ 25 Mo, admin only, audit log, preview obligatoire avant replace, transaction tout-ou-rien |
| Fuite de secrets à l'export                                            | Élevé  | liste d'exclusions explicite + test « `password_hash` absent » (D1)                                     |
| Régression visuelle suite aux retouches CSS                            | Moyen  | retouches **additives** (nouvelles classes), prints relus, grille d'audit 42×3 avant/après              |
| Traductions métier approximatives (dépôt, réception, CUMP…)            | Moyen  | glossaire FR⇄EN validé (I5) ; FR reste la langue source et le repli systématique                        |
| Chaînes concaténées non traduisibles découvertes en cours d'extraction | Faible | réécriture en phrase complète avec interpolation (correction localisée, testée)                         |
| Croissance du bundle (locales)                                         | Faible | FR statique (défaut), EN chargée à la demande (`import()` dynamique) ; budget +~45 ko gzip maîtrisé     |

---

## 6. Estimation indicative

| Phase | D1  | D2  | D3  | R1  | R2  | R3  | I1  | I2  | I3  | I4  | I5  | **Total**  |
| ----- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---------- |
| j·p   | 1,5 | 2   | 1,5 | 1   | 2,5 | 1   | 1,5 | 1,5 | 2   | 2,5 | 1,5 | **≈ 18,5** |

Volumétrie i18n : ~1 261 chaînes actuelles + ~150 apportées par les plans 06/07 → **≈ 1 400 clés** à terme, réparties ~15 % socle / 40 % admin / 25 % pilotage-SA / 20 % POS-erreurs.

---

## 7. État de livraison — Track D (D1–D3) ✅ _livrée_

Vérifié sur l'implémentation effective (tests verts au commit de phase) :

| Phase  | Livré                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Preuves (tests)                                                                                                                                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | `GET /api/tenant/export` : snapshot JSON `stockman-export` **v1** — en-tête `{ format, version, exportedAt, sections }`, **43 tables** métier en ordre FK (annexe A), chaque section comptée ; `tenant_configs` **non secrètes uniquement** ; réponse `Content-Disposition: attachment` ; audit `EXPORT` ; 403 pour un vendeur.                                                                                                                                                                                                                                                                                                                                                                 | `apps/api/tests/tenantData.test.ts` (manifeste, secrets absents du fichier, 403 rôle)                                                                                                                             |
| **D2** | `POST /api/tenant/import?mode=preview\|replace` (corps ≤ 25 Mo) : validation stricte (`IMPORT_FORMAT`, `IMPORT_VERSION`, `IMPORT_TOO_LARGE` > 150 000 lignes, `IMPORT_ROW_INVALID` ligne par ligne) ; **preview** = rapport `{ tables, ignoredSections, demotedUserRefs, warnings }` sans écriture ; **replace** = purge des tables du tenant (ordre inverse + cascades) puis réinsertion chunkée (100 lignes) en **une seule transaction** (`tenant_id` forcé, références utilisateurs inconnues rabattues sur l'admin important, séquences d'identité réalignées, secrets tenant **préservés**), audit `IMPORT`.                                                                              | round-trip export→destruction→restauration : compteurs identiques **et** génération EAN-13 fonctionnelle après restauration ; ligne corrompue → 400 + base inchangée ; clé secrète existante conservée (10 tests) |
| **D3** | API : `GET /api/customers/export/csv` + `POST /api/customers/import` (upsert téléphone→nom, `price_channel` préservé si non fourni), `GET /api/suppliers/export/csv` + `POST /api/suppliers/import` (upsert nom), `GET /api/sales/export/csv?from&to` (≤ 20 000 lignes, vendeur limité à ses ventes, audit `EXPORT`) ; format maison `buildCsv` (BOM `\ufeff`, `;`, CRLF, cellules quotées). Web : composants partagés `ExportCsvButton` / `ImportCsvButton` (+ modale de compte-rendu erreurs ligne à ligne) posés sur **Clients** et **Fournisseurs** ; carte **« Sauvegarde & restauration »** dans Paramètres (export, aperçu, confirmation « RESTAURER », remplacement puis rechargement). | `apps/api/tests/partnersCsv.test.ts` (6) ; `apps/web/tests/csvTransfer.test.tsx` (3)                                                                                                                              |

**Portes passées :** API typecheck ✔ + **239/239** tests (dont openapi exhaustivité : les 7 nouvelles routes sont documentées) ; web `tsc` ✔ + **101/101** tests + build ✔. Documentation synchronisée : `03_EXPLOITATION.md` § 6bis (trois niveaux de sauvegarde), `04_API.md` § 5 (endpoints D1–D3), `01_MATRICE_INTERFACES.md` §§ 2.6/2.10/2.14/2.16.

---

## 8. État de livraison — Track R (responsive)

| Phase  | État        | Livré                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Preuves (tests)                                                                                                                                                               |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | ✅ _livrée_ | Bloc « R1 » additif dans `global.css` (aucune règle historique modifiée) : breakpoints unifiés **360 / 640 / 860 / 1000 / 1080** documentés en en-tête ; **modales plein écran ≤ 640 px** (`padding: 0`, `min-height: 100dvh`, `border-radius: 0`) avec opt-out `.modal-keep` exposé via `Modal keep` (ConfirmModal l'active d'office) ; topbar/page repliables + utilitaire `.filters-row` ; **cibles tactiles** `@media (pointer: coarse)` (boutons ≥ 40 px, liens sidebar/menu épaissis, chips) ; **inputs ≥ 16 px ≤ 640 px** (anti auto-zoom iOS) ; repli 360 px (états vides, badge hors-ligne, KPI). Toutes les règles viewport préfixées `screen` → impressions A4/thermiques/reçus intactes.                                                                                                                                                                                                                                                                | `apps/web/tests/responsive.test.tsx` (9) : classes `keep` + garde-fous statiques sur la feuille (règles présentes, `screen`-only, blocs `@media print` historiques préservés) |
| **R2** | ✅ _livrée_ | Pattern additif `.table-cards` (conteneur `.table-wrap table-cards` + `td[data-label]`) : ≤ 760 px l'`thead` disparaît, chaque ligne devient une carte « LIBELLÉ : valeur » (`td::before { content: attr(data-label) }` ; cellules sans libellé = actions, repliées à droite). Application aux **7 listes denses** (Ventes, Produits, Clients, Fournisseurs, Commandes + retours + OTIF, Réceptions + grille de saisie, Devis) — parité stricte `td`/`data-label` garantie par test (toute nouvelle cellule sans libellé fait échouer la suite). **POS ≤ 480 px** : panier en panneau bas repliable (`.pos-bar` fixe + poignée `.pos-bar-toggle` avec compteur/total, `.pos-bar-body` repliable, `aria-expanded`) — logique caisse inchangée, bureau strictement identique (poignée `display: none`). Formulaires : `.row > .field` pleine largeur ≤ 640 px ; toolbar caisse désolidarisée de l'offset topbar ; grille produits resserrée 360 px (tuiles ≥ 104 px). | `responsive.test.tsx` étendu (11 nouveaux tests : pattern CSS + couverture des 7 pages + câblage POS) ; `tsc` ✔ · **121/121** web · build ✔                                   |
| **R3** | ✅ _livrée_ | **Grille d'audit des 42 écrans × {360, 768, 1280 px}** intégrée au runbook (`docs/03_EXPLOITATION.md` § 9 — critères Navigation / Lecture / Action / 0 débordement, points d'attention par écran, consignes de recette Android/iPhone) ; audit de débordement automatisé (aucune largeur fixe > 400 px inline dans `src/`); **impressions vérifiées non affectées** : les règles R1/R2 sont confinées à `@media screen`, les blocs `@media print` (étiquettes A4 Code 39, gabarits thermiques 50×30/38×25, reçu 80 mm, page A4) sont intacts et **verrouillés par test** ; correctifs résiduels appliqués : toolbar caisse désolidarisée de la topbar repliée, tuiles produits resserrées à 360 px, grille de saisie réception en cartes-lignes, champs de formulaires empilés à 1 colonne ≤ 640 px.                                                                                                                                                                | `responsive.test.tsx` (verrous print + pattern + couverture) ; suites web **121/121** · build ✔                                                                               |

**Portes R1 :** web `tsc` ✔ + **110/110** tests + build ✔ (API inchangée).

## 9. État de livraison — Track I (i18n FR/EN)

| Phase  | État        | Livré                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Preuves (tests)                                                                                                                                                                                                                                |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I1** | ✅ _livrée_ | Socle **i18next + react-i18next** (`apps/web/src/i18n/`) : ressources **bundlées localement** (zéro requête réseau → caisse hors-ligne fonctionnelle), résolution de la langue `localStorage("stockman.lang")` → `navigator.language` → repli FR, `<html lang>` synchronisé à chaque bascule, persistance via `setLanguage()`. Dictionnaires `locales/fr.json` (langue source, valeurs **strictement identiques** aux chaînes historiques) et `locales/en.json` (miroir complet). `lib/format.ts` internationalisé : formateurs Intl **recréés au changement de langue** (fr-FR ⇄ en-US), FCFA conservé, libellés courts (`format.*`) et dates relatives via i18n. `tests/setup.ts` force le FR pour toutes les suites historiques (non-régression byte-identique). | `apps/web/tests/i18n.test.tsx` (8 tests) : **parité stricte FR=EN** des clés + aucune valeur vide, synchro `<html lang>`, bascule à chaud FR→EN→FR d'un composant monté, persistance, formats monétaire/quantité/relatif dans les deux locales |
| **I2** | ✅ _livrée_ | **Socle transverse** intégralement converti : `ui.tsx` (SearchInput, Pagination, Modal/ConfirmModal, ErrorState), `Shell.tsx` (navigation par groupes via `t()`, badge hors-ligne, cloche de notifications, bandeau licence, impersonation, rôles, **sélecteur de langue `LanguageSwitcher`** dans la topbar), `ScanField`, `CameraScanner`, `CashSessionGate`, `CsvTransfer` (compte-rendu via `<Trans>`), **4 pages publiques auth** (connexion + PIN, inscription, mot de passe oublié, réinitialisation — sélecteur de langue posé sur chacune), carte « Langue de l'interface » en page Paramètres. Aucun texte FR historique modifié : les 121 suites préexistantes passent sans retouche.                                                                    | tsc ✔ · **129/129** web (121 historiques + 8 i18n) · build ✔ · API **239/239** ✔                                                                                                                                                               |

**Portes Track I (jalon I1+I2) :** web `tsc` ✔ + **129/129** tests + build ✔ · API `typecheck` ✔ + **239/239** ✔. Restant : I3 (Catalogue & Stock), I4 (Ventes, Achats & Pilotage + console SA), I5 (POS vendeur, erreurs API, garde-fou anti-chaînes en dur, glossaire métier).

---

**Incluses** (parents → enfants ; `tenant_id` forcé à l'import) :

1. **Référentiel** : `depots`, `categories`, `units`, `tenant_configs`
2. **Catalogue** : `products`, `product_variants`, `product_barcodes`, `barcode_sequences`, `product_depot_settings`, `promotions`, `price_history`
3. **Tiers** : `suppliers`, `customers`
4. **Stock** : `stock_receipts`, `stock_receipt_items`, `stock_levels`, `stock_batches`, `product_serials`, `stock_transfers`, `stock_transfer_items`, `stock_transfer_item_batches`, `stock_movements`, `inventory_campaigns`, `inventory_campaign_products`, `inventory_count_items`
5. **Achats** : `purchase_orders`, `purchase_order_items`, `supplier_returns`, `supplier_return_items`
6. **Ventes** : `quotes`, `quote_items`, `sales`, `sale_items`, `sale_payments`, `sale_returns`, `sale_return_items`, `cash_sessions`
7. **Facturation & divers** : `invoice_sequences`, `invoices`, `invoice_items`, `notification_settings`, `notifications`

**Exclues** : `tenants`, `plans`, `licenses`, `system_configs`, `refresh_tokens`, `audit_logs` (immuables), `users` (v1 : comptes et mots de passe non migrés — références inconnues rabattues sur l'admin important).

**Purge (mode replace)** : même liste, ordre inverse, filtrée `WHERE tenant_id = $1`, dans la même transaction que l'insertion.

## Annexe B — Critères d'acceptation mesurables

- **D** : test automatisé « round-trip » vert (export → replace → compteurs par table strictement identiques) ; le fichier exporté se recharge sans erreur de version.
- **R** : checklist 42 écrans × 3 largeurs cochée dans le runbook ; aucun débordement horizontal constaté à 360 px sur les 6 listes R2 ; impressions intactes.
- **I** : test de parité FR=EN vert ; 0 chaîne FR en dur hors `locales/` et liste blanche ; bascule de langue effective à chaud sur les 42 écrans ; les 68 tests web historiques passent sans modification.
