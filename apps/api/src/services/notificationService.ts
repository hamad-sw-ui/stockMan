import { query } from "../config/db";
import { getEnv } from "../config/env";
import { toDateStr } from "../lib/dates";
import { logger } from "../lib/logger";

/**
 * Notifications multi-canal (corrige BCK-01 : la version initiale interrogeait
 * une table `configs` inexistante et ne pouvait jamais aboutir).
 * Driver `mock` (console) ou `live` (Africa's Talking / Meta WhatsApp) selon NOTIF_DRIVER.
 */

export interface ProviderResponse {
  ok: boolean;
  detail: unknown;
}

interface SmsProvider {
  name: string;
  send(to: string, message: string): Promise<ProviderResponse>;
}

const mockProvider = (name: string): SmsProvider => ({
  name,
  async send(to, message) {
    logger.info(`[NOTIF MOCK ${name}]`, { to, message: message.slice(0, 160) });
    return { ok: true, detail: { mock: true } };
  },
});

const africaTalkingProvider = (): SmsProvider => ({
  name: "africastalking",
  async send(to, message) {
    const env = getEnv();
    if (!env.AT_API_KEY || !env.AT_USERNAME)
      throw new Error("Clés Africa's Talking absentes");
    const body = new URLSearchParams({
      username: env.AT_USERNAME,
      to,
      message,
      ...(env.AT_SENDER_ID ? { from: env.AT_SENDER_ID } : {}),
    });
    const res = await fetch(
      "https://api.africastalking.com/version1/messaging",
      {
        method: "POST",
        headers: {
          apiKey: env.AT_API_KEY,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
      },
    );
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const recipients =
      (
        data.SMSMessageData as
          { Recipients?: Array<{ status: string }> } | undefined
      )?.Recipients ?? [];
    const ok = res.ok && recipients.some((r) => r.status === "Success");
    return { ok, detail: data };
  },
});

const whatsappProvider = (): SmsProvider => ({
  name: "whatsapp",
  async send(to, message) {
    const env = getEnv();
    if (!env.WA_TOKEN || !env.WA_PHONE_ID)
      throw new Error("Clés WhatsApp absentes");
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${env.WA_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WA_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to.replace(/[^0-9]/g, ""),
          type: "text",
          text: { body: message },
        }),
      },
    );
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return { ok: res.ok && !("error" in data), detail: data };
  },
});

function pickProvider(channel: "SMS" | "WHATSAPP"): SmsProvider {
  if (getEnv().NOTIF_DRIVER === "mock") return mockProvider(channel);
  return channel === "SMS" ? africaTalkingProvider() : whatsappProvider();
}

export type NotificationChannel = "IN_APP" | "SMS" | "WHATSAPP";

export interface NotifyInput {
  tenantId: string;
  channel: NotificationChannel;
  message: string;
  type: string;
  phone?: string | null;
  userId?: string | null;
  /** Clé d'unicité fonctionnelle (exactly-once côté métier). */
  dedupeKey?: string | null;
}

/**
 * Envoie une notification : insertion d'abord (dédup par `dedupeKey`),
 * envoi provider ensuite pour les canaux externes, statut tracé dans
 * `notifications` (+ réponse provider pour le debug).
 */
export async function notify(
  input: NotifyInput,
): Promise<"sent" | "failed" | "deduped"> {
  try {
    const ins = await query<{ id: string }>(
      `INSERT INTO notifications (tenant_id, user_id, phone, type, channel, message, status, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        input.tenantId,
        input.userId ?? null,
        input.phone ?? null,
        input.type,
        input.channel,
        input.message,
        input.dedupeKey ?? null,
      ],
    );
    const id = ins.rows[0]?.id;
    if (!id) return "deduped";

    if (input.channel === "IN_APP") {
      await query(
        `UPDATE notifications SET status='SENT', provider_response=$2 WHERE id=$1`,
        [id, JSON.stringify({ inApp: true })],
      );
      return "sent";
    }
    if (!input.phone) {
      await query(
        `UPDATE notifications SET status='FAILED', provider_response=$2 WHERE id=$1`,
        [id, JSON.stringify({ reason: "destinataire absent" })],
      );
      return "failed";
    }

    try {
      const result = await pickProvider(input.channel).send(
        input.phone,
        input.message,
      );
      await query(
        "UPDATE notifications SET status=$2, provider_response=$3 WHERE id=$1",
        [id, result.ok ? "SENT" : "FAILED", JSON.stringify(result.detail)],
      );
      return result.ok ? "sent" : "failed";
    } catch (err) {
      await query(
        "UPDATE notifications SET status=$2, provider_response=$3 WHERE id=$1",
        [
          id,
          "FAILED",
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        ],
      );
      return "failed";
    }
  } catch (err) {
    logger.error("notify() a échoué", {
      message: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Messages métier (alertes planifiées)

const todayKey = () => new Date().toISOString().slice(0, 10);

export async function sendLowStockAlerts(tenantId: string): Promise<void> {
  const settings = await query(
    "SELECT alert_phone, alert_whatsapp, low_stock_enabled FROM notification_settings WHERE tenant_id=$1",
    [tenantId],
  );
  const cfg = settings.rows[0];
  if (!cfg || !cfg.low_stock_enabled) return;

  // Filtrage du seuil côté application (HAVING non portable sur tous les planificateurs)
  const all = await query<{
    name: string;
    total: number;
    min_stock_level: number;
  }>(
    `SELECT p.name, COALESCE(SUM(sl.quantity),0)::float AS total, p.min_stock_level::float
       FROM products p
       LEFT JOIN stock_levels sl ON sl.product_id = p.id
      WHERE p.tenant_id=$1 AND p.archived_at IS NULL
      GROUP BY p.id, p.name, p.min_stock_level`,
    [tenantId],
  );
  const low = all.rows
    .filter((p) => p.total <= p.min_stock_level)
    .sort((a, b) => a.total - b.total || a.name.localeCompare(b.name))
    .slice(0, 15);
  if (low.length === 0) return;

  const list = low
    .map(
      (p) => `- ${p.name} : ${p.total} restant(s) (seuil ${p.min_stock_level})`,
    )
    .join("\n");
  const message = `⚠️ Alerte stock bas — ${low.length} produit(s) sous le seuil :\n${list}\nConnectez-vous à StockMan pour réapprovisionner.`;

  await notify({
    tenantId,
    channel: "IN_APP",
    type: "LOW_STOCK",
    message,
    dedupeKey: `LOW_STOCK:${todayKey()}`,
  });
  if (cfg.alert_phone) {
    await notify({
      tenantId,
      channel: "SMS",
      phone: cfg.alert_phone,
      type: "LOW_STOCK",
      message,
      dedupeKey: `LOW_STOCK_SMS:${todayKey()}`,
    });
  }
  if (cfg.alert_whatsapp) {
    await notify({
      tenantId,
      channel: "WHATSAPP",
      phone: cfg.alert_whatsapp,
      type: "LOW_STOCK",
      message,
      dedupeKey: `LOW_STOCK_WA:${todayKey()}`,
    });
  }
}

export async function sendExpiryAlerts(tenantId: string): Promise<void> {
  const settings = await query(
    "SELECT alert_whatsapp, alert_phone, expiry_alert_enabled FROM notification_settings WHERE tenant_id=$1",
    [tenantId],
  );
  const cfg = settings.rows[0];
  if (!cfg || !cfg.expiry_alert_enabled) return;

  const cutoff7d = new Date(Date.now() + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const soon = await query<{
    name: string;
    batch_number: string;
    expiry_date: Date;
    quantity: string;
  }>(
    `SELECT p.name, b.batch_number, b.expiry_date, b.quantity
       FROM stock_batches b JOIN products p ON p.id = b.product_id
      WHERE p.tenant_id=$1 AND b.quantity > 0 AND b.expiry_date::date <= $2::date
      ORDER BY b.expiry_date ASC LIMIT 15`,
    [tenantId, cutoff7d],
  );
  if (soon.rows.length === 0) return;

  const list = soon.rows
    .map(
      (r) =>
        `- ${r.name} (lot ${r.batch_number}) : ${parseFloat(String(r.quantity))} u. expire le ${toDateStr(r.expiry_date)}`,
    )
    .join("\n");
  const message = `⏳ Péremptions proches (≤ 7 j) :\n${list}`;
  await notify({
    tenantId,
    channel: "IN_APP",
    type: "EXPIRY",
    message,
    dedupeKey: `EXPIRY:${todayKey()}`,
  });
  if (cfg.alert_whatsapp) {
    await notify({
      tenantId,
      channel: "WHATSAPP",
      phone: cfg.alert_whatsapp,
      type: "EXPIRY",
      message,
      dedupeKey: `EXPIRY_WA:${todayKey()}`,
    });
  }
}

export async function sendDailyReport(tenantId: string): Promise<void> {
  const settings = await query(
    "SELECT alert_whatsapp, alert_phone, daily_report_enabled FROM notification_settings WHERE tenant_id=$1",
    [tenantId],
  );
  const cfg = settings.rows[0];
  if (!cfg || !cfg.daily_report_enabled) return;

  // Minuit local serveur comme borne du jour (paramètre JS : portable)
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const stats = await query<{ revenue: string; count: string }>(
    `SELECT COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END),0) AS revenue,
            COUNT(CASE WHEN status='COMPLETED' THEN 1 END) AS count
       FROM sales WHERE tenant_id=$1 AND created_at >= $2`,
    [tenantId, dayStart],
  );
  const topRows = await query<{ name: string; qty: string }>(
    `SELECT p.name, SUM(si.base_qty) AS qty
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
      WHERE s.tenant_id=$1 AND s.status='COMPLETED' AND s.created_at >= $2
      GROUP BY p.name ORDER BY qty DESC LIMIT 3`,
    [tenantId, dayStart],
  );
  const r = stats.rows[0]!;
  const top = topRows.rows
    .map((t) => `${t.name} ×${parseFloat(String(t.qty))}`)
    .join(", ");
  const message =
    `📊 Rapport du jour :\n` +
    `• Chiffre d'affaires : ${parseFloat(String(r.revenue)).toLocaleString("fr-FR")} FCFA\n` +
    `• Ventes : ${r.count}\n` +
    (top ? `• Top produits : ${top}` : "• Aucune vente aujourd’hui.");
  await notify({
    tenantId,
    channel: "IN_APP",
    type: "DAILY_REPORT",
    message,
    dedupeKey: `DAILY:${todayKey()}`,
  });
  if (cfg.alert_whatsapp) {
    await notify({
      tenantId,
      channel: "WHATSAPP",
      phone: cfg.alert_whatsapp,
      type: "DAILY_REPORT",
      message,
      dedupeKey: `DAILY_WA:${todayKey()}`,
    });
  } else if (cfg.alert_phone) {
    await notify({
      tenantId,
      channel: "SMS",
      phone: cfg.alert_phone,
      type: "DAILY_REPORT",
      message,
      dedupeKey: `DAILY_SMS:${todayKey()}`,
    });
  }
}
