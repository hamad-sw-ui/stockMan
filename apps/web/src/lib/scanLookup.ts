/**
 * Résolution de codes-barres (C3) — enveloppe typée du résolveur serveur
 * GET /api/products/lookup/:code : produit > variante > alias/conditionnement.
 * Tous les écrans « flux physiques » (réceptions, transferts, campagnes,
 * retours, devis, achats) passent par ICI : un alias fournisseur ou un code
 * de carton est donc résolu partout de la même façon.
 */
import { get } from "./http";

export interface BarcodeLookupResult {
  matched: "product" | "variant" | "alias";
  productId: string;
  productName: string;
  productBarcode: string | null;
  sellingPrice: number;
  purchasePrice: number;
  taxRate: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number;
  requiresSerial: boolean;
  trackBatch: boolean;
  hasVariants: boolean;
  variantId: string | null;
  variantName: string | null;
  additionalPrice: number;
  /** Conditionnement scanné (code portant unit_id) : facteur vs unité de
   *  vente — scanner le carton ×12 pré-remplit la quantité à 12. */
  unitId: string | null;
  unitSymbol: string | null;
  unitFactor: number;
  aliasId: string | null;
  symbology: string | null;
}

/** Résout un code scanné ; lève ApiError 404 BARCODE_UNKNOWN si inconnu. */
export async function lookupBarcode(
  code: string,
): Promise<BarcodeLookupResult> {
  return get<BarcodeLookupResult>(
    `/products/lookup/${encodeURIComponent(code.trim())}`,
  );
}
