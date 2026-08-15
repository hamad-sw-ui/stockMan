/**
 * D3 — Transferts CSV partagés : bouton Export (téléchargement) et bouton
 * Import (fichier → envoi brut → compte-rendu détaillé créés/mis à jour/
 * lignes refusées avec motif). Posé sur les pages Clients et Fournisseurs ;
 * miroir rigoureux de l'ergonomie historique de la page Produits.
 */
import { useRef, useState } from "react";
import { download, upload } from "../lib/http";
import { useToast } from "../store/toast";
import { Button, Modal } from "./ui";

export interface CsvImportReport {
  created: number;
  updated: number;
  total: number;
  errors: Array<{ ligne: number; message: string }>;
}

export function ExportCsvButton({
  endpoint,
  filename,
}: {
  endpoint: string;
  filename: string;
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const act = async () => {
    setBusy(true);
    try {
      await download(endpoint, filename);
    } catch (e) {
      show(e instanceof Error ? e.message : "Export impossible", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="sm" loading={busy} onClick={act}>
      ⬇️ Export CSV
    </Button>
  );
}

export function ImportCsvButton({
  endpoint,
  acceptNote,
  onDone,
}: {
  endpoint: string;
  /** Rappel des colonnes attendues (affiché dans la modale de compte-rendu). */
  acceptNote: string;
  onDone?: () => void;
}) {
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CsvImportReport | null>(null);

  const send = async (file: File) => {
    const text = await file.text();
    setBusy(true);
    try {
      const r = await upload<CsvImportReport>(endpoint, text);
      setReport(r);
      if (r.errors.length === 0)
        show(
          `Import terminé : ${r.created} créés, ${r.updated} mis à jour.`,
          "success",
        );
      else
        show(
          `${r.created + r.updated}/${r.total} lignes importées, ${r.errors.length} erreur(s).`,
          "error",
        );
      if (r.created + r.updated > 0) onDone?.();
    } catch (e) {
      show(e instanceof Error ? e.message : "Import impossible", "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        loading={busy}
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        ⬆️ Import CSV
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void send(f);
        }}
      />
      {report ? (
        <Modal
          title="Compte-rendu de l'import"
          onClose={() => setReport(null)}
          footer={<Button onClick={() => setReport(null)}>Fermer</Button>}
        >
          <p style={{ marginTop: 0 }}>
            <strong>{report.created}</strong> créés ·{" "}
            <strong>{report.updated}</strong> mis à jour ·{" "}
            <strong>{report.errors.length}</strong> erreur(s) sur {report.total}{" "}
            lignes.
          </p>
          {report.errors.length > 0 ? (
            <div
              style={{
                maxHeight: 240,
                overflowY: "auto",
                fontSize: "0.85rem",
                border: "1px solid var(--line, #e2e8f0)",
                borderRadius: 8,
                padding: 8,
              }}
            >
              {report.errors.map((e, i) => (
                <p key={i} style={{ margin: "4px 0" }}>
                  <strong>Ligne {e.ligne}</strong> — {e.message}
                </p>
              ))}
              <p className="muted" style={{ marginBottom: 0 }}>
                Corrigez les lignes concernées puis relancez le fichier (les
                lignes déjà importées sont mises à jour, pas dupliquées).{" "}
                {acceptNote}
              </p>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
