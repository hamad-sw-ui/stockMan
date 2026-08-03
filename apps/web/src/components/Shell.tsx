/** Coquille applicative : barre latérale par rôle, topbar (cloche de
 *  notifications, indicateur hors-ligne/sync, menu utilisateur), bannières
 *  licence + impersonation. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "../store/auth";
import { useToast } from "../store/toast";
import { formatDate, formatRelative } from "../lib/format";
import { get, patch, post, refreshSession, type ApiError } from "../lib/http";
import { countQueued } from "../lib/offline/outbox";
import { onSyncComplete, syncOutbox } from "../lib/offline/sync";
import type { NotificationRow, Paged } from "../lib/types";

/* ------------------------------ Hooks réseau ------------------------------- */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/** Nombre de ventes en file hors-ligne, rafraîchi au fil des syncs. */
export function useOutboxCount(pollMs = 12_000): {
  queued: number;
  refresh: () => Promise<void>;
} {
  const [queued, setQueued] = useState(0);
  const refresh = useCallback(async () => {
    try {
      setQueued(await countQueued());
    } catch {
      /* IndexedDB indisponible : ignorer */
    }
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    const off = onSyncComplete(() => void refresh());
    const onVis = () => void refresh();
    window.addEventListener("focus", onVis);
    return () => {
      clearInterval(id);
      off();
      window.removeEventListener("focus", onVis);
    };
  }, [refresh, pollMs]);
  return { queued, refresh };
}

/* --------------------------- Indicateur hors-ligne -------------------------- */
function OfflinePill() {
  const online = useOnlineStatus();
  const { queued, refresh } = useOutboxCount();
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (online && queued > 0) {
      setSyncing(true);
      void syncOutbox()
        .then((r) => {
          if (r.synced > 0)
            toast.success(`${r.synced} vente(s) hors-ligne synchronisée(s).`);
        })
        .finally(() => {
          setSyncing(false);
          void refresh();
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const cls = !online ? "off" : syncing ? "syncing" : "";
  const text = !online
    ? `Hors ligne${queued > 0 ? ` — ${queued} en file` : ""}`
    : syncing
      ? "Synchronisation…"
      : queued > 0
        ? `En ligne — ${queued} en file`
        : "En ligne";
  return (
    <span className={`offline-pill ${cls}`} title={text} aria-live="polite">
      <span className="pulse" />
      {text}
    </span>
  );
}

/* ----------------------------- Cloche de notifications ---------------------- */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const r = await get<Paged<NotificationRow> & { unread: number }>(
        "/notifications?size=6",
      );
      setItems(r.data);
      setUnread(r.unread ?? 0);
    } catch {
      /* silencieux */
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 45_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const markAll = async () => {
    try {
      await post("/notifications/read-all");
      toast.success("Notifications marquées comme lues.");
      void load();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button
        className="icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications (${unread} non lues)`}
      >
        🔔
        {unread > 0 ? (
          <span className="dot-badge">{unread > 99 ? "99+" : unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="menu-pop" style={{ minWidth: 320 }}>
          <div className="row-between" style={{ padding: "4px 8px 8px" }}>
            <strong>Notifications</strong>
            {unread > 0 ? (
              <button className="link-btn" onClick={() => void markAll()}>
                Tout lire
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="muted" style={{ padding: "4px 8px 10px" }}>
              Aucune notification récente.
            </p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                className="menu-item"
                style={{
                  alignItems: "flex-start",
                  flexDirection: "column",
                  gap: 2,
                }}
                onClick={async () => {
                  if (n.status === "SENT" && n.channel === "IN_APP") {
                    await patch(`/notifications/${n.id}/read`).catch(
                      () => undefined,
                    );
                    void load();
                  }
                }}
              >
                <span
                  style={{
                    fontWeight:
                      n.status === "SENT" && n.channel === "IN_APP" ? 700 : 500,
                  }}
                >
                  {n.message}
                </span>
                <span className="muted" style={{ fontSize: "0.76rem" }}>
                  {formatRelative(n.created_at)}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------- Navigation -------------------------------- */
interface NavItem {
  to: string;
  label: string;
  ico: string;
  end?: boolean;
  badge?: number;
}
interface NavGroup {
  title?: string;
  items: NavItem[];
}

function adminNav(outbox: number): NavGroup[] {
  return [
    {
      items: [{ to: "/admin", label: "Tableau de bord", ico: "📊", end: true }],
    },
    {
      title: "Vendre",
      items: [
        {
          to: "/admin/caisse",
          label: "Caisse (POS)",
          ico: "🧾",
          badge: outbox,
        },
        {
          to: "/admin/sessions-caisse",
          label: "Sessions de caisse",
          ico: "💵",
        },
        { to: "/admin/factures", label: "Factures & avoirs", ico: "🧾" },
        { to: "/admin/promotions", label: "Promotions", ico: "🎁" },
        { to: "/admin/clients", label: "Clients & crédit", ico: "🤝" },
        { to: "/admin/devis", label: "Devis & proforma", ico: "📝" },
        { to: "/admin/commandes", label: "Achats fournisseurs", ico: "📋" },
      ],
    },
    {
      title: "Catalogue",
      items: [
        { to: "/admin/produits", label: "Produits", ico: "📦" },
        { to: "/admin/categories", label: "Catégories", ico: "🏷️" },
        { to: "/admin/unites", label: "Unités", ico: "📏" },
      ],
    },
    {
      title: "Stock",
      items: [
        { to: "/admin/depots", label: "Dépôts & transferts", ico: "🏬" },
        { to: "/admin/receptions", label: "Réceptions", ico: "📥" },
        { to: "/admin/inventaire", label: "Inventaire", ico: "🧮" },
        { to: "/admin/mouvements", label: "Mouvements", ico: "↔️" },
        { to: "/admin/fournisseurs", label: "Fournisseurs", ico: "🚚" },
      ],
    },
    {
      title: "Pilotage",
      items: [
        { to: "/admin/ventes", label: "Ventes", ico: "💳" },
        { to: "/admin/equipe", label: "Équipe", ico: "👥" },
        { to: "/admin/rapports", label: "Rapports", ico: "📈" },
        { to: "/admin/notifications", label: "Notifications", ico: "🔔" },
      ],
    },
    {
      title: "Configuration",
      items: [
        { to: "/admin/parametres", label: "Paramètres", ico: "⚙️" },
        { to: "/admin/abonnement", label: "Abonnement", ico: "💎" },
        { to: "/admin/journal", label: "Journal d'audit", ico: "🛡️" },
      ],
    },
  ];
}

function vendorNav(outbox: number): NavGroup[] {
  return [
    {
      items: [
        { to: "/caisse", label: "Caisse", ico: "🧾", end: true },
        { to: "/caisse/session", label: "Ma caisse", ico: "💵" },
        { to: "/caisse/mes-ventes", label: "Mes ventes", ico: "💳" },
        { to: "/caisse/stock", label: "Stock du dépôt", ico: "📦" },
        { to: "/caisse/cloture", label: "Clôture (Z)", ico: "🧮" },
        {
          to: "/caisse/file",
          label: "Synchro hors-ligne",
          ico: "🔄",
          badge: outbox,
        },
      ],
    },
  ];
}

function saNav(): NavGroup[] {
  return [
    {
      items: [
        { to: "/sa", label: "Vue d'ensemble", ico: "🌍", end: true },
        { to: "/sa/tenants", label: "Tenants", ico: "🏢" },
        { to: "/sa/licences", label: "Licences", ico: "📜" },
        { to: "/sa/plans", label: "Plans", ico: "🧩" },
        { to: "/sa/configs", label: "Configurations", ico: "🔐" },
        { to: "/sa/supervision", label: "Supervision", ico: "🛰️" },
      ],
    },
  ];
}

/* ------------------------------ Bannière licence ---------------------------- */
function LicenseBanner() {
  const { user } = useAuth();
  if (!user || user.role !== "ADMIN" || !user.license) return null;
  const lic = user.license;
  const days = Math.ceil(
    (new Date(lic.end_date).getTime() - Date.now()) / 86_400_000,
  );
  if (lic.status !== "EXPIRED" && days > 7) return null;
  const expired = lic.status === "EXPIRED" || days < 0;
  return (
    <div
      className="license-banner"
      role="alert"
      style={
        expired
          ? {
              background: "var(--danger-soft)",
              borderColor: "var(--danger)",
              color: "var(--danger)",
            }
          : undefined
      }
    >
      <span>{expired ? "⛔" : "⏳"}</span>
      <div>
        {expired ? (
          <>
            <strong>Licence expirée le {formatDate(lic.end_date)}.</strong> Les
            nouvelles opérations (ventes, stocks) sont bloquées tant que
            l&apos;abonnement n&apos;est pas renouvelé.
          </>
        ) : (
          <>
            <strong>
              {lic.status === "TRIAL" ? "Essai" : "Abonnement"} : {days} jour(s)
              restant(s)
            </strong>{" "}
            (fin le {formatDate(lic.end_date)}).
          </>
        )}{" "}
        <Link to="/admin/abonnement" style={{ fontWeight: 700 }}>
          Voir l&apos;abonnement →
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------- Coquille ---------------------------------- */
export default function Shell({
  variant,
}: {
  variant: "admin" | "vendor" | "sa";
}) {
  const { user, logout, refreshUser } = useAuth();
  const { queued } = useOutboxCount();
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const impersonating =
    sessionStorage.getItem("stockman.impersonating") === "1";

  const groups = useMemo(
    () =>
      variant === "sa"
        ? saNav()
        : variant === "vendor"
          ? vendorNav(queued)
          : adminNav(queued),
    [variant, queued],
  );
  const roleLabel =
    user?.role === "SUPER_ADMIN"
      ? "Super Admin"
      : user?.role === "ADMIN"
        ? "Gérant"
        : "Vendeur";

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const quitImpersonation = async () => {
    sessionStorage.removeItem("stockman.impersonating");
    const ok = await refreshSession();
    if (ok) {
      await refreshUser().catch(() => undefined);
      toast.info("Session support terminée.");
      navigate("/sa");
    } else {
      await logout();
      navigate("/login");
    }
  };

  return (
    <div className={`app-shell ${navOpen ? "nav-open" : ""}`}>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="side-brand">
          <span className="logo-dot">
            {user?.tenant.logo ? (
              <img
                src={user.tenant.logo}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  borderRadius: 10,
                }}
              />
            ) : (
              "📦"
            )}
          </span>
          <div>
            StockMan
            <small>
              {variant === "sa" ? "Console éditeur" : user?.tenant.name}
            </small>
          </div>
        </div>
        <nav className="side-nav">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.title ? <div className="side-group">{g.title}</div> : null}
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) =>
                    `side-link ${isActive ? "active" : ""}`
                  }
                >
                  <span className="ico" aria-hidden>
                    {it.ico}
                  </span>
                  {it.label}
                  {it.badge ? <span className="count">{it.badge}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-user">
          <span className="avatar" aria-hidden>
            {user?.name?.slice(0, 1).toUpperCase()}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="name"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user?.name}
            </div>
            <div className="role">{roleLabel}</div>
          </div>
          <button
            className="icon-btn"
            style={{
              background: "transparent",
              borderColor: "rgba(255,255,255,0.15)",
              color: "#cbd5e1",
            }}
            title="Se déconnecter"
            aria-label="Se déconnecter"
            onClick={() => {
              void logout().then(() => navigate("/login"));
            }}
          >
            ⏻
          </button>
        </div>
      </aside>
      <div className="main-col">
        {impersonating ? (
          <div className="impersonation-banner" role="alert">
            🛠️ Session support éditeur active
            {user
              ? ` — vous agissez en tant que ${user.name} (actions journalisées)`
              : ""}
            .
            <button
              className="btn btn-sm"
              style={{ background: "rgba(255,255,255,0.14)", color: "#fff" }}
              onClick={() => void quitImpersonation()}
            >
              Quitter
            </button>
          </div>
        ) : null}
        <header className="topbar">
          <button
            className="icon-btn burger"
            onClick={() => setNavOpen(true)}
            aria-label="Ouvrir le menu"
          >
            ☰
          </button>
          <OfflinePill />
          <span className="spacer" />
          {variant !== "sa" ? <NotificationBell /> : null}
        </header>
        <main className={`page ${variant === "vendor" ? "page-wide" : ""}`}>
          <LicenseBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Enveloppe de page avec garde d'erreurs standard. */
export function PageError({
  error,
  retry,
}: {
  error: ApiError | null;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="empty" role="alert">
      <span className="emoji">⚠️</span>
      <h3>
        {error.status === 402
          ? "Fonction verrouillée par la licence"
          : "Chargement impossible"}
      </h3>
      <p>{error.message}</p>
      {retry ? (
        <button className="btn btn-outline" onClick={retry}>
          Réessayer
        </button>
      ) : null}
    </div>
  );
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} — StockMan`;
    return () => {
      document.title = "StockMan";
    };
  }, [title]);
}

export type { ReactNode };
