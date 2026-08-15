/** I5 — Garde-fou anti-chaînes FR « en dur » dans le JSX.
 *
 *  Principe : tout libellé visible à l'écran doit passer par t()/Trans —
 *  les 130+ tests métier assertent les textes français à l'identique, un
 *  oubli de conversion passerait donc inaperçu côté EN. Ce test balaye
 *  src/**‌/*.tsx et signale :
 *    1. les attributs littéraux   aria-label|placeholder|title|label|sub|
 *       hint|alt|heading="…" contenant une chaîne francophone ;
 *    2. les mêmes attributs en gabarit {`…`} (parties statiques) ;
 *    3. les nœuds texte JSX mono-ligne (>texte<) francophones ;
 *    4. les lignes de texte pur (nœuds texte multi-lignes : aucun caractère
 *       de syntaxe JS/JSX sur la ligne) francophones.
 *
 *  « Francophone » = au moins un caractère accentué français (é è ê à ù ç …)
 *  ou un mot métier français de la liste ci-dessous (frontières de mot).
 *
 *  Hors champ volontairement (liste blanche, chaque entrée doit servir —
 *  une entrée périmée fait échouer le test) :
 *    - les documents d'impression légaux FR (reçus TOTAL/Paiement/Merci,
 *      facture NIU/RCCM, HT/TVA/TTC), marqués « hors champ i18n v1 » ;
 *    - la marque « StockMan » (nom propre, jamais signalée : sans accent).
 *  Les fichiers .ts ne sont pas balayés : chaînes du contrat CSV (en-têtes
 *  FR parsés par l'API) et constantes de repli y sont intentionnelles. */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_DIR = join(__dirname, "..", "src");

const ACCENTS = /[éèêëàâäùûüçîïôöœÉÈÊËÀÂÄÙÛÜÇÎÏÔÖŒ]/;
const WORDS = [
  "Accueil",
  "Annuler",
  "Ajouter",
  "Article",
  "Articles",
  "Aucun",
  "Aucune",
  "Chargement",
  "Code-barres",
  "Enregistrer",
  "Graphique",
  "Erreur",
  "Fermer",
  "Imprimer",
  "Introuvable",
  "Merci",
  "Montant",
  "Paiement",
  "Produit",
  "Produits",
  "Quantité",
  "Qté",
  "Rechercher",
  "Retour",
  "Statut",
  "Supprimer",
  "Total",
  "TOTAL",
  "Tous",
  "Toutes",
  "Veuillez",
  "Valider",
  "Téléchargement",
  "Télécharger",
  "Réessayer",
];
const WORD_RE = new RegExp(
  `(?<![A-Za-zÀ-ÿ])(${WORDS.join("|")})(?![A-Za-zÀ-ÿ])`,
);

const ATTR_NAMES =
  "(?:aria-label|placeholder|title|label|sub|hint|alt|heading)";
const ATTR_RE = new RegExp(`\\b${ATTR_NAMES}="([^"]*)"`, "g");
const TPL_RE = new RegExp(`\\b${ATTR_NAMES}=\\{\`([^\`]*)\`\\}`, "g");
const TEXT_RE = />([^<>{}\n]+)</g;
const LINE_FORBIDDEN = /[<>{}=;()`"']/;
const LINE_COMMENT = /(?<![:"'`])\/\/[^\n]*/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

/** Chaînes FR assumées (documents d'impression légaux, voir en-tête) :
 *  chemin relatif depuis src/ → sous-chaînes tolérées. */
const WHITELIST: Record<string, string[]> = {
  "pages/admin/InvoicesPage.tsx": [
    "Total HT",
    "Total TTC",
    "Fermer",
    "Article",
    "Qté",
    "Imprimer",
  ],
  "pages/admin/SaleDetailPage.tsx": ["TOTAL"],
  "pages/vendor/PaymentsPage.tsx": [
    "TOTAL",
    "Paiement",
    "Merci de votre visite !",
  ],
  "pages/vendor/PosPage.tsx": ["TOTAL"],
};

const isFrench = (s: string) => ACCENTS.test(s) || WORD_RE.test(s);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? tsxFiles(join(dir, e.name))
      : e.name.endsWith(".tsx")
        ? [join(dir, e.name)]
        : [],
  );
}

interface Candidate {
  kind: "ATTR" | "TPL" | "TEXT" | "LINE";
  file: string;
  value: string;
}

function stripCode(src: string): string {
  return src.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
}

function collect(file: string): Candidate[] {
  const rel = relative(SRC_DIR, file);
  const code = stripCode(readFileSync(file, "utf8"));
  const found: Candidate[] = [];

  for (const m of code.matchAll(ATTR_RE)) {
    const value = m[1]!.trim();
    if (value && isFrench(value))
      found.push({ kind: "ATTR", file: rel, value });
  }
  for (const m of code.matchAll(TPL_RE)) {
    const staticPart = m[1]!.replace(/\$\{[^}]*\}/g, "…").trim();
    if (staticPart && isFrench(staticPart))
      found.push({ kind: "TPL", file: rel, value: staticPart });
  }
  for (const m of code.matchAll(TEXT_RE)) {
    const value = m[1]!.trim();
    if (value.length > 1 && isFrench(value))
      found.push({ kind: "TEXT", file: rel, value });
  }
  for (const line of code.split("\n")) {
    const value = line.trim();
    const letters = (value.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
    if (letters >= 2 && !LINE_FORBIDDEN.test(value) && isFrench(value))
      found.push({ kind: "LINE", file: rel, value });
  }
  return found;
}

describe("garde-fou i18n — aucune chaîne FR en dur dans le JSX", () => {
  const files = tsxFiles(SRC_DIR).sort();
  const candidates = files.flatMap(collect);
  const violations = candidates.filter(
    (c) => !(WHITELIST[c.file] ?? []).some((w) => c.value.includes(w)),
  );

  it("balaye bien l'ensemble des fichiers .tsx applicatifs", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("aucun libellé à l'écran n'est une chaîne française littérale", () => {
    expect(
      violations.map((v) => `${v.file} [${v.kind}] ${v.value.slice(0, 70)}`),
    ).toEqual([]);
  });

  it("chaque entrée de la liste blanche sert encore (anti-péremption)", () => {
    const stale = Object.entries(WHITELIST).flatMap(([file, allowed]) =>
      allowed
        .filter(
          (w) =>
            !candidates.some((c) => c.file === file && c.value.includes(w)),
        )
        .map((w) => `${file}: « ${w} » ne correspond plus à rien`),
    );
    expect(stale).toEqual([]);
  });
});
