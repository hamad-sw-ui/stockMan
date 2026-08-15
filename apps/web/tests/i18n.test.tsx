/** I1 — Socle d'internationalisation FR/EN :
 *  - parité stricte des dictionnaires (mêmes clés, aucune valeur vide) ;
 *  - synchronisation de <html lang> et persistance du choix ;
 *  - bascule à chaud d'un composant monté (FR → EN → FR) ;
 *  - formats Intl (monétaire, quantité, relatif, libellés courts).
 *  La langue courante est restaurée en FR après chaque test : les autres
 *  suites assertent les textes français à l'identique (voir setup.ts). */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTranslation } from "react-i18next";
import { i18n, LANG_STORAGE_KEY, setLanguage } from "../src/i18n";
import enResources from "../src/i18n/locales/en.json";
import frResources from "../src/i18n/locales/fr.json";
import { LanguageSwitcher } from "../src/components/Shell";
import {
  formatMoney,
  formatQty,
  formatRelative,
  stockStatusLabel,
} from "../src/lib/format";

/** Liste aplatie des clés feuilles (ex. « shell.nav.products »). */
function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object"
      ? flattenKeys(v as Record<string, unknown>, key)
      : [key];
  });
}

/** Clés dont la valeur est une chaîne vide (interdit : silence UI). */
function blankValues(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object")
      return blankValues(v as Record<string, unknown>, key);
    return typeof v === "string" && v.trim() === "" ? [key] : [];
  });
}

beforeEach(cleanup);
afterEach(async () => {
  cleanup();
  if (!i18n.language.startsWith("fr")) await i18n.changeLanguage("fr");
});

describe("i18n — parité des dictionnaires", () => {
  it("EN et FR exposent exactement le même jeu de clés", () => {
    const frKeys = flattenKeys(frResources).sort();
    const enKeys = flattenKeys(enResources).sort();
    expect(enKeys).toEqual(frKeys);
  });

  it("aucune valeur vide dans les deux langues", () => {
    expect(blankValues(frResources)).toEqual([]);
    expect(blankValues(enResources)).toEqual([]);
  });

  it("la résolution t() ne retombe jamais sur la clé brute", () => {
    expect(i18n.t("common.save")).toBe("Enregistrer");
    expect(i18n.t("shell.nav.products")).toBe("Produits");
  });
});

describe("i18n — bascule de langue", () => {
  it("synchronise <html lang> à chaque changement", async () => {
    await i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
    await i18n.changeLanguage("fr");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("le sélecteur rebascule un libellé monté FR → EN → FR à chaud", async () => {
    function Probe() {
      const { t } = useTranslation();
      return (
        <>
          <LanguageSwitcher />
          <p data-testid="probe">{t("common.save")}</p>
        </>
      );
    }
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("Enregistrer");

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "en" } });
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("Save"),
    );
    expect(document.documentElement.lang).toBe("en");

    fireEvent.change(select, { target: { value: "fr" } });
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("Enregistrer"),
    );
    expect(document.documentElement.lang).toBe("fr");
  });

  it("persiste le choix dans le stockage local", async () => {
    await setLanguage("en");
    expect(globalThis.localStorage.getItem(LANG_STORAGE_KEY)).toBe("en");
    await setLanguage("fr");
    expect(globalThis.localStorage.getItem(LANG_STORAGE_KEY)).toBe("fr");
  });
});

describe("i18n — formats et libellés", () => {
  it("formatMoney/formatQty suivent la locale, la devise reste FCFA", async () => {
    await i18n.changeLanguage("en");
    expect(formatMoney(12500)).toBe("12,500 FCFA");
    expect(formatQty(12.5)).toBe("12.5");
    await i18n.changeLanguage("fr");
    // fr-FR : séparateur de milliers (espace fine insécable selon ICU).
    expect(formatMoney(12500)).toMatch(/^12.500 FCFA$/);
    expect(formatQty(12.5)).toBe("12,5");
  });

  it("les libellés courts et relatifs basculent avec la langue", async () => {
    expect(stockStatusLabel("low")).toBe("Stock bas");
    await i18n.changeLanguage("en");
    expect(stockStatusLabel("low")).toBe("Low stock");
    expect(formatRelative(Date.now() - 5 * 60_000)).toBe("5 min ago");
    await i18n.changeLanguage("fr");
    expect(formatRelative(Date.now() - 5 * 60_000)).toBe("il y a 5 min");
  });
});
