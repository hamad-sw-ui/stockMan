import cron from "node-cron";
import { query } from "../config/db";
import { getEnv } from "../config/env";
import { logger } from "../lib/logger";
import {
  sendDailyReport,
  sendExpiryAlerts,
  sendLowStockAlerts,
} from "./notificationService";

/**
 * Tâches planifiées (corrige BCK-07) :
 *  - verrou par advisory lock PostgreSQL (multi-instance safe ; repli gracieux
 *    si la fonction n'existe pas, ex. pg-mem en tests) ;
 *  - dédup exactly-once via `notifications.dedupe_key` (pas de spam) ;
 *  - rapport journalier déclenché à l'heure locale configurée PAR tenant.
 */
const LOCK_ID = 727272;

async function withLock<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    const r = await query("SELECT pg_try_advisory_lock($1) AS got", [LOCK_ID]);
    if (!r.rows[0]?.got) return null;
  } catch {
    // pg-mem / environnements sans advisory locks : on continue sans verrou.
  }
  try {
    return await fn();
  } finally {
    await query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(
      () => undefined,
    );
  }
}

async function forEachActiveTenant(fn: (tenantId: string) => Promise<void>) {
  const tenants = await query<{ id: string }>(
    "SELECT id FROM tenants WHERE is_active = TRUE",
  );
  for (const t of tenants.rows) {
    try {
      await fn(t.id);
    } catch (err) {
      logger.error("Job tenant échoué", {
        tenantId: t.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

const lastDailyCheck: Record<string, string> = {};

export function startScheduler(): void {
  if (!getEnv().ENABLE_SCHEDULER) {
    logger.info("Planificateur désactivé (ENABLE_SCHEDULER=false).");
    return;
  }
  logger.info("🕒 Planificateur initialisé");

  // Chaque heure : alertes stock bas
  cron.schedule("0 * * * *", () => {
    void withLock(() => forEachActiveTenant(sendLowStockAlerts));
  });

  // Chaque jour 08:00 : péremptions proches
  cron.schedule("0 8 * * *", () => {
    void withLock(() => forEachActiveTenant(sendExpiryAlerts));
  });

  // Toutes les 5 min : rapport journalier à l'heure configurée par tenant
  cron.schedule("*/5 * * * *", () => {
    void withLock(async () => {
      const rows = await query<{
        tenant_id: string;
        daily_report_time: string;
        daily_report_enabled: boolean;
        timezone?: string;
      }>(
        `SELECT ns.tenant_id, ns.daily_report_time, ns.daily_report_enabled, t.timezone
           FROM notification_settings ns JOIN tenants t ON t.id = ns.tenant_id
          WHERE ns.daily_report_enabled = TRUE AND t.is_active = TRUE`,
      );
      for (const row of rows.rows) {
        if (!row.daily_report_enabled) continue;
        const confT = row.timezone ?? "Africa/Douala";
        const local = new Date().toLocaleTimeString("fr-FR", {
          timeZone: confT,
          hour12: false,
        });
        const [wantH, wantM] = String(row.daily_report_time)
          .split(":")
          .map(Number);
        const [nowH, nowM] = local.split(":").map(Number);
        const want = (wantH ?? 20) * 60 + (wantM ?? 0);
        const now = (nowH ?? 0) * 60 + (nowM ?? 0);
        const dateKey = new Date().toLocaleDateString("fr-CA", {
          timeZone: confT,
        });
        const marker = `${row.tenant_id}:${dateKey}`;
        if (
          Math.abs(now - want) <= 4 &&
          lastDailyCheck[row.tenant_id] !== marker
        ) {
          lastDailyCheck[row.tenant_id] = marker;
          await sendDailyReport(row.tenant_id).catch((err) =>
            logger.error("Rapport journalier échoué", {
              tenantId: row.tenant_id,
              message: String(err),
            }),
          );
        }
      }
    });
  });

  // Purge hebdomadaire (dimanche 03:00) : refresh tokens expirés, notifications > 90 j
  cron.schedule("0 3 * * 0", () => {
    void withLock(async () => {
      await query(
        "DELETE FROM refresh_tokens WHERE expires_at < now() - INTERVAL '1 day'",
      );
      await query(
        "DELETE FROM notifications WHERE created_at < now() - INTERVAL '90 days'",
      );
      logger.info("Purge hebdomadaire effectuée");
    });
  });
}
