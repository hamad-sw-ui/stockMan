/**
 * Code-barres Code 39 — encodeur pur TypeScript, AUCUNE dépendance.
 *
 * Le Code 39 est idéal pour les étiquettes locales (imprimante A4 ordinaire) :
 * alphabet limité mais robuste (chiffres, majuscules, - . espace $ / + %) et
 * lu par toutes les douchettes du marché.
 *
 * Chaque caractère = 9 éléments (5 barres, 4 espaces), 3 larges et 6 étroits.
 * Début/fin obligatoires avec « * ». Un espace étroit sépare les caractères.
 */

/** Alphabet Code 39 avec les motifs large(w)/étroit(n), barre et espace alternés. */
const PATTERNS: Record<string, string> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnnwnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn", // début / fin (jamais dans le texte lisible)
};

const NARROW = 1;
const WIDE = 3;

/** Normalise une valeur pour le Code 39 : minuscules → majuscules. */
export function normalizeCode39(value: string): string {
  return value.toUpperCase();
}

/** Tous les caractères sont-ils encodables en Code 39 ? */
export function canEncodeCode39(value: string): boolean {
  return [...normalizeCode39(value)].every((c) => c in PATTERNS && c !== "*");
}

/**
 * Largeurs successives (étroit=1, large=3) alternant barre/espace, en
 * commençant TOUJOURS par une barre. Le premier et dernier caractères sont « * ».
 * @throws Error si un caractère n'appartient pas à l'alphabet Code 39.
 */
export function code39Widths(value: string): number[] {
  const text = normalizeCode39(value);
  const chars = [...text];
  for (const c of chars) {
    if (!(c in PATTERNS) || c === "*") {
      throw new Error(
        `Caractère non encodable en Code 39 : « ${c} » (chiffres, A-Z, - . espace $ / + %).`,
      );
    }
  }
  const widths: number[] = [];
  const full = ["*", ...chars, "*"];
  full.forEach((c, i) => {
    if (i > 0) widths.push(NARROW); // espace inter-caractère
    for (const p of PATTERNS[c]!) widths.push(p === "w" ? WIDE : NARROW);
  });
  return widths;
}

/**
 * Chemin SVG des barres (remplies) prêt à être rendu, avec hauteur donnée.
 * Retourne aussi la largeur totale en unités de module.
 */
export function code39Bars(
  value: string,
  height = 40,
): {
  bars: Array<{ x: number; w: number; h: number }>;
  width: number;
  height: number;
} {
  const widths = code39Widths(value);
  const bars: Array<{ x: number; w: number; h: number }> = [];
  let x = 0;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w, h: height }); // positions paires = barres
    x += w;
  });
  return { bars, width: x, height };
}
