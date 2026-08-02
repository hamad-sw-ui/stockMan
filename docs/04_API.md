# 04 — Référence API StockMan (v2.0)

API REST JSON du SaaS StockMan. Ce document est le guide d'intégration ; la
spécification machine complète (OpenAPI 3.0.3, exhaustive à 100 % — vérifiée
par test) est servie par l'API elle-même :

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

| Domaine                                            | Préfixe                                       | Écrit                                    |
| -------------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| Authentification                                   | `/api/auth/*`                                 | public + session                         |
| Catégories · unités · dépôts · fournisseurs        | `/api/categories                              | units                                    | depots  | suppliers`         | ADMIN (+ licence) |
| Produits · variantes · lots · import/export CSV    | `/api/products*`                              | ADMIN                                    |
| Réceptions · transferts · ajustements · mouvements | `/api/stock/*`                                | ADMIN (lecture mouvements), écrit ADMIN  |
| Ventes · annulation · retours · reçus              | `/api/sales*`                                 | vente : tout rôle ; void/retours : ADMIN |
| Caisse                                             | `/api/pos/bootstrap`                          | tout rôle                                |
| Rapports · Z · prédictif                           | `/api/reports/*`                              | dashboard/Z : tout rôle ; autres : ADMIN |
| Équipe                                             | `/api/users*`                                 | ADMIN                                    |
| Tenant courant · abonnement                        | `/api/tenants/current`, `/api/licenses/plans` | lecture AUTH, écrit ADMIN                |
| Console éditeur                                    | `/api/tenants                                 | licenses                                 | configs | reports/superadmin | */supervision`    | SUPER_ADMIN |
| Notifications · paramètres d'alertes               | `/api/notifications*`                         | lecture AUTH, réglages ADMIN             |
| Audit                                              | `/api/audit-logs*`                            | lecture ADMIN / supervision SA           |

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
réceptions `POST /api/stock/receipts`).

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
