/** Moteur de panier : règles EXACTES du serveur (prix = (catalogue +
 *  supplément variante) × facteur d'unité × (1 − remise)). */
import { describe, expect, it } from 'vitest';
import { cartTotal, changeDue, effectiveUnitPrice, lineKey, makeLine, paymentLabel, unitFactor, type CartProduct, type CartUnit, type CartVariant } from '../src/lib/cart';

const piece: CartUnit = { id: 'u1', symbol: 'Pce', baseValue: 1, isBase: true };
const carton: CartUnit = { id: 'u2', symbol: 'Ctn', baseValue: 12 };
const savon: CartProduct = { id: 'p1', name: 'Savon', sellingPrice: 500, unitBaseValue: 1, unitId: 'u1', unitSymbol: 'Pce' };
const rouge: CartVariant = { id: 'v1', name: 'Rouge', additionalPrice: 50 };
const riz: CartProduct = { id: 'p2', name: 'Riz 1kg', sellingPrice: 1200, unitBaseValue: 1 }; // kg en unité de base

describe('unitFactor', () => {
  it('1 sans unité ou avec unité de base', () => {
    expect(unitFactor(savon, null)).toBe(1);
    expect(unitFactor(savon, piece)).toBe(1);
  });
  it('facteur = base_value(unité) / base_value(produit)', () => {
    expect(unitFactor(savon, carton)).toBe(12);
  });
  it('unité de produit non unitaire (ex. 100 g) ratio correct', () => {
    const produit100g = { id: 'p3', name: 'Café', sellingPrice: 300, unitBaseValue: 100 };
    const kg = { id: 'u9', symbol: 'kg', baseValue: 1000 };
    expect(unitFactor(produit100g, kg)).toBe(10);
  });
});

describe('effectiveUnitPrice', () => {
  it('prix catalogue seul', () => {
    expect(effectiveUnitPrice({ product: savon, quantity: 1 })).toBe(500);
  });
  it('+ supplément variante', () => {
    expect(effectiveUnitPrice({ product: savon, variant: rouge, quantity: 1 })).toBe(550);
  });
  it('× facteur de l’unité dérivée (carton)', () => {
    expect(effectiveUnitPrice({ product: savon, unit: carton, quantity: 1 })).toBe(6000);
  });
  it('× (1 − remise)', () => {
    expect(effectiveUnitPrice({ product: savon, quantity: 1, discountPct: 10 })).toBe(450);
  });
  it('variante + unité + remise cumulés, arrondi 2 décimales', () => {
    expect(effectiveUnitPrice({ product: savon, variant: rouge, unit: carton, quantity: 1, discountPct: 5 })).toBe(6270);
  });
  it('remise bornée à [0,100]', () => {
    expect(effectiveUnitPrice({ product: savon, quantity: 1, discountPct: 150 })).toBe(0);
    expect(effectiveUnitPrice({ product: savon, quantity: 1, discountPct: -10 })).toBe(500);
  });
});

describe('makeLine', () => {
  it('quantité, baseQty et total cohérents (carton ×2 = 24 pièces)', () => {
    const l = makeLine({ product: savon, unit: carton, quantity: 2 });
    expect(l.factor).toBe(12);
    expect(l.baseQty).toBe(24);
    expect(l.lineTotal).toBe(12000);
    expect(l.key).toBe(lineKey('p1', null, 'u2'));
  });
  it('quantité ≤ 0 ramenée à 1', () => {
    expect(makeLine({ product: savon, quantity: 0 }).quantity).toBe(1);
  });
  it('la clé distingue variante et unité', () => {
    const a = makeLine({ product: savon, quantity: 1 });
    const b = makeLine({ product: savon, variant: rouge, quantity: 1 });
    const c = makeLine({ product: savon, unit: carton, quantity: 1 });
    expect(new Set([a.key, b.key, c.key]).size).toBe(3);
  });
  it('total ligne avec remise appliquée sur la ligne entière', () => {
    const l = makeLine({ product: riz, quantity: 3, discountPct: 10 });
    expect(l.lineTotal).toBe(3240); // 1200 × 3 × 0.9
  });
});

describe('cartTotal / changeDue', () => {
  it('somme des lignes, arrondie', () => {
    const lines = [makeLine({ product: savon, quantity: 2 }), makeLine({ product: riz, quantity: 1 })];
    expect(cartTotal(lines)).toBe(2200);
    expect(cartTotal([])).toBe(0);
  });
  it('monnaie : jamais négative, 0 si montant non saisi', () => {
    expect(changeDue(2000, 5000)).toBe(3000);
    expect(changeDue(2000, 1500)).toBe(0);
    expect(changeDue(2000, null)).toBe(0);
    expect(changeDue(2000, undefined)).toBe(0);
  });
});

it('paymentLabel', () => {
  expect(paymentLabel('CASH')).toBe('Espèces');
  expect(paymentLabel('MTN_MOMO')).toBe('MTN MoMo');
  expect(paymentLabel('ORANGE_MONEY')).toBe('Orange Money');
});
