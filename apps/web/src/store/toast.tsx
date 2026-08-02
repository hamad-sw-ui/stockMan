import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  message: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push(kind: Toast['kind'], message: string): void;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: Toast['kind'], message: string) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 6500 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toasts, push, dismiss }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)} style={{ cursor: 'pointer' }}>
            <span>{t.kind === 'ok' ? '✅' : t.kind === 'error' ? '⚠️' : 'ℹ️'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé dans <ToastProvider>');
  return {
    success: (m: string) => ctx.push('ok', m),
    error: (m: string) => ctx.push('error', m),
    info: (m: string) => ctx.push('info', m),
    /** Variante générique : kind 'success' | 'error' | 'info'. */
    show: (m: string, kind: 'success' | 'error' | 'info' = 'info') =>
      ctx.push(kind === 'success' ? 'ok' : kind, m),
  };
}
