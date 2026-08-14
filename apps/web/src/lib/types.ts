/** Types partagés des réponses API (camelCase côté contrats, snake_case toléré
 *  sur certaines ressources brutes SQL — d'où les unions). */

export type PaymentMethod = "CASH" | "MTN_MOMO" | "ORANGE_MONEY";

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  product_count?: number;
}

export interface Unit {
  id: string;
  name: string;
  symbol: string;
  base_value: number;
  is_base: boolean;
}

export interface Depot {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  owner_id: string | null;
  owner_name?: string | null;
  is_active: boolean;
  user_count?: number;
}

export interface Supplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  receipt_count?: number;
  default_lead_time_days?: number; // délai d'approvisionnement habituel (E4)
}

export interface Variant {
  id: string;
  product_id?: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  additional_price: number;
  additionalPrice?: number;
  attributes?: Record<string, string> | null;
}

export interface Batch {
  id: string;
  product_id: string;
  depot_id: string;
  depot_name?: string;
  supplier_id: string | null;
  supplier_name?: string | null;
  batch_number: string;
  quantity: number;
  expiry_date: string | null;
  received_date: string;
}

export interface StockLevel {
  product_id: string;
  variant_id: string | null;
  depot_id?: string;
  depot_name?: string;
  variant_name?: string | null;
  quantity: number;
}

export interface ProductListItem {
  id: string;
  name: string;
  description: string | null;
  barcode: string | null;
  purchase_price: number;
  avg_cost?: number; // CUMP (E1) — coût unitaire moyen pondéré réel
  track_batch?: boolean; // gestion par lot obligatoire (E2)
  selling_price: number;
  tax_rate?: number; // TVA en % (E7) — prix catalogue TTC (19,25 / 0 exonéré)
  wholesale_price?: number | null; // prix de GROS TTC (E8) — NULL = pas de grille
  wholesale_min_qty?: number; // quantité seuil d'application du prix de gros (E8)
  requires_serial?: boolean; // sérialisation IMEI / n° de série (E8)
  min_stock_level: number;
  category_id: string | null;
  category_name: string | null;
  has_variants: boolean;
  archived_at: string | null;
  unit_id: string | null;
  unit_symbol: string | null;
  unit_base_value: number | null;
  total_qty: number;
  depot_qty: number;
  variant_count: number;
  stock_status: "ok" | "low" | "out";
}

export interface ProductDetail extends ProductListItem {
  variants: Variant[];
  batches: Batch[];
  levels: StockLevel[];
  recentMovements: Movement[];
}

export interface Movement {
  id: string;
  type: string;
  quantity: number;
  previous_stock: number | null;
  new_stock: number | null;
  reason: string | null;
  reference_id: string | null;
  created_at: string;
  product_id?: string;
  product_name?: string;
  variant_name?: string | null;
  depot_name?: string;
  user_name?: string | null;
}

export interface BootstrapProduct {
  id: string;
  name: string;
  barcode: string | null;
  selling_price: number;
  purchase_price: number;
  min_stock_level: number;
  has_variants: boolean;
  image_url: string | null;
  unit_id: string | null;
  unit_symbol: string | null;
  unit_base_value: number | null;
  /** Produit sérialisé (IMEI) — capture obligatoire des numéros à la vente (E8). */
  requires_serial?: boolean;
  category_name: string | null;
  variants: Array<{
    id: string;
    name: string;
    sku: string | null;
    barcode: string | null;
    additionalPrice: number;
  }>;
}

export interface PosCustomer {
  id: string;
  name: string;
  phone: string | null;
  balance: number;
  credit_limit: number;
}

/** C3 — alias de code-barres chargé dans le bootstrap (résolution au scan,
 *  hors-ligne incluse ; plafond serveur 5 000, sinon lookup en ligne). */
export interface PosBarcodeAlias {
  code: string;
  product_id: string;
  variant_id: string | null;
  unit_id: string | null;
  unit_base_value: number | null;
  unit_symbol: string | null;
}

export interface PosBootstrap {
  serverTime: string;
  depotId: string;
  products: BootstrapProduct[];
  levels: StockLevel[];
  units: Unit[];
  categories: Array<{ id: string; name: string }>;
  favorites: string[];
  customers?: PosCustomer[]; // carnet de dettes sélectionnable hors-ligne (E3)
  barcodes?: PosBarcodeAlias[]; // C3 — alias multi-codes
  /** false = registre > 5 000 alias : la caisse consulte l'API à la volée. */
  barcodesComplete?: boolean;
}

export interface SaleListItem {
  id: string;
  status: "COMPLETED" | "VOIDED";
  total_amount: number;
  payment_method: PaymentMethod;
  payment_reference: string | null;
  created_at: string;
  synced_at: string | null;
  client_sale_id: string | null;
  vendor_name: string;
  depot_name: string;
  line_count: number;
  returned_amount: number;
}

export interface SaleItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  unit_id: string | null;
  quantity: number;
  base_qty: number;
  unit_price: number;
  total_price: number;
  product_name: string;
  variant_name: string | null;
  unit_symbol: string | null;
}

export interface SaleReturnGroup {
  id: string;
  reason: string | null;
  created_at: string;
  created_by_name: string | null;
  items: Array<{
    productName: string;
    variantName: string | null;
    baseQty: number;
    unitPrice: number;
  }>;
}

export interface SaleDetail extends SaleListItem {
  depot_id: string;
  vendor_id: string;
  amount_received: number | null;
  items: SaleItem[];
  returns: SaleReturnGroup[];
}

export interface ReceiptData {
  sale: {
    id: string;
    created_at: string;
    vendor_name: string;
    payment_method: string;
    payment_reference: string | null;
    total_amount: string;
  };
  tenant: {
    name: string;
    phone: string | null;
    currency: string;
    niu?: string | null;
    rccm?: string | null;
    address?: string | null;
    invoice_footer?: string | null;
  };
  lines: Array<{
    label: string;
    qty: number;
    unit: string;
    unitPrice: number;
    total: number;
    taxRate?: number | null;
  }>;
  text: string;
  /** E7 — reçu fiscal : n° de facture, avoirs et ventilation HT/TVA. */
  invoice?: { number: string } | null;
  creditNotes?: Array<{ number: string }>;
  outstanding?: number;
  totals?: { ttc: number; ht: number; vat: number };
}

export interface DashboardData {
  range: { from: string; to: string; timezone: string };
  summary: {
    revenue: number;
    sales_count: number;
    avg_basket: number;
    today_revenue: number;
    voided_count: number;
  };
  series: Array<{ date: string; amount: number; count: number }>;
  topProducts: Array<{ name: string; qty: number; revenue: number }>;
  paymentMix: Array<{ payment_method: string; count: number; amount: number }>;
  lowStockCount: number;
}

export interface VendorRow {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "VENDEUR";
  is_active: boolean;
  depot_id: string | null;
  depot_name: string | null;
  has_pin: boolean;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  channel: string;
  message: string;
  status: "PENDING" | "SENT" | "FAILED" | "READ";
  phone: string | null;
  created_at: string;
  provider_response: string | null;
}

export interface NotificationSettings {
  tenant_id: string;
  alert_phone: string | null;
  alert_whatsapp: string | null;
  low_stock_enabled: boolean;
  expiry_alert_enabled: boolean;
  daily_report_enabled: boolean;
  daily_report_time: string;
}

export interface TenantCurrent {
  id: string;
  name: string;
  subdomain: string | null;
  logo: string | null;
  primary_color: string | null;
  phone: string | null;
  currency: string;
  timezone: string;
  is_active: boolean;
  /** E7 — mentions légales (facturation) */
  niu?: string | null;
  rccm?: string | null;
  address?: string | null;
  invoice_footer?: string | null;
  license: {
    plan_code: string;
    plan_name: string;
    monthly_price: number;
    status: string;
    start_date: string;
    end_date: string;
    max_users: number;
    max_depots: number;
  } | null;
  usage: { users: number; depots: number };
}

export interface Plan {
  code: string;
  name: string;
  max_users: number;
  max_depots: number;
  monthly_price: number;
}

export interface LicenseRow {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  plan_code: string;
  plan_name?: string;
  monthly_price?: number;
  status: "TRIAL" | "ACTIVE" | "EXPIRED" | "SUSPENDED";
  start_date: string;
  end_date: string;
  max_users: number;
  max_depots: number;
  notes: string | null;
}

export interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: string | null;
  previous_state: unknown;
  new_state: unknown;
  created_at: string;
  user_name: string | null;
  user_full_name?: string | null;
  depot_name: string | null;
  tenant_name?: string;
}

export interface TransferRow {
  id: string;
  from_depot: string;
  to_depot: string;
  from_depot_name: string;
  to_depot_name: string;
  note: string | null;
  status: "PENDING" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  created_by_name: string | null;
  created_at: string;
}

/** E8 — ligne de stock EN TRANSIT (transferts ouverts, reliquat valorisé). */
export interface TransitRow {
  itemId: string;
  transferId: string;
  createdAt: string;
  status: string;
  note: string | null;
  fromDepot: string;
  toDepot: string;
  productId: string;
  product: string;
  variantName: string | null;
  shipped: number;
  received: number;
  lost: number;
  discrepancyReason: "DAMAGE" | "LOSS" | null;
  inTransit: number;
  value: number;
}

/** E8 — promotion datée (produit précis ou globale). */
export interface Promotion {
  id: string;
  name: string;
  product_id: string | null;
  product_name: string | null;
  discount_pct: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  created_at: string;
}

/** E8 — ligne d'historique de prix (PATCH produit). */
export interface PriceHistoryEntry {
  id: string;
  field: "DETAIL" | "WHOLESALE";
  old_price: number | null;
  new_price: number | null;
  reason: string | null;
  changed_by_name: string | null;
  created_at: string;
}

/** E8 — numéro de série (IMEI) en stock. */
export interface SerialRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  depot_id: string;
  depot_name: string;
  serial: string;
  status: "IN_STOCK" | "SOLD";
  sold_at: string | null;
}

/** E8 — paramètres produit par dépôt (seuil effectif + rayonnage). */
export interface DepotSettingRow {
  depot_id: string;
  depot_name: string;
  min_stock_level: number | null;
  bin_location: string | null;
  updated_at: string | null;
}

/** E8 — ligne du rapport KPI stock (ABC/rotation/couverture/dormant). */
export interface StockKpiRow {
  product_id: string;
  name: string;
  barcode: string | null;
  unit: string | null;
  current_stock: number;
  reserved: number;
  avg_cost: number;
  stock_value: number;
  qty_sold_90d: number;
  avg_daily: number;
  coverage_days: number;
  turnover_90d: number;
  abc_class: "A" | "B" | "C";
  last_sale_at: string | null;
  days_since_sale: number;
  dormant: boolean;
}
export interface StockKpis {
  totals: {
    stock_value: number;
    references: number;
    dormant_count: number;
    dormant_value: number;
  };
  data: StockKpiRow[];
}

/** E8 — résultat d'import CSV du stock initial. */
export interface StockImportResult {
  receiptId: string | null;
  imported: number;
  errors: Array<{ ligne: number; message: string }>;
}

export interface ReceiptRow {
  id: string;
  reference: string | null;
  note: string | null;
  created_at: string;
  supplier_name: string | null;
  depot_name: string;
  received_by_name: string | null;
  line_count: number;
  total_cost: number;
}

export interface SaTenantRow {
  id: string;
  name: string;
  subdomain: string | null;
  is_active: boolean;
  created_at: string;
  user_count: number;
  depot_count: number;
  revenue: number;
  license: { planCode: string; status: string; endDate: string | null } | null;
}

export interface SaStats {
  tenants: { total: number; active: number; active_users: number };
  revenue: { all_time: number; month: number };
  mrr: number;
  trialsEndingSoon: Array<{ tenant_name: string; end_date: string }>;
  failedNotifications24h: number;
  newTenants30d: number;
  topTenants: Array<{ name: string; revenue: number }>;
}

/* -------------------- Clients & crédit (E3) -------------------- */
export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  balance: number;
  credit_limit: number;
  is_active: boolean;
  created_at: string;
}

export interface CustomerDebt {
  saleId: string;
  date: string | null;
  dueDate: string | null;
  total: number;
  paid: number;
  outstanding: number;
  days: number;
  status: string;
}

export interface CustomerDetail extends Customer {
  aging: { d0_30: number; d31_60: number; d61_90: number; over90: number };
  debts: CustomerDebt[];
  recentPayments: Array<{
    id: string;
    amount: number;
    method: PaymentMethod;
    created_at: string;
    sale_id: string;
  }>;
}

/* ------------------------- Devis (E3) ------------------------- */
export interface QuoteListItem {
  id: string;
  status: "DRAFT" | "CONVERTED" | "CANCELLED";
  total_amount: number;
  note: string | null;
  valid_until: string | null;
  created_at: string;
  customer_id: string | null;
  customer_name: string | null;
  depot_id: string;
  depot_name: string;
  converted_sale_id: string | null;
  line_count: number;
}

export interface QuoteItem {
  id: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_name: string | null;
  unit_id: string | null;
  unit_symbol: string | null;
  quantity: number;
  base_qty: number;
  unit_price: number;
  total_price: number;
}

export interface QuoteDetail extends QuoteListItem {
  created_by_name: string | null;
  items: QuoteItem[];
}

/* -------------------- Approvisionnement (E4) -------------------- */
export type PoStatus =
  "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "CLOSED" | "CANCELLED";

export interface PurchaseOrderListItem {
  id: string;
  status: PoStatus;
  reference: string | null;
  expected_at: string | null;
  close_reason: string | null;
  created_at: string;
  supplier_id: string;
  supplier_name: string;
  depot_id: string;
  depot_name: string;
  created_by_name: string | null;
  line_count: number | null;
  ordered_total: number | null;
  received_total: number | null;
}

export interface PurchaseOrderItem {
  id: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_name: string | null;
  quantity: number;
  received_qty: number;
  remaining_qty: number;
  unit_cost: number;
}

export interface PurchaseOrderDetail extends PurchaseOrderListItem {
  note: string | null;
  first_received_at: string | null;
  closed_at: string | null;
  sent_at: string | null;
  default_lead_time_days: number;
  items: PurchaseOrderItem[];
  receipts_count: number;
  received_value: number;
}

export interface SupplierReturnListItem {
  id: string;
  reason: string;
  note: string | null;
  total_cost: number;
  created_at: string;
  supplier_id: string;
  supplier_name: string;
  depot_name: string;
  created_by_name: string | null;
  line_count: number;
}

export interface SupplierReturnDetail extends SupplierReturnListItem {
  receipt_id: string | null;
  items: Array<{
    id: string;
    product_id: string;
    product_name: string;
    variant_name: string | null;
    batch_number: string | null;
    quantity: number;
    unit_cost: number;
  }>;
}

export interface OtifRow {
  supplier_id: string;
  supplier_name: string;
  orders: number;
  closed_orders: number;
  on_time_rate: number | null;
  in_full_rate: number | null;
  otif_rate: number | null;
  avg_lead_time_days: number | null;
}

/* -------------------- Inventaire physique (E5) -------------------- */
export type CampaignStatus =
  "DRAFT" | "COUNTING" | "REVIEW" | "CLOSED" | "CANCELLED";
export type CampaignScope = "ALL" | "SELECTION" | "ABC_A" | "ABC_B" | "ABC_C";

export interface CampaignListItem {
  id: string;
  status: CampaignStatus;
  scope: CampaignScope;
  blind: boolean;
  freeze_stock: boolean;
  note: string | null;
  depot_id: string;
  depot_name: string;
  started_at: string | null;
  closed_at: string | null;
  created_at: string;
  created_by_name: string | null;
  validated_by_name: string | null;
  line_count: number | null;
  counted: number | null;
}

export interface CampaignCountLine {
  id: string;
  product_id: string;
  product_name: string;
  theoretical_qty: number | null; // null en comptage aveugle
  theoretical_cost: number | null;
  counted_qty: number | null;
  variance_qty: number | null;
  variance_value: number | null;
  reason: string | null;
  counted_by_name: string | null;
  applied: boolean;
}

export interface CampaignDetail {
  id: string;
  status: CampaignStatus;
  scope: CampaignScope;
  blind: boolean;
  freeze_stock: boolean;
  blind_masked: boolean;
  note: string | null;
  depot_id: string;
  depot_name: string;
  created_by_name: string | null;
  validated_by_name: string | null;
  started_at: string | null;
  validated_at: string | null;
  closed_at: string | null;
  created_at: string;
  items: CampaignCountLine[];
  totals: {
    lines: number;
    counted: number;
    discrepancies: number;
    valueUp: number;
    valueDown: number;
  };
}

export interface AbcScheduleRow {
  scope: "ABC_A" | "ABC_B" | "ABC_C";
  class_label: string;
  product_count: number;
  frequency_days: number;
  last_count_at: string | null;
  due_at: string | null;
  overdue: boolean;
}

/* ======================= E6 — Sessions de caisse ========================== */

export type CashSessionStatus = "OPEN" | "CLOSED";

export interface ZMethodLine {
  payments: number;
  expected: number;
  counted: number | null;
  variance: number | null;
}

/** Z de caisse : photographie immuable émise à la clôture de la session. */
export interface ZReport {
  generatedAt: string;
  businessDate: string;
  depotId: string;
  openedAt: string;
  openedBy: string;
  closedBy: string;
  openingFloat: number;
  sales: {
    count: number;
    voided: number;
    totalSold: number;
    totalPaid: number;
    creditOutstanding: number;
  };
  methods: {
    CASH: ZMethodLine;
    MTN_MOMO: ZMethodLine;
    ORANGE_MONEY: ZMethodLine;
  };
  varianceTotal: number;
}

export interface CashSession {
  id: string;
  depotId: string;
  depotName?: string;
  status: CashSessionStatus;
  businessDate: string;
  openedBy: string;
  openedByName?: string;
  openedAt: string;
  openingFloat: number;
  note: string | null;
  closedBy: string | null;
  closedByName?: string | null;
  closedAt: string | null;
  countedCash: number | null;
  countedMtn: number | null;
  countedOm: number | null;
  zReport: ZReport | null;
}

export interface CashSessionCurrent {
  required: boolean;
  session:
    | (CashSession & {
        expected: { CASH: number; MTN_MOMO: number; ORANGE_MONEY: number };
      })
    | null;
}

/** Ligne de configuration tenant (secrets masqués, préférences en clair). */
export interface TenantConfigRow {
  key: string;
  value: string;
  is_secret: boolean;
  masked: boolean;
}

/* ======================= E7 — Facturation & fiscalité ===================== */

export type InvoiceKind = "INVOICE" | "CREDIT_NOTE";

export interface InvoiceListItem {
  id: string;
  depotId: string;
  depotName: string;
  kind: InvoiceKind;
  series: "FAC" | "AV";
  year: number;
  seq: number;
  number: string;
  saleId: string | null;
  parentInvoiceId: string | null;
  parentNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  note: string | null;
  issuedByName: string | null;
  issuedAt: string;
}

export interface InvoiceItem {
  id: string;
  product_id: string | null;
  product_name: string;
  variant_name: string | null;
  unit_symbol: string | null;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  total_ht: number;
  total_vat: number;
  total_ttc: number;
}

export interface TenantLegal {
  name: string;
  phone: string | null;
  niu: string | null;
  rccm: string | null;
  address: string | null;
  invoice_footer: string | null;
  currency: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  items: InvoiceItem[];
  tenant?: TenantLegal;
}

export interface VatJournalRow {
  number: string;
  date: string;
  depot: string;
  kind: InvoiceKind;
  customer: string | null;
  ht: number;
  vat: number;
  ttc: number;
}

export interface VatJournal {
  range: { from: string; to: string; timezone: string };
  rows: VatJournalRow[];
  byRate: Array<{ rate: number; ht: number; vat: number }>;
  totals: { ht: number; vat: number; ttc: number };
}
