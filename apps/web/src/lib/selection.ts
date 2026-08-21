/** Sélection multiple générique (actions groupées) — socle partagé par les
 *  listes (catalogue, clients, fournisseurs…). Ensemble d'identifiants avec
 *  bascule unitaire, « tout sélectionner » (page visible) et effacement. */
import { useCallback, useMemo, useState } from "react";

export interface Selection<T extends string = string> {
  /** Identifiants actuellement sélectionnés (immuable, ordre d'insertion). */
  selected: Set<T>;
  /** Nombre d'éléments sélectionnés. */
  size: number;
  /** Bascule un identifiant. */
  toggle: (id: T) => void;
  /** Sélectionne (true) ou désélectionne (false) toute une page. */
  toggleAll: (ids: Iterable<T>, on: boolean) => void;
  /** Efface la sélection. */
  clear: () => void;
  /** Vrai si l'identifiant est sélectionné. */
  has: (id: T) => boolean;
  /** Tableau des identifiants sélectionnés. */
  ids: () => T[];
  /** Remplace la sélection entière. */
  set: (ids: Iterable<T>) => void;
}

export function useSelection<T extends string = string>(): Selection<T> {
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const toggle = useCallback((id: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const set = useCallback((ids: Iterable<T>) => {
    setSelected(new Set(ids));
  }, []);

  const toggleAll = useCallback((ids: Iterable<T>, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const has = useCallback((id: T) => selected.has(id), [selected]);

  const ids = useCallback(() => [...selected], [selected]);

  return useMemo(
    () => ({ selected, size: selected.size, toggle, toggleAll, clear, has, ids, set }),
    [selected, toggle, toggleAll, clear, has, ids, set],
  );
}
