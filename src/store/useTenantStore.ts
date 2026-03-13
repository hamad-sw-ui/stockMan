import { create } from 'zustand';
import { db } from '@/lib/db';
import { Tenant } from '@/types';

interface TenantState {
  tenants: Tenant[];
  isLoading: boolean;
  fetchTenants: () => Promise<void>;
  addTenant: (tenant: Tenant) => Promise<void>;
  updateTenant: (id: string, updates: Partial<Tenant>) => Promise<void>;
}

export const useTenantStore = create<TenantState>((set) => ({
  tenants: [],
  isLoading: false,
  fetchTenants: async () => {
    set({ isLoading: true });
    const tenants = await db.tenants.toArray();
    set({ tenants, isLoading: false });
  },
  addTenant: async (tenant) => {
    await db.tenants.add(tenant);
    set((state) => ({ tenants: [...state.tenants, tenant] }));
  },
  updateTenant: async (id, updates) => {
    await db.tenants.update(id, updates);
    set((state) => ({
      tenants: state.tenants.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }));
  },
}));
