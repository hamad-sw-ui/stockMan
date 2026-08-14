/** Étiquettes code-barres (C4, docs/06) : expansion quantité → étiquettes,
 *  gabarits, choix de symbologie automatique et générateur ZPL pur
 *  (^XA…^XZ, ^BY, échappements ^FH_ hexadécimaux). */
import { describe, expect, it } from "vitest";
import {
  expandLabels,
  labelSymbology,
  LABEL_TEMPLATES,
  templateById,
  type LabelLine,
} from "../src/lib/labels";
import { buildZpl, buildZplLabel, zplEscapeField } from "../src/lib/zpl";

const line = (over: Partial<LabelLine>): LabelLine => ({
  key: "l1",
  name: "Savon",
  code: "4006381333931",
  price: 400,
  qty: 1,
  ...over,
});

describe("lib/labels (C4)", () => {
  it("expandLabels déplie les quantités : réception 3 × 24 → 72 étiquettes", () => {
    const lines = [
      line({ key: "a", name: "Eau 1,5 L", qty: 24 }),
      line({ key: "b", name: "Jus 1 L", qty: 24, code: "5901234123457" }),
      line({ key: "c", name: "Lait 1 L", qty: 24, code: "3017620422003" }),
    ];
    const cells = expandLabels(lines);
    expect(cells).toHaveLength(72);
    expect(cells[0]!.name).toBe("Eau 1,5 L");
    expect(cells[71]!.name).toBe("Lait 1 L");
    // Clés unitaires uniques
    expect(new Set(cells.map((c) => c.key)).size).toBe(72);
  });

  it("expandLabels saute qty 0/négative, arrondit les décimales et exclut les lignes sans code", () => {
    const cells = expandLabels([
      line({ key: "zero", qty: 0 }),
      line({ key: "neg", qty: -3 }),
      line({ key: "dec", qty: 2.6 }),
      line({ key: "nocode", qty: 5, code: null }),
    ]);
    expect(cells).toHaveLength(3); // 2.6 → 3
    expect(cells.every((c) => c.key.startsWith("dec"))).toBe(true);
  });

  it("labelSymbology : EAN-13 valide → EAN13, IMEI 15 chiffres → CODE128, alphabet 39 → CODE39, sinon CODE128", () => {
    expect(labelSymbology("4006381333931")).toBe("EAN13");
    expect(labelSymbology("356938035643809")).toBe("CODE128"); // IMEI
    expect(labelSymbology("FOURN-01")).toBe("CODE39");
    expect(labelSymbology("savon-é")).toBe("CODE128"); // hors alphabet 39
    expect(labelSymbology("1234567890123")).toBe("CODE39"); // non-EAN, chiffres OK 39
  });

  it("gabarits : A4 non-ZPL, 50×30 et 38×25 exportables ZPL", () => {
    expect(LABEL_TEMPLATES.map((t) => t.id)).toEqual([
      "a4-grid",
      "50x30",
      "38x25",
    ]);
    expect(templateById("a4-grid").zpl).toBe(false);
    expect(templateById("50x30").zpl).toBe(true);
    expect(templateById("38x25").zpl).toBe(true);
  });
});

describe("lib/zpl (C4)", () => {
  it("génère un bloc ^XA…^XZ par étiquette, dimensions du gabarit (^PW/^LL) et ^BY", () => {
    const zpl = buildZpl(
      [
        { name: "Eau", code: "FOURN-01", priceText: "400 FCFA" },
        { name: "Jus", code: "FOURN-02", priceText: null },
      ],
      { template: "50x30", shop: "Boutique du Centre" },
    );
    expect(zpl.match(/\^XA/g)).toHaveLength(2);
    expect(zpl.match(/\^XZ/g)).toHaveLength(2);
    expect(zpl).toContain("^PW400"); // 50 mm × 8 pts/mm
    expect(zpl).toContain("^LL240"); // 30 mm
    expect(zpl).toContain("^BY2");
    expect(zpl).toContain("^FD400 FCFA^FS");
    expect(zpl).toContain("^FH_^FDBoutique du Centre^FS"); // enseigne
    // Seconde étiquette : pas de prix
    const second = zpl.split("^XA")[2]!;
    expect(second).not.toContain("FCFA");
    // Gabarit 38×25
    expect(
      buildZplLabel(
        { name: "E", code: "A1", priceText: null },
        { template: "38x25" },
      ),
    ).toContain("^PW304");
    expect(
      buildZplLabel(
        { name: "E", code: "A1", priceText: null },
        { template: "38x25" },
      ),
    ).toContain("^LL200");
  });

  it("symbologie ZPL : ^BE EAN-13, ^B3 Code 39, ^BC pour IMEI", () => {
    expect(
      buildZplLabel(
        { name: "S", code: "4006381333931", priceText: null },
        { template: "50x30" },
      ),
    ).toContain("^BEN,");
    expect(
      buildZplLabel(
        { name: "S", code: "FOURN-01", priceText: null },
        { template: "50x30" },
      ),
    ).toContain("^B3N,");
    expect(
      buildZplLabel(
        { name: "S", code: "356938035643809", priceText: null },
        { template: "50x30" },
      ),
    ).toContain("^BCN,");
  });

  it("échappement ^FH_ : ^ ~ \\ convertis en séquences hexadécimales", () => {
    expect(zplEscapeField("A^B~C\\D")).toBe("A_5EB_7EC_5CD");
    const zpl = buildZplLabel(
      { name: "Café ^ spécial ~ \\", code: "FOURN-01", priceText: null },
      { template: "50x30" },
    );
    expect(zpl).toContain("^FH_");
    expect(zpl).toContain("_5E");
    expect(zpl).toContain("_7E");
    expect(zpl).toContain("_5C");
    // Le caractère brut ^ ne doit plus subsister dans le payload du nom
    expect(zpl).not.toContain("FDCafé ^ spécial");
  });
});
