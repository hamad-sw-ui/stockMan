/** Formatters fr-FR : monnaie FCFA, quantités, dates, relatif, libellés métier. */
import { describe, expect, it, vi } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatQty,
  formatRelative,
  movementTypeLabel,
  notificationTypeLabel,
  paymentMethodLabel,
  stockStatusLabel,
} from "../src/lib/format";

describe("formatMoney", () => {
  it("formate en FCFA fr-FR sans décimales superflues", () => {
    // Tolère espace fine insécable (fr-FR) : on normalise tous les espaces
    expect(formatMoney(12500).replace(/[\s\u202f\u00a0]/g, " ")).toBe(
      "12 500 FCFA",
    );
    expect(formatMoney(0).replace(/[\s\u202f\u00a0]/g, " ")).toBe("0 FCFA");
  });
  it("gère null/undefined/NaN", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
  });
  it("respecte la devise passée", () => {
    expect(formatMoney(1000, "XAF")).toContain("XAF");
  });
  it("arrondit les décimales au besoin", () => {
    expect(formatMoney(99.5).replace(/[\s\u202f\u00a0]/g, " ")).toBe(
      "99,5 FCFA",
    );
  });
});

describe("formatQty", () => {
  it("supprime les zéros superflus", () => {
    expect(formatQty(24)).toBe("24");
    expect(formatQty(12.5)).toBe("12,5");
  });
  it("gère les valeurs nulles", () => {
    expect(formatQty(null)).toBe("—");
  });
});

describe("dates", () => {
  it("formatDate jj/mm/aaaa", () => {
    expect(formatDate("2026-08-02T13:45:00.000Z")).toMatch(/^02\/08\/2026$/);
  });
  it("formatDateTime ajoute l’heure", () => {
    expect(formatDateTime("2026-08-02T13:45:00.000Z")).toMatch(
      /^02\/08\/2026 \d{2}:\d{2}$/,
    );
  });
  it("valeurs invalides → tiret", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime("invalide")).toBe("—");
  });
});

describe("formatRelative", () => {
  it("à l’instant / minutes / heures / jours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00Z"));
    expect(formatRelative(new Date("2026-08-02T11:59:50Z"))).toBe(
      "à l'instant",
    );
    expect(formatRelative(new Date("2026-08-02T11:30:00Z"))).toBe(
      "il y a 30 min",
    );
    expect(formatRelative(new Date("2026-08-02T09:00:00Z"))).toBe("il y a 3 h");
    expect(formatRelative(new Date("2026-08-01T12:00:00Z"))).toBe("hier");
    expect(formatRelative(new Date("2026-07-28T12:00:00Z"))).toBe("il y a 5 j");
    vi.useRealTimers();
  });
});

describe("libellés métier", () => {
  it("paiements", () => {
    expect(paymentMethodLabel("CASH")).toBe("Espèces");
    expect(paymentMethodLabel("MTN_MOMO")).toBe("MTN MoMo");
    expect(paymentMethodLabel("ORANGE_MONEY")).toBe("Orange Money");
    expect(paymentMethodLabel("X")).toBe("X");
  });
  it("mouvements", () => {
    expect(movementTypeLabel("IN")).toBe("Entrée");
    expect(movementTypeLabel("SALE")).toBe("Vente");
    expect(movementTypeLabel("VOID")).toBe("Annulation");
  });
  it("notifications & stock", () => {
    expect(notificationTypeLabel("LOW_STOCK")).toBe("Stock bas");
    expect(stockStatusLabel("out")).toBe("Rupture");
    expect(stockStatusLabel("low")).toBe("Stock bas");
  });
});
