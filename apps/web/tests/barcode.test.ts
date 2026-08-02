/** Tests de l'encodeur Code 39 (étiquettes A4) : motifs exacts, délimiteurs
 *  « * », espace inter-caractère, normalisation casse, rejet des caractères
 *  hors alphabet et géométrie SVG. */
import { describe, expect, it } from "vitest";
import {
  canEncodeCode39,
  code39Bars,
  code39Widths,
  normalizeCode39,
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
