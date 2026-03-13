import { create } from 'zustand';

interface UIState {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  primaryColor: string;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleSidebar: () => void;
  setPrimaryColor: (color: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'light',
  sidebarCollapsed: false,
  primaryColor: '#10B981',
  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setPrimaryColor: (color) => set({ primaryColor: color }),
}));
