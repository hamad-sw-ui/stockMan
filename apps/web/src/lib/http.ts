/** Client HTTP unique : jeton d'accès en mémoire, rafraîchissement silencieux
 *  (cookie httpOnly) avec file d'attente single-flight, erreurs typées. */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenListener = (token: string | null) => void;

let accessToken: string | null = null;
const listeners = new Set<TokenListener>();

export function getAccessToken(): string | null {
  return accessToken;
}
export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((l) => l(token));
}
export function onTokenChange(l: TokenListener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/* ---------------- Rafraîchissement : une seule requête, le reste attend -------------- */
let refreshing: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken?: string };
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    }
  })();
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Réponse brute (CSV, texte) au lieu de JSON. */
  raw?: boolean;
  /** Ne pas tenter le refresh sur 401 (flux auth eux-mêmes). */
  skipAuthRetry?: boolean;
  signal?: AbortSignal;
}

export async function apiFetch<T = unknown>(path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Connexion impossible. Vérifiez votre réseau.');
  }

  if (res.status === 401 && retry && !opts.skipAuthRetry) {
    const ok = await refreshSession();
    if (ok) return apiFetch<T>(path, opts, false);
    setAccessToken(null);
    throw new ApiError(401, 'SESSION_EXPIRED', 'Session expirée. Reconnectez-vous.');
  }

  if (opts.raw) return res as unknown as T;

  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const err = (data.error ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? `Erreur ${res.status}`, err.details);
  }
  return data as T;
}

export const get = <T = unknown>(path: string, opts?: RequestOptions) => apiFetch<T>(path, { ...opts, method: 'GET' });
export const post = <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => apiFetch<T>(path, { ...opts, method: 'POST', body });
export const put = <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => apiFetch<T>(path, { ...opts, method: 'PUT', body });
export const patch = <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => apiFetch<T>(path, { ...opts, method: 'PATCH', body });
export const del = <T = unknown>(path: string, opts?: RequestOptions) => apiFetch<T>(path, { ...opts, method: 'DELETE' });

/** Téléchargement de fichiers (CSV) avec en-têtes d'auth. */
export async function download(path: string, filename: string): Promise<void> {
  const res = await apiFetch<Response>(path, { raw: true });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD', `Téléchargement impossible (${res.status}).`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
