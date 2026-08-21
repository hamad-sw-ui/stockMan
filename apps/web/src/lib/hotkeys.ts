/** Raccourcis clavier globaux (socle d'ergonomie) — hook léger sans dépendance.
 *  - `useHotkeys(map)` : associe une combinaison à un gestionnaire.
 *      * « accord » (modificateur + touche, ex. "ctrl+k") ;
 *      * « touche simple » (ex. "/") ;
 *      * « séquence » (deux touches successives, ex. "g d").
 *  - Ignore les frappes quand le focus est dans un champ de saisie (sauf si
 *    `allowInInput`), pour ne pas court-circuiter la saisie utilisateur. */
import { useEffect, useRef } from "react";

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isChord(combo: string): boolean {
  return !combo.includes(" ");
}

/** Vérifie qu'un « accord » (ex. "ctrl+k") correspond à l'événement. */
function chordMatches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1]!;
  const mods = parts.slice(0, -1);
  const ctrl = mods.some((m) => m === "ctrl" || m === "cmd" || m === "mod");
  const shift = mods.includes("shift");
  const alt = mods.includes("alt");
  if (e.key.toLowerCase() !== key) return false;
  const ctrlPressed = e.ctrlKey || e.metaKey;
  if (ctrlPressed !== ctrl) return false;
  if (e.shiftKey !== shift) return false;
  if (e.altKey !== alt) return false;
  return true;
}

export function useHotkeys(
  map: Record<string, () => void>,
  opts: { allowInInput?: boolean } = {},
): void {
  const mapRef = useRef(map);
  mapRef.current = map;

  const seqRef = useRef<string[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        INPUT_TAGS.has(active.tagName) &&
        !opts.allowInInput
      ) {
        return;
      }

      const chords = Object.keys(mapRef.current).filter(isChord);
      const sequences = Object.keys(mapRef.current).filter((k) => !isChord(k));

      if (sequences.length > 0) {
        seqRef.current.push(e.key.toLowerCase());
        const maxLen = Math.max(
          ...sequences.map((k) => k.trim().split(/\s+/).length),
        );
        if (seqRef.current.length > maxLen) seqRef.current.shift();
        const joined = seqRef.current.join(" ");
        for (const combo of sequences) {
          if (joined.endsWith(combo.toLowerCase())) {
            e.preventDefault();
            seqRef.current = [];
            mapRef.current[combo]?.();
            return;
          }
        }
      }

      for (const combo of chords) {
        if (chordMatches(e, combo)) {
          e.preventDefault();
          mapRef.current[combo]?.();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts.allowInInput]);
}
