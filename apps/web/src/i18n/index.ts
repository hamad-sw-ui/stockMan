/** I1 — Internationalisation FR/EN (i18next + react-i18next).
 *
 *  - Ressources **bundlées en local** (aucune requête réseau → la caisse
 *    fonctionne hors-ligne).
 *  - Résolution de la langue : `localStorage("stockman.lang")` →
 *    `navigator.language` → repli FR (langue source, jamais modifiée).
 *  - `<html lang>` synchronisé à chaque bascule (accessibilité + SEO).
 *  - Les formateurs Intl de `lib/format.ts` sont recréés au changement
 *    (voir `currentLocale()`).
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const LANG_STORAGE_KEY = "stockman.lang";
export const SUPPORTED = ["fr", "en"] as const;
export type SupportedLang = (typeof SUPPORTED)[number];

/** Langue demandée au démarrage : préférence stockée, sinon navigateur. */
export function detectInitialLang(): SupportedLang {
  try {
    const stored = globalThis.localStorage?.getItem(LANG_STORAGE_KEY);
    if (stored === "fr" || stored === "en") return stored;
  } catch {
    /* stockage indisponible (mode privé) — non bloquant */
  }
  const nav = globalThis.navigator?.language?.slice(0, 2).toLowerCase();
  return nav === "en" ? "en" : "fr";
}

function syncHtmlLang(lng: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng.startsWith("en") ? "en" : "fr";
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: detectInitialLang(),
  fallbackLng: "fr",
  interpolation: { escapeValue: false }, // React échappe déjà
  returnEmptyString: false,
});

syncHtmlLang(i18n.language);
i18n.on("languageChanged", syncHtmlLang);

/** Locale Intl associée à la langue courante (fr-FR ⇄ en-US). */
export function currentLocale(): string {
  return i18n.language?.startsWith("en") ? "en-US" : "fr-FR";
}

/** Bascule de langue persistée (topbar, paramètres, login). */
export async function setLanguage(lng: SupportedLang): Promise<void> {
  try {
    globalThis.localStorage?.setItem(LANG_STORAGE_KEY, lng);
  } catch {
    /* non bloquant */
  }
  await i18n.changeLanguage(lng);
}

export default i18n;
/** Export nommé d'appoint (format.ts, tests) — même instance. */
export { i18n };
