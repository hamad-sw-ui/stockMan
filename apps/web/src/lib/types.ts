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
  selling_price: number;
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
  category_name: string | null;
  variants: Array<{
    id: string;
    name: string;
    sku: string | null;
    barcode: string | null;
    additionalPrice: number;
  }>;
}

export interface PosBootstrap {
  serverTime: string;
  depotId: string;
  products: BootstrapProduct[];
  levels: StockLevel[];
  units: Unit[];
  categories: Array<{ id: string; name: string }>;
  favorites: string[];
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
  tenant: { name: string; phone: string | null; currency: string };
  lines: Array<{
    label: string;
    qty: number;
    unit: string;
    unitPrice: number;
    total: number;
  }>;
  text: string;
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
  status: "PENDING" | "RECEIVED" | "CANCELLED";
  created_by_name: string | null;
  created_at: string;
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
