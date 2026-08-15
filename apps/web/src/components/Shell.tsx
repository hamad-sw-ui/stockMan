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
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useAuth } from "../store/auth";
import { useToast } from "../store/toast";
import { formatDate, formatRelative } from "../lib/format";
import { get, patch, post, refreshSession, type ApiError } from "../lib/http";
import { countQueued } from "../lib/offline/outbox";
import { onSyncComplete, syncOutbox } from "../lib/offline/sync";
import { setLanguage, SUPPORTED, type SupportedLang } from "../i18n";
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
  const { t } = useTranslation();

  useEffect(() => {
    if (online && queued > 0) {
      setSyncing(true);
      void syncOutbox()
        .then((r) => {
          if (r.synced > 0)
            toast.success(t("shell.offline.syncedToast", { count: r.synced }));
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
    ? queued > 0
      ? t("shell.offline.offlineWithQueue", { count: queued })
      : t("shell.offline.offline")
    : syncing
      ? t("shell.offline.syncing")
      : queued > 0
        ? t("shell.offline.onlineWithQueue", { count: queued })
        : t("shell.offline.online");
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
  const { t } = useTranslation();

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
      toast.success(t("shell.bell.markAllReadToast"));
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
        aria-label={t("shell.bell.aria", { count: unread })}
      >
        🔔
        {unread > 0 ? (
          <span className="dot-badge">{unread > 99 ? "99+" : unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="menu-pop" style={{ minWidth: 320 }}>
          <div className="row-between" style={{ padding: "4px 8px 8px" }}>
            <strong>{t("shell.bell.title")}</strong>
            {unread > 0 ? (
              <button className="link-btn" onClick={() => void markAll()}>
                {t("shell.bell.markAllRead")}
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="muted" style={{ padding: "4px 8px 10px" }}>
              {t("shell.bell.empty")}
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

function adminNav(t: TFunction, outbox: number): NavGroup[] {
  return [
    {
      items: [
        {
          to: "/admin",
          label: t("shell.nav.dashboard"),
          ico: "📊",
          end: true,
        },
      ],
    },
    {
      title: t("shell.nav.sell"),
      items: [
        {
          to: "/admin/caisse",
          label: t("shell.nav.pos"),
          ico: "🧾",
          badge: outbox,
        },
        {
          to: "/admin/sessions-caisse",
          label: t("shell.nav.cashSessions"),
          ico: "💵",
        },
        { to: "/admin/factures", label: t("shell.nav.invoices"), ico: "🧾" },
        {
          to: "/admin/promotions",
          label: t("shell.nav.promotions"),
          ico: "🎁",
        },
        { to: "/admin/clients", label: t("shell.nav.customers"), ico: "🤝" },
        { to: "/admin/devis", label: t("shell.nav.quotes"), ico: "📝" },
        {
          to: "/admin/commandes",
          label: t("shell.nav.purchaseOrders"),
          ico: "📋",
        },
      ],
    },
    {
      title: t("shell.nav.catalog"),
      items: [
        { to: "/admin/produits", label: t("shell.nav.products"), ico: "📦" },
        {
          to: "/admin/categories",
          label: t("shell.nav.categories"),
          ico: "🏷️",
        },
        { to: "/admin/unites", label: t("shell.nav.units"), ico: "📏" },
      ],
    },
    {
      title: t("shell.nav.stock"),
      items: [
        { to: "/admin/depots", label: t("shell.nav.depots"), ico: "🏬" },
        { to: "/admin/receptions", label: t("shell.nav.receipts"), ico: "📥" },
        { to: "/admin/inventaire", label: t("shell.nav.inventory"), ico: "🧮" },
        { to: "/admin/mouvements", label: t("shell.nav.movements"), ico: "↔️" },
        {
          to: "/admin/fournisseurs",
          label: t("shell.nav.suppliers"),
          ico: "🚚",
        },
      ],
    },
    {
      title: t("shell.nav.pilotage"),
      items: [
        { to: "/admin/ventes", label: t("shell.nav.sales"), ico: "💳" },
        { to: "/admin/equipe", label: t("shell.nav.team"), ico: "👥" },
        { to: "/admin/rapports", label: t("shell.nav.reports"), ico: "📈" },
        {
          to: "/admin/notifications",
          label: t("shell.nav.notifications"),
          ico: "🔔",
        },
      ],
    },
    {
      title: t("shell.nav.configuration"),
      items: [
        { to: "/admin/parametres", label: t("shell.nav.settings"), ico: "⚙️" },
        {
          to: "/admin/abonnement",
          label: t("shell.nav.subscription"),
          ico: "💎",
        },
        { to: "/admin/journal", label: t("shell.nav.auditLog"), ico: "🛡️" },
      ],
    },
  ];
}

function vendorNav(t: TFunction, outbox: number): NavGroup[] {
  return [
    {
      items: [
        {
          to: "/caisse",
          label: t("shell.nav.posVendor"),
          ico: "🧾",
          end: true,
        },
        { to: "/caisse/session", label: t("shell.nav.myTill"), ico: "💵" },
        { to: "/caisse/mes-ventes", label: t("shell.nav.mySales"), ico: "💳" },
        { to: "/caisse/stock", label: t("shell.nav.depotStock"), ico: "📦" },
        { to: "/caisse/cloture", label: t("shell.nav.closing"), ico: "🧮" },
        {
          to: "/caisse/file",
          label: t("shell.nav.offlineSync"),
          ico: "🔄",
          badge: outbox,
        },
      ],
    },
  ];
}

function saNav(t: TFunction): NavGroup[] {
  return [
    {
      items: [
        { to: "/sa", label: t("shell.nav.saOverview"), ico: "🌍", end: true },
        { to: "/sa/tenants", label: t("shell.nav.saTenants"), ico: "🏢" },
        { to: "/sa/licences", label: t("shell.nav.saLicenses"), ico: "📜" },
        { to: "/sa/plans", label: t("shell.nav.saPlans"), ico: "🧩" },
        { to: "/sa/configs", label: t("shell.nav.saConfigs"), ico: "🔐" },
        {
          to: "/sa/supervision",
          label: t("shell.nav.saSupervision"),
          ico: "🛰️",
        },
      ],
    },
  ];
}

/* ------------------------------ Bannière licence ---------------------------- */
function LicenseBanner() {
  const { user } = useAuth();
  const { t } = useTranslation();
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
            <strong>
              {t("shell.license.expiredTitle", {
                date: formatDate(lic.end_date),
              })}
            </strong>{" "}
            {t("shell.license.expiredBody")}
          </>
        ) : (
          <>
            <strong>
              {lic.status === "TRIAL"
                ? t("shell.license.trial")
                : t("shell.license.subscription")}{" "}
              : {t("shell.license.daysLeft", { count: days })}
            </strong>{" "}
            {t("shell.license.endsOn", { date: formatDate(lic.end_date) })}
          </>
        )}{" "}
        <Link to="/admin/abonnement" style={{ fontWeight: 700 }}>
          {t("shell.license.viewSubscription")}
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------- Coquille ---------------------------------- */
/** Sélecteur de langue (I1) — compact, posé dans la topbar. */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const current: SupportedLang = i18n.language.startsWith("en") ? "en" : "fr";
  return (
    <select
      className={`select ${className}`}
      style={{ width: "auto", padding: "6px 9px", fontSize: "0.85rem" }}
      value={current}
      onChange={(e) => void setLanguage(e.target.value as SupportedLang)}
      aria-label={t("shell.language.label")}
      title={t("shell.language.label")}
    >
      {SUPPORTED.map((l) => (
        <option key={l} value={l}>
          {l === "fr"
            ? t("shell.language.french")
            : t("shell.language.english")}
        </option>
      ))}
    </select>
  );
}

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
  const { t } = useTranslation();
  const impersonating =
    sessionStorage.getItem("stockman.impersonating") === "1";

  const groups = useMemo(
    () =>
      variant === "sa"
        ? saNav(t)
        : variant === "vendor"
          ? vendorNav(t, queued)
          : adminNav(t, queued),
    [variant, queued, t],
  );
  const roleLabel =
    user?.role === "SUPER_ADMIN"
      ? t("shell.roles.superAdmin")
      : user?.role === "ADMIN"
        ? t("shell.roles.admin")
        : t("shell.roles.vendor");

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const quitImpersonation = async () => {
    sessionStorage.removeItem("stockman.impersonating");
    const ok = await refreshSession();
    if (ok) {
      await refreshUser().catch(() => undefined);
      toast.info(t("shell.impersonation.endedToast"));
      navigate("/sa");
    } else {
      await logout();
      navigate("/login");
    }
  };

  return (
    <div className={`app-shell ${navOpen ? "nav-open" : ""}`}>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <aside className="sidebar" aria-label={t("shell.nav.main")}>
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
              {variant === "sa"
                ? t("shell.brand.saConsole")
                : user?.tenant.name}
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
            title={t("shell.logout")}
            aria-label={t("shell.logout")}
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
            {t("shell.impersonation.active")}
            {user ? t("shell.impersonation.actingAs", { name: user.name }) : ""}
            .
            <button
              className="btn btn-sm"
              style={{ background: "rgba(255,255,255,0.14)", color: "#fff" }}
              onClick={() => void quitImpersonation()}
            >
              {t("shell.impersonation.quit")}
            </button>
          </div>
        ) : null}
        <header className="topbar">
          <button
            className="icon-btn burger"
            onClick={() => setNavOpen(true)}
            aria-label={t("shell.nav.openMenu")}
          >
            ☰
          </button>
          <OfflinePill />
          <span className="spacer" />
          <LanguageSwitcher />
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
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div className="empty" role="alert">
      <span className="emoji">⚠️</span>
      <h3>
        {error.status === 402
          ? t("common.licenseLocked")
          : t("common.loadingError")}
      </h3>
      <p>{error.message}</p>
      {retry ? (
        <button className="btn btn-outline" onClick={retry}>
          {t("common.retry")}
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
