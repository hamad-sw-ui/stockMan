import { db } from './db';
import { getTenantLicense, isLicenseValid, markLicenseAsVerified } from './licenses';
import type { User, LoginCredentials, AuthState, Tenant, License } from '@/types';

// Simulation d'authentification JWT avec support Multi-tenant
const AUTH_TOKEN_KEY = 'depot_auth_token';
const AUTH_USER_KEY = 'depot_auth_user';
const AUTH_TENANT_KEY = 'depot_auth_tenant';
const AUTH_LICENSE_KEY = 'depot_auth_license';

// Mots de passe de démonstration
const DEMO_PASSWORDS: Record<string, string> = {
  'superadmin@depot.cm': 'super123',
  'admin@depot.cm': 'admin123'
};

export async function login(credentials: LoginCredentials): Promise<AuthState> {
  const { email, password } = credentials;

  // 1. Vérifier le mot de passe
  if (DEMO_PASSWORDS[email] !== password) {
    throw new Error('Email ou mot de passe incorrect');
  }

  // 2. Récupérer l'utilisateur
  const user = await db.users.where('email').equals(email).first();

  if (!user || !user.isActive) {
    throw new Error('Utilisateur non trouvé ou inactif');
  }

  return finalizeLogin(user);
}

/**
 * Authentification rapide par code PIN pour les vendeurs (Phase 2)
 */
export async function loginWithPin(pin: string, tenantId: string): Promise<AuthState> {
  // Recherche de l'utilisateur par PIN au sein du tenant
  const user = await db.users
    .where({ tenantId, pinCode: pin })
    .first();

  if (!user || !user.isActive) {
    throw new Error('Code PIN incorrect ou compte désactivé');
  }

  return finalizeLogin(user);
}

/**
 * Finalise le processus de connexion, stocke les infos et retourne l'état
 */
async function finalizeLogin(user: User): Promise<AuthState> {
  // 3. Charger le Tenant et la Licence
  const tenant = await db.tenants.get(user.tenantId);
  const license = await getTenantLicense(user.tenantId);

  if (!tenant || !tenant.isActive) {
    throw new Error('Votre organisation est désactivée');
  }

  // 4. Vérifier la licence
  if (license && !isLicenseValid(license)) {
    console.warn('Attention : Licence expirée ou invalide');
  }

  // 5. Générer le token et stocker
  const token = btoa(JSON.stringify({ userId: user.id, tenantId: user.tenantId, role: user.role }));

  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  localStorage.setItem(AUTH_TENANT_KEY, JSON.stringify(tenant));
  localStorage.setItem(AUTH_LICENSE_KEY, JSON.stringify(license));

  return {
    user,
    tenant,
    isAuthenticated: true,
    token
  };
}

/**
 * Service de vérification périodique de la licence (chaque heure).
 */
export async function startLicenseCheckService() {
  setInterval(async () => {
    const user = getCurrentUser();
    if (!user) return;

    const license = await getTenantLicense(user.tenantId);
    if (license) {
      const isValid = isLicenseValid(license);
      await markLicenseAsVerified(license.id);
      
      if (!isValid) {
        console.error('ALERTE : La licence a expiré. Certaines fonctions seront restreintes.');
        // Ici, on pourrait déclencher un événement global ou un Toast
      }
    }
  }, 60 * 60 * 1000); // 1 heure
}

export function logout(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_TENANT_KEY);
  localStorage.removeItem(AUTH_LICENSE_KEY);
}

export function getCurrentUser(): User | null {
  const userJson = localStorage.getItem(AUTH_USER_KEY);
  return userJson ? JSON.parse(userJson) : null;
}

export function getCurrentTenant(): Tenant | null {
  const tenantJson = localStorage.getItem(AUTH_TENANT_KEY);
  return tenantJson ? JSON.parse(tenantJson) : null;
}

export function getCurrentLicense(): License | null {
  const licenseJson = localStorage.getItem(AUTH_LICENSE_KEY);
  return licenseJson ? JSON.parse(licenseJson) : null;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAuthToken() && !!getCurrentUser();
}

export function hasRole(requiredRole: User['role']): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  return user.role === 'SUPER_ADMIN' || user.role === requiredRole;
}