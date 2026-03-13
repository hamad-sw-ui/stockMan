import { create } from 'zustand';
import { db } from '@/lib/db';
import { AuditLog } from '@/types';

interface AuditState {
  logs: AuditLog[];
  isLoading: boolean;
  fetchLogs: (tenantId: string) => Promise<void>;
  fetchAllLogs: () => Promise<void>;
  clearLogs: (tenantId: string) => Promise<void>;
}

export const useAuditStore = create<AuditState>((set) => ({
  logs: [],
  isLoading: false,
  fetchLogs: async (tenantId) => {
    set({ isLoading: true });
    const logs = await db.auditLogs
      .where('tenantId')
      .equals(tenantId)
      .reverse()
      .sortBy('timestamp');
    set({ logs, isLoading: false });
  },
  fetchAllLogs: async () => {
    set({ isLoading: true });
    const logs = await db.auditLogs
      .reverse()
      .sortBy('timestamp');
    set({ logs, isLoading: false });
  },
  clearLogs: async (tenantId) => {
    await db.auditLogs.where('tenantId').equals(tenantId).delete();
    set({ logs: [] });
  },
}));
