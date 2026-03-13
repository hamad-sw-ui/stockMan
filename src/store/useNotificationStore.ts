import { create } from 'zustand';
import { db } from '@/lib/db';
import { SystemNotification } from '@/types';

interface NotificationState {
  notifications: SystemNotification[];
  unreadCount: number;
  isLoading: boolean;
  fetchNotifications: (tenantId: string) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  fetchNotifications: async (tenantId) => {
    set({ isLoading: true });
    const notifications = await db.notifications
      .where('tenantId')
      .equals(tenantId)
      .reverse()
      .sortBy('createdAt');
    const unreadCount = notifications.filter((n) => !n.isRead).length;
    set({ notifications, unreadCount, isLoading: false });
  },
  markAsRead: async (id) => {
    await db.notifications.update(id, { isRead: true });
    set((state) => ({
      notifications: state.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      unreadCount: state.unreadCount - 1,
    }));
  },
}));
