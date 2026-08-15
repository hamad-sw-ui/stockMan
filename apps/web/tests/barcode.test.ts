/** Tests de l'encodeur Code 39 (étiquettes A4) : motifs exacts, délimiteurs
 *  « * », espace inter-caractère, normalisation casse, rejet des caractères
 *  hors alphabet et géométrie SVG. */
import { describe, expect, it } from "vitest";
import {
  canEncodeCode39,
  code39Bars,
  code39Widths,
  detectBarcodeSymbology,
  ean13Bars,
  ean13Bits,
  ean13Checksum,
  ean8Checksum,
  isValidEan13,
  isValidEan8,
  isValidUpca,
  normalizeCode39,
  upcaChecksum,
} from "../src/lib/barcode";

// Largeurs attendues d'un motif donné (n=1, w=3), barre en position paire.
const widthsOf = (pattern: string) =>
  [...pattern].map((p) => (p === "w" ? 3 : 1));
const STAR = widthsOf("nwnnwnwnn");

describe("lib/barcode — Code 39", () => {
  it("encode un caractère seul avec début/fin « * » et espaces inter-caractères", () => {
    // '*' + espace + 'A' + espace + '*'
    expect(code39Widths("A")).toEqual([
      ...STAR,
      1,
      ...widthsOf("wnnnnnwnw"),
      1,
      ...STAR,
    ]);
  });

  it("respecte les motifs de référence (chiffres, lettres, symboles)", () => {
    // '0' : nnnwwnwnn · 'Z' : nwwnwnnnn · '-' : nwnnnnwnw
    const w = code39Widths("0Z-");
    const attendu = [
      ...STAR,
      1,
      ...widthsOf("nnnwwnwnn"),
      1,
      ...widthsOf("nwwnwnnnn"),
      1,
      ...widthsOf("nwnnnnwnw"),
      1,
      ...STAR,
    ];
    expect(w).toEqual(attendu);
  });

  it("compte les modules : (n+2) caractères × 9 éléments + (n+1) espaces", () => {
    const n = 5;
    expect(code39Widths("12345").length).toBe((n + 2) * 9 + (n + 1));
  });

  it("alterne strictement barre / espace en partant d’une barre", () => {
    const { bars, width } = code39Bars("ABC123");
    const widths = code39Widths("ABC123");
    const total = widths.reduce((a, b) => a + b, 0);
    expect(width).toBe(total);
    // Une barre par position paire, abscisses croissantes sans recouvrement
    let x = 0;
    width.toString(); // no-op TS
    const expectedBars = widths.filter((_, i) => i % 2 === 0);
    expect(bars).toHaveLength(expectedBars.length);
    bars.forEach((b, i) => {
      expect(b.w).toBe(expectedBars[i]);
      if (i === 0) expect(b.x).toBe(0);
      x = b.x + b.w;
    });
    expect(x).toBeLessThanOrEqual(width);
  });

  it("normalise la casse (minuscules → majuscules)", () => {
    expect(normalizeCode39("abc-123")).toBe("ABC-123");
    expect(code39Widths("abc")).toEqual(code39Widths("ABC"));
  });

  it("valide l’appartenance à l’alphabet", () => {
    expect(canEncodeCode39("6001")).toBe(true);
    expect(canEncodeCode39("PROD-01.A/B+C $")).toBe(true);
    expect(canEncodeCode39("café")).toBe(false); // é accentué : non encodable
    expect(canEncodeCode39("a*b")).toBe(false); // * réservé aux délimiteurs
    expect(canEncodeCode39("code_underscored")).toBe(false);
  });

  it("rejette explicitement les caractères hors alphabet", () => {
    expect(() => code39Widths("ÉTÉ")).toThrowError(/non encodable/);
    expect(() => code39Widths("A*B")).toThrowError(/non encodable/);
  });
});

describe("EAN-13 (GS1)", () => {
  it("chiffre de contrôle GS1 : exemple canonique + calcul manuel", () => {
    // Exemple canonique GS1 (Wikipedia/GS1)
    expect(ean13Checksum("400638133393")).toBe(1);
    // 6 + 1×3 + 1×3 = 12 → contrôle 8
    expect(ean13Checksum("610000000001")).toBe(8);
    // 3 + 5×3 + 9 + 1×3 = 30 → contrôle 0
    expect(ean13Checksum("359000000001")).toBe(0);
  });

  it("validation : code exact, mauvais contrôle, longueurs", () => {
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("6100000000018")).toBe(true);
    expect(isValidEan13("6100000000011")).toBe(false); // contrôle faux (8 attendu)
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("610000000001")).toBe(false); // 12 chiffres seulement
    expect(isValidEan13("61000000000111")).toBe(false); // 14 chiffres
    expect(isValidEan13("6100000000A11")).toBe(false); // non numérique
  });

  it("contrôle rejeté si les 12 chiffres fournis sont invalides", () => {
    expect(() => ean13Checksum("6100000000011")).toThrow();
    expect(() => ean13Checksum("abc")).toThrow();
  });

  it("motif binaire : 95 modules, gardes et parité conformes", () => {
    const bits = ean13Bits("4006381333931");
    expect(bits).toHaveLength(95);
    expect(bits.startsWith("101")).toBe(true);
    expect(bits.endsWith("101")).toBe(true);
    expect(bits.slice(45, 50)).toBe("01010"); // garde centrale
    // 1er chiffre 4 → parité LGLLGG ; 2e chiffre 0 encodé en L = "0001101"
    expect(bits.slice(3, 10)).toBe("0001101");
    // côté droit en R : dernier chiffre (1) = "1100110" (7 modules avant la
    // garde finale de 3 modules)
    expect(bits.slice(-10, -3)).toBe("1100110");
  });

  it("ean13Bars : barres disjointes dans le cadre, erreur sur code invalide", () => {
    const { bars, width } = ean13Bars("4006381333931", 40);
    expect(width).toBe(95);
    expect(bars.length).toBeGreaterThan(20);
    let right = 0;
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(right - 1e-9); // pas de chevauchement
      right = Math.max(right, b.x + b.w);
    }
    expect(right).toBeLessThanOrEqual(95);
    expect(() => ean13Bars("6100000000011")).toThrow(); // contrôle faux
  });
});

/** C2 — détection de symbologie à la saisie (badge d'aide fiche produit) :
 *  parité stricte avec le validateur serveur (apps/api/src/lib/barcode.ts). */
describe("detectBarcodeSymbology + checksums EAN-8 / UPC-A", () => {
  it("EAN-8 : checksum 96385074 valide (4), 96385071 refusé", () => {
    expect(ean8Checksum("9638507")).toBe(4);
    expect(isValidEan8("96385074")).toBe(true);
    expect(isValidEan8("96385071")).toBe(false);
    expect(isValidEan8("12345678")).toBe(false);
  });

  it("UPC-A : checksum classique 036000291452 (2), 012345678905 (5)", () => {
    expect(upcaChecksum("03600029145")).toBe(2);
    expect(isValidUpca("036000291452")).toBe(true);
    expect(isValidUpca("012345678905")).toBe(true);
    expect(isValidUpca("012345678901")).toBe(false);
  });

  it("détection : EAN-13 ok / ko avec chiffre de contrôle attendu", () => {
    expect(detectBarcodeSymbology("4006381333931")).toMatchObject({
      symbology: "EAN13",
      valid: true,
    });
    const bad = detectBarcodeSymbology("4006381333930");
    expect(bad).toMatchObject({ symbology: "EAN13", valid: false });
    expect(bad.label).toContain("1 attendu");
  });

  it("détection : EAN-8, UPC-A, Code 39 (hors tailles numériques), Code 128", () => {
    expect(detectBarcodeSymbology("96385074").symbology).toBe("EAN8");
    expect(detectBarcodeSymbology("036000291452").symbology).toBe("UPCA");
    // 6 chiffres : ni EAN ni UPC → Code 39 (codes courts historiques licites)
    expect(detectBarcodeSymbology("620000").symbology).toBe("CODE39");
    expect(detectBarcodeSymbology("LOG-2026-A").symbology).toBe("CODE39");
    // Accolades : hors alphabet 39 mais ASCII imprimable → Code 128
    expect(detectBarcodeSymbology("lot{a}").symbology).toBe("CODE128");
    // Accents : ni 39 ni 128 → rejet franc
    expect(detectBarcodeSymbology("café").valid).toBe(false);
    expect(detectBarcodeSymbology("café").symbology).toBeNull();
    // Vide : rien à afficher
    expect(detectBarcodeSymbology("  ").label).toBe("");
  });
});
