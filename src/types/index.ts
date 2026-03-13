// Types pour l'application de gestion de dépôts

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'VENDEUR';

export interface User {
  id: string;
  tenantId: string; // Ajout pour multi-tenant
  email: string;
  name: string;
  role: UserRole;
  depotId?: string;
  pinCode?: string; // Code PIN pour accès rapide (Phase 2)
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

export interface Depot {
  id: string;
  tenantId: string; // Ajout pour multi-tenant
  name: string;
  address: string;
  phone: string;
  ownerId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  tenantId: string; // Ajout pour multi-tenant
  depotId: string;
  name: string;
  description?: string;
  categoryId: string; // Référence à Category
  barcode?: string;
  purchasePrice: number;
  sellingPrice: number;
  quantity: number;
  minStockLevel: number;
  expirationDate?: Date;
  unitId: string; // Unité de stockage par défaut
  hasVariants: boolean;
  variants?: ProductVariant[];
  batches?: StockBatch[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string; // ex: "Bleu / XL"
  sku?: string;
  barcode?: string;
  additionalPrice: number;
  quantity: number;
  attributes: Record<string, string>; // ex: { color: 'blue', size: 'XL' }
}

export interface StockBatch {
  id: string;
  productId: string;
  variantId?: string;
  batchNumber: string;
  quantity: number;
  expiryDate: Date;
  receivedDate: Date;
  supplierId?: string;
}

export interface Sale {
  id: string;
  tenantId: string; // Ajout pour multi-tenant
  depotId: string;
  vendorId: string;
  vendorName: string;
  items: SaleItem[];
  totalAmount: number;
  paymentMethod: PaymentMethod;
  createdAt: Date;
  syncedAt?: Date;
}

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export type PaymentMethod = 'CASH' | 'MTN_MOMO' | 'ORANGE_MONEY';

export interface Supplier {
  id: string;
  tenantId: string; // Ajout pour multi-tenant
  depotId: string;
  name: string;
  email?: string;
  phone: string;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  tenantId: string; // Ajout pour multi-tenant
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  previousState?: any; // Pour comparaison
  newState?: any;      // Pour comparaison
  details: string;
  timestamp: Date;
  depotId?: string;
}

// --- Nouveaux types pour la Phase 1 ---

export type LicenseStatus = 'ACTIVE' | 'EXPIRED' | 'TRIAL' | 'SUSPENDED';

export interface License {
  id: string;
  tenantId: string;
  planName: string; // Lite, Pro, Enterprise
  status: LicenseStatus;
  startDate: Date;
  endDate: Date;
  lastVerifiedAt: Date;
  maxDepots: number;
  maxUsers: number;
  activeModules: string[]; // Liste des IDs de plugins
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: string[];
  dependencies?: string[];
  entryPoint: string; // Chemin vers le composant principal ou la config
}

export interface Tenant {
  id: string;
  name: string;
  subdomain?: string;
  logo?: string;
  primaryColor?: string;
  isActive: boolean;
  createdAt: Date;
}

export interface Unit {
  id: string;
  tenantId: string;
  name: string;
  symbol: string;
  baseValue: number; // 1 pour l'unité de base
  isBase: boolean;   // Unité de mesure la plus petite
}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
}

export interface SystemNotification {
  id: string;
  tenantId: string;
  userId?: string; // Si vide, s'adresse à tout le tenant
  title: string;
  message: string;
  type: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS';
  isRead: boolean;
  createdAt: Date;
}

// --------------------------------------

export interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  token: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface DashboardStats {
  totalSales: number;
  todaySales: number;
  lowStockCount: number;
  expiredProductsCount: number;
  totalProducts: number;
  totalVendors: number;
}

export interface StockAlert {
  id: string;
  productId: string;
  productName: string;
  currentStock: number;
  minStock: number;
  type: 'LOW_STOCK' | 'EXPIRED' | 'NEAR_EXPIRY';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}