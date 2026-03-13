import { create } from 'zustand';
import { db } from '@/lib/db';
import { Product, Category, Unit } from '@/types';

interface StockState {
  products: Product[];
  categories: Category[];
  units: Unit[];
  isLoading: boolean;
  fetchStockData: (tenantId: string) => Promise<void>;
  addProduct: (product: Product) => Promise<void>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addCategory: (category: Category) => Promise<void>;
  addUnit: (unit: Unit) => Promise<void>;
}

export const useStockStore = create<StockState>((set) => ({
  products: [],
  categories: [],
  units: [],
  isLoading: false,
  fetchStockData: async (tenantId) => {
    set({ isLoading: true });
    try {
      const [products, categories, units] = await Promise.all([
        db.products.where('tenantId').equals(tenantId).toArray(),
        db.categories.where('tenantId').equals(tenantId).toArray(),
        db.units.where('tenantId').equals(tenantId).toArray(),
      ]);
      set({ products, categories, units, isLoading: false });
    } catch (error) {
      console.error("Error fetching stock data:", error);
      set({ isLoading: false });
    }
  },
  addProduct: async (product) => {
    await db.products.add(product);
    set((state) => ({ products: [...state.products, product] }));
  },
  updateProduct: async (id, updates) => {
    await db.products.update(id, updates);
    set((state) => ({
      products: state.products.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  },
  deleteProduct: async (id) => {
    await db.products.delete(id);
    set((state) => ({ products: state.products.filter((p) => p.id !== id) }));
  },
  addCategory: async (category) => {
    await db.categories.add(category);
    set((state) => ({ categories: [...state.categories, category] }));
  },
  addUnit: async (unit) => {
    await db.units.add(unit);
    set((state) => ({ units: [...state.units, unit] }));
  },
}));
