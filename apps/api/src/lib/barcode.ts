/**
 * Validation & normalisation des codes-barres (C2) — règles GS1 + Code 39/128.
 * Côté serveur (autorité), la parité avec `apps/web/src/lib/barcode.ts`
 * (encodage graphique) est garantie par les tests des deux côtés.
 *
 * Décision de produit (documentée docs/06) :
 *  - 13 chiffres → EAN-13 avec chiffre de contrôle OBLIGATOIRE (le message cite
 *    le chiffre attendu pour corriger d'un coup l'œil) ;
 *  - 12 chiffres → UPC-A contrôlé puis **normalisé en EAN-13** (préfixe « 0 ») ;
 *  - 8 chiffres → EAN-8 avec chiffre de contrôle obligatoire ;
 *  - autre longueur → Code 39 (alphabet 0-9 A-Z « -. $/+% », mis en MAJUSCULES)
 *    puis Code 128 (ASCII imprimable) ; tout le reste est refusé.
 * Aucun code générique hérité n'est cassé : les codes courts de la V1
 * (« 6001 »…) restent valables en Code 39.
 */

export type Symbology = "EAN13" | "EAN8" | "UPCA" | "CODE39" | "CODE128";

const CODE39_ALPHABET = new Set([
  ..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%",
]);

/** Chiffre de contrôle EAN-13 à partir des 12 premiers chiffres (poids 1/3). */
export function ean13ChecksumApi(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1)
    sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** Chiffre de contrôle EAN-8 à partir des 7 premiers chiffres (poids 3/1). */
export function ean8ChecksumApi(digits7: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i += 1)
    sum += Number(digits7[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** Chiffre de contrôle UPC-A à partir des 11 premiers chiffres (poids 3/1). */
export function upcaChecksumApi(digits11: string): number {
  let sum = 0;
  for (let i = 0; i < 11; i += 1)
    sum += Number(digits11[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

export interface BarcodeValid {
  ok: true;
  /** Code normalisé à stocker (UPC-A → EAN-13 ; Code 39 en majuscules). */
  code: string;
  symbology: Symbology;
  /** Note explicative éventuelle (ex. normalisation UPC-A → EAN-13). */
  note?: string;
}
export interface BarcodeInvalid {
  ok: false;
  message: string;
}
export type BarcodeVerdict = BarcodeValid | BarcodeInvalid;

/** Détecte la symbologie, valide le chiffre de contrôle, normalise. */
export function detectAndValidateBarcode(raw: string): BarcodeVerdict {
  const code = raw.trim();
  if (!code) return { ok: false, message: "Code-barres vide." };
  if (code.length > 100)
    return {
      ok: false,
      message: "Code-barres trop long (100 caractères max).",
    };

  if (/^\d{13}$/.test(code)) {
    const expected = ean13ChecksumApi(code.slice(0, 12));
    if (expected !== Number(code[12]))
      return {
        ok: false,
        message: `EAN-13 invalide : chiffre de contrôle attendu ${expected} (reçu ${code[12]}).`,
      };
    return { ok: true, code, symbology: "EAN13" };
  }
  if (/^\d{12}$/.test(code)) {
    const expected = upcaChecksumApi(code.slice(0, 11));
    if (expected !== Number(code[11]))
      return {
        ok: false,
        message: `UPC-A invalide : chiffre de contrôle attendu ${expected} (reçu ${code[11]}).`,
      };
    return {
      ok: true,
      code: `0${code}`,
      symbology: "EAN13",
      note: "UPC-A normalisé en EAN-13 (préfixe 0).",
    };
  }
  if (/^\d{8}$/.test(code)) {
    const expected = ean8ChecksumApi(code.slice(0, 7));
    if (expected !== Number(code[7]))
      return {
        ok: false,
        message: `EAN-8 invalide : chiffre de contrôle attendu ${expected} (reçu ${code[7]}).`,
      };
    return { ok: true, code, symbology: "EAN8" };
  }
  const upper = code.toUpperCase();
  if ([...upper].every((c) => CODE39_ALPHABET.has(c)))
    return { ok: true, code: upper, symbology: "CODE39" };
  if ([...code].every((c) => c >= " " && c <= "~"))
    return { ok: true, code, symbology: "CODE128" };
  return {
    ok: false,
    message:
      "Caractères non imprimables : ni EAN/UPC, ni Code 39 (chiffres, lettres sans accent, - . espace $ / + %), ni Code 128.",
  };
}
