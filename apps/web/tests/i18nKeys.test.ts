/** Garde-fou « clés utilisées = clés existantes » :
 *  toute clé littérale passée à `t("…")` / `t('…')` / `i18nKey="…"` dans
 *  `src/` doit exister à la fois dans `fr.json` et `en.json` (la parité
 *  stricte est déjà testée par `i18n.test.tsx`). Sans cela, une clé mal
 *  préfixée ou manquante s'affiche brute à l'écran (bug F2). */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import fr from "../src/i18n/locales/fr.json";
import en from "../src/i18n/locales/en.json";

function flatten(obj: Record<string, unknown>, prefix = ""): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") {
      for (const leaf of flatten(v as Record<string, unknown>, key)) out.add(leaf);
    } else {
      out.add(key);
    }
  }
  return out;
}

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) out = out.concat(walk(p));
    else if ([".ts", ".tsx"].includes(extname(f))) out.push(p);
  }
  return out;
}

/** Extrait les clés littérales (non interpolées) passées à t()/i18nKey. */
function usedLiteralKeys(): Set<string> {
  const keys = new Set<string>();
  const re =
    /(?<![A-Za-z0-9_])t\(\s*["'`]([^"'`]+)["'`]\s*[),]|i18nKey=["']([^"']+)["']/g;
  for (const file of walk(join(process.cwd(), "src"))) {
    const src = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const k = m[1] ?? m[2];
      if (!k || k.includes("${")) continue; // clé dynamique (ex. format.relative.${k})
      keys.add(k);
    }
  }
  return keys;
}

// Clés préfixées dynamiquement à l'exécution par un helper local (ex.
// `formatRelative` résout `t("justNow")` → `format.relative.justNow`) : le
// littéral source n'est pas la clé finale, on ne peut donc pas l'exiger tel
// quel. Elles sont couvertes par les tests de `formatRelative` (i18n.test.tsx).
const PREFIXED_AT_RUNTIME = new Set([
  "justNow",
  "minutes",
  "hours",
  "yesterday",
  "days",
]);

describe("i18n — toute clé utilisée existe dans les deux dictionnaires", () => {
  const frKeys = flatten(fr);
  const enKeys = flatten(en);
  const used = usedLiteralKeys();

  it("aucune clé utilisée n'est absente de fr.json", () => {
    const missing = [...used]
      .filter((k) => !PREFIXED_AT_RUNTIME.has(k) && !frKeys.has(k))
      .sort();
    expect(missing).toEqual([]);
  });

  it("aucune clé utilisée n'est absente de en.json", () => {
    const missing = [...used]
      .filter((k) => !PREFIXED_AT_RUNTIME.has(k) && !enKeys.has(k))
      .sort();
    expect(missing).toEqual([]);
  });
});
