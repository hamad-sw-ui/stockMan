/**
 * Export ZPL (phase C4, docs/06) — générateur PUR de fichiers .zpl pour
 * imprimantes thermiques Zebra/TSC (203 dpi ≈ 8 points/mm).
 *
 * Copie d'exploitation : fichier `.zpl` envoyé à l'imprimante par USB
 * (`COPY etiquette.zpl LPT1` / partage réseau) — voir docs/03.
 * Rendu par gabarit : enseigne (option), nom, code-barres (symbologie
 * automatique : ^BE EAN-13 / ^B3 Code 39 / ^BC Code 128-IMEI) et prix.
 */
import { labelSymbology } from "./labels";

export interface ZplLabelInput {
  name: string;
  code: string;
  /** Texte déjà formaté (« 1 500 FCFA ») — null = pas de prix. */
  priceText: string | null;
}

export interface ZplOptions {
  /** Gabarit thermique : largeur d'étiquette dicte ^PW/^LL. */
  template: "50x30" | "38x25";
  /** Enseigne imprimée en haut de l'étiquette (null = masquée). */
  shop?: string | null;
}

/** Échappement ^FD : `^`, `~`, `\` en hexadécimal sous `^FH_`. */
export function zplEscapeField(s: string): string {
  return s.replace(/\\/g, "_5C").replace(/\^/g, "_5E").replace(/~/g, "_7E");
}

const DOTS_PER_MM = 8; // 203 dpi

/** Une étiquette `^XA…^XZ` complète pour le gabarit demandé. */
export function buildZplLabel(input: ZplLabelInput, opts: ZplOptions): string {
  const wMm = opts.template === "38x25" ? 38 : 50;
  const hMm = opts.template === "38x25" ? 25 : 30;
  const pw = wMm * DOTS_PER_MM;
  const ll = hMm * DOTS_PER_MM;
  const name =
    input.name.length > 26 ? `${input.name.slice(0, 25)}…` : input.name;
  const lines: string[] = [
    "^XA",
    `^PW${pw}`,
    `^LL${ll}`,
    "^CI28", // UTF-8
  ];
  let y = 8;
  if (opts.shop) {
    lines.push(`^FO10,${y}^A0N,16,16^FH_^FD${zplEscapeField(opts.shop)}^FS`);
    y += 20;
  }
  lines.push(`^FO10,${y}^A0N,20,20^FH_^FD${zplEscapeField(name)}^FS`);
  y += 28;
  const sym = labelSymbology(input.code);
  const barH = hMm >= 30 ? 46 : 36;
  if (sym === "EAN13")
    lines.push(`^FO10,${y}^BY2^BEN,${barH},Y,N^FD${input.code}^FS`);
  else if (sym === "CODE39")
    lines.push(
      `^FO10,${y}^BY2^B3N,N,${barH},Y,N^FH_^FD${zplEscapeField(input.code)}^FS`,
    );
  else lines.push(`^FO10,${y}^BY2^BCN,${barH},Y,N,N^FD${input.code}^FS`);
  if (input.priceText)
    lines.push(
      `^FO10,${y + barH + 18}^A0N,22,22^FH_^FD${zplEscapeField(input.priceText)}^FS`,
    );
  lines.push("^XZ");
  return lines.join("\n");
}

/** Fichier multi-étiquettes : concaténation des blocs (ordre conservé). */
export function buildZpl(labels: ZplLabelInput[], opts: ZplOptions): string {
  return labels.map((l) => buildZplLabel(l, opts)).join("\n");
}

/** Télécharge le contenu en `.zpl` (côté navigateur uniquement). */
export function downloadZpl(content: string, filename = "etiquettes.zpl") {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
