import { create } from 'zustand';
import { db } from '@/lib/db';
import { PluginManifest } from '@/types';

interface ModuleState {
  activeModules: string[];
  isLoading: boolean;
  fetchModules: (tenantId: string) => Promise<void>;
  toggleModule: (tenantId: string, moduleId: string) => Promise<void>;
}

export const useModuleStore = create<ModuleState>((set) => ({
  activeModules: [],
  isLoading: false,
  fetchModules: async (tenantId) => {
    set({ isLoading: true });
    const license = await db.licenses.where('tenantId').equals(tenantId).first();
    set({ activeModules: license?.activeModules || [], isLoading: false });
  },
  toggleModule: async (tenantId, moduleId) => {
    const license = await db.licenses.where('tenantId').equals(tenantId).first();
    if (!license) return;
    
    const newModules = license.activeModules.includes(moduleId)
      ? license.activeModules.filter((m) => m !== moduleId)
      : [...license.activeModules, moduleId];
      
    await db.licenses.update(license.id, { activeModules: newModules });
    set({ activeModules: newModules });
  },
}));
