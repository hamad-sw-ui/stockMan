/**
 * C5 — Codes à pesée GS1 (balances étiqueteuses), préfixes « magasin » 20–29.
 *
 * Une étiquette de balance est un EAN-13 :  PP AAAAA VVVVV K
 *   PP    = préfixe magasin (20–29, paramétré dans la balance) ;
 *   AAAAA = code article (5 chiffres) — côté StockMan, `products.barcode`
 *           porte « PPAAAAA » (7 chiffres) sur les produits is_weighed ;
 *   VVVVV = valeur embarquée : prix en FCFA (mode PRICE) ou poids en grammes
 *           (mode WEIGHT) — interprétation pilotée par la préférence tenant
 *           barcode_weighted_mode (OFF = code ignoré) ;
 *   K     = chiffre de contrôle EAN-13 (vérifié ici — une étiquette abîmée
 *           ou mal lue est rejetée avant tout calcul de prix/quantité).
 *
 * « Prix divisé » : en mode PRICE, la caisse déduit la quantité = prix ÷ prix
 * catalogue (le serveur re-calcule le total à l'encaissement — l'écart est
 * ≤ l'arrondi de quantité, journalisé par le ticket).
 *
 * Référence : docs/06_AUDIT_PRO_CODE_BARRES.md § C5.
 */
import { isValidEan13 } from "./barcode";
import type { BootstrapProduct, WeightedMode } from "./types";

export interface WeightedParse {
  /** Préfixe magasin (20–29). */
  prefix: string;
  /** Code article 5 chiffres. */
  articleCode: string;
  /** Code produit recherché dans le catalogue : « PPAAAAA » (7 chiffres). */
  productCode: string;
  /** Valeur embarquée brute (FCFA en mode PRICE, grammes en mode WEIGHT). */
  value: number;
}

/** Extrait les blocs d'une étiquette de balance ; null si ce n'en est pas une. */
export function parseWeightedBarcode(code: string): WeightedParse | null {
  const c = code.trim();
  if (!/^\d{13}$/.test(c)) return null;
  const n = Number(c.slice(0, 2));
  if (n < 20 || n > 29) return null; // préfixes magasin GS1 uniquement
  if (!isValidEan13(c)) return null;
  const prefix = c.slice(0, 2);
  const articleCode = c.slice(2, 7);
  return {
    prefix,
    articleCode,
    productCode: prefix + articleCode,
    value: Number(c.slice(7, 12)),
  };
}

export interface WeighedHit {
  productId: string;
  /** Quantité à mettre en ligne (kg à 3 décimales en WEIGHT ; quantité
   *  dérivée du prix en PRICE). */
  quantity: number;
  /** Prix FCFA embarqué (mode PRICE seulement) — affiché sur la ligne. */
  embeddedPrice: number | null;
  /** Libellé court pour le toast / la ligne (ex. « 1,5 kg », « 1 500 FCFA »). */
  label: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Résout un code de balance contre le catalogue local et le mode tenant.
 *  Règles anti-collision : préfixe 20–29 + checksum valide + produit portant
 *  le drapeau is_weighed + code article exact — sinon null (l'appelant
 *  poursuit la chaîne de résolution classique). */
export function resolveWeighedScan(
  products: Array<
    Pick<BootstrapProduct, "id" | "name" | "barcode" | "selling_price"> & {
      is_weighed?: boolean;
    }
  >,
  mode: WeightedMode | undefined,
  code: string,
): WeighedHit | null {
  if (!mode || mode === "OFF") return null;
  const parsed = parseWeightedBarcode(code);
  if (!parsed) return null;
  const product = products.find(
    (p) => p.is_weighed && p.barcode === parsed.productCode,
  );
  if (!product) return null;
  if (mode === "WEIGHT") {
    // Valeur en grammes → quantité en kg (unité de vente usuelle balance).
    const quantity = round3(parsed.value / 1000);
    if (!(quantity > 0)) return null;
    return {
      productId: product.id,
      quantity,
      embeddedPrice: null,
      // Affichage au format des balances : 1,500 kg / 0,250 kg.
      label: `${(parsed.value / 1000).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`,
    };
  }
  // PRICE : le prix payé est embarqué → quantité dérivée du prix catalogue.
  const price = Number(product.selling_price);
  if (!(price > 0) || !(parsed.value > 0)) return null;
  const quantity = round3(parsed.value / price);
  if (!(quantity > 0)) return null;
  return {
    productId: product.id,
    quantity,
    embeddedPrice: parsed.value,
    label: `${parsed.value.toLocaleString("fr-FR")} FCFA`,
  };
}
