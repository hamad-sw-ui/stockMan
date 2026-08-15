/** Résolveur de scan caisse (C3) : priorité produit > variante > alias,
 *  geste du conditionnement (unité + facteur rattachés) et inconnus. */
import { describe, expect, it } from "vitest";
import { resolvePosScan } from "../src/lib/posScan";
import type { PosBootstrap } from "../src/lib/types";

const boot: Pick<PosBootstrap, "products" | "barcodes"> = {
  products: [
    {
      id: "p-savon",
      name: "Savon",
      barcode: "6100000000018",
      selling_price: 400,
      purchase_price: 200,
      min_stock_level: 5,
      has_variants: true,
      image_url: null,
      unit_id: "u-pce",
      unit_symbol: "Pce",
      unit_base_value: 1,
      category_name: null,
      variants: [
        {
          id: "v-500",
          name: "500 ml",
          sku: null,
          barcode: "3017620422003",
          additionalPrice: 100,
        },
      ],
    },
  ],
  barcodes: [
    // Code fournisseur (sans unité) puis conditionnement carton ×12
    {
      code: "FOUR-SAVON-01",
      product_id: "p-savon",
      variant_id: null,
      unit_id: null,
      unit_base_value: null,
      unit_symbol: null,
    },
    {
      code: "3590000000010",
      product_id: "p-savon",
      variant_id: null,
      unit_id: "u-ctn",
      unit_base_value: 12,
      unit_symbol: "Ctn",
    },
  ],
};

describe("lib/posScan — resolvePosScan (C3)", () => {
  it("code produit principal → kind product", () => {
    expect(resolvePosScan(boot, "6100000000018")).toEqual({
      kind: "product",
      productId: "p-savon",
    });
  });

  it("code variante → kind variant avec productId parent", () => {
    expect(resolvePosScan(boot, "3017620422003")).toEqual({
      kind: "variant",
      productId: "p-savon",
      variantId: "v-500",
    });
  });

  it("alias fournisseur (sans unité) → kind alias, cible produit", () => {
    expect(resolvePosScan(boot, "FOUR-SAVON-01")).toEqual({
      kind: "alias",
      productId: "p-savon",
      variantId: null,
      unitId: null,
      unitSymbol: null,
      unitBaseValue: null,
    });
  });

  it("code de conditionnement → alias avec unité carton ×12", () => {
    expect(resolvePosScan(boot, "3590000000010")).toEqual({
      kind: "alias",
      productId: "p-savon",
      variantId: null,
      unitId: "u-ctn",
      unitSymbol: "Ctn",
      unitBaseValue: 12,
    });
  });

  it("inconnu / vide / espaces → null", () => {
    expect(resolvePosScan(boot, "INCONNU")).toBeNull();
    expect(resolvePosScan(boot, "   ")).toBeNull();
    // Espaces autour d'un code connu : tolérés (douchette + retro-espace)
    expect(resolvePosScan(boot, "  6100000000018 ")?.kind).toBe("product");
  });

  it("priorité stricte : un code produit ne tombe jamais sur l'alias", () => {
    const clash = {
      products: boot.products,
      barcodes: [
        {
          code: "6100000000018", // doublon déclaré alias du même code produit
          product_id: "p-savon",
          variant_id: null,
          unit_id: "u-ctn",
          unit_base_value: 12,
          unit_symbol: "Ctn",
        },
      ],
    };
    expect(resolvePosScan(clash, "6100000000018")?.kind).toBe("product");
  });
});
