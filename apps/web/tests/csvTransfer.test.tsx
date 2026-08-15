/** D3 — Boutons de transfert CSV (export téléchargement / import + compte-rendu
 *  détaillé). La couche HTTP est simulée (vi.mock) : on vérifie l'enchaînement
 *  fichier → upload brut → modale de rapport, et l'export → download. */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExportCsvButton,
  ImportCsvButton,
} from "../src/components/CsvTransfer";
import { ApiError } from "../src/lib/http";
import { ToastProvider } from "../src/store/toast";

// jsdom 25 n'expose pas Blob.text() : polyfill minimal via FileReader.
if (typeof File.prototype.text !== "function") {
  File.prototype.text = function (this: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(this);
    });
  };
}

const downloadMock = vi.fn();
const uploadMock = vi.fn();
vi.mock("../src/lib/http", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/lib/http")>();
  return {
    ...mod,
    download: (...args: unknown[]) => downloadMock(...args),
    upload: (...args: unknown[]) => uploadMock(...args),
  };
});

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => {
  cleanup();
  downloadMock.mockReset();
  uploadMock.mockReset();
});
afterEach(cleanup);

describe("CsvTransfer — Export", () => {
  it("déclenche le téléchargement du point d'export au clic", async () => {
    downloadMock.mockResolvedValue(undefined);
    renderWithToast(
      <ExportCsvButton
        endpoint="/api/customers/export/csv"
        filename="clients.csv"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    await waitFor(() =>
      expect(downloadMock).toHaveBeenCalledWith(
        "/api/customers/export/csv",
        "clients.csv",
      ),
    );
  });
});

describe("CsvTransfer — Import", () => {
  it("envoie le fichier brut puis affiche le compte-rendu (créés/màj/erreurs)", async () => {
    const onDone = vi.fn();
    uploadMock.mockResolvedValue({
      created: 2,
      updated: 1,
      total: 4,
      errors: [{ ligne: 3, message: "Téléphone invalide" }],
    });
    renderWithToast(
      <ImportCsvButton
        endpoint="/api/customers/import"
        acceptNote="Colonnes : Nom;Téléphone;Ville."
        onDone={onDone}
      />,
    );

    const csv = "Nom;Téléphone\nAlpha;650000001\nBeta;xx\nGamma;650000003\n";
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, {
      target: { files: [new File([csv], "clients.csv", { type: "text/csv" })] },
    });

    // Le contenu est transmis tel quel au serveur (décodage côté API).
    await waitFor(() =>
      expect(uploadMock).toHaveBeenCalledWith("/api/customers/import", csv),
    );

    // Compte-rendu détaillé affiché dans la modale.
    expect(
      await screen.findByText("Compte-rendu de l'import"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ligne 3/)).toBeInTheDocument();
    expect(screen.getByText(/Téléphone invalide/)).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(1);

    // Fermeture de la modale (bouton du pied ; l'en-tête a son propre « Fermer » ✕).
    const closers = screen.getAllByRole("button", { name: "Fermer" });
    fireEvent.click(closers[closers.length - 1]!);
    await waitFor(() =>
      expect(
        screen.queryByText("Compte-rendu de l'import"),
      ).not.toBeInTheDocument(),
    );
  });

  it("signale l'erreur serveur via toast, sans modale ni rafraîchissement", async () => {
    const onDone = vi.fn();
    uploadMock.mockRejectedValue(
      new ApiError(400, "CSV_INVALID", "En-tête inattendue : « Adresse »."),
    );
    renderWithToast(
      <ImportCsvButton
        endpoint="/api/suppliers/import"
        acceptNote="Colonnes : Nom;Téléphone."
        onDone={onDone}
      />,
    );

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File(["Adresse\nYaoundé\n"], "f.csv", { type: "text/csv" }),
        ],
      },
    });

    expect(
      await screen.findByText("En-tête inattendue : « Adresse »."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Compte-rendu de l'import"),
    ).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});
