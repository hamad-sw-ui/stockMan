/**
 * Spécification OpenAPI 3.0 de l'API StockMan — construite de façon DÉCLARATIVE
 * (table des routes) et servie sur GET /api/openapi.json. Un test valide sa
 * structure (chemins, operationId uniques, résumés FR, sécurité par rôle).
 */

type Role = "PUBLIC" | "AUTH" | "ADMIN" | "SA";
type Method = "get" | "post" | "patch" | "put" | "delete";

interface RouteDoc {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  role: Role;
  /** paramètres de chemin ou de requête notables */
  params?: Array<{
    name: string;
    in: "path" | "query";
    type?: string;
    required?: boolean;
    description?: string;
  }>;
  /** description compacte du corps JSON attendu (ou 'csv') */
  body?: Record<string, string> | "csv";
  /** schéma de la réponse succès : objet type… */
  returns?: string;
  /** réponse 201 au lieu de 200 (créations) */
  created?: boolean;
  errors?: string[];
}

const UUID = "string (uuid)";
const MONEY = "number (≥ 0, FCFA)";
const DATE = "string (YYYY-MM-DD)";

/** Table exhaustive des routes (miroir de app.ts + routes/*.ts). */
export const ROUTES: RouteDoc[] = [
  // ------------------------------------------------------------- Système
  {
    method: "get",
    path: "/",
    tag: "Système",
    summary: "Carte d’identité de l’API (nom, version).",
    role: "PUBLIC",
    returns: "{ name, version }",
  },
  {
    method: "get",
    path: "/api/health",
    tag: "Système",
    summary: "Santé : API + base de données.",
    role: "PUBLIC",
    returns: "{ status, db, ts }",
  },
  {
    method: "get",
    path: "/api/openapi.json",
    tag: "Système",
    summary: "Cette spécification OpenAPI.",
    role: "PUBLIC",
  },

  // ------------------------------------------------------------- Auth
  {
    method: "post",
    path: "/api/auth/register",
    tag: "Authentification",
    summary:
      "Inscription : crée un tenant + son compte ADMIN (licence TRIAL, dépôt principal, unités par défaut).",
    role: "PUBLIC",
    body: {
      tenantName: "string (2..120)",
      userName: "string (2..120)",
      email: "string (email, unique)",
      password: "string (8+, lettre+chiffre)",
    },
    returns: "{ user, accessToken } + cookie refresh httpOnly",
    errors: ["409 EMAIL_TAKEN"],
    created: true,
  },
  {
    method: "post",
    path: "/api/auth/login",
    tag: "Authentification",
    summary:
      "Connexion email + mot de passe (tous rôles). Limitée (anti-force brute).",
    role: "PUBLIC",
    body: { email: "string (email)", password: "string" },
    returns: "{ user, accessToken } + cookie refresh",
    errors: [
      "401 INVALID_CREDENTIALS",
      "403 ACCOUNT_DISABLED / TENANT_DISABLED",
    ],
  },
  {
    method: "post",
    path: "/api/auth/pin",
    tag: "Authentification",
    summary:
      "Connexion vendeur par PIN rapide (caisse) : email + code PIN à 4-6 chiffres.",
    role: "PUBLIC",
    body: { email: "string (email)", pin: "string (4-6 chiffres)" },
    returns: "{ user, accessToken } + cookie refresh",
    errors: ["401 INVALID_PIN / PIN_NOT_SET", "429 trop de tentatives"],
  },
  {
    method: "post",
    path: "/api/auth/refresh",
    tag: "Authentification",
    summary:
      "Rotation du jeton d’accès via le cookie refresh (jeton opaque rotatif, révocable).",
    role: "PUBLIC",
    returns: "{ accessToken }",
    errors: ["401 SESSION_EXPIRED (cookie absent/invalide)"],
  },
  {
    method: "post",
    path: "/api/auth/logout",
    tag: "Authentification",
    summary:
      "Déconnexion : révoque le refresh token courant et purge le cookie.",
    role: "AUTH",
  },
  {
    method: "post",
    path: "/api/auth/forgot-password",
    tag: "Authentification",
    summary:
      "Demande de réinitialisation : jeton à usage unique (la réponse ne révèle pas l’existence du compte).",
    role: "PUBLIC",
    body: { email: "string (email)" },
    returns: "{ message } (+ resetToken fourni en mode test/dev)",
  },
  {
    method: "post",
    path: "/api/auth/reset-password",
    tag: "Authentification",
    summary: "Réinitialisation du mot de passe avec le jeton reçu.",
    role: "PUBLIC",
    body: { token: "string", password: "string (8+, lettre+chiffre)" },
    errors: ["400 TOKEN_INVALID"],
  },
  {
    method: "get",
    path: "/api/auth/me",
    tag: "Authentification",
    summary: "Profil courant (utilisateur + tenant + licence).",
    role: "AUTH",
    returns: "{ user, tenant, license }",
  },
  {
    method: "post",
    path: "/api/auth/change-password",
    tag: "Authentification",
    summary:
      "Changement de mot de passe (mot de passe actuel requis ; révoque les autres sessions).",
    role: "AUTH",
    body: {
      currentPassword: "string",
      newPassword: "string (8+, lettre+chiffre)",
    },
    errors: ["400 WRONG_PASSWORD"],
  },

  // ------------------------------------------------------------- Catalogue
  {
    method: "get",
    path: "/api/categories",
    tag: "Catalogue",
    summary: "Liste des catégories du tenant.",
    role: "AUTH",
  },
  {
    method: "post",
    path: "/api/categories",
    tag: "Catalogue",
    summary: "Créer une catégorie.",
    role: "ADMIN",
    body: { name: "string", description: "string?" },
    errors: ["409 NAME_TAKEN"],
    created: true,
  },
  {
    method: "patch",
    path: "/api/categories/{id}",
    tag: "Catalogue",
    summary: "Renommer / décrire une catégorie.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "delete",
    path: "/api/categories/{id}",
    tag: "Catalogue",
    summary: "Supprimer une catégorie (les produits rattachés sont détachés).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "get",
    path: "/api/units",
    tag: "Catalogue",
    summary: "Unités de mesure (base + conversions, ex. Carton ×12).",
    role: "AUTH",
  },
  {
    method: "post",
    path: "/api/units",
    tag: "Catalogue",
    summary: "Créer une unité (base_value = facteur vers l’unité de base).",
    role: "ADMIN",
    body: {
      name: "string",
      symbol: "string",
      baseValue: "number (>0)",
      isBase: "boolean?",
    },
    created: true,
  },
  {
    method: "patch",
    path: "/api/units/{id}",
    tag: "Catalogue",
    summary: "Modifier une unité.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "delete",
    path: "/api/units/{id}",
    tag: "Catalogue",
    summary: "Supprimer une unité non utilisée.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["409 UNIT_IN_USE"],
  },
  {
    method: "get",
    path: "/api/depots",
    tag: "Catalogue",
    summary: "Dépôts du tenant.",
    role: "AUTH",
  },
  {
    method: "post",
    path: "/api/depots",
    tag: "Catalogue",
    summary: "Créer un dépôt (plafond licence max_depots appliqué).",
    role: "ADMIN",
    body: {
      name: "string",
      address: "string?",
      phone: "string?",
      ownerId: "uuid?",
    },
    errors: ["403 LICENSE_DEPOT_LIMIT", "409 NAME_TAKEN"],
    created: true,
  },
  {
    method: "patch",
    path: "/api/depots/{id}",
    tag: "Catalogue",
    summary: "Modifier / (dés)activer un dépôt.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "get",
    path: "/api/depots/{id}/stock",
    tag: "Stock",
    summary: "Niveaux de stock d’un dépôt (produits × variantes).",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "get",
    path: "/api/suppliers",
    tag: "Catalogue",
    summary: "Fournisseurs.",
    role: "AUTH",
  },
  {
    method: "get",
    path: "/api/suppliers/{id}",
    tag: "Catalogue",
    summary: "Fiche fournisseur + historique des réceptions.",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/suppliers",
    tag: "Catalogue",
    summary: "Créer un fournisseur.",
    role: "ADMIN",
    body: {
      name: "string",
      phone: "string?",
      email: "string?",
      address: "string?",
      notes: "string?",
    },
    created: true,
  },
  {
    method: "patch",
    path: "/api/suppliers/{id}",
    tag: "Catalogue",
    summary: "Modifier un fournisseur.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "delete",
    path: "/api/suppliers/{id}",
    tag: "Catalogue",
    summary: "Supprimer un fournisseur (les réceptions conservent leur trace).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },

  // ------------------------------------------------------------- Produits
  {
    method: "get",
    path: "/api/products",
    tag: "Produits",
    summary:
      "Catalogue paginé : recherche plein texte (nom, code-barres, catégorie), filtres catégorie/dépôt/statut (actif, stock bas, rupture, archivé).",
    role: "AUTH",
    params: [
      { name: "page", in: "query", type: "number (défaut 1)" },
      { name: "size", in: "query", type: "number (≤ 100)" },
      { name: "search", in: "query" },
      { name: "categoryId", in: "query", type: UUID },
      { name: "depotId", in: "query", type: UUID },
      { name: "status", in: "query", type: "active|low|out|archived" },
    ],
    returns: "{ data[], total, page, totalPages }",
  },
  {
    method: "post",
    path: "/api/products",
    tag: "Produits",
    summary:
      "Créer un produit (variantes optionnelles, stock initial tracé en mouvement IN).",
    role: "ADMIN",
    body: {
      name: "string",
      barcode: "string?",
      categoryId: "uuid?",
      unitId: "uuid?",
      purchasePrice: MONEY,
      sellingPrice: MONEY,
      minStockLevel: MONEY,
      hasVariants: "boolean?",
      variants: "array?",
      initialStock: "{ depotId, quantity, batchNumber?, expiryDate? }?",
    },
    errors: [
      "400 BARCODE_INVALID / BARCODE_DUP_IN_FORM",
      "409 NAME_TAKEN / BARCODE_TAKEN",
    ],
    created: true,
  },
  {
    method: "get",
    path: "/api/products/barcode/{code}",
    tag: "Produits",
    summary:
      "Recherche exacte par code-barres (produit puis variante puis alias) — usage caisse/douchette. Forme de réponse historique (compat).",
    role: "AUTH",
    params: [{ name: "code", in: "path" }],
    errors: ["404 BARCODE_UNKNOWN"],
  },
  {
    method: "get",
    path: "/api/products/lookup/{code}",
    tag: "Produits",
    summary:
      "Résolveur C1 enrichi : produit > variante > alias/conditionnement, avec facteur de conversion (unit_factor) et symbologie détectée.",
    role: "AUTH",
    params: [{ name: "code", in: "path" }],
    errors: ["404 BARCODE_UNKNOWN"],
  },
  {
    method: "get",
    path: "/api/products/{id}/barcodes",
    tag: "Produits",
    summary:
      "Liste tous les codes-barres d'un produit (principal + alias fournisseurs + conditionnements).",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/products/{id}/barcodes",
    tag: "Produits",
    summary:
      "Ajoute un code-barres alias (fournisseur ou conditionnement carton/palette) à un produit ou une variante. Idempotent si même cible.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: {
      code: "string",
      variantId: "uuid?",
      unitId: "uuid?",
      source: "REGISTERED | SUPPLIER",
    },
    errors: [
      "400 BARCODE_INVALID / VARIANT_UNKNOWN / UNIT_UNKNOWN",
      "409 BARCODE_TAKEN",
    ],
    created: true,
  },
  {
    method: "delete",
    path: "/api/products/barcodes/{id}",
    tag: "Produits",
    summary:
      "Retire un alias du registre (le code principal se gère dans la fiche produit).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["400 BARCODE_PRIMARY", "404 NOT_FOUND"],
  },
  {
    method: "get",
    path: "/api/products/export/csv",
    tag: "Produits",
    summary: "Export CSV du catalogue (séparateur « ; », UTF-8 BOM Excel).",
    role: "AUTH",
    returns: "text/csv",
  },
  {
    method: "post",
    path: "/api/products/import",
    tag: "Produits",
    summary:
      "Import CSV du catalogue : en-tête « Nom;Catégorie;Code-barres;Prix achat;Prix vente;Unité;Seuil alerte », ≤ 500 lignes, upsert par code-barres sinon nom, catégories auto-créées, erreurs par ligne. Les quantités ne sont PAS importées (le stock entre par les réceptions).",
    role: "ADMIN",
    body: "csv",
    returns: "{ created, updated, errors[] (ligne, message), total }",
    errors: ["400 CSV_EMPTY / CSV_HEADER / CSV_TOO_MANY"],
  },
  {
    method: "get",
    path: "/api/products/{id}",
    tag: "Produits",
    summary:
      "Fiche produit : variantes, lots (FEFO), niveaux par dépôt, 20 derniers mouvements.",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "patch",
    path: "/api/products/{id}",
    tag: "Produits",
    summary: "Mettre à jour une fiche produit.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/products/{id}/archive",
    tag: "Produits",
    summary:
      "Archiver (soft-delete) : historique des ventes conservé, produit masqué.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/products/{id}/restore",
    tag: "Produits",
    summary: "Restaurer un produit archivé.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/products/{id}/variants",
    tag: "Produits",
    summary: "Ajouter une variante (ex. « Bleu / XL »).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: {
      name: "string",
      sku: "string?",
      barcode: "string?",
      additionalPrice: "number?",
      attributes: "object?",
    },
    created: true,
  },
  {
    method: "patch",
    path: "/api/products/variants/{id}",
    tag: "Produits",
    summary: "Modifier une variante.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "delete",
    path: "/api/products/variants/{id}",
    tag: "Produits",
    summary: "Supprimer une variante sans ventes ni stock.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["409 VARIANT_IN_USE"],
  },
  {
    method: "post",
    path: "/api/products/{id}/batches",
    tag: "Produits",
    summary:
      "Créer un lot (correction manuelle ; les réceptions créent les lots automatiquement).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: {
      depotId: "uuid",
      batchNumber: "string",
      quantity: MONEY,
      expiryDate: `${DATE}?`,
      supplierId: "uuid?",
    },
    created: true,
  },
  {
    method: "patch",
    path: "/api/products/batches/{id}",
    tag: "Produits",
    summary: "Corriger un lot.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "delete",
    path: "/api/products/batches/{id}",
    tag: "Produits",
    summary: "Supprimer un lot épuisé (quantité 0 uniquement).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["409 BATCH_NOT_EMPTY"],
  },

  // ------------------------------------------------------------- Stock
  {
    method: "post",
    path: "/api/stock/receipts",
    tag: "Stock",
    summary:
      "Réception fournisseur : mouvements IN, création/alimentation des lots, coût d’achat — atomique.",
    role: "ADMIN",
    body: {
      depotId: "uuid",
      supplierId: "uuid?",
      reference: "string?",
      note: "string?",
      items:
        "[{ productId, variantId?, quantity, unitId?, unitCost?, batchNumber?, expiryDate? }]",
    },
    created: true,
  },
  {
    method: "get",
    path: "/api/stock/receipts",
    tag: "Stock",
    summary: "Réceptions (paginées).",
    role: "ADMIN",
  },
  {
    method: "get",
    path: "/api/stock/receipts/{id}",
    tag: "Stock",
    summary: "Détail d’une réception (lignes + lots créés).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/stock/transfers",
    tag: "Stock",
    summary:
      "Émettre un transfert inter-dépôts (statut PENDING, stock sortant tout de suite).",
    role: "ADMIN",
    body: {
      fromDepot: "uuid",
      toDepot: "uuid",
      note: "string?",
      items: "[{ productId, variantId?, quantity }]",
    },
    errors: ["400 SAME_DEPOT", "409 INSUFFICIENT_STOCK"],
    created: true,
  },
  {
    method: "get",
    path: "/api/stock/transfers",
    tag: "Stock",
    summary: "Transferts (paginés, filtre statut).",
    role: "ADMIN",
  },
  {
    method: "post",
    path: "/api/stock/transfers/{id}/receive",
    tag: "Stock",
    summary:
      "Réceptionner un transfert (E8 v2) : PARTIELLE par ligne possible — {items?: [{transferItemId, receivedQty, lostQty?, discrepancyReason? (DAMAGE|LOSS)}]} ; absent = reliquat intégral. Écarts valorisés au coût des lots, statut PARTIALLY_RECEIVED tant qu'un reliquat subsiste.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["400 DISCREPANCY_REASON_REQUIRED", "409 TRANSFER_OVER_RECEIPT"],
  },
  {
    method: "post",
    path: "/api/stock/transfers/{id}/cancel",
    tag: "Stock",
    summary:
      "Annuler un transfert PENDING ou PARTIALLY_RECEIVED : seul le RELIQUAT (non reçu, non perdu) est ré-intégré au dépôt source.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "get",
    path: "/api/stock/transit",
    tag: "Stock",
    summary:
      "Stock EN TRANSIT (E8) : lignes des transferts ouverts avec reliquat en route, valeur au coût des lots alloués, total.",
    role: "ADMIN",
  },
  {
    method: "post",
    path: "/api/stock/reserve",
    tag: "Stock",
    summary:
      "Réserver du stock (E8) : quantités mises de côté, non vendables à la caisse (disponible = stock − réservé, contrôlé serveur).",
    role: "ADMIN",
    body: {
      depotId: `${UUID}?`,
      productId: UUID,
      variantId: `${UUID}?`,
      quantity: "number",
      reason: "string?",
    },
    errors: ["409 STOCK_RESERVE_EXCEEDS"],
    created: true,
  },
  {
    method: "post",
    path: "/api/stock/release",
    tag: "Stock",
    summary: "Libérer du stock réservé (retour au disponible à la vente).",
    role: "ADMIN",
    body: {
      depotId: `${UUID}?`,
      productId: UUID,
      variantId: `${UUID}?`,
      quantity: "number",
      reason: "string?",
    },
    errors: ["409 RELEASE_EXCEEDS"],
  },
  {
    method: "post",
    path: "/api/stock/import",
    tag: "Stock",
    summary:
      "Import CSV du stock initial (E8) : {csv, depotId?, reference?} — colonnes Produit (code-barres ou nom);Quantité;Coût;Lot;Expiration. Une réception groupée atomique ; lignes invalides rapportées sans bloquer les valides ; produits sérialisés refusés (réception avec numéros).",
    role: "ADMIN",
    errors: ["400 CSV_HEADER", "400 CSV_TOO_MANY"],
    created: true,
  },
  {
    method: "post",
    path: "/api/stock/adjust",
    tag: "Stock",
    summary:
      "Ajustement d’inventaire (comptage physique) : sort négatif/positif tracé ADJUSTMENT avec motif obligatoire.",
    role: "ADMIN",
    body: {
      depotId: "uuid",
      productId: "uuid",
      variantId: "uuid?",
      newQuantity: "number (≥ 0)",
      reason: "string (obligatoire)",
    },
  },
  {
    method: "get",
    path: "/api/stock/movements",
    tag: "Stock",
    summary:
      "Journal des mouvements (pagination par curseur, filtres type/produit/dépôt/date).",
    role: "ADMIN",
    params: [
      { name: "cursor", in: "query" },
      { name: "type", in: "query" },
      { name: "productId", in: "query" },
      { name: "depotId", in: "query" },
    ],
  },

  // ------------------------------------------------------------- Ventes
  {
    method: "post",
    path: "/api/sales",
    tag: "Ventes",
    summary:
      "Créer une vente (caisse) : serveur = autorité prix/stock, mouvements OUT FEFO, idempotence hors-ligne par clientSaleId (rejeu sans doublon).",
    role: "AUTH",
    body: {
      depotId: "uuid",
      clientSaleId: "uuid? (obligatoire en hors-ligne)",
      createdAt: "ISO 8601? (borné ±48 h)",
      paymentMethod: "CASH | MTN_MOMO | ORANGE_MONEY",
      paymentReference: "string? (n° transaction MoMo)",
      items: "[{ productId, variantId?, quantity, unitId?, discountPct? }]",
    },
    returns:
      "vente + lignes (201) · 200 { duplicate: true } si clientSaleId déjà reçu",
    errors: [
      "409 INSUFFICIENT_STOCK",
      "423 LICENSE_EXPIRED",
      "400 SYNC_TOO_OLD",
    ],
    created: true,
  },
  {
    method: "get",
    path: "/api/sales",
    tag: "Ventes",
    summary: "Ventes paginées : filtres période/dépôt/vendeur/paiement/statut.",
    role: "AUTH",
    params: [
      { name: "from", in: "query", type: DATE },
      { name: "to", in: "query", type: DATE },
      { name: "depotId", in: "query", type: UUID },
      { name: "vendorId", in: "query", type: UUID },
      { name: "status", in: "query", type: "COMPLETED|VOIDED" },
    ],
  },
  {
    method: "get",
    path: "/api/sales/{id}",
    tag: "Ventes",
    summary: "Détail d’une vente (lignes, retours).",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "get",
    path: "/api/sales/{id}/receipt",
    tag: "Ventes",
    summary: "Données du reçu (impression 80 mm / partage WhatsApp).",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/sales/{id}/void",
    tag: "Ventes",
    summary:
      "Annuler une vente : statut VOIDED, stock ré-intégré (mouvement VOID), motif tracé.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: { reason: "string (obligatoire)" },
    errors: ["409 ALREADY_VOIDED"],
  },
  {
    method: "post",
    path: "/api/sales/{id}/returns",
    tag: "Ventes",
    summary:
      "Retour/avoir partiel : lignes rendues, stock ré-intégré (RETURN), vente conservée.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: { reason: "string?", items: "[{ productId, variantId?, baseQty }]" },
  },
  {
    method: "post",
    path: "/api/sales/{id}/payments",
    tag: "Ventes",
    summary:
      "Versement sur une vente (règlement de crédit) : idempotent hors-ligne (clientPaymentId), solde client décrémenté, statut PARTIAL→PAID.",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
    body: {
      method: "CASH | MTN_MOMO | ORANGE_MONEY",
      amount: "number > 0",
      reference: "string?",
      clientPaymentId: "uuid? (idempotence offline)",
    },
    errors: ["409 OVERPAY_INVALID", "409 SALE_VOIDED_FOR_PAYMENT"],
  },

  // ------------------------------------------------------------- Clients (E3)
  {
    method: "get",
    path: "/api/customers",
    tag: "Clients",
    summary:
      "Liste des clients : recherche nom/téléphone (q), filtre débiteurs (withDebt), pagination.",
    role: "AUTH",
  },
  {
    method: "post",
    path: "/api/customers",
    tag: "Clients",
    summary:
      "Créer une fiche client (nom, téléphone, limite de crédit) — carnet de dettes.",
    role: "AUTH",
    body: {
      name: "string",
      phone: "string?",
      creditLimit: "number (0 = aucune limite)",
    },
  },
  {
    method: "get",
    path: "/api/customers/{id}",
    tag: "Clients",
    summary:
      "Détail client : solde, vieillissement des créances (0-30/31-60/61-90/>90 j), dettes détaillées, 20 derniers versements.",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "patch",
    path: "/api/customers/{id}",
    tag: "Clients",
    summary:
      "Mettre à jour la fiche client (dont plafond de crédit, activation).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/customers/{id}/remind",
    tag: "Clients",
    summary:
      "Relance de paiement SMS/WhatsApp (message auto avec solde, 1/jour/client/canal par dedupe).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: { channel: "SMS | WHATSAPP", message: "string? (override)" },
    errors: ["400 REMIND_NO_PHONE"],
  },

  // ------------------------------------------------------------- Devis (E3)
  {
    method: "get",
    path: "/api/quotes",
    tag: "Devis",
    summary:
      "Devis / proformas : filtre statut (DRAFT/CONVERTED/CANCELLED), client.",
    role: "AUTH",
  },
  {
    method: "post",
    path: "/api/quotes",
    tag: "Devis",
    summary:
      "Créer un devis : prix recalculés serveur (autorité), AUCUN mouvement de stock.",
    role: "ADMIN",
    body: {
      customerId: "uuid?",
      validUntil: "date?",
      items: "[{ productId, variantId?, unitId?, quantity, discountPct? }]",
    },
  },
  {
    method: "get",
    path: "/api/quotes/{id}",
    tag: "Devis",
    summary: "Détail d'un devis (client, dépôt, lignes, statut).",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/quotes/{id}/convert",
    tag: "Devis",
    summary:
      "Convertir un devis en vente AU PRIX FIGÉ du devis (proforma honoré) — décrémente le stock, anti double-conversion.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["409 QUOTE_ALREADY_CONVERTED", "409 QUOTE_EXPIRED"],
  },
  {
    method: "post",
    path: "/api/quotes/{id}/cancel",
    tag: "Devis",
    summary: "Annuler un devis brouillon.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },

  // ------------------------------------------- Approvisionnement (E4)
  {
    method: "get",
    path: "/api/purchase-orders",
    tag: "Approvisionnement",
    summary:
      "Bons de commande fournisseurs (DRAFT/SENT/PARTIALLY_RECEIVED/CLOSED/CANCELLED) avec compteurs commandé/réceptionné.",
    role: "ADMIN",
    params: [
      { name: "status", in: "query" },
      { name: "supplierId", in: "query", type: UUID },
    ],
  },
  {
    method: "post",
    path: "/api/purchase-orders",
    tag: "Approvisionnement",
    summary:
      "Créer un bon de commande (brouillon) — livraison prévue par défaut : aujourd'hui + délai habituel du fournisseur.",
    role: "ADMIN",
    body: {
      supplierId: "uuid",
      depotId: "uuid?",
      expectedAt: "date? (défaut: création + délai fournisseur)",
      items: "[{ productId, variantId?, quantity (base), unitCost }]",
    },
    created: true,
    errors: ["400 SUPPLIER_UNKNOWN", "400 PRODUCT_UNKNOWN"],
  },
  {
    method: "get",
    path: "/api/purchase-orders/otif",
    tag: "Approvisionnement",
    summary:
      "Taux de service fournisseurs : On-Time / In-Full / OTIF (%) et délai réel moyen mesuré.",
    role: "ADMIN",
    params: [
      { name: "from", in: "query", type: DATE },
      { name: "to", in: "query", type: DATE },
      { name: "supplierId", in: "query", type: UUID },
    ],
  },
  {
    method: "get",
    path: "/api/purchase-orders/returns",
    tag: "Approvisionnement",
    summary: "Retours fournisseur (avoirs) : liste paginée.",
    role: "ADMIN",
    params: [{ name: "supplierId", in: "query", type: UUID }],
  },
  {
    method: "post",
    path: "/api/purchase-orders/returns",
    tag: "Approvisionnement",
    summary:
      "Créer un retour fournisseur : prélèvement FEFO (périmés inclus) ou lot explicite, valorisé au COÛT RÉEL DU LOT, mouvement SUPPLIER_RETURN.",
    role: "ADMIN",
    body: {
      supplierId: "uuid",
      reason:
        "DAMAGED | EXPIRED | WRONG_PRODUCT | QUALITY | OVERDELIVERY | OTHER",
      receiptId: "uuid? (rattachement livraison)",
      items: "[{ productId, variantId?, quantity, unitId?, batchId? }]",
    },
    created: true,
    errors: ["409 STOCK_INSUFFICIENT", "400 BATCH_UNKNOWN"],
  },
  {
    method: "get",
    path: "/api/purchase-orders/returns/{id}",
    tag: "Approvisionnement",
    summary: "Détail d'un retour fournisseur (lignes, lots, coûts).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "get",
    path: "/api/purchase-orders/{id}",
    tag: "Approvisionnement",
    summary:
      "Détail d'une commande : lignes avec reliquat (remaining_qty), valeur réceptionnée.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/purchase-orders/{id}/send",
    tag: "Approvisionnement",
    summary: "Envoyer la commande au fournisseur (BROUILLON → ENVOYÉE).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["409 PO_NOT_DRAFT"],
  },
  {
    method: "post",
    path: "/api/purchase-orders/{id}/receive",
    tag: "Approvisionnement",
    summary:
      "Réception rattachée (partielle possible) : avance les reliquats, crée la réception stock (CUMP/lots), motif d'écart codifié par ligne, clôture automatique si tout est livré.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: {
      items:
        "[{ poItemId, quantity, unitId?, discrepancyReason?, batchNumber?, expiryDate? }]",
    },
    created: true,
    errors: ["409 PO_NOT_RECEIVABLE", "409 PO_OVER_RECEIPT"],
  },
  {
    method: "post",
    path: "/api/purchase-orders/{id}/close",
    tag: "Approvisionnement",
    summary:
      "Clôturer manuellement la commande (reliquat acté comme définitif, motif codifié).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: {
      reason:
        "DELIVERED | SUPPLIER_SHORTAGE | CANCELLED_BY_SUPPLIER | PRICE_DISPUTE | OTHER",
    },
    errors: ["409 PO_NOT_CLOSABLE"],
  },
  {
    method: "post",
    path: "/api/purchase-orders/{id}/cancel",
    tag: "Approvisionnement",
    summary: "Annuler un brouillon de commande.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["409 PO_NOT_DRAFT"],
  },

  // ------------------------------------------- Inventaire pro (E5)
  {
    method: "get",
    path: "/api/inventory-campaigns",
    tag: "Inventaire",
    summary:
      "Campagnes d'inventaire physique (DRAFT/COUNTING/REVIEW/CLOSED/CANCELLED) avec compteurs de comptage.",
    role: "ADMIN",
    params: [
      { name: "status", in: "query" },
      { name: "depotId", in: "query", type: UUID },
    ],
  },
  {
    method: "post",
    path: "/api/inventory-campaigns",
    tag: "Inventaire",
    summary:
      "Créer une campagne (brouillon) : périmètre catalogue/ABC/sélection, comptage aveugle et gel des mouvements optionnels.",
    role: "ADMIN",
    body: {
      depotId: "uuid?",
      scope: "ALL | SELECTION | ABC_A | ABC_B | ABC_C",
      productIds: "uuid[]? (scope SELECTION)",
      blind: "boolean (défaut false)",
      freezeStock: "boolean (défaut false) — gele tout mouvement du dépôt",
    },
    created: true,
    errors: [
      "400 SCOPE_EMPTY",
      "409 uq_inventory_active_depot (1 active/dépôt)",
    ],
  },
  {
    method: "get",
    path: "/api/inventory-campaigns/abc-schedule",
    tag: "Inventaire",
    summary:
      "Inventaire tournant ABC : produits par classe (ventes 90 j), fréquence (A=30/B=90/C=365 j), dernier comptage, échéance et retard.",
    role: "ADMIN",
  },
  {
    method: "get",
    path: "/api/inventory-campaigns/{id}",
    tag: "Inventaire",
    summary:
      "Détail + rapport d'écarts VALORISÉ CUMP (théorique et coût figés au lancement ; masqués en comptage aveugle).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/inventory-campaigns/{id}/start",
    tag: "Inventaire",
    summary:
      "Lancer le comptage : génère les lignes produits, fige théorique + CUMP, active le gel éventuel.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["409 CAMPAIGN_NOT_DRAFT"],
  },
  {
    method: "put",
    path: "/api/inventory-campaigns/{id}/counts",
    tag: "Inventaire",
    summary: "Saisie des quantités comptées (motif codifié par ligne d'écart).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: { lines: "[{ productId, countedQty, reason? }]" },
    errors: ["409 CAMPAIGN_NOT_COUNTING", "400 PRODUCT_NOT_IN_CAMPAIGN"],
  },
  {
    method: "post",
    path: "/api/inventory-campaigns/{id}/review",
    tag: "Inventaire",
    summary:
      "Passer en revue : exige comptage complet et motif codifié sur chaque écart, calcule les variances valorisées.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["409 COUNT_INCOMPLETE", "409 COUNT_REASON_MISSING"],
  },
  {
    method: "post",
    path: "/api/inventory-campaigns/{id}/validate",
    tag: "Inventaire",
    summary:
      "Valider et appliquer les ajustements (atomique) — SÉPARATION DES TÂCHES : le validateur ne peut pas avoir compté.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["409 COUNT_VALIDATOR_SAME_AS_COUNTER", "409 CAMPAIGN_CLOSED"],
  },
  {
    method: "post",
    path: "/api/inventory-campaigns/{id}/cancel",
    tag: "Inventaire",
    summary: "Annuler une campagne (dégèle le dépôt si gelée).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    errors: ["409 CAMPAIGN_CLOSED"],
  },

  // ------------------------------------------- Sessions de caisse (E6)
  {
    method: "post",
    path: "/api/cash-sessions",
    tag: "Sessions de caisse",
    summary:
      "Ouvrir la caisse du dépôt : fond d'ouverture, journée métier (fuseau tenant — une seule session ouverte/journée par dépôt, verrou de concurrence par index unique). Rôles : ADMIN (depotId requis) ou VENDEUR (son dépôt).",
    role: "AUTH",
    body: {
      depotId: "uuid? (requis pour un ADMIN)",
      openingFloat: "number ≥ 0 (fond de caisse, défaut 0)",
      note: "string?",
    },
    created: true,
    errors: ["409 SESSION_ALREADY_OPEN", "409 DAY_LOCKED"],
  },
  {
    method: "get",
    path: "/api/cash-sessions/current",
    tag: "Sessions de caisse",
    summary:
      "Session ouverte du dépôt + attendus EN DIRECT par méthode (fond + encaissements) + drapeau « session obligatoire » du tenant (cash_session_required).",
    role: "AUTH",
    params: [{ name: "depotId", in: "query", type: UUID }],
  },
  {
    method: "get",
    path: "/api/cash-sessions",
    tag: "Sessions de caisse",
    summary:
      "Sessions du tenant (pagination, filtres dépôt/statut/journées) — les écarts de clôture sont visibles par le gérant.",
    role: "ADMIN",
    params: [
      { name: "depotId", in: "query", type: UUID },
      { name: "status", in: "query", type: "OPEN|CLOSED" },
      { name: "from", in: "query", type: DATE },
      { name: "to", in: "query", type: DATE },
    ],
  },
  {
    method: "get",
    path: "/api/cash-sessions/{id}",
    tag: "Sessions de caisse",
    summary:
      "Détail : fond, comptés, Z figé à la clôture (immuable). ADMIN : tout le tenant ; VENDEUR : son dépôt uniquement.",
    role: "AUTH",
  },
  {
    method: "post",
    path: "/api/cash-sessions/{id}/close",
    tag: "Sessions de caisse",
    summary:
      "Clôturer la session (ADMIN ou vendeur du dépôt) : compté physique par méthode, écart = compté − attendu, Z ÉMIS et figé, journée VERROUILLÉE (les annulations de ventes de la journée sont bloquées ensuite).",
    role: "AUTH",
    body: {
      countedCash: "number ≥ 0 (espèces comptées — obligatoire)",
      countedMtn: "number ≥ 0? (solde MTN MoMo constaté)",
      countedOm: "number ≥ 0? (solde Orange Money constaté)",
      note: "string?",
    },
    errors: ["409 SESSION_ALREADY_CLOSED"],
  },

  // ------------------------------------------- Facturation & fiscalité (E7)
  {
    method: "get",
    path: "/api/invoices",
    tag: "Facturation",
    summary:
      "Factures et avoirs (numérotation légale continue FAC-…/AV-… par dépôt/série/année, séquence verrouillée, immuabilité — pagination, filtres dépôt/type/période).",
    role: "ADMIN",
    params: [
      { name: "depotId", in: "query", type: UUID },
      { name: "kind", in: "query", type: "INVOICE|CREDIT_NOTE" },
      { name: "from", in: "query", type: DATE },
      { name: "to", in: "query", type: DATE },
    ],
  },
  {
    method: "get",
    path: "/api/invoices/by-sale/{saleId}",
    tag: "Facturation",
    summary:
      "Facture (et avoirs éventuels) d'une vente — ventilation HT/TVA/TTC figée. VENDEUR : ventes de son dépôt.",
    role: "AUTH",
  },
  {
    method: "get",
    path: "/api/invoices/{id}",
    tag: "Facturation",
    summary:
      "Facture détaillée imprimable : lignes, TVA par ligne, mentions légales du tenant (raison sociale, NIU, RCCM, adresse). VENDEUR : son dépôt.",
    role: "AUTH",
  },
  {
    method: "get",
    path: "/api/reports/vat-journal",
    tag: "Rapports",
    summary:
      "Journal de TVA collectée : factures (+) et avoirs (−) ventilés HT/TVA/TTC, synthèse par taux, cadrage jour local tenant. CSV via ?format=csv.",
    role: "ADMIN",
    params: [
      { name: "from", in: "query", type: DATE },
      { name: "to", in: "query", type: DATE },
      { name: "depotId", in: "query", type: UUID },
      { name: "format", in: "query", type: "json|csv" },
    ],
  },
  {
    method: "get",
    path: "/api/reports/exports/syscohada-sales",
    tag: "Rapports",
    summary:
      "Export comptable SYSCOHADA — journal des ventes (VT) : DÉBIT règlements (571000/521100/521200) et crédit client (411100), CRÉDIT 701100 HT et 443100 TVA ; avoirs en contrepasse. CSV (séparateur point-virgule).",
    role: "ADMIN",
    params: [
      { name: "from", in: "query", type: DATE },
      { name: "to", in: "query", type: DATE },
    ],
  },
  {
    method: "get",
    path: "/api/reports/exports/syscohada-receivables",
    tag: "Rapports",
    summary:
      "Export SYSCOHADA — créances clients (411100) : solde par client ventilé 0-30/31-60/61-90/>90 j. CSV (séparateur point-virgule).",
    role: "ADMIN",
  },
  {
    method: "get",
    path: "/api/reports/exports/syscohada-inventory",
    tag: "Rapports",
    summary:
      "Export SYSCOHADA — inventaire valorisé (311000 marchandises) au CUMP par produit/dépôt. CSV (séparateur point-virgule).",
    role: "ADMIN",
    params: [{ name: "depotId", in: "query", type: UUID }],
  },

  // ------------------------------------------------------------- Maturité (E8)
  {
    method: "get",
    path: "/api/serials/lookup",
    tag: "Sérialisation",
    summary:
      "Recherche garantie/SAV d'un numéro de série (IMEI) : statut, dépôt, vente et n° de facture d'origine. ?serial=…",
    role: "AUTH",
    params: [{ name: "serial", in: "query", type: "string" }],
    errors: ["404"],
  },
  {
    method: "get",
    path: "/api/serials/product/{productId}",
    tag: "Sérialisation",
    summary:
      "Numéros de série EN STOCK d'un produit (aide à la vente) — filtre dépôt optionnel.",
    role: "AUTH",
    params: [{ name: "depotId", in: "query", type: UUID }],
  },
  {
    method: "post",
    path: "/api/serials/product/{productId}",
    tag: "Sérialisation",
    summary:
      "Enregistrer des numéros de série en stock (complément manuel — doublons refusés avec la liste). Les réceptions fournisseurs les exigent déjà pour les produits sérialisés.",
    role: "ADMIN",
    body: { depotId: `${UUID}?`, serials: "string[] (1..500)" },
    errors: ["409 SERIAL_DUPLICATE"],
    created: true,
  },
  {
    method: "get",
    path: "/api/pricing/promotions",
    tag: "Prix & promotions",
    summary:
      "Promotions datées (produit précis ou globales) — pagination, filtre ?active=true (fenêtre en cours).",
    role: "ADMIN",
  },
  {
    method: "post",
    path: "/api/pricing/promotions",
    tag: "Prix & promotions",
    summary:
      "Créer une promotion datée : remise automatique à la caisse dans la fenêtre, figée sur la ligne de vente (promo produit prioritaire sur globale).",
    role: "ADMIN",
    body: {
      name: "string",
      productId: `${UUID}? (NULL = globale)`,
      discountPct: "0<pct<=100",
      startsAt: DATE,
      endsAt: DATE,
      isActive: "boolean?",
    },
    errors: ["400 PROMO_WINDOW_INVALID"],
    created: true,
  },
  {
    method: "patch",
    path: "/api/pricing/promotions/{id}",
    tag: "Prix & promotions",
    summary: "Modifier/activer/désactiver une promotion.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "delete",
    path: "/api/pricing/promotions/{id}",
    tag: "Prix & promotions",
    summary: "Supprimer une promotion.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "get",
    path: "/api/pricing/price-history/{productId}",
    tag: "Prix & promotions",
    summary:
      "Historique horodaté des changements de prix du produit (détail & gros) : ancien → nouveau, qui, quand, motif.",
    role: "ADMIN",
  },
  {
    method: "get",
    path: "/api/products/{id}/depot-settings",
    tag: "Catalogue",
    summary:
      "Paramètres par dépôt du produit (E8) : seuil d'alerte effectif par dépôt + rayonnage (bin location).",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "put",
    path: "/api/products/{id}/depot-settings",
    tag: "Catalogue",
    summary:
      "Définir seuil d'alerte par dépôt (NULL = hérite du catalogue) et rayonnage.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: {
      depotId: UUID,
      minStockLevel: "number|null",
      binLocation: "string?",
    },
  },
  {
    method: "get",
    path: "/api/reports/stock-kpis",
    tag: "Rapports",
    summary:
      "KPI stock (E8) : valeur au CUMP, rotation 90 j, couverture (jours), classification ABC, stock DORMANT (pas de vente ≥ N j, valeur immobilisée). CSV via ?format=csv.",
    role: "ADMIN",
    params: [
      { name: "depotId", in: "query", type: UUID },
      { name: "dormantDays", in: "query", type: "number (défaut 60)" },
      { name: "format", in: "query", type: "json|csv" },
    ],
  },

  // ------------------------------------------------------------- Caisse (POS)
  {
    method: "get",
    path: "/api/pos/bootstrap",
    tag: "Caisse",
    summary:
      "Instantané caisse hors-ligne : produits + variantes + prix serveur, niveaux du dépôt, unités, catégories, ventes récentes du vendeur (cache IndexedDB côté PWA).",
    role: "AUTH",
    params: [{ name: "depotId", in: "query", type: UUID }],
  },

  // ------------------------------------------------------------- Rapports
  {
    method: "get",
    path: "/api/reports/dashboard",
    tag: "Rapports",
    summary:
      "Tableau de bord : CA jour/semaine/mois, panier moyen, top produits, alertes stock & péremption, série 14 jours.",
    role: "AUTH",
  },
  {
    method: "get",
    path: "/api/reports/sales",
    tag: "Rapports",
    summary:
      "Rapport des ventes : CA, volume, par dépôt/vendeur/paiement, série quotidienne. CSV via ?format=csv.",
    role: "ADMIN",
    params: [
      { name: "from", in: "query", type: DATE },
      { name: "to", in: "query", type: DATE },
      { name: "depotId", in: "query", type: UUID },
      { name: "format", in: "query", type: "json|csv" },
    ],
  },
  {
    method: "get",
    path: "/api/reports/margin",
    tag: "Rapports",
    summary:
      "Marge par produit à COÛT FIGÉ (coût réel de la ligne de vente : lot ou CUMP du jour), triée par marge totale. CSV disponible.",
    role: "ADMIN",
  },
  {
    method: "get",
    path: "/api/reports/stock-valuation",
    tag: "Rapports",
    summary:
      "Valorisation du stock au CUMP (coût unitaire moyen pondéré, référentiel SYSCOHADA), par dépôt. CSV disponible.",
    role: "ADMIN",
  },
  {
    method: "get",
    path: "/api/reports/cogs",
    tag: "Rapports",
    summary:
      "Coût des marchandises vendues (COGS) de la période : CA, coût réel vendu, marge brute, taux de marge.",
    role: "ADMIN",
    params: [
      { name: "from", in: "query", type: DATE },
      { name: "to", in: "query", type: DATE },
      { name: "depotId", in: "query", type: UUID },
    ],
  },
  {
    method: "get",
    path: "/api/reports/batch-trace",
    tag: "Rapports",
    summary:
      "Traçabilité / rappel de lot : origine fournisseur, ventes prélevées sur le lot, autres mouvements, quantité restante par dépôt.",
    role: "ADMIN",
    params: [
      { name: "productId", in: "query", type: UUID },
      { name: "batchNumber", in: "query", type: "string" },
    ],
  },
  {
    method: "post",
    path: "/api/reports/costs-revalue",
    tag: "Rapports",
    summary:
      "Revalorisation idempotente de l'historique (E1) : rejeu CUMP des réceptions, coût des lots, figeage rétroactif des lignes de vente sans coût.",
    role: "ADMIN",
  },
  {
    method: "get",
    path: "/api/reports/expiry",
    tag: "Rapports",
    summary:
      "Lots périssables : expirés, ≤ 30 jours, ≤ 90 jours (FEFO). CSV disponible.",
    role: "ADMIN",
  },
  {
    method: "get",
    path: "/api/reports/predictive",
    tag: "Rapports",
    summary:
      "Prévision de rupture : vélocité 30 j → épuisement estimé + suggestion de commande (quantité cible délai fournisseur + 7 j, fournisseur habituel, coût) — bouton « commander » (E4). Cadrage dépôt ?depotId= (seuil effectif par dépôt, E8). CSV via ?format=csv.",
    role: "ADMIN",
    params: [
      { name: "depotId", in: "query", type: UUID },
      { name: "format", in: "query", type: "json|csv" },
    ],
  },
  {
    method: "get",
    path: "/api/reports/z-report",
    tag: "Rapports",
    summary:
      "Rapport Z de clôture de caisse : CA, ventes, paiements par méthode, annulations — par jour et dépôt.",
    role: "AUTH",
    params: [
      { name: "date", in: "query", type: DATE },
      { name: "depotId", in: "query", type: UUID },
    ],
  },
  {
    method: "get",
    path: "/api/reports/superadmin/stats",
    tag: "Admin SaaS",
    summary:
      "Statistiques éditeur : tenants actifs, licences par statut, CA cumulé plateforme.",
    role: "SA",
  },

  // ------------------------------------------------------------- Utilisateurs
  {
    method: "get",
    path: "/api/users",
    tag: "Utilisateurs",
    summary: "Équipe du tenant.",
    role: "ADMIN",
  },
  {
    method: "post",
    path: "/api/users",
    tag: "Utilisateurs",
    summary:
      "Créer un membre (vendeur affecté à un dépôt, PIN caisse optionnel haché bcrypt).",
    role: "ADMIN",
    body: {
      name: "string",
      email: "string (email)",
      role: "ADMIN|VENDEUR",
      depotId: "uuid?",
      password: "string (8+)",
      pin: "string (4-6 chiffres)?",
    },
    errors: ["403 LICENSE_USER_LIMIT", "409 EMAIL_TAKEN"],
    created: true,
  },
  {
    method: "patch",
    path: "/api/users/{id}",
    tag: "Utilisateurs",
    summary: "Modifier rôle/dépôt/nom d’un membre.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/users/{id}/reset-password",
    tag: "Utilisateurs",
    summary:
      "Réinitialiser le mot de passe d’un membre (révoque ses sessions).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: { newPassword: "string (8+)" },
  },
  {
    method: "post",
    path: "/api/users/{id}/reset-pin",
    tag: "Utilisateurs",
    summary: "Définir/réinitialiser le PIN caisse d’un vendeur.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
    body: { pin: "string (4-6 chiffres)" },
  },
  {
    method: "post",
    path: "/api/users/{id}/deactivate",
    tag: "Utilisateurs",
    summary: "Désactiver un compte (sessions révoquées).",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/users/{id}/activate",
    tag: "Utilisateurs",
    summary: "Réactiver un compte.",
    role: "ADMIN",
    params: [{ name: "id", in: "path", type: UUID }],
  },

  // ------------------------------------------------------------- Tenants & licences
  {
    method: "get",
    path: "/api/tenants/current",
    tag: "Tenant",
    summary:
      "Tenant courant + licence + compteurs d’usage (utilisateurs/dépôts vs plafonds).",
    role: "AUTH",
  },
  {
    method: "patch",
    path: "/api/tenants/current",
    tag: "Tenant",
    summary: "Paramètres de l’entreprise (nom, téléphone, logo, couleur).",
    role: "ADMIN",
  },
  {
    method: "get",
    path: "/api/tenants",
    tag: "Admin SaaS",
    summary: "Tous les tenants (recherche, filtre statut).",
    role: "SA",
  },
  {
    method: "post",
    path: "/api/tenants",
    tag: "Admin SaaS",
    summary: "Provisionner un tenant (compte gérant inclus, licence initiale).",
    role: "SA",
    body: {
      name: "string",
      adminName: "string",
      adminEmail: "string (email)",
      planCode: "string",
      months: "number?",
    },
    created: true,
  },
  {
    method: "get",
    path: "/api/tenants/{id}",
    tag: "Admin SaaS",
    summary:
      "Détail tenant : licence courante, usage, membres, ventes récentes.",
    role: "SA",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "patch",
    path: "/api/tenants/{id}",
    tag: "Admin SaaS",
    summary: "Modifier un tenant.",
    role: "SA",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/tenants/{id}/status",
    tag: "Admin SaaS",
    summary: "Activer / suspendre un tenant (connexions bloquées si inactif).",
    role: "SA",
    params: [{ name: "id", in: "path", type: UUID }],
    body: { isActive: "boolean" },
  },
  {
    method: "post",
    path: "/api/tenants/{id}/impersonate",
    tag: "Admin SaaS",
    summary:
      "Support : jeton d’impersonation du gérant (audit IMPERSONATE, bandeau visible dans l’app, sessions vendeurs exclues).",
    role: "SA",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/tenants/{id}/reset-admin-password",
    tag: "Admin SaaS",
    summary: "Réinitialiser le mot de passe du gérant d’un tenant.",
    role: "SA",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "get",
    path: "/api/licenses/plans",
    tag: "Licences",
    summary: "Grille des plans commerciaux.",
    role: "AUTH",
  },
  {
    method: "post",
    path: "/api/licenses/plans",
    tag: "Licences",
    summary: "Créer un plan.",
    role: "SA",
    body: {
      code: "string (A-Z0-9_)",
      name: "string",
      maxUsers: "number",
      maxDepots: "number",
      monthlyPrice: MONEY,
    },
    created: true,
  },
  {
    method: "patch",
    path: "/api/licenses/plans/{code}",
    tag: "Licences",
    summary: "Modifier un plan.",
    role: "SA",
    params: [{ name: "code", in: "path" }],
  },
  {
    method: "get",
    path: "/api/licenses",
    tag: "Licences",
    summary:
      "Licences de tous les tenants (filtre statut, triées par échéance).",
    role: "SA",
    params: [{ name: "status", in: "query" }],
  },
  {
    method: "post",
    path: "/api/licenses",
    tag: "Licences",
    summary: "Attribuer une licence à un tenant.",
    role: "SA",
    body: {
      tenantId: "uuid",
      planCode: "string",
      startDate: DATE,
      endDate: DATE,
      notes: "string?",
    },
    created: true,
  },
  {
    method: "post",
    path: "/api/licenses/{id}/renew",
    tag: "Licences",
    summary: "Renouveler une licence (prolongation, plan optionnel).",
    role: "SA",
    params: [{ name: "id", in: "path", type: UUID }],
    body: { months: "number (1-36)", planCode: "string?" },
  },

  // ------------------------------------------------------------- Notifications
  {
    method: "get",
    path: "/api/notifications",
    tag: "Notifications",
    summary: "Notifications du tenant (paginées, non lues d’abord).",
    role: "AUTH",
  },
  {
    method: "patch",
    path: "/api/notifications/{id}/read",
    tag: "Notifications",
    summary: "Marquer comme lue.",
    role: "AUTH",
    params: [{ name: "id", in: "path", type: UUID }],
  },
  {
    method: "post",
    path: "/api/notifications/read-all",
    tag: "Notifications",
    summary: "Tout marquer comme lu.",
    role: "AUTH",
  },
  {
    method: "get",
    path: "/api/notifications/settings",
    tag: "Notifications",
    summary:
      "Paramètres d’alertes (destinataires SMS/WhatsApp, rapports quotidiens, heure d’envoi).",
    role: "ADMIN",
  },
  {
    method: "put",
    path: "/api/notifications/settings",
    tag: "Notifications",
    summary: "Enregistrer les paramètres d’alertes.",
    role: "ADMIN",
  },
  {
    method: "post",
    path: "/api/notifications/test",
    tag: "Notifications",
    summary: "Envoyer un message de test (SMS ou WhatsApp) vers un numéro.",
    role: "ADMIN",
    body: { channel: "SMS|WHATSAPP", phone: "string" },
  },
  {
    method: "get",
    path: "/api/notifications/supervision",
    tag: "Admin SaaS",
    summary: "Supervision des envois (tous tenants, filtres statut/canal).",
    role: "SA",
  },

  // ------------------------------------------------------------- Config & audit
  {
    method: "get",
    path: "/api/configs",
    tag: "Configuration",
    summary: "Clés système globales (secrets masqués).",
    role: "SA",
  },
  {
    method: "put",
    path: "/api/configs",
    tag: "Configuration",
    summary:
      "Définir les clés système (Africa’s Talking, WhatsApp, …) — audit CONFIG, jamais renvoyées en clair ensuite.",
    role: "SA",
    body: { entries: "[{ key, value, isSecret? }]" },
  },
  {
    method: "get",
    path: "/api/configs/tenant",
    tag: "Configuration",
    summary:
      "Configuration du tenant : secrets masqués (sms_password, tokens…) ; préférences métier en clair (cash_session_required…).",
    role: "ADMIN",
  },
  {
    method: "put",
    path: "/api/configs/tenant",
    tag: "Configuration",
    summary:
      "Enregistrer une clé : secrets (sms_username, sms_api_key, whatsapp_token, whatsapp_phone_id) ou préférence (cash_session_required = « true »/« false » : vendre/encaisser exige une session de caisse ouverte — E6).",
    role: "ADMIN",
    body: { key: "string", value: "string" },
    errors: ["400 CONFIG_VALUE_INVALID"],
  },
  {
    method: "get",
    path: "/api/audit-logs",
    tag: "Audit",
    summary:
      "Journal d’audit du tenant (filtre entité/action/utilisateur, paginé).",
    role: "ADMIN",
  },
  {
    method: "get",
    path: "/api/audit-logs/supervision",
    tag: "Admin SaaS",
    summary: "Journal d’audit global tous tenants.",
    role: "SA",
  },
];

const errorSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string", example: "INSUFFICIENT_STOCK" },
        message: {
          type: "string",
          example: "Stock insuffisant pour « Eau 1.5L » (disponible : 3).",
        },
        details: {},
      },
      required: ["code", "message"],
    },
    requestId: { type: "string" },
  },
  required: ["error"],
};

function errorResponses(r: Role, extra: string[] = []) {
  const errs: Record<string, { description: string; content?: unknown }> = {
    "400": {
      description: `Requête invalide (validation).${extra.length ? ` Codes possibles : ${extra.join(", ")}.` : ""}`,
      content: { "application/json": { schema: errorSchema } },
    },
  };
  if (r !== "PUBLIC") {
    errs["401"] = {
      description: "Jeton d’accès absent ou expiré.",
      content: { "application/json": { schema: errorSchema } },
    };
  }
  if (r === "ADMIN")
    errs["403"] = {
      description:
        "Réservé au rôle ADMIN (gérant), ou plafond de licence atteint (LICENSE_*).",
      content: { "application/json": { schema: errorSchema } },
    };
  if (r === "SA")
    errs["403"] = {
      description: "Réservé au SUPER_ADMIN éditeur.",
      content: { "application/json": { schema: errorSchema } },
    };
  if (r === "AUTH" || r === "ADMIN")
    errs["423"] = {
      description:
        "Licence expirée/suspendue (verrouillage en écriture après grâce).",
      content: { "application/json": { schema: errorSchema } },
    };
  errs["429"] = {
    description:
      "Limite de débit atteinte (rate limiting global / anti-force brute auth).",
    content: { "application/json": { schema: errorSchema } },
  };
  return errs;
}

function buildOperation(doc: RouteDoc) {
  const roleLabel = {
    PUBLIC: "Accès public.",
    AUTH: "Tout utilisateur connecté.",
    ADMIN: "Rôle ADMIN requis (+ licence active en écriture).",
    SA: "SUPER_ADMIN éditeur requis.",
  }[doc.role];
  const params = (doc.params ?? []).map((p) => ({
    name: p.name,
    in: p.in,
    required: p.in === "path" ? true : (p.required ?? false),
    schema: { type: "string" },
    description:
      [p.type, p.description].filter(Boolean).join(" — ") || undefined,
  }));
  const op: Record<string, unknown> = {
    operationId: `${doc.method}_${doc.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    tags: [doc.tag],
    summary: doc.summary,
    description: roleLabel,
    parameters: params.length ? params : undefined,
    responses: {
      [doc.created === true ? "201" : "200"]: {
        description: "Succès.",
        content:
          doc.returns === "text/csv"
            ? { "text/csv": { schema: { type: "string" } } }
            : {
                "application/json": {
                  schema: { type: "object", description: doc.returns ?? "" },
                },
              },
      },
      ...errorResponses(doc.role, doc.errors),
    },
    security: doc.role === "PUBLIC" ? [] : [{ bearerAuth: [] }],
  };
  if (doc.body === "csv") {
    op.requestBody = {
      required: true,
      content: {
        "text/csv": {
          schema: { type: "string" },
          example:
            "Nom;Catégorie;Code-barres;Prix achat;Prix vente;Unité;Seuil alerte\nEau 1.5L;Boissons;6001;200;400;Pce;5",
        },
      },
    };
  } else if (doc.body) {
    op.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(doc.body).map(([k, v]) => [
                k,
                { type: "string", description: v },
              ]),
            ),
          },
        },
      },
    };
  }
  return op;
}

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const doc of ROUTES) {
    paths[doc.path] ??= {};
    paths[doc.path]![doc.method] = buildOperation(doc);
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "StockMan API",
      version: "2.0.0",
      description:
        "SaaS multi-tenant de gestion de dépôts, de stock et de caisse (Cameroun / CEMAC).\n\n" +
        "**Authentification** : jeton d’accès JWT court (10 min, en-tête `Authorization: Bearer …`) " +
        "+ cookie `refresh_token` httpOnly rotatif (7 j). Les vendeurs se connectent à la caisse par PIN.\n\n" +
        "**Multi-tenant** : chaque requête est bornée au tenant du jeton (isolation stricte).\n\n" +
        "**Hors-ligne** : la caisse fonctionne sans réseau ; les ventes sont rejouées avec `clientSaleId` " +
        "(idempotence serveur — aucun doublon possible).\n\n" +
        '**Erreurs** : `{ "error": { "code", "message", "details?" }, "requestId" }` — messages utilisables en français directement dans l’UI.',
      contact: { name: "Éditeur StockMan" },
    },
    servers: [{ url: "/", description: "Même origine (nginx reverse proxy)" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Jeton d’accès (10 min) obtenu via /api/auth/login, /api/auth/pin ou /api/auth/refresh.",
        },
      },
      schemas: { Error: errorSchema },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}
