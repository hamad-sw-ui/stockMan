/** Champ de scan universel (C3) : Entrée/douchette, auto-envoi 350 ms sans
 *  suffixe, anti-double tir, retour visuel et erreur inline. La résolution
 *  HTTP est simulée (vi.mock) — l'enveloppe est testée à part (lookup). */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScanField } from "../src/components/ScanField";
import type { BarcodeLookupResult } from "../src/lib/scanLookup";
import { ApiError } from "../src/lib/http";

const lookupMock = vi.fn();
vi.mock("../src/lib/scanLookup", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/lib/scanLookup")>();
  return { ...mod, lookupBarcode: (code: string) => lookupMock(code) };
});

const baseHit: BarcodeLookupResult = {
  matched: "product",
  productId: "p1",
  productName: "Savon Liquide",
  productBarcode: "6100000000018",
  sellingPrice: 1500,
  purchasePrice: 900,
  taxRate: 19.25,
  wholesalePrice: null,
  wholesaleMinQty: 0,
  requiresSerial: false,
  trackBatch: false,
  hasVariants: false,
  variantId: null,
  variantName: null,
  additionalPrice: 0,
  unitId: null,
  unitSymbol: null,
  unitFactor: 1,
  aliasId: null,
  symbology: "EAN-13",
};

beforeEach(() => {
  cleanup();
  lookupMock.mockReset();
});
afterEach(cleanup);

describe("components/ScanField (C3)", () => {
  it("Entrée résout le code, rappelle le parent et vide le champ", async () => {
    lookupMock.mockResolvedValue(baseHit);
    const onResolve = vi.fn();
    render(<ScanField onResolve={onResolve} />);
    const input = screen.getByLabelText("Champ de scan code-barres");
    await userEvent.type(input, "6100000000018{Enter}");
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(baseHit));
    expect(lookupMock).toHaveBeenCalledWith("6100000000018");
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/✓ Savon Liquide/)).toBeInTheDocument();
  });

  it("Code inconnu (404) : message inline + callback onUnknown, champ conservé", async () => {
    lookupMock.mockRejectedValue(
      new ApiError(404, "BARCODE_UNKNOWN", "introuvable"),
    );
    const onResolve = vi.fn();
    const onUnknown = vi.fn();
    render(<ScanField onResolve={onResolve} onUnknown={onUnknown} />);
    const input = screen.getByLabelText("Champ de scan code-barres");
    await userEvent.type(input, "99999999{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Code inconnu : « 99999999 ».",
      ),
    );
    expect(onResolve).not.toHaveBeenCalled();
    expect(onUnknown).toHaveBeenCalledOnce();
    expect((input as HTMLInputElement).value).toBe("99999999");
  });

  it("Douchette sans suffixe : auto-envoi après 350 ms (≥ 5 caractères)", async () => {
    vi.useFakeTimers();
    try {
      lookupMock.mockResolvedValue(baseHit);
      const onResolve = vi.fn();
      render(<ScanField onResolve={onResolve} />);
      const input = screen.getByLabelText("Champ de scan code-barres");
      fireEvent.change(input, { target: { value: "6100000000018" } });
      expect(lookupMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(400);
      expect(lookupMock).toHaveBeenCalledWith("6100000000018");
      await vi.waitFor(() => expect(onResolve).toHaveBeenCalled());
    } finally {
      vi.useRealTimers();
    }
  });

  it("Anti-double tir : l'auto-envoi ne se répète pas pour le même code", async () => {
    vi.useFakeTimers();
    try {
      lookupMock.mockResolvedValue(baseHit);
      render(<ScanField onResolve={vi.fn()} />);
      const input = screen.getByLabelText("Champ de scan code-barres");
      fireEvent.change(input, { target: { value: "ABC12345" } });
      await vi.advanceTimersByTimeAsync(400);
      expect(lookupMock).toHaveBeenCalledTimes(1); // auto-envoi unique
      // La douchette « maintient » la valeur : aucun second tir automatique.
      await vi.advanceTimersByTimeAsync(2000);
      expect(lookupMock).toHaveBeenCalledTimes(1); // pas de tir répété
    } finally {
      vi.useRealTimers();
    }
  });

  it("Le bouton 📷 n'est rendu que si BarcodeDetector existe (jsdom : absent)", () => {
    render(<ScanField onResolve={vi.fn()} />);
    expect(
      screen.queryByTitle("Scanner avec la caméra"),
    ).not.toBeInTheDocument();
    expect(screen.getByTitle("Rechercher ce code")).toBeInTheDocument();
  });
});
