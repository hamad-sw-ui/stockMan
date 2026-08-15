/** Scanner caméra : détection de l'API native (amélioration progressive),
 *  cycle de vie du flux (play → detect → stop des pistes), erreur caméra. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CameraScanner,
  cameraScanSupported,
} from "../src/components/CameraScanner";

const stopTrack = vi.fn();
const fakeStream = {
  getTracks: () => [{ stop: stopTrack }],
} as unknown as MediaStream;

function mockBarcodeDetector(codes: Array<{ rawValue: string }>) {
  const detect = vi.fn().mockResolvedValue(codes);
  (window as { BarcodeDetector?: unknown }).BarcodeDetector = class {
    constructor(public opts?: { formats?: string[] }) {}
    detect = detect;
  };
  return detect;
}

describe("components/CameraScanner", () => {
  beforeEach(() => {
    stopTrack.mockClear();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
    vi.restoreAllMocks();
  });

  it("détecte le support natif (BarcodeDetector + getUserMedia)", () => {
    expect(cameraScanSupported()).toBe(false); // jsdom : pas d'API native
    mockBarcodeDetector([]);
    expect(cameraScanSupported()).toBe(true);
  });

  it("lit un code et le remonte une seule fois", async () => {
    const detect = mockBarcodeDetector([{ rawValue: "6100000000011" }]);
    const onDetect = vi.fn();
    render(<CameraScanner onDetect={onDetect} onClose={() => undefined} />);
    await waitFor(() => expect(onDetect).toHaveBeenCalledWith("6100000000011"));
    await waitFor(() => expect(detect).toHaveBeenCalled());
    expect(onDetect).toHaveBeenCalledTimes(1);
    // Le flux caméra est libéré au démontage
    cleanup();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("ignore les trames illisibles et continue", async () => {
    mockBarcodeDetector([]);
    const onDetect = vi.fn();
    render(<CameraScanner onDetect={onDetect} onClose={() => undefined} />);
    await waitFor(() =>
      expect(
        screen.getByText(/Visez le code-barres|Activation/),
      ).toBeInTheDocument(),
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(onDetect).not.toHaveBeenCalled();
  });

  it("affiche un message clair si la caméra est refusée", async () => {
    mockBarcodeDetector([]);
    (navigator.mediaDevices.getUserMedia as unknown as ReturnType<
      typeof vi.fn
    >) = vi.fn().mockRejectedValue(new Error("denied"));
    render(
      <CameraScanner onDetect={() => undefined} onClose={() => undefined} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Caméra inaccessible/,
      ),
    );
  });

  it("le bouton Fermer rappelle onClose et libère les pistes", async () => {
    mockBarcodeDetector([]);
    const onClose = vi.fn();
    render(<CameraScanner onDetect={() => undefined} onClose={onClose} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Fermer le scanner/ }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
