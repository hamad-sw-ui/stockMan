import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get as httpGet, post as httpPost, refreshSession, setAccessToken } from '../lib/http';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'VENDEUR';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  depotId: string | null;
  tenantId: string;
  impersonated: boolean;
  tenant: {
    id: string;
    name: string;
    logo: string | null;
    primaryColor: string | null;
    currency: string;
    timezone: string;
    isActive: boolean;
  };
  license?: {
    plan_code: string;
    status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
    end_date: string;
    max_users: number;
    max_depots: number;
  } | null;
}

interface LoginResponse {
  accessToken: string;
  user: SessionUser;
}

interface AuthContextValue {
  user: SessionUser | null;
  /** true tant que la session n'est pas restaurée (boot). */
  booting: boolean;
  login(email: string, password: string): Promise<SessionUser>;
  loginWithPin(email: string, pin: string): Promise<SessionUser>;
  register(input: { tenantName: string; userName: string; email: string; password: string; phone?: string }): Promise<SessionUser>;
  logout(): Promise<void>;
  refreshUser(): Promise<void>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isVendor: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SNAPSHOT_KEY = 'stockman.user';

function loadSnapshot(): SessionUser | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

/** Applique la couleur d'entreprise du tenant (personnalisation visuelle). */
function applyTenantTheme(user: SessionUser | null) {
  const color = user?.tenant.primaryColor || '#059669';
  document.documentElement.style.setProperty('--primary', color);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => loadSnapshot());
  const [booting, setBooting] = useState(true);

  const settle = useCallback((u: SessionUser | null) => {
    setUser(u);
    applyTenantTheme(u);
    if (u) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(u));
    else localStorage.removeItem(SNAPSHOT_KEY);
  }, []);

  // Restauration silencieuse de la session au démarrage (cookie refresh)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await refreshSession();
      if (cancelled) return;
      if (ok) {
        try {
          const me = await httpGet<SessionUser>('/auth/me');
          if (!cancelled) settle(me);
        } catch {
          if (!cancelled) settle(null);
        }
      } else {
        settle(null);
      }
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [settle]);

  const finishLogin = useCallback(
    (res: LoginResponse) => {
      setAccessToken(res.accessToken);
      settle(res.user);
      return res.user;
    },
    [settle],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await httpPost<LoginResponse>('/auth/login', { email, password });
      return finishLogin(res);
    },
    [finishLogin],
  );

  const loginWithPin = useCallback(
    async (email: string, pin: string) => {
      const res = await httpPost<LoginResponse>('/auth/pin', { email, pin });
      return finishLogin(res);
    },
    [finishLogin],
  );

  const register = useCallback(
    async (input: { tenantName: string; userName: string; email: string; password: string; phone?: string }) => {
      const res = await httpPost<LoginResponse>('/auth/register', input);
      return finishLogin(res);
    },
    [finishLogin],
  );

  const logout = useCallback(async () => {
    try {
      await httpPost('/auth/logout');
    } catch {
      /* déconnexion locale quand même */
    }
    setAccessToken(null);
    settle(null);
  }, [settle]);

  const refreshUser = useCallback(async () => {
    const me = await httpGet<SessionUser>('/auth/me');
    settle(me);
  }, [settle]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      booting,
      login,
      loginWithPin,
      register,
      logout,
      refreshUser,
      isAdmin: user?.role === 'ADMIN',
      isSuperAdmin: user?.role === 'SUPER_ADMIN',
      isVendor: user?.role === 'VENDEUR',
    }),
    [user, booting, login, loginWithPin, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
