/**
 * Petits utilitaires CSV (séparateur « ; », guillemets ") pour l'import de
 * catalogue. Aucun paquet externe : le format est stable et documenté.
 */

/** Découpe un texte CSV en lignes de cellules (RFC 4180, séparateur « ; »). */
export function parseCsv(text: string): string[][] {
  // BOM Excel UTF-8 éventuel
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ";") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (c === "\r") continue;
    cell += c;
  }
  row.push(cell);
  rows.push(row);
  // Lignes vides finales écartées
  return rows.filter((r) => r.some((c2) => c2.trim() !== ""));
}

/** Normalise un en-tête : minuscules, sans accents, ponctuation → espace. */
export function normHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Parse un montant FCFA tolérant : « 1 200 », « 1 200,50 », « 1200.50 ». */
export function parseMoney(raw: string): number | null {
  const s = raw.replace(/[  ]/g, "").replace(",", ".");
  if (s === "") return null;
  if (!/^-?\d+(\.\d{1,4})?$/.test(s)) return null;
  return Number(s);
}
