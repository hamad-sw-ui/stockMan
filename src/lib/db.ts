import Dexie, { Table } from 'dexie';
import type { 
  User, Depot, Product, Sale, Supplier, AuditLog, 
  Tenant, License, PluginManifest, Unit, Category, SystemNotification 
} from '@/types';

// Configuration de la base de données IndexedDB (Phase 2 : v0.7)
class StockManDatabase extends Dexie {
  tenants!: Table<Tenant>;
  licenses!: Table<License>;
  users!: Table<User>;
  depots!: Table<Depot>;
  products!: Table<Product>;
  sales!: Table<Sale>;
  suppliers!: Table<Supplier>;
  auditLogs!: Table<AuditLog>;
  modules!: Table<PluginManifest>; // Table 9
  units!: Table<Unit>;           // Table 10
  categories!: Table<Category>;   // Table 11
  notifications!: Table<SystemNotification>; // Table 12

  constructor() {
    super('StockManDB'); // Renommé pour marquer la transition
    
    this.version(4).stores({
      tenants: 'id, subdomain, isActive',
      licenses: 'id, tenantId, status',
      users: 'id, tenantId, email, role, depotId, isActive, [tenantId+pinCode]',
      depots: 'id, tenantId, ownerId, isActive',
      products: 'id, tenantId, depotId, name, categoryId, barcode, unitId, hasVariants',
      sales: 'id, tenantId, depotId, vendorId, createdAt',
      suppliers: 'id, tenantId, depotId, name',
      auditLogs: 'id, tenantId, userId, timestamp, entity',
      modules: 'id, name, version, isActive',
      units: 'id, tenantId, name, symbol, isBase',
      categories: 'id, tenantId, name',
      notifications: 'id, tenantId, userId, type, isRead, createdAt'
    });
  }
}

export const db = new StockManDatabase();

// ... (logAction reste identique, initializeDatabase sera mis à jour au besoin)
export async function logAction(
  userId: string,
  userName: string,
  action: string,
  entity: string,
  entityId: string,
  details: string,
  tenantId: string,
  depotId?: string,
  previousState?: any,
  newState?: any
) {
  const log: AuditLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    tenantId,
    userId,
    userName,
    action,
    entity,
    entityId,
    details,
    previousState,
    newState,
    timestamp: new Date(),
    depotId
  };

  await db.auditLogs.add(log);
}

export async function initializeDatabase() {
  const tenantCount = await db.tenants.count();
  if (tenantCount === 0) {
    // Initialisation identique à la phase 1 mais adaptée au nouveau schéma si besoin
    const defaultTenant: Tenant = {
      id: 'tenant-001',
      name: 'Groupe Commercial Alpha',
      isActive: true,
      createdAt: new Date()
    };
    await db.tenants.add(defaultTenant);
    
    // Ajout d'utilisateurs de démonstration
    await db.users.bulkAdd([
      {
        id: 'user-admin-01',
        tenantId: 'tenant-001',
        email: 'admin@depot.cm',
        name: 'Propriétaire Alpha',
        role: 'ADMIN',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'user-vendor-01',
        tenantId: 'tenant-001',
        email: 'vendeur@depot.cm',
        name: 'Vendeur de Jour',
        role: 'VENDEUR',
        pinCode: '1234', // Code PIN de démo
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
    
    // Ajout d'unités (Phase 3)
    await db.units.bulkAdd([
      { id: 'u1', tenantId: 'tenant-001', name: 'Pièce', symbol: 'Pce', baseValue: 1, isBase: true },
      { id: 'u2', tenantId: 'tenant-001', name: 'Carton (x24)', symbol: 'Ctn', baseValue: 24, isBase: false }
    ]);

    // Ajout de catégories
    await db.categories.bulkAdd([
      { id: 'cat1', tenantId: 'tenant-001', name: 'Boissons' },
      { id: 'cat2', tenantId: 'tenant-001', name: 'Alimentaire' }
    ]);

    // Ajout d'un produit complexe (Phase 3)
    await db.products.add({
      id: 'p1',
      tenantId: 'tenant-001',
      depotId: 'depot-001',
      name: 'Eau Minérale Tangui',
      description: 'Eau minérale naturelle 1.5L',
      categoryId: 'cat1',
      unitId: 'u1',
      purchasePrice: 250,
      sellingPrice: 400,
      quantity: 120,
      minStockLevel: 50,
      hasVariants: true,
      variants: [
        { id: 'v1', productId: 'p1', name: 'Format 1.5L', additionalPrice: 0, quantity: 80, attributes: { size: '1.5L' } },
        { id: 'v2', productId: 'p1', name: 'Format 0.5L', additionalPrice: -150, quantity: 40, attributes: { size: '0.5L' } }
      ],
      batches: [
        { id: 'b1', productId: 'p1', batchNumber: 'LOT-2026-001', quantity: 100, expiryDate: new Date('2027-12-31'), receivedDate: new Date() }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log('Base de données StockMan v1.0 (Phase 3) initialisée');
  }
}