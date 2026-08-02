/**
 * Utilitaires de dates côté application (évite les constructions SQL
 * non portables tout en restant exact sur une vraie Postgres).
 */

/** Normalise une valeur date/timestamptz venue du driver en « YYYY-MM-DD ». */
export function toDateStr(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // timestamptz : le driver renvoie déjà en UTC ; la partie date UTC est celle attendue.
  return d.toISOString().slice(0, 10);
}

/**
 * Décalage (heures) entre l'UTC et le fuseau du tenant à un instant donné.
 * Ex. Africa/Douala → +1 (pas d'heure d'été). Utilisé pour cadrer les
 * agrégations « par jour local » : (created_at + (offset || ' hours')::interval)::date
 */
export function tzOffsetHours(tz: string, at: Date = new Date()): number {
  try {
    const local = new Date(at.toLocaleString('en-US', { timeZone: tz }));
    return (local.getTime() - at.getTime()) / 3_600_000;
  } catch {
    return 1; // repli Douala (UTC+1, sans DST)
  }
}

/** Série de dates « YYYY-MM-DD » de `from` à `to` inclus (remplace generate_series). */
export function dateRange(from: string, to: string): string[] {
  const days: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = start.getTime(); d <= end.getTime() && days.length < 400; d += 86_400_000) {
    days.push(new Date(d).toISOString().slice(0, 10));
  }
  return days;
}
