# 04 — Référence API StockMan (v2.1 « conformité expert »)

API REST JSON du SaaS StockMan. Ce document est le guide d'intégration ; la
spécification machine complète (OpenAPI 3.0.3, exhaustive à 100 % — vérifiée
par test) est servie par l'API elle-même. La **v2.1** ajoute les domaines de
l'audit expert métier (E1→E8) : clients/crédit, devis, commandes fournisseurs,
campagnes d'inventaire, sessions de caisse, factures/TVA, promotions, séries
IMEI, exports comptables.

```
GET /api/openapi.json        → spec OpenAPI 3.0 (publique, cache 1 h)
```

---

## 1. Bases

| Sujet              | Détail                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| Protocole          | HTTPS en production (HSTS), HTTP en local                               |
| Format             | JSON UTF-8 (`application/json`), CSV `;` pour exports/imports           |
| Montant            | FCFA, nombres (pas de centimes : `12500`)                               |
| Dates              | ISO 8601 UTC (`2026-08-02T14:30:00.000Z`) ; dates courtes `YYYY-MM-DD`  |
| Identifiants       | UUID v4                                                                 |
| Pagination offset  | `?page=1&size=20` (≤ 100) → `{ data[], total, page, size, totalPages }` |
| Pagination curseur | mouvements : `?cursor=<opaque>` → `nextCursor`                          |
| Rate limit         | global par IP (~300 req/min) ; auth durcie (5–20 essais/15 min)         |

## 2. Authentification

| Élément              | Durée                                                       | Transport                                     |
| -------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| Jeton d'accès JWT    | 10 min                                                      | En-tête `Authorization: Bearer <jwt>`         |
| Refresh token opaque | 7 j, **rotatif** (réutilisation = révocation de la famille) | Cookie `refresh_token` httpOnly, SameSite=Lax |

Flux :

1. `POST /api/auth/login` `{email, password}` → `{user, accessToken}` + cookie.
   Vendeurs caisse : `POST /api/auth/pin` `{email, pin}` (4–6 chiffres, bcrypt).
2. À l'expiration : `POST /api/auth/refresh` (cookie) → nouveau `accessToken`.
3. `POST /api/auth/logout` → révocation.

Rôles : `SUPER_ADMIN` (éditeur, console SaaS), `ADMIN` (gérant, tout son
tenant), `VENDEUR` (caisse, ses ventes, consultation catalogue/stock).
**Isolation** : chaque requête est bornée au `tenant_id` du jeton — en base ET
au service (tests de non-fuites RBAC croisés).

## 3. Erreurs

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Stock insuffisant pour « Eau 1.5L » (disponible : 3).",
    "details": {}
  },
  "requestId": "8f3e…"
}
```

Codes courants : `VALIDATION_ERROR` (400, `details.issues`), `INVALID_CREDENTIALS`,
`PIN_NOT_SET`, `ACCOUNT_DISABLED`, `TENANT_DISABLED` (401/403), `EMAIL_TAKEN`,
`NAME_TAKEN`, `BARCODE_TAKEN` (409), `NOT_FOUND` (404), `INSUFFICIENT_STOCK`,
`ALREADY_VOIDED`, `VARIANT_IN_USE`, `BATCH_NOT_EMPTY`, `SAME_DEPOT` (409),
`LICENSE_EXPIRED`, `LICENSE_USER_LIMIT`, `LICENSE_DEPOT_LIMIT` (423/403),
`RATE_LIMITED` (429), `CSV_EMPTY/CSV_HEADER/CSV_TOO_MANY` (400),
`SYNC_TOO_OLD` (400 — vente hors-ligne trop ancienne, ±48 h bornage serveur).

## 4. Hors-ligne caisse (idempotence)

1. `GET /api/pos/bootstrap?depotId=` → instantané (catalogue, prix serveur,
   stock dépôt, unités, ventes récentes) mis en cache IndexedDB par la PWA.
2. Hors-ligne, la vente est gardée localement avec `clientSaleId` (UUID v4).
3. Au retour réseau : `POST /api/sales` avec `clientSaleId` + `createdAt`.
   - Rejeu d'un même `clientSaleId` → **200 `{duplicate:true}`**, jamais de doublon
     (index unique `(tenant_id, client_sale_id)` + mouvements POS créés dans la
     même transaction que la vente).
   - Le **serveur est l'autorité finale** pour les prix et les stocks.

## 5. Cartographie des ressources

| Domaine                                            | Préfixe                                       | Écrit                                                 |
| -------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| Authentification                                   | `/api/auth/*`                                 | public + session                                      |
| Catégories · unités · dépôts · fournisseurs        | `/api/categories                              | units                                                 | depots  | suppliers`         | ADMIN (+ licence) |
| Produits · variantes · lots · import/export CSV    | `/api/products*`                              | ADMIN                                                 |
| Réceptions · transferts · ajustements · mouvements | `/api/stock/*`                                | ADMIN (lecture mouvements), écrit ADMIN               |
| Ventes · annulation · retours · reçus              | `/api/sales*`                                 | vente : tout rôle ; void/retours : ADMIN              |
| Caisse                                             | `/api/pos/bootstrap`                          | tout rôle                                             |
| Rapports · Z · prédictif                           | `/api/reports/*`                              | dashboard/Z : tout rôle ; autres : ADMIN              |
| Équipe                                             | `/api/users*`                                 | ADMIN                                                 |
| Tenant courant · abonnement                        | `/api/tenants/current`, `/api/licenses/plans` | lecture AUTH, écrit ADMIN                             |
| Console éditeur                                    | `/api/tenants                                 | licenses                                              | configs | reports/superadmin | */supervision`    | SUPER_ADMIN |
| Notifications · paramètres d'alertes               | `/api/notifications*`                         | lecture AUTH, réglages ADMIN                          |
| Audit                                              | `/api/audit-logs*`                            | lecture ADMIN / supervision SA                        |
| Clients · crédit · relances                        | `/api/customers*`                             | ADMIN (sélection caisse : tout rôle)                  |
| Devis / proforma                                   | `/api/quotes*`                                | ADMIN                                                 |
| Commandes fournisseurs · retours · OTIF            | `/api/purchase-orders*`                       | ADMIN                                                 |
| Campagnes d'inventaire                             | `/api/inventory-campaigns*`                   | ADMIN                                                 |
| Sessions de caisse                                 | `/api/cash-sessions*`                         | ouverture/clôture : caissier du dépôt ; suivi : ADMIN |
| Factures & avoirs (TVA)                            | `/api/invoices*`                              | lecture ADMIN                                         |
| Promotions · historique des prix                   | `/api/pricing/*`                              | ADMIN                                                 |
| Numéros de série (IMEI)                            | `/api/serials*`                               | lecture tout rôle ; enregistrement ADMIN              |

### Domaines v2.1 « conformité expert » (E1→E8)

| Module                     | Endpoints clés                                                                                                                                                                                                                                                                                               | Invariants garantis serveur                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1 Coûts réels**         | `GET /api/reports/cogs` · `GET /api/reports/margin                                                                                                                                                                                                                                                           | stock-valuation` (CUMP)                                                                                                                                                                                                                                                            | `sale_items.unit_cost` figé à la vente ; CUMP recalculé à chaque entrée ; annulation réintègre au même coût ; changer `purchase_price` ne modifie plus l'historique |
| **E2 Lots / FEFO**         | `GET /api/reports/batch-trace` · `GET /api/stock/transit`                                                                                                                                                                                                                                                    | allocation FEFO automatique à la vente (choix manuel avec motif) ; vente d'un lot périmé **bloquée serveur** ; rappel : lot → ventes                                                                                                                                               |
| **E3 Clients & crédit**    | `GET/POST /api/customers` · `GET/PATCH /api/customers/{id}` · `POST /api/customers/{id}/remind` · `POST /api/sales/{id}/payments` · `GET/POST /api/quotes` · `POST /api/quotes/{id}/convert`                                                                                                                 | statut PAYÉ/PARTIEL/CRÉDIT ; versements idempotents (`clientPaymentId`) ; vieillissement 30/60/90 ; plafond de crédit bloquant ; devis à prix figés convertibles                                                                                                                   |
| **E4 Approvisionnement**   | `GET/POST /api/purchase-orders` · `POST /{id}/send                                                                                                                                                                                                                                                           | receive                                                                                                                                                                                                                                                                            | close                                                                                                                                                               | cancel`·`GET/POST /api/purchase-orders/returns`·`GET /api/purchase-orders/otif`                                                                                              | réceptions partielles + reliquats ; motifs d'écart ; retours valorisés au coût réel du lot ; bidirectionnel avec `stock_receipts` |
| **E5 Inventaire physique** | `GET/POST /api/inventory-campaigns` · `POST /{id}/start                                                                                                                                                                                                                                                      | cancel`·`PUT /{id}/counts`·`POST /{id}/review                                                                                                                                                                                                                                      | validate`·`GET /abc-schedule`                                                                                                                                       | comptage aveugle ; qui compte ≠ qui valide (403) ; écarts valorisés au CUMP ; gel optionnel du périmètre ; motifs codifiés                                                   |
| **E6 Sessions de caisse**  | `GET/POST /api/cash-sessions` · `GET /current` · `POST /{id}/close`                                                                                                                                                                                                                                          | fond d'ouverture, attendu par méthode, compté, écart ; vente interdite hors session si `cash_session_required=true` ; Z émis à la clôture, journée verrouillée                                                                                                                     |
| **E7 Fiscalité CM**        | `GET /api/invoices` (+`/by-sale/{saleId}`) · `GET /api/reports/vat-journal` · `GET /api/reports/exports/syscohada-sales                                                                                                                                                                                      | receivables                                                                                                                                                                                                                                                                        | inventory`                                                                                                                                                          | TVA par produit (19,25 %/exonéré) ; numérotation continue par série/année verrouillée ; facture immuable (VOID → avoir ; retour partiel → avoir partiel) ; mentions NIU/RCCM |
| **E8 Maturité**            | `GET /api/stock/transit` · `POST /api/stock/import` · `GET/POST/PATCH/DELETE /api/pricing/promotions` · `GET /api/pricing/price-history/{productId}` · `GET/POST /api/serials/product/{productId}` · `GET /api/serials/lookup` · `GET/PUT /api/products/{id}/depot-settings` · `GET /api/reports/stock-kpis` | transit visible + réception partielle écartée ; IMEI obligatoire à la vente d'un produit sérialisé (1 numéro = 1 article) ; promo produit > globale ; plafond de remise par rôle (403 `DISCOUNT_LIMIT_EXCEEDED`) ; seuils par dépôt + rayonnages ; ABC/rotation/couverture/dormant |

### Import catalogue (CSV)

```
POST /api/products/import          Content-Type: text/csv
Nom;Catégorie;Code-barres;Prix achat;Prix vente;Unité;Seuil alerte
Eau 1.5L;Boissons;6001;200;400;Pce;5
"Huile ""Palme"" 5L";Épicerie;6002;3 500;4 900;Pce;3
```

→ `{ created, updated, total, errors: [{ ligne, message }] }` · ≤ 500 lignes ·
upsert par code-barres sinon nom (casse indifférente) · catégories auto-créées ·
audit `IMPORT`. Les quantités ne passent **pas** par l'import (stock tracé :
réceptions `POST /api/stock/receipts` ou import de l'inventaire d'ouverture ci-dessous).

### Import du stock initial (inventaire d'ouverture — v2.1)

```
POST /api/stock/import          { "depotId"?, "reference"?, "csv": "Produit;Quantité;Coût;Lot;Expiration\nEau 1.5L;48;200;LOT-A;2027-06-30" }
```

→ `{ receiptId, imported, errors: [{ ligne, message }] }` — une **réception
groupée atomique** (lots créés, CUMP pondéré, mouvements `IN`, audit `IMPORT`) ;
colonnes reconnues avec accents indifférents ; `Lot` obligatoire pour les
produits gérés par lots ; **produits sérialisés refusés** (leur entrée exige
les numéros de série) ; ≤ 500 lignes ; les lignes invalides sont rapportées
sans bloquer les valides.

### États d'une licence

`TRIAL → ACTIVE → EXPIRED` (ou `SUSPENDED`). Écritures métier verrouillées en
`EXPIRED` **après grâce** (`LICENSE_GRACE_DAYS`, défaut 3 j). Renouvellement SA :
`POST /api/licenses/{id}/renew`.

---

## 6. Migration de données V1 → V2

Pour reprises de l'application historique (Schéma `database/legacy/`) :

```bash
DATABASE_URL=postgresql://… node scripts/migrate-v1-to-v2.js --check   # rapport d'écarts, lecture seule
DATABASE_URL=postgresql://… node scripts/migrate-v1-to-v2.js --apply   # migration atomique + rapport JSON
```

Détail complet dans `docs/03_EXPLOITATION.md` (§ Reprise V1) : PIN re-hachés,
fusion du catalogue par dépôt, `stock_levels` + lots FEFO `LOT-V1-*`, mouvements
de migration tracés, somme de contrôle du stock, entrée `MIGRATION` au journal
d'audit de chaque tenant.
