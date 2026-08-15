/**
 * Résolveur de scan de caisse (C3) — fonction PURE, hors-ligne.
 *
 * Priorité stricte (identique au résolveur serveur C1) :
 *   1. code principal produit   → ouverture fiche/ajout produit ;
 *   2. code principal variante  → ajout direct de la variante ;
 *   3. alias du registre (fournisseur ou conditionnement) → cible + unité
 *      scannée (le prix suit le facteur d'unité, moteur cart.ts).
 *
 * La pesée embarquée (EAN 20–29, C5) est d'abord tentée côté appelant.
 */
import type { PosBarcodeAlias, PosBootstrap } from "./types";

export type PosScanHit =
  | { kind: "product"; productId: string }
  | { kind: "variant"; productId: string; variantId: string }
  | {
      kind: "alias";
      productId: string;
      variantId: string | null;
      unitId: string | null;
      unitSymbol: string | null;
      /** base_value de l'unité du code scanné (null = unité catalogue). */
      unitBaseValue: number | null;
    }
  | null;

type BootstrapLike = Pick<PosBootstrap, "products"> & {
  barcodes?: PosBarcodeAlias[];
};

/** Résout un code scanné contre le bootstrap hors-ligne. null si inconnu. */
export function resolvePosScan(b: BootstrapLike, codeRaw: string): PosScanHit {
  const code = codeRaw.trim();
  if (!code) return null;
  const prod = b.products.find((p) => p.barcode === code);
  if (prod) return { kind: "product", productId: prod.id };
  for (const p of b.products) {
    const v = p.variants.find((x) => x.barcode === code);
    if (v) return { kind: "variant", productId: p.id, variantId: v.id };
  }
  const alias = (b.barcodes ?? []).find((x) => x.code === code);
  if (alias)
    return {
      kind: "alias",
      productId: alias.product_id,
      variantId: alias.variant_id,
      unitId: alias.unit_id,
      unitSymbol: alias.unit_symbol,
      unitBaseValue: alias.unit_base_value,
    };
  return null;
}
