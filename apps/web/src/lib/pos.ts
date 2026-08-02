/** Bootstrap de caisse : UN appel réseau (catalogue + stocks du dépôt) mis en
 *  cache IndexedDB, avec repli automatique hors-ligne. */
import { useEffect, useState } from "react";
import { get } from "./http";
import { loadBootstrap, saveBootstrap } from "./offline/catalogCache";
import { useAuth } from "../store/auth";
import type { Depot, PosBootstrap } from "./types";

export interface BootstrapStatus {
  data: PosBootstrap | null;
  loading: boolean;
  /** 'network' : ni API ni cache disponibles (première utilisation hors-ligne). */
  error: "network" | null;
  fromCache: boolean;
  /** Dépôt de vente effectif. */
  depotId: string | null;
  /** Dépôts sélectionnables (admin : tous les actifs ; vendeur : le sien). */
  depots: Array<Pick<Depot, "id" | "name" | "is_active">>;
}

export function usePosBootstrap(requestedDepotId?: string): BootstrapStatus {
  const { user } = useAuth();
  const [state, setState] = useState<BootstrapStatus>({
    data: null,
    loading: true,
    error: null,
    fromCache: false,
    depotId: null,
    depots: [],
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));

      // 1) Dépôts autorisés (le vendeur est verrouillé sur le sien)
      let depots: Array<Pick<Depot, "id" | "name" | "is_active">> = [];
      try {
        const all = await get<Depot[]>("/depots");
        depots = all
          .filter((d) => d.is_active)
          .map((d) => ({ id: d.id, name: d.name, is_active: d.is_active }));
      } catch {
        depots = [];
      }
      if (user?.depotId) {
        depots = depots.filter((d) => d.id === user.depotId);
        if (depots.length === 0)
          depots = [{ id: user.depotId, name: "Mon dépôt", is_active: true }];
      }

      const depotId =
        requestedDepotId ?? user?.depotId ?? depots[0]?.id ?? null;
      if (!depotId) {
        if (alive)
          setState({
            data: null,
            loading: false,
            error: "network",
            fromCache: false,
            depotId: null,
            depots,
          });
        return;
      }

      // 2) Réseau d'abord, cache en secours
      try {
        const data = await get<PosBootstrap>(
          `/pos/bootstrap?depotId=${depotId}`,
        );
        saveBootstrap(depotId, data).catch(() => undefined);
        if (alive)
          setState({
            data,
            loading: false,
            error: null,
            fromCache: false,
            depotId,
            depots,
          });
      } catch {
        const cached = await loadBootstrap<PosBootstrap>(depotId).catch(
          () => undefined,
        );
        if (alive) {
          if (cached?.data) {
            setState({
              data: { ...cached.data, depotId },
              loading: false,
              error: null,
              fromCache: true,
              depotId,
              depots,
            });
          } else {
            setState({
              data: null,
              loading: false,
              error: "network",
              fromCache: false,
              depotId,
              depots,
            });
          }
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [requestedDepotId, user?.depotId]);

  return state;
}
