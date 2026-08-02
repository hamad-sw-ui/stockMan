import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/* ---------------------------------- Bouton --------------------------------- */
type BtnVariant = "primary" | "outline" | "danger" | "danger-soft" | "ghost";
export function Button({
  variant = "primary",
  size,
  block,
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: "sm" | "lg";
  block?: boolean;
  loading?: boolean;
}) {
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "",
    block ? "btn-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? (
        <span
          className="spinner"
          style={{ width: 15, height: 15, borderWidth: 2 }}
        />
      ) : null}
      {children}
    </button>
  );
}

/* ----------------------------------- Card ---------------------------------- */
export function Card({
  children,
  pad = true,
  className = "",
  title,
  actions,
}: {
  children: ReactNode;
  pad?: boolean;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`card ${pad ? "card-pad" : ""} ${className}`}>
      {title || actions ? (
        <div className="panel-title">
          <div>{typeof title === "string" ? <h2>{title}</h2> : title}</div>
          <div className="row">{actions}</div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* ---------------------------------- Champs --------------------------------- */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label?: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label ? (
        <label>
          {label}{" "}
          {required ? <span style={{ color: "var(--danger)" }}>*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <span style={{ color: "var(--danger)", fontSize: "0.8rem" }}>
          {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input" rows={3} {...props} />;
}
export function Select({
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className="select" {...rest}>
      {children}
    </select>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Rechercher…",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="input-icon" style={{ flex: 1, minWidth: 180 }}>
      <span>🔎</span>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
      />
    </div>
  );
}

/* --------------------------------- Divers UI -------------------------------- */
export function Badge({
  tone,
  children,
  dot,
}: {
  tone?: "ok" | "warn" | "danger" | "info";
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={`badge ${tone ? `badge-${tone}` : ""} ${dot ? "badge-dot" : ""}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center" role="status">
      <span className="spinner" />
      {label ? (
        <span className="muted" style={{ marginLeft: 10 }}>
          {label}
        </span>
      ) : null}
    </div>
  );
}

export function EmptyState({
  emoji = "📭",
  title,
  children,
  action,
}: {
  emoji?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="emoji" aria-hidden>
        {emoji}
      </span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: ReactNode }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={t.id === active ? "active" : ""}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>{total} élément(s)</span>
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        ← Préc.
      </Button>
      <span>
        Page {page} / {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Suiv. →
      </Button>
    </nav>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: "ok" | "warn" | "danger";
}) {
  return (
    <div className="card kpi">
      <span className="kpi-label">{label}</span>
      <span
        className="kpi-value"
        style={
          tone
            ? {
                color: `var(--${tone === "ok" ? "ok" : tone === "warn" ? "warn" : "danger"})`,
              }
            : undefined
        }
      >
        {value}
      </span>
      {sub ? <span className="kpi-sub">{sub}</span> : null}
    </div>
  );
}

/* ---------------------------------- Modale ---------------------------------- */
export function Modal({
  title,
  onClose,
  children,
  wide,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current
      ?.querySelector<HTMLElement>("input, select, textarea, button")
      ?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        className={`modal ${wide ? "modal-lg" : ""}`}
        role="dialog"
        aria-modal="true"
        ref={ref}
      >
        <div className="row-between" style={{ marginBottom: 14 }}>
          <h2>{title}</h2>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        {children}
        {footer ? (
          <div
            className="row"
            style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Boîte de confirmation destructive. */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirmer",
  danger = true,
  onConfirm,
  onClose,
  loading,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div>{message}</div>
    </Modal>
  );
}

/* ------------------------------- Page header -------------------------------- */
export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="row-between" style={{ marginBottom: 16 }}>
      <div>
        <h1>{title}</h1>
        {sub ? (
          <div className="muted" style={{ fontSize: "0.92rem" }}>
            {sub}
          </div>
        ) : null}
      </div>
      <div className="row">{actions}</div>
    </div>
  );
}

/* ------------------------------ États réseau -------------------------------- */
export function ErrorState({
  error,
  onRetry,
}: {
  error: { message?: string; status?: number } | null;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      emoji="⚠️"
      title={
        error?.status === 402
          ? "Fonction verrouillée par la licence"
          : "Chargement impossible"
      }
      action={
        onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            Réessayer
          </Button>
        ) : undefined
      }
    >
      {error?.message}
    </EmptyState>
  );
}
