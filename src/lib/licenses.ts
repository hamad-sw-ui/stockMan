import { db } from './db';
import { License } from '@/types';

/**
 * Récupère la licence active pour un tenant donné.
 */
export async function getTenantLicense(tenantId: string): Promise<License | null> {
  const license = await db.licenses.where('tenantId').equals(tenantId).first();
  return license || null;
}

/**
 * Vérifie si une licence est valide (statut ACTIVE et date non expirée).
 */
export function isLicenseValid(license: License): boolean {
  if (!license) return false;
  
  const now = new Date();
  const isStatusActive = license.status === 'ACTIVE' || license.status === 'TRIAL';
  const isNotExpired = new Date(license.endDate) > now;
  
  return isStatusActive && isNotExpired;
}

/**
 * Met à jour la date de dernière vérification de la licence.
 */
export async function markLicenseAsVerified(licenseId: string) {
  await db.licenses.update(licenseId, {
    lastVerifiedAt: new Date()
  });
}

/**
 * Vérifie si le tenant a accès à un module spécifique.
 */
export function hasModuleAccess(license: License, moduleId: string): boolean {
  if (!license || !isLicenseValid(license)) return false;
  return license.activeModules.includes(moduleId);
}
