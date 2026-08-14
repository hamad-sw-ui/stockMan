/**
 * ScanField — champ de scan universel (phase C3, docs/06).
 *
 *  - DOUCHETTE USB : les pistoles se comportent en clavier — frappe très
 *    rapide suffixée d'« Entrée » (suffixe par défaut) ; filet de sécurité
 *    pour les douchettes SANS suffixe : auto-envoi après 350 ms sans frappe
 *    (≥ 5 caractères, anti-double tir) ;
 *  - CAMÉRA : bouton 📷 affiché uniquement si `BarcodeDetector` existe
 *    (amélioration progressive, réutilise CameraScanner) ;
 *  - résolution via le résolveur unique `/products/lookup/:code` : les alias
 *    fournisseurs et les codes de conditionnement (carton ×12 → facteur
 *    auto-rempli) fonctionnent donc PARTOUT où ce champ est posé.
 */
import { useRef, useState } from "react";
import { ApiError } from "../lib/http";
import { lookupBarcode, BarcodeLookupResult } from "../lib/scanLookup";
import { CameraScanner, cameraScanSupported } from "./CameraScanner";

const AUTO_MIN_LEN = 5;
const AUTO_DELAY_MS = 350;

export function ScanField({
  onResolve,
  onUnknown,
  placeholder = "Scanner ou saisir un code-barres…",
  autoFocus,
  disabled,
  label,
}: {
  /** Résolution réussie (le champ est vidé, prêt pour le scan suivant). */
  onResolve: (r: BarcodeLookupResult) => void;
  /** Code inconnu / erreur réseau (message déjà francisé). */
  onUnknown?: (code: string, message: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState<string | null>(null);
  const [camOpen, setCamOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoFired = useRef("");

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const resolve = async (codeRaw: string) => {
    const code = codeRaw.trim();
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await lookupBarcode(code);
      setValue("");
      autoFired.current = "";
      setOkFlash(
        `${r.productName}${r.variantName ? ` · ${r.variantName}` : ""}${
          r.unitFactor !== 1 ? ` · ×${r.unitFactor}` : ""
        }`,
      );
      onResolve(r);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 404
          ? `Code inconnu : « ${code} ».`
          : e instanceof Error
            ? e.message
            : "Recherche impossible.";
      setError(msg);
      onUnknown?.(code, msg);
    } finally {
      setBusy(false);
    }
  };

  const onChange = (v: string) => {
    setValue(v);
    setError(null);
    setOkFlash(null);
    clearTimer();
    const t = v.trim();
    if (t.length >= AUTO_MIN_LEN && t !== autoFired.current) {
      timer.current = setTimeout(() => {
        autoFired.current = t;
        void resolve(t);
      }, AUTO_DELAY_MS);
    } else if (t.length < AUTO_MIN_LEN) {
      autoFired.current = "";
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    clearTimer();
    const t = value.trim();
    autoFired.current = t;
    void resolve(t);
  };

  return (
    <div className="scanfield" style={{ minWidth: 220, flex: 1 }}>
      {label ? (
        <label className="muted" style={{ display: "block", fontSize: 12 }}>
          {label}
        </label>
      ) : null}
      <div className="row" style={{ gap: 6, alignItems: "center" }}>
        <input
          className="input"
          style={{ flex: 1 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled || busy}
          inputMode="search"
          aria-label={label ?? "Champ de scan code-barres"}
        />
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => {
            clearTimer();
            autoFired.current = value.trim();
            void resolve(value);
          }}
          disabled={disabled || busy || !value.trim()}
          title="Rechercher ce code"
        >
          🔍
        </button>
        {cameraScanSupported() ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setCamOpen((o) => !o)}
            disabled={disabled || busy}
            title="Scanner avec la caméra"
          >
            📷
          </button>
        ) : null}
      </div>
      {busy ? (
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
          Recherche du code…
        </p>
      ) : null}
      {okFlash && !error ? (
        <p
          role="status"
          style={{ margin: "4px 0 0", fontSize: 12, color: "#047857" }}
        >
          ✓ {okFlash}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          style={{ margin: "4px 0 0", fontSize: 12, color: "#b91c1c" }}
        >
          {error}
        </p>
      ) : null}
      {camOpen ? (
        <CameraScanner
          onDetect={(code) => {
            setCamOpen(false);
            clearTimer();
            void resolve(code);
          }}
          onClose={() => setCamOpen(false)}
        />
      ) : null}
    </div>
  );
}
