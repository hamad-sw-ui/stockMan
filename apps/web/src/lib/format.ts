/** Formatages locaux — FCFA sans décimales, dates Douala.
 *  I1 : les formateurs Intl sont recréés quand la langue change
 *  (fr-FR ⇄ en-US) ; le FCFA et ses règles métier sont conservés.
 *  Les libellés courts passent par i18n (FR = langue source). */

import { i18n, currentLocale } from "../i18n";

/* Formateurs mémoïsés par langue (re-créés au changement de langue). */
let fmtLang = "";
let moneyFmt = new Intl.NumberFormat("fr-FR");
let qtyFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

function ensureFormatters(): void {
  const loc = currentLocale();
  if (loc === fmtLang) return;
  fmtLang = loc;
  moneyFmt = new Intl.NumberFormat(loc, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  qtyFmt = new Intl.NumberFormat(loc, { maximumFractionDigits: 2 });
}

/** 12 500 → « 12 500 FCFA » (fr) / « 12,500 FCFA » (en). */
export function formatMoney(
  amount: number | null | undefined,
  currency = "FCFA",
): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  ensureFormatters();
  return `${moneyFmt.format(amount)} ${currency}`;
}

/** Quantité sans zéros superflus : 24, 12.5 → « 12,5 » (fr) / « 12.5 » (en). */
export function formatQty(q: number | null | undefined): string {
  if (q == null || Number.isNaN(q)) return "—";
  ensureFormatters();
  return qtyFmt.format(q);
}

function toDate(value: Date | string | number): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 02/08/2026 (fr) / 8/2/2026 (en). */
export function formatDate(
  value: Date | string | number | null | undefined,
): string {
  if (value == null) return "—";
  const d = toDate(value);
  return d ? d.toLocaleDateString(currentLocale()) : "—";
}

/** 02/08/2026 13:45 (fr) / 8/2/2026, 1:45 PM (en). */
export function formatDateTime(
  value: Date | string | number | null | undefined,
): string {
  if (value == null) return "—";
  const d = toDate(value);
  if (!d) return "—";
  const loc = currentLocale();
  return `${d.toLocaleDateString(loc)} ${d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}`;
}

/** « il y a 5 min » / « 5 min ago » / « hier » / date courte */
export function formatRelative(value: Date | string | number): string {
  const d = toDate(value);
  if (!d) return "—";
  const t = (k: string, opts?: Record<string, unknown>) =>
    i18n.t(`format.relative.${k}`, opts);
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return t("justNow");
  if (min < 60) return t("minutes", { count: min });
  const h = Math.round(min / 60);
  if (h < 24) return t("hours", { count: h });
  const days = Math.round(h / 24);
  if (days === 1) return t("yesterday");
  if (days < 7) return t("days", { count: days });
  return d.toLocaleDateString(currentLocale());
}

/** Statut de stock présenté à l'utilisateur. */
export function stockStatusLabel(status: "ok" | "low" | "out"): string {
  return i18n.t(`format.stockStatus.${status}`);
}

export function paymentMethodLabel(m: string): string {
  const key = `format.payment.${m}`;
  return i18n.exists(key) ? i18n.t(key) : m;
}

export function movementTypeLabel(type: string): string {
  const key = `format.movement.${type}`;
  return i18n.exists(key) ? i18n.t(key) : type;
}

export function notificationTypeLabel(type: string): string {
  const key = `format.notification.${type}`;
  return i18n.exists(key) ? i18n.t(key) : type;
}
