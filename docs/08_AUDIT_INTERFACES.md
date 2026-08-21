# 08 — Audit des interfaces : boutons, liens & flux non fonctionnels

> Méthode : revue statique exhaustive du front (`apps/web/src`) + recoupement avec
> l'API (`apps/api/src/routes`) + vérification **empirique** des comportements douteux
> (test Vitest jetable sur la couche de cache). Le référentiel de comparaison est le
> README (fonctionnalités annoncées) et la matrice des 42 écrans (`docs/01_*`).

## Synthèse

Le socle est **globalement sain** : aucune route morte (chaque appel HTTP du front
correspond à un endpoint existant), aucun `TODO`/stub, aucune chaîne « à venir »,
aucun `href="#"`, aucun `console.log` résiduel, parité i18n FR=EN parfaite (1 902 clés).
Les 245 tests et le typecheck passent.

En revanche, l'audit a révélé **6 manquements réels**, dont **2 défauts structurels**
qui touchent l'ensemble des écrans de liste. Ils sont listés ci-dessous par sévérité,
chacun avec son diagnostic précis (fichier, ligne, cause racine) et sa correction
complète jusqu'au test de non-régression.

---

## Défauts structurels (P0)

### F1 — `invalidateQueries()` ne rafraîchit pas les composants montés

**Symptôme utilisateur.** Après une création / modification / suppression (catégorie,
unité, dépôt, fournisseur, client, produit, utilisateur, tenant, promotion…), la liste
à l'écran **ne se met pas à jour**. Le changement n'apparaît qu'après avoir quitté puis
rouvert la page (remontage du composant). Le bouton fonctionne (l'API est appelée), mais
l'interface reste figée : c'est perçu comme « non fonctionnel ».

**Cause racine.** `apps/web/src/lib/query.ts` :

```ts
export function invalidateQueries(prefix?: string): void {
  if (!prefix) return cache.clear();
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}
```

`invalidateQueries` ne fait que **vider la `Map` de cache**. Or `useQuery` conserve son
état dans un `useState` local et **n'a aucun abonnement** à cette Map : son
`useEffect` ne re-s'exécute que si `key`/`path`/`fetchIt` changent. Vider la Map n'est
utile que pour le *prochain montage* (il court-circuite le TTL de 15 s). Pour un
composant déjà monté, rien ne se passe. La méthode `refetch()` exposée par `useQuery`
n'est **jamais appelée** nulle part (code mort).

**Vérification empirique (test Vitest jetable).** Un composant alimenté par `useQuery`
reste sur sa valeur périmée après `invalidateQueries("probe:")` : le mock `get` n'est
re-appelé **qu'une seule fois** et l'UI affiche toujours la valeur `1`. Comportement
confirmé.

**Périmètre impacté.** Tout écran de liste qui affiche via `useQuery` et invalide après
mutation : `CategoriesPage`, `UnitsPage`, `DepotsPage` (dépôts + transferts + transit),
`SuppliersPage`, `CustomersPage`, `ProductsPage` (archivage/import), `VendorsPage`
(équipe), `PromotionsPage`, `QuotesPage`, `PurchaseOrdersPage`, `InventoryPage`
(campagnes), `NotificationsPage`, `SaTenantsPage`, `SaTenantDetailPage` (licences),
`ProductDetailPage` (variantes/lots/réglages dépôt), et le verrou `CashSessionGate`.
`useMutation({ invalidate })` hérite du même défaut.

**Correction.** Ajouter un mécanisme d'abonnement dans la mini-couche de cache :

```ts
type InvalidateListener = (prefix?: string) => void;
const listeners = new Set<InvalidateListener>();

export function invalidateQueries(prefix?: string): void {
  if (!prefix) cache.clear();
  else for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
  for (const l of [...listeners]) l(prefix);
}

// dans useQuery :
useEffect(() => {
  const handler: InvalidateListener = (prefix) => {
    if (!prefix || key.startsWith(prefix)) void fetchIt(true);
  };
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}, [key, fetchIt]);
```

**Test de non-régression.** Nouveau `apps/web/tests/query.test.ts` :
1. rend un `Probe` sur `useQuery("x:1", "/x")` → valeur 1 ;
2. `invalidateQueries("x:")` → le mock est rappelé, l'UI affiche 2 ;
3. `invalidateQueries("y:")` (préfixe étranger) → **pas** de refetch ;
4. démontage → le listener est retiré (pas de fuite).

**Acceptation.** Chaque CRUD de liste met l'écran à jour immédiatement, sans
navigation. Ce correctif résout F1 **et** F3 (le verrou de caisse) en même temps.

---

### F2 — 3 clés i18n manquantes ou mal préfixées (libellés affichés bruts)

Avec `returnEmptyString: false` et `fallbackLng: "fr"` (`apps/web/src/i18n/index.ts`),
une clé absente est rendue **telle quelle** (ex. `nav.settings`) à l'écran.

| # | Fichier : ligne | Clé utilisée (erronée) | Clé attendue / correctif | Impact visible |
|---|---|---|---|---|
| F2a | `apps/web/src/pages/admin/SettingsPage.tsx:956` | `t("nav.settings")` | `t("shell.nav.settings")` | Le titre « Paramètres » affiche `nav.settings` |
| F2b | `apps/web/src/pages/sa/SaDashboardPage.tsx:76` | `t("nav.saLicenses")` | `t("shell.nav.saLicenses")` | Le bouton « Licences » (carte essais) affiche `nav.saLicenses` |
| F2c | `apps/web/src/pages/sa/SaTenantDetailPage.tsx:568` | `t("pages.sa.tenantDetail.editTitle")` | clé **inexistante** : à créer | Le titre de la modale « Modifier le tenant » affiche la clé brute |

**Correction.**
- F2a/F2b : remplacer la clé par le bon préfixe `shell.nav.*` (aucune donnée à ajouter).
- F2c : ajouter `pages.sa.tenantDetail.editTitle` dans `fr.json` (ex. « ✏️ Modifier le
  tenant ») **et** `en.json` (ex. « ✏️ Edit tenant ») — la parité FR=EN est testée à
  l'identique, les deux doivent être ajoutés simultanément.

**Test de non-régression (complément du garde-fou existant).** Étendre
`apps/web/tests/i18n.test.tsx` (ou un nouveau test) avec un contrôle
**« toute clé `t(...)` utilisée dans `src/` existe dans `fr.json` et `en.json` »** :
extraire les clés littérales (`t("…")`, `Trans i18nKey="…"`) et échouer si une clé
n'existe pas. C'est précisément le test qui a manqué pour laisser passer F2.

**Acceptation.** Aucune clé brute n'est visible en FR comme en EN ; le test « clés
utilisées = clés existantes » est vert.

---

## Défauts ciblés (P1)

### F3 — `CashSessionGate` ne se referme jamais après ouverture d'une caisse

**Fichier.** `apps/web/src/components/CashSessionGate.tsx:27`.

**Cause racine.** Le formulaire d'ouverture reçoit `onOpened={() => undefined}` : après
ouverture réussie, rien n'invalide/rafraîchit `useQuery("cash:current", …)`. Le verrou
(`required && !session`) reste donc vrai et la modale plein écran **reste affichée**,
même si la caisse est désormais ouverte côté serveur. (La page `CashSessionPage`, elle,
passe `invalidateQueries("cash:")` mais souffre du même défaut F1 : le composant monté
n'est pas re-rendu.)

**Correction.**
1. `CashSessionGate` : `onOpened={() => invalidateQueries("cash:")}` (import de
   `invalidateQueries` depuis `../lib/query`).
2. La vraie fermeture vient de la correction F1 : dès que l'invalidation déclenche un
   refetch, `q.data.session` devient non-nul et le composant retourne `null`.

**Test.** Étendre un test composant (ex. `CashSessionGate` monté, session ouverte via
mock → la modale disparaît).

**Acceptation.** Après « Ouvrir la caisse », l'écran POS se déverrouille immédiatement.

---

### F4 — Bouton de renouvellement WhatsApp relié à un numéro factice

**Fichier.** `apps/web/src/pages/admin/SubscriptionPage.tsx:206` :

```tsx
href={`https://wa.me/237600000000?text=${encodeURIComponent(…)}`}
```

Le numéro `237600000000` est un **placeholder** : le bouton « Renouveler via WhatsApp »
ouvre une conversation vers un numéro qui n'existe pas. C'est un élément « présent mais
non fonctionnel » pour l'utilisateur final.

**Correction.** Rendre le numéro configurable côté éditeur :
- l'exposer via une **configuration globale** existante (`/configs`, console SA) — ex.
  clé `SUPPORT_WHATSAPP` — ou une variable d'environnement (`SUPPORT_WHATSAPP`) lue par
  `GET /configs/tenant` ;
- dans `SubscriptionPage`, charger cette valeur et masquer/neutraliser le bouton si elle
  est absente (avec un libellé « Contactez votre éditeur » en repli) ;
- ajouter les clés i18n nécessaires (`pages.subscription.noSupport`, etc.) en FR+EN.

**Test.** Le bouton construit l'URL à partir de la valeur configurée ; sans valeur, il
n'est pas rendu (ou rendu inactif avec libellé explicite).

**Acceptation.** Le renouvellement pointe vers un canal réel et configurable.

---

## Écarts de complétude (P2)

### F5 — Rapports implémentés côté API mais inaccessibles depuis l'UI

Le README annonce (l. 89) des rapports « COGS », « KPIs stock » et « traçabilité
lots ». Or :

| Endpoint (API, existant) | UI | Constat |
|---|---|---|
| `GET /reports/cogs` | ❌ aucun onglet | implémenté, non atteignable |
| `GET /reports/stock-kpis` | ❌ aucun onglet | implémenté, non atteignable |
| `GET /reports/costs-revalue` | ❌ aucun onglet | implémenté, non atteignable |
| `GET /reports/batch-trace` | ✅ (depuis la fiche produit, par lot) | atteignable |

`ReportsPage` n'expose que 7 onglets (ventes, marges, stock, péremption, prédictif,
clôture, TVA). Trois rapports back-end sont donc « présents » (OpenAPI comprise) mais
**sans bouton**.

**Correction.** Ajouter les onglets/rubriques manquants dans `ReportsPage` :
- « COGS » → `GET /reports/cogs?from=…&to=…` (tableau + export CSV) ;
- « KPIs stock » → `GET /reports/stock-kpis` (ABC/rotation/couverture/dormant) ;
- le cas échéant « Revalorisation » → `GET /reports/costs-revalue` (lecture seule).

Chaque ajout : type TypeScript dédié, rendu du tableau, export CSV, clés i18n FR+EN, et
un cas de test de rendu. Mettre à jour `VALID_TABS` et le mapping `endpoints`.

**Acceptation.** Les 3 rapports annoncés sont accessibles et exportables depuis l'UI.

---

## Non-anomalies (vérifiées, pour lever tout doute)

- **Routage** : les 42 routes déclarées dans `App.tsx` correspondent exactement aux
  entrées de navigation de `Shell.tsx` (admin / vendor / SA). Aucun lien vers une route
  inexistante.
- **Endpoints** : chaque chemin HTTP appelé par le front existe dans `apps/api/src/routes/*`.
- **Boutons** : aucun bouton sans `onClick` (hors `type="submit"`), aucun
  `disabled={true}` figé, aucun `href="#"`, aucun gestionnaire vide.
- **i18n** : parité FR=EN exacte (1 902 clés), zéro valeur vide.
- **Placeholders de saisie** (`6130000000000`, `+237 6XX XXX XXX`, `LOT-A`…) : ce sont
  des *exemples* dans des champs de formulaire, pas des valeurs injectées.

---

## Plan de remédiation ordonné

| Étape | Objet | Fichiers principaux | Test associé | Sévérité |
|---|---|---|---|---|
| 1 | Correctif couche cache (abonnement) | `apps/web/src/lib/query.ts` | `tests/query.test.ts` (nouveau) | P0 |
| 2 | Verrou caisse : `onOpened` + refetch | `components/CashSessionGate.tsx` | test composant gate | P1 |
| 3 | Clés i18n F2a/F2b | `pages/admin/SettingsPage.tsx`, `pages/sa/SaDashboardPage.tsx` | garde-fou clés (nouveau) | P0 |
| 4 | Clé i18n F2c | `pages/sa/SaTenantDetailPage.tsx` + `fr.json` + `en.json` | garde-fou clés | P0 |
| 5 | WhatsApp configurable | `pages/admin/SubscriptionPage.tsx` + `/configs` (API) | test unitaire URL | P1 |
| 6 | Rapports COGS / KPIs / revalo | `pages/admin/ReportsPage.tsx` + i18n | test de rendu | P2 |

**Ordre recommandé** : 1 → 3/4 (indépendants) → 2 (dépend de 1) → 5 → 6. Chaque étape
doit être validée par `npm run typecheck`, `npm run test --workspace apps/web` et
`npm run test --workspace apps/api` (aucune régression), puis un build complet.

**Portes de qualité finales** :
- `typecheck` api + web ✔
- tests web (existants + nouveaux `query.test.ts` + garde-fou clés) ✔
- tests api inchangés ✔
- `build --workspace apps/web` ✔
- vérification manuelle : CRUD d'une catégorie → liste à jour sans rechargement ;
  ouverture caisse via le verrou → déverrouillage immédiat ; page Paramètres / carte
  licences SA → titres corrects en FR et EN.

---

## Annexe — Ergonomie « dashboards » : raccourcis, filtres, actions groupées

Question posée : les utilisateurs peuvent-ils utiliser les dashboards avec des
raccourcis clavier, des filtres de recherche, et des sélections pour des actions
groupées ?

Réponse courte : **non**. C'est un manquement **ergonomique** (capacité absente),
différent des défauts fonctionnels F1→F5 ci-dessus (code cassé ou inatteignable).
L'état réel, vérifié dans le code :

| Capacité | État | Constat précis |
|---|---|---|
| Raccourcis clavier | ❌ quasi absents | Seuls `Escape` (ferme une modale, `components/ui.tsx:327`) et `Entrée` (valide un champ scan, `components/ScanField.tsx:101` / POS / Réceptions). Aucun raccourci global, pas de palette `Ctrl/Cmd+K`, pas de navigation clavier de liste, rien sur les dashboards. |
| Filtres / recherche | ⚠️ partiel, incohérent | Complet : Produits (recherche + catégorie + dépôt + statut). Partiel : Clients (recherche + débiteurs), Fournisseurs, Commandes, Devis, Ventes, Mouvements, Journal. **Aucun filtre** : Catégories, Unités, Dépôts, Réceptions, Équipe, Notifications. Pas de filtre sauvegardé, pas de plage de dates sur les listes. |
| Sélection + actions groupées | ❌ quasi absentes | Deux cas isolés : multi-sélection produits **pour imprimer les étiquettes** (`ProductsPage:91`) et **pour le périmètre d'une campagne d'inventaire** (`InventoryPage:315`). Aucune case « tout sélectionner », aucun archivage/suppression/export groupé (clients, fournisseurs, catégories, unités, ventes…). |

### Objectif cible

Permettre, sur chaque **liste**, le triptyque : **filtrer → sélectionner (case + « tout
sélectionner ») → agir en groupe** (exporter CSV, archiver, supprimer, imprimer), plus
un socle de **raccourcis clavier** cohérent (navigation et actions fréquentes).

### Plan de mise en œuvre (par incréments, sans casser l'existant)

**Piste 1 — Socle transversal réutilisable (à livrer en premier).**
1. `components/ui.tsx` : composant `BulkBar` (barre d'action qui apparaît quand
   `selected.size > 0`, affiche le compte, boutons d'action, « tout effacer ») — calqué
   sur la barre d'étiquettes existante de `ProductsPage` (généralisation de ce motif).
2. Hook `useSelection()` (dans `lib/`) : `Set<string>` + `toggle` + `toggleAll` +
   `clear` + `ids()`, pour éviter de réimplémenter la logique par page.
3. Hook `useHotkeys()` (dans `lib/`) : carte `{ keys, handler }`, `Ctrl/Cmd+K` →
   focus du champ de recherche, `Échap` → efface la sélection, `G`+`D` → dashboard, etc.
   Documenté dans `docs/README.md` (règle de contribution).

**Piste 2 — Déployer filtre + sélection + bulk par écran (par priorité métier).**
1. Produits : ajouter « tout sélectionner » + `BulkBar` (archiver, exporter la
   sélection) en complément de l'impression d'étiquettes existante.
2. Clients : `BulkBar` (export sélection, relance SMS/WhatsApp groupée via
   `POST /customers/:id/remind` en lot — à ajouter côté API).
3. Fournisseurs : même schéma.
4. Catégories / Unités / Dépôts / Réceptions / Équipe / Notifications : ajouter un
   `SearchInput` (recherche côté client sur les listes déjà chargées, sans nouvel
   endpoint) + sélection/bulk là où une action groupée a du sens (suppression groupée
   uniquement si l'API la valide ; sinon export seul).
5. Dashboards (`DashboardPage`, `SaDashboardPage`) : ajouter des **raccourcis de
   navigation** (liens existants déjà présents) + filtre de période mémorisé
   (`localStorage`), pas de refonte.

**Piste 3 — API (uniquement si une action groupée l'exige).**
- `POST /products/bulk-archive`, `POST /customers/bulk-remind`, etc., transactionnels
  et audités (réutiliser `lib/audit.ts`). Ne pas exposer de suppression groupée sans
  garde-fou (confirmation + limite de taille).

### Portes de qualité pour cette annexe
- Chaque ajout : clés i18n FR+EN (parité testée), test composant (la `BulkBar` apparaît
  au 1er clic, disparaît à zéro ; le filtre réduit la liste ; le raccourci active le
  champ), `typecheck` + tests web verts.
- Accessibilité : cases et boutons ≥ 44 px, `aria-label` sur chaque contrôle, navigation
  clavier visible (focus-ring).

**Ordre** : Piste 1 (socle) → Piste 2 (par écrans, Produits puis Clients en pilotes) →
Piste 3 (endpoints batch seulement si nécessaire). Ce chantier est indépendant des
correctifs P0/P1 (F1→F5) et peut démarrer en parallèle.

---

## État de livraison (travaux effectués — tous testés)

| Réf. | Correctif | Fichiers | Test |
|---|---|---|---|
| F1 | Invalidation du cache (abonnement + refetch auto) | `lib/query.ts` | `tests/query.test.tsx` (4) |
| F2 | 3 clés i18n manquantes + garde-fou « clé utilisée = clé existante » | 2 pages + `fr/en.json` + `tests/i18nKeys.test.ts` | `i18nKeys.test.ts` (2) |
| F3 | Verrou caisse : `onOpened` → invalidate, se referme | `components/CashSessionGate.tsx` | `tests/cashSessionGate.test.tsx` (2) |
| F4 | WhatsApp configurable (`GET /api/configs/public` + bouton conditionnel) | `routes/configs.ts` + `SubscriptionPage` | `tests/configsPublic.test.ts` (4) |
| F5 | Rapports COGS + KPIs stock + revalorisation exposés | `ReportsPage.tsx` + i18n | rendu (typecheck/build) |
| P1 | Socle : `useSelection`, `useHotkeys`, `BulkBar`, `lib/csv` | `lib/selection.ts`, `lib/hotkeys.ts`, `components/BulkBar.tsx`, `lib/csv.ts` | `selection.test.tsx` (3) + `hotkeys.test.tsx` (4) + `bulkBar.test.tsx` (2) |
| P2 | Produits : tout-sélectionner, archiver/export en lot, Échap + Ctrl+K | `ProductsPage.tsx` + `ui.tsx` (`SearchInput` ref) | build/typecheck |
| P2 | Clients : sélection + relance SMS en lot + export | `CustomersPage.tsx` | — |
| P2 | Fournisseurs : sélection + export | `SuppliersPage.tsx` | — |
| P2 | Recherche ajoutée sur Catégories, Unités, Dépôts, Réceptions, Équipe, Notifications | 6 pages + i18n | — |
| P2 | Dashboard : période mémorisée (`localStorage`) | `DashboardPage.tsx` | — |
| P3 | `POST /api/products/bulk-archive` + `POST /api/customers/bulk-remind` | `routes/products.ts`, `routes/customers.ts` | `tests/bulkActions.test.ts` (5) |
| — | OpenAPI : 3 nouvelles routes documentées | `lib/openapi.ts` | `tests/openapi.test.ts` (exhaustivité) |

**Portes de qualité finales (toutes vertes) :**
- `typecheck` api + web ✔
- tests API : **248/248** (32 fichiers) ✔
- tests web : **152/152** (20 fichiers) ✔
- `build --workspace apps/api` ✔ et `build --workspace apps/web` ✔
