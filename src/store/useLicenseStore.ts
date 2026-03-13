import { create } from 'zustand';
import { db } from '@/lib/db';
import { License } from '@/types';

interface LicenseState {
  licenses: License[];
  license: License | null;
  isLoading: boolean;
  fetchLicense: (tenantId: string) => Promise<void>;
  fetchAllLicenses: () => Promise<void>;
  updateLicense: (id: string, updates: Partial<License>) => Promise<void>;
}

export const useLicenseStore = create<LicenseState>((set) => ({
  licenses: [],
  license: null,
  isLoading: false,
  fetchLicense: async (tenantId) => {
    set({ isLoading: true });
    const license = await db.licenses.where('tenantId').equals(tenantId).first();
    set({ license: license || null, isLoading: false });
  },
  fetchAllLicenses: async () => {
    set({ isLoading: true });
    const licenses = await db.licenses.toArray();
    set({ licenses, isLoading: false });
  },
  updateLicense: async (id, updates) => {
    await db.licenses.update(id, updates);
    set((state) => ({
      licenses: state.licenses.map((l) => (l.id === id ? { ...l, ...updates } : l)),
      license: state.license?.id === id ? { ...state.license, ...updates } : state.license,
    }));
  },
}));
