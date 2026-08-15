/**
 * Étiquettes code-barres (phase C4, docs/06) — logique PURE :
 * gabarits d'impression, expansion « quantité → n étiquettes » et choix
 * automatique de symbologie. Aucune dépendance au DOM (testable vitest).
 */
import { isValidEan13 } from "./barcode";

export type LabelTemplateId = "a4-grid" | "50x30" | "38x25";

export interface LabelTemplate {
  id: LabelTemplateId;
  label: string;
  widthMm: number;
  heightMm: number;
  /** Export ZPL (imprimante thermique) disponible pour ce gabarit. */
  zpl: boolean;
}

export const LABEL_TEMPLATES: LabelTemplate[] = [
  {
    id: "a4-grid",
    label: "Planche A4 (grille)",
    widthMm: 62,
    heightMm: 30,
    zpl: false,
  },
  {
    id: "50x30",
    label: "Thermique 50 × 30 mm",
    widthMm: 50,
    heightMm: 30,
    zpl: true,
  },
  {
    id: "38x25",
    label: "Thermique 38 × 25 mm",
    widthMm: 38,
    heightMm: 25,
    zpl: true,
  },
];

export const templateById = (id: LabelTemplateId): LabelTemplate =>
  LABEL_TEMPLATES.find((t) => t.id === id)!;

/** Une ligne à étiqueter : code requis pour imprimer (sinon la ligne saute). */
export interface LabelLine {
  key: string;
  name: string;
  code: string | null;
  price: number | null;
  qty: number;
}

/** Une étiquette matérialisée (quantité déjà « dépliée »). */
export interface ExpandedLabel extends Omit<LabelLine, "qty"> {}

/**
 * Déplie les lignes en étiquettes unitaires : quantité arrondie à l'entier
 * le plus proche, 0/négatif = ligne sautée, ligne sans code exclue.
 * Ex. réception 3 × 24 → 72 étiquettes (critère d'acceptation C4).
 */
export function expandLabels(lines: LabelLine[]): ExpandedLabel[] {
  const out: ExpandedLabel[] = [];
  for (const l of lines) {
    const n = Math.max(0, Math.round(l.qty));
    if (n === 0 || !l.code) continue;
    for (let i = 0; i < n; i++)
      out.push({
        key: `${l.key}#${i}`,
        name: l.name,
        code: l.code,
        price: l.price,
      });
  }
  return out;
}

const CODE39_RE = /^[0-9A-Z \-.$/+%]+$/;

/**
 * Choix de symbologie automatique : EAN-13 si le code est un EAN-13 valide,
 * Code 128 pour les IMEI (15 chiffres) et les codes hors alphabet Code 39,
 * Code 39 sinon (standard historique de l'app).
 */
export function labelSymbology(code: string): "EAN13" | "CODE39" | "CODE128" {
  if (isValidEan13(code)) return "EAN13";
  if (/^\d{15}$/.test(code)) return "CODE128"; // IMEI
  if (CODE39_RE.test(code)) return "CODE39";
  return "CODE128";
}
