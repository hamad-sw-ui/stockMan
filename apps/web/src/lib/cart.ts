/** Moteur de panier POS — calculs purs, 100 % testables.
 *  Règles (alignées sur l'API, qui RESTE l'autorité finale) :
 *  - prix unitaire effectif = (prix catalogue + supplément variante) × facteur d'unité ;
 *  - remise par ligne en % ;
 *  - conversion d'unité : facteur = base_value(unité de vente) / base_value(unité produit).
 */

export interface CartUnit {
  id: string;
  symbol: string;
  baseValue: number;
  isBase?: boolean;
}

export interface CartProduct {
  id: string;
  name: string;
  sellingPrice: number;
  /** base_value de l'unité catalogue du produit (défaut 1). */
  unitBaseValue: number;
  unitId?: string | null;
  unitSymbol?: string | null;
  barcode?: string | null;
}

export interface CartVariant {
  id: string;
  name: string;
  additionalPrice: number;
  sku?: string | null;
  barcode?: string | null;
}

export interface CartLineInput {
  product: CartProduct;
  variant?: CartVariant | null;
  unit?: CartUnit | null;
  quantity: number;
  discountPct?: number;
}

export interface CartLine extends CartLineInput {
  key: string;
  unitPrice: number;
  baseQty: number;
  factor: number;
  lineTotal: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Facteur de conversion vers l'unité de base du produit. */
export function unitFactor(product: { unitBaseValue: number }, unit: { baseValue: number } | null | undefined): number {
  if (!unit) return 1;
  const productBase = product.unitBaseValue > 0 ? product.unitBaseValue : 1;
  return unit.baseValue / productBase;
}

/** Prix d'une unité de vente (avec supplément variante, facteur et remise). */
export function effectiveUnitPrice(input: CartLineInput): number {
  const catalog = input.product.sellingPrice + (input.variant?.additionalPrice ?? 0);
  const factor = unitFactor(input.product, input.unit);
  const discount = Math.min(Math.max(input.discountPct ?? 0, 0), 100) / 100;
  return round2(catalog * factor * (1 - discount));
}

export function makeLine(input: CartLineInput): CartLine {
  const factor = unitFactor(input.product, input.unit);
  const quantity = input.quantity > 0 ? input.quantity : 1;
  const discount = Math.min(Math.max(input.discountPct ?? 0, 0), 100);
  const unitPrice = effectiveUnitPrice({ ...input, quantity });
  return {
    ...input,
    quantity,
    discountPct: discount,
    key: lineKey(input.product.id, input.variant?.id ?? null, input.unit?.id ?? null),
    factor,
    unitPrice,
    baseQty: round2(quantity * factor),
    lineTotal: round2(quantity * factor * (input.product.sellingPrice + (input.variant?.additionalPrice ?? 0)) * (1 - discount / 100)),
  };
}

export function lineKey(productId: string, variantId: string | null, unitId: string | null): string {
  return `${productId}::${variantId ?? ''}::${unitId ?? ''}`;
}

export function cartTotal(lines: ReadonlyArray<Pick<CartLine, 'lineTotal'>>): number {
  return round2(lines.reduce((acc, l) => acc + l.lineTotal, 0));
}

/** Monnaie à rendre (≥ 0). */
export function changeDue(total: number, received: number | null | undefined): number {
  if (received == null) return 0;
  return Math.max(0, round2(received - total));
}

export function paymentLabel(m: 'CASH' | 'MTN_MOMO' | 'ORANGE_MONEY'): string {
  return m === 'CASH' ? 'Espèces' : m === 'MTN_MOMO' ? 'MTN MoMo' : 'Orange Money';
}
