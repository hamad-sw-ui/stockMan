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

/**
 * Code-barres EAN-13 (E8) — norme GS1 des produits du commerce (scan rapide,
 * compatibilité caisses/douchettes). Un EAN-13 = 12 chiffres + 1 chiffre de
 * contrôle ; il est imprimable sur toute étiqueteuse standard.
 */

/** Chiffre de contrôle GS1 : pondération 1/3 alternée depuis la gauche. */
export function ean13Checksum(digits12: string): number {
  if (!/^\d{12}$/.test(digits12))
    throw new Error(`EAN-13 : 12 chiffres attendus, reçu « ${digits12} ».`);
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/** Code complet à 13 chiffres valide (chiffre de contrôle concordant) ? */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13Checksum(code.slice(0, 12)) === Number(code[12]);
}

/**
 * EAN-8 / UPC-A — formats courts rencontrés sur petits articles et produits
 * d'importation nord-américaine (le serveur normalise l'UPC-A en EAN-13).
 */

/** Chiffre de contrôle EAN-8 (poids 3/1 depuis la gauche sur 7 chiffres). */
export function ean8Checksum(digits7: string): number {
  if (!/^\d{7}$/.test(digits7))
    throw new Error(`EAN-8 : 7 chiffres attendus, reçu « ${digits7} ».`);
  let sum = 0;
  for (let i = 0; i < 7; i += 1)
    sum += Number(digits7[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** EAN-8 complet valide ? */
export function isValidEan8(code: string): boolean {
  if (!/^\d{8}$/.test(code)) return false;
  return ean8Checksum(code.slice(0, 7)) === Number(code[7]);
}

/** Chiffre de contrôle UPC-A (poids 3/1 sur 11 chiffres). */
export function upcaChecksum(digits11: string): number {
  if (!/^\d{11}$/.test(digits11))
    throw new Error(`UPC-A : 11 chiffres attendus, reçu « ${digits11} ».`);
  let sum = 0;
  for (let i = 0; i < 11; i += 1)
    sum += Number(digits11[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** UPC-A complet valide ? */
export function isValidUpca(code: string): boolean {
  if (!/^\d{12}$/.test(code)) return false;
  return upcaChecksum(code.slice(0, 11)) === Number(code[11]);
}

/** ASCII imprimable (Code 128) ? */
function isPrintableAscii(code: string): boolean {
  return [...code].every((c) => c >= " " && c <= "~");
}

export type SymbologyGuess = "EAN13" | "EAN8" | "UPCA" | "CODE39" | "CODE128";

export interface SymbologyBadge {
  symbology: SymbologyGuess | null;
  /** checksum GS1 concordant (EAN/UPC) ; toujours vrai pour 39/128. */
  valid: boolean;
  /** Libellé court pour badge UI, ex. « EAN-13 ✓ ». */
  label: string;
}

/** Détection en saisie (badge d'aide) : symbologie + validité du contrôle. */
export function detectBarcodeSymbology(raw: string): SymbologyBadge {
  const code = raw.trim();
  if (!code) return { symbology: null, valid: false, label: "" };
  if (/^\d{13}$/.test(code)) {
    const ok = isValidEan13(code);
    return {
      symbology: "EAN13",
      valid: ok,
      label: ok
        ? "EAN-13 ✓"
        : `EAN-13 ✗ (contrôle ${ean13Checksum(code.slice(0, 12))} attendu)`,
    };
  }
  if (/^\d{12}$/.test(code)) {
    const ok = isValidUpca(code);
    return {
      symbology: "UPCA",
      valid: ok,
      label: ok
        ? "UPC-A ✓"
        : `UPC-A ✗ (contrôle ${upcaChecksum(code.slice(0, 11))} attendu)`,
    };
  }
  if (/^\d{8}$/.test(code)) {
    const ok = isValidEan8(code);
    return {
      symbology: "EAN8",
      valid: ok,
      label: ok
        ? "EAN-8 ✓"
        : `EAN-8 ✗ (contrôle ${ean8Checksum(code.slice(0, 7))} attendu)`,
    };
  }
  if (canEncodeCode39(code))
    return { symbology: "CODE39", valid: true, label: "Code 39" };
  if (isPrintableAscii(code))
    return { symbology: "CODE128", valid: true, label: "Code 128" };
  return {
    symbology: null,
    valid: false,
    label: "Caractères non imprimables",
  };
}

/* Motifs binaires des chiffres (1 = barre) — 7 modules par chiffre. */
const L_PATTERNS = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const G_PATTERNS = L_PATTERNS.map((p) => [...p].reverse().join(""));
const R_PATTERNS = L_PATTERNS.map((p) =>
  [...p].map((b) => (b === "1" ? "0" : "1")).join(""),
);
/* Parités gauches selon le 1er chiffre (L = impair, G = pair). */
const PARITY: Record<string, string> = {
  "0": "LLLLLL",
  "1": "LLGLGG",
  "2": "LLGGLG",
  "3": "LLGGGL",
  "4": "LGLLGG",
  "5": "LGGLLG",
  "6": "LGGGLL",
  "7": "LGLGLG",
  "8": "LGLGGL",
  "9": "LGGLGL",
};

/**
 * Motif binaire complet (95 modules) : garde 101 + 6 chiffres gauches selon
 * parité + garde centrale 01010 + 6 chiffres droits en R + garde 101.
 * @throws Error si le code n'est pas un EAN-13 valide.
 */
export function ean13Bits(code: string): string {
  if (!isValidEan13(code))
    throw new Error(
      `EAN-13 invalide : « ${code} » (13 chiffres, chiffre de contrôle concordant requis — reçu ${ean13Checksum(code.slice(0, 12))} attendu en position 13 si les 12 premiers chiffres sont exacts).`,
    );
  const parity = PARITY[code[0]!]!;
  let bits = "101";
  for (let i = 1; i <= 6; i += 1) {
    const d = Number(code[i]);
    bits += parity[i - 1] === "L" ? L_PATTERNS[d] : G_PATTERNS[d];
  }
  bits += "01010";
  for (let i = 7; i <= 12; i += 1) {
    bits += R_PATTERNS[Number(code[i])];
  }
  return bits + "101";
}

/** Barres prêtes pour un rendu SVG (module = 1). */
export function ean13Bars(
  code: string,
  height = 40,
): {
  bars: Array<{ x: number; w: number; h: number }>;
  width: number;
  height: number;
} {
  const bits = ean13Bits(code);
  const bars: Array<{ x: number; w: number; h: number }> = [];
  let x = 0;
  let run = 0;
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] === "1") {
      run += 1;
      // fin de séquence de barres ?
      if (bits[i + 1] !== "1") {
        bars.push({ x: x - run + 1, w: run, h: height });
        run = 0;
      }
    }
    x += 1;
  }
  return { bars, width: bits.length, height };
}
