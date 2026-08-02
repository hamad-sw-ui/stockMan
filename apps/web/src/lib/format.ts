/** Formatages locaux (fr-FR) — FCFA sans décimales, dates Douala. */

const moneyFmt = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** 12 500 → « 12 500 FCFA » (espace fine insécable fr-FR). */
export function formatMoney(
  amount: number | null | undefined,
  currency = "FCFA",
): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return `${moneyFmt.format(amount)} ${currency}`;
}

const qtyFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Quantité sans zéros superflus : 24, 12.5 → « 12,5 ». */
export function formatQty(q: number | null | undefined): string {
  if (q == null || Number.isNaN(q)) return "—";
  return qtyFmt.format(q);
}

function toDate(value: Date | string | number): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 02/08/2026 */
export function formatDate(
  value: Date | string | number | null | undefined,
): string {
  if (value == null) return "—";
  const d = toDate(value);
  return d ? d.toLocaleDateString("fr-FR") : "—";
}

/** 02/08/2026 13:45 */
export function formatDateTime(
  value: Date | string | number | null | undefined,
): string {
  if (value == null) return "—";
  const d = toDate(value);
  if (!d) return "—";
  return `${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** « il y a 5 min » / « hier » / date courte */
export function formatRelative(value: Date | string | number): string {
  const d = toDate(value);
  if (!d) return "—";
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.round(h / 24);
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} j`;
  return d.toLocaleDateString("fr-FR");
}

/** Statut de stock présenté à l'utilisateur. */
export function stockStatusLabel(status: "ok" | "low" | "out"): string {
  return status === "ok"
    ? "En stock"
    : status === "low"
      ? "Stock bas"
      : "Rupture";
}

export function paymentMethodLabel(m: string): string {
  switch (m) {
    case "CASH":
      return "Espèces";
    case "MTN_MOMO":
      return "MTN MoMo";
    case "ORANGE_MONEY":
      return "Orange Money";
    default:
      return m;
  }
}

export function movementTypeLabel(t: string): string {
  const map: Record<string, string> = {
    IN: "Entrée",
    OUT: "Sortie",
    TRANSFER: "Transfert",
    ADJUSTMENT: "Ajustement",
    SALE: "Vente",
    RETURN: "Retour",
    DAMAGE: "Casse",
    EXPIRED: "Péremption",
    VOID: "Annulation",
  };
  return map[t] ?? t;
}

export function notificationTypeLabel(t: string): string {
  const map: Record<string, string> = {
    LOW_STOCK: "Stock bas",
    EXPIRY: "Péremption",
    DAILY_REPORT: "Rapport du jour",
    SYSTEM: "Système",
    SYNC_FAILURE: "Échec de synchro",
  };
  return map[t] ?? t;
}
