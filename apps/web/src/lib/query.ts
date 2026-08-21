/** Mini-couche de requêtes (fetch + cache léger + invalidation) —
 *  volontairement simple et testable. */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, get } from "./http";

interface QueryState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean; // premier chargement
  refetching: boolean;
  refetch: () => Promise<void>;
}

const cache = new Map<string, { data: unknown; at: number }>();
const CACHE_TTL = 15_000;

/**
 * Auditeurs d'invalidation : chaque `useQuery` monté s'abonne pour pouvoir
 * re-fetcher immédiatement lorsque `invalidateQueries` est appelé. Sans ce
 * mécanisme, vider la Map de cache ne suffisait pas : les composants déjà
 * montés gardaient leur état local (stale) et ne se mettaient jamais à jour
 * après une mutation (création / édition / suppression).
 */
type InvalidateListener = (prefix?: string) => void;
const invalidateListeners = new Set<InvalidateListener>();

export function invalidateQueries(prefix?: string): void {
  if (!prefix) cache.clear();
  else for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
  for (const listener of [...invalidateListeners]) listener(prefix);
}

/** S'abonne aux invalidations ; renvoie la fonction de désabonnement. */
export function onInvalidate(listener: InvalidateListener): () => void {
  invalidateListeners.add(listener);
  return () => {
    invalidateListeners.delete(listener);
  };
}

export function useQuery<T = unknown>(
  key: string,
  path: string | null,
): QueryState<T> {
  const [state, setState] = useState<{
    data?: T;
    error: ApiError | null;
    loading: boolean;
    refetching: boolean;
  }>(() => {
    const hit = path ? cache.get(key) : undefined;
    return {
      data:
        hit && Date.now() - hit.at < CACHE_TTL ? (hit.data as T) : undefined,
      error: null,
      loading: !!path && !hit,
      refetching: false,
    };
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchIt = useCallback(
    async (background = false) => {
      if (!path) return;
      if (!background)
        setState((s) => ({
          ...s,
          loading: !s.data,
          refetching: !!s.data,
          error: null,
        }));
      try {
        const data = await get<T>(path);
        cache.set(key, { data, at: Date.now() });
        if (alive.current)
          setState({ data, error: null, loading: false, refetching: false });
      } catch (e) {
        const err =
          e instanceof ApiError
            ? e
            : new ApiError(0, "ERROR", "Erreur inattendue.");
        if (alive.current)
          setState((s) => ({
            ...s,
            error: err,
            loading: false,
            refetching: false,
          }));
      }
    },
    [key, path],
  );

  useEffect(() => {
    const hit = cache.get(key);
    const fresh = hit && Date.now() - hit.at < CACHE_TTL;
    if (path && !fresh) void fetchIt();
    else if (fresh)
      setState({
        data: hit!.data as T,
        error: null,
        loading: false,
        refetching: false,
      });
  }, [key, path, fetchIt]);

  // Re-fetch automatique lorsqu'une mutation invalide notre préfixe de cache.
  useEffect(() => {
    const handler: InvalidateListener = (prefix) => {
      if (!path) return;
      if (!prefix || key.startsWith(prefix)) void fetchIt(true);
    };
    return onInvalidate(handler);
  }, [key, path, fetchIt]);

  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    refetching: state.refetching,
    refetch: useCallback(() => fetchIt(true), [fetchIt]),
  };
}

interface MutationState<TVars, TData> {
  run: (vars: TVars) => Promise<TData>;
  loading: boolean;
  error: ApiError | null;
}

export function useMutation<TVars = void, TData = unknown>(
  fn: (vars: TVars) => Promise<TData>,
  opts?: { invalidate?: string[] },
): MutationState<TVars, TData> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(
    async (vars: TVars) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fn(vars);
        if (opts?.invalidate)
          for (const p of opts.invalidate) invalidateQueries(p);
        return data;
      } catch (e) {
        const err =
          e instanceof ApiError
            ? e
            : new ApiError(0, "ERROR", "Erreur inattendue.");
        if (alive.current) setError(err);
        throw err;
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    [fn, opts],
  );

  return { run, loading, error };
}
