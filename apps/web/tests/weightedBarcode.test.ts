/**
 * C5 — Codes à pesée GS1 (balances étiqueteuses, préfixes 20–29) :
 * parseur pur (blocs + checksum) puis résolution caisse anti-collision
 * (mode OFF, drapeau is_weighed requis, arrondis au gramme).
 * Matrice : docs/06_AUDIT_PRO_CODE_BARRES.md § C5.
 */
import { describe, expect, it } from "vitest";
import {
  parseWeightedBarcode,
  resolveWeighedScan,
} from "../src/lib/weightedBarcode";

// 26 00123 01500 4 — article 00123, valeur 1500, contrôle EAN-13 = 4.
const ETIQUETTE = "2600123015004";

const weighedProduct = {
  id: "prod-w",
  name: "Poulet entier",
  barcode: "2600123", // code article balance (7 chiffres)
  selling_price: 3000, // FCFA / kg
  is_weighed: true,
};

describe("lib/weightedBarcode — parseur d'étiquettes de balance", () => {
  it("décompose PP + article + valeur et valide le checksum", () => {
    expect(parseWeightedBarcode(ETIQUETTE)).toEqual({
      prefix: "26",
      articleCode: "00123",
      productCode: "2600123",
      value: 1500,
    });
  });

  it("rejette un checksum discordant (étiquette abîmée / mal lue)", () => {
    expect(parseWeightedBarcode("2600123015005")).toBeNull();
  });

  it("rejette tout ce qui n'est pas un magasin 20–29 ou pas 13 chiffres", () => {
    // EAN-13 classique valide (préfixe 61) : jamais interprété comme pesée.
    expect(parseWeightedBarcode("6100000000018")).toBeNull();
    expect(parseWeightedBarcode("012345678905")).toBeNull(); // 12 chiffres
    expect(parseWeightedBarcode("260012301500")).toBeNull(); // 12 chiffres
    expect(parseWeightedBarcode("26A0123015004")).toBeNull(); // non numérique
    expect(parseWeightedBarcode("")).toBeNull();
  });

  it("un autre préfixe magasin (20) est accepté", () => {
    // 20 99999 00050 K → contrôle calculé : digits 2,0,9,9,9,9,9,0,0,0,5,0
    // impairs 2+9+9+9+0+5=34, pairs 0+9+9+0+0+0=18·3=54, total 88 → K=2.
    expect(parseWeightedBarcode("2099999000502")).toEqual({
      prefix: "20",
      articleCode: "99999",
      productCode: "2099999",
      value: 50,
    });
  });
});

describe("lib/weightedBarcode — résolution caisse (anti-collision)", () => {
  it("mode OFF : l'étiquette est ignorée même si tout concorde", () => {
    expect(resolveWeighedScan([weighedProduct], "OFF", ETIQUETTE)).toBeNull();
    expect(
      resolveWeighedScan([weighedProduct], undefined, ETIQUETTE),
    ).toBeNull();
  });

  it("mode WEIGHT : 1 500 g embarqués → quantité 1,5 kg, libellé balance", () => {
    const hit = resolveWeighedScan([weighedProduct], "WEIGHT", ETIQUETTE);
    expect(hit).not.toBeNull();
    expect(hit!.productId).toBe("prod-w");
    expect(hit!.quantity).toBe(1.5);
    expect(hit!.embeddedPrice).toBeNull();
    // « 1,500 kg » au format balance fr-FR
    expect(hit!.label).toBe(
      `${(1.5).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`,
    );
  });

  it("mode WEIGHT : 250 g → 0,25 kg (arrondi au gramme)", () => {
    // 26 00123 00250 K : impairs 2+0+1+3+0+5=11, pairs 6+0+2+0+2+0=10·3=30 → 41 → K=9
    const hit = resolveWeighedScan([weighedProduct], "WEIGHT", "2600123002509");
    expect(hit!.quantity).toBe(0.25);
  });

  it("mode PRICE : 1 500 FCFA à 3 000 F/kg → quantité 0,5 kg, prix restitué", () => {
    const hit = resolveWeighedScan([weighedProduct], "PRICE", ETIQUETTE);
    expect(hit!.productId).toBe("prod-w");
    expect(hit!.quantity).toBe(0.5);
    expect(hit!.embeddedPrice).toBe(1500);
    expect(hit!.label).toContain("1");
    expect(hit!.label).toContain("500");
    expect(hit!.label).toContain("FCFA");
  });

  it("mode PRICE : quantité arrondie au gramme (1 000 F / 3 000 F·kg⁻¹ ≈ 0,333)", () => {
    // 26 00123 01000 K : impairs 2+0+1+3+1+0=7, pairs 6+0+2+0+0+0=8·3=24 → 31 → K=9
    const hit = resolveWeighedScan([weighedProduct], "PRICE", "2600123010009");
    expect(hit!.quantity).toBe(0.333);
  });

  it("collision neutralisée : produit NON marqué « à pesée » avec le même code article", () => {
    const notWeighed = { ...weighedProduct, is_weighed: false };
    expect(resolveWeighedScan([notWeighed], "WEIGHT", ETIQUETTE)).toBeNull();
  });

  it("collision neutralisée : code article différent (même préfixe)", () => {
    const otherArticle = { ...weighedProduct, barcode: "2600999" };
    expect(resolveWeighedScan([otherArticle], "WEIGHT", ETIQUETTE)).toBeNull();
  });

  it("garde-fous : prix catalogue nul ou valeur embarquée nulle → null", () => {
    const free = { ...weighedProduct, selling_price: 0 };
    expect(resolveWeighedScan([free], "PRICE", ETIQUETTE)).toBeNull();
    // 26 00123 00000 K : impairs 2+0+1+3+0+0=6, pairs 6+0+2+0+0+0=8·3=24 → 30 → K=0
    expect(
      resolveWeighedScan([weighedProduct], "PRICE", "2600123000000"),
    ).toBeNull();
  });
});
