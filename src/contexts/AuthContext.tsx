import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User, Tenant, License, LoginCredentials, AuthState } from '@/types';
import * as authLib from '@/lib/auth';
import { initializeDatabase } from '@/lib/db';

interface AuthContextType extends AuthState {
  license: License | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  loginWithPin: (pin: string, tenantId: string) => Promise<void>;
  logout: () => void;
  hasRole: (role: User['role']) => boolean;
  hasModule: (moduleId: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    tenant: null,
    isAuthenticated: false,
    token: null
  });
  const [license, setLicense] = useState<License | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const navigate = useNavigate();

  const handleAuthRedirect = (role: User['role']) => {
    if (role === 'SUPER_ADMIN') {
      navigate('/superadmin/dashboard');
    } else if (role === 'ADMIN') {
      navigate('/admin/dashboard');
    } else if (role === 'VENDEUR') {
      navigate('/vendor/dashboard');
    }
  };

  useEffect(() => {
    async function initialize() {
      try {
        // 1. Initialiser la base de données (Multi-tenant)
        await initializeDatabase();
        console.log("✅ Base de données initialisée avec succès");

        // 2. Restaurer la session
        const user = authLib.getCurrentUser();
        const tenant = authLib.getCurrentTenant();
        const token = authLib.getAuthToken();
        const savedLicense = authLib.getCurrentLicense();

        if (user && tenant && token) {
          setAuthState({ user, tenant, isAuthenticated: true, token });
          setLicense(savedLicense);
          
          // 3. Démarrer le service de licence si authentifié
          authLib.startLicenseCheckService();
        }
      } catch (error) {
        console.error("❌ Erreur critique d'initialisation :", error);
        // Tentative de secours : vider le cache si la DB est corrompue
        if (error instanceof Error && error.message.includes('VersionError')) {
          console.warn("Version de base de données incompatible détectée. Réinitialisation...");
          localStorage.clear();
          indexedDB.deleteDatabase('StockManDB');
        }
      } finally {
        setIsInitialized(true);
      }
    }

    initialize();
  }, []);

  const login = async (credentials: LoginCredentials) => {
    const result = await authLib.login(credentials);
    const savedLicense = authLib.getCurrentLicense();
    
    setAuthState(result);
    setLicense(savedLicense);
    authLib.startLicenseCheckService();

    if (result.user) {
      handleAuthRedirect(result.user.role);
    }
  };

  const loginWithPin = async (pin: string, tenantId: string) => {
    const result = await authLib.loginWithPin(pin, tenantId);
    const savedLicense = authLib.getCurrentLicense();
    
    setAuthState(result);
    setLicense(savedLicense);
    authLib.startLicenseCheckService();

    if (result.user) {
      handleAuthRedirect(result.user.role);
    }
  };

  const logout = () => {
    authLib.logout();
    setAuthState({
      user: null,
      tenant: null,
      isAuthenticated: false,
      token: null
    });
    setLicense(null);
    navigate('/login');
  };

  const hasRole = (role: User['role']) => {
    return authLib.hasRole(role);
  };

  const hasModule = (moduleId: string) => {
    return license?.activeModules.includes(moduleId) || false;
  };

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 font-medium">Chargement du système StockMan...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ ...authState, license, login, loginWithPin, logout, hasRole, hasModule }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth doit être utilisé dans un AuthProvider');
  }
  return context;
}