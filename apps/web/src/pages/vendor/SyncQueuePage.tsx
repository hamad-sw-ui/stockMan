/** File de synchronisation hors-ligne : ventes mises en attente pendant les
 *  coupures réseau, statuts locaux, rejeu manuel et purge des échecs. */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
} from "../../components/ui";
import { formatDateTime, formatMoney } from "../../lib/format";
import {
  listOutbox,
  retryEntry,
  type OutboxEntry,
} from "../../lib/offline/outbox";
import { syncOutbox } from "../../lib/offline/sync";
import { useOnlineStatus } from "../../components/Shell";
import { useToast } from "../../store/toast";

const statusBadge = (t: (k: string) => string, s: OutboxEntry["status"]) =>
  s === "QUEUED" ? (
    <Badge tone="info">{t("pages.syncQueue.statusQueued")}</Badge>
  ) : s === "SYNCING" ? (
    <Badge>{t("pages.syncQueue.statusSyncing")}</Badge>
  ) : (
    <Badge tone="danger">{t("pages.syncQueue.statusFailed")}</Badge>
  );

export default function SyncQueuePage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const online = useOnlineStatus();
  const { show } = useToast();

  const load = useCallback(async () => {
    setEntries(await listOutbox());
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  const syncNow = async () => {
    if (!online) {
      show(t("pages.syncQueue.stillOffline"), "info");
      return;
    }
    setBusy(true);
    try {
      const r = await syncOutbox();
      show(
        r.synced > 0
          ? t("pages.syncQueue.syncedToast", { count: r.synced })
          : r.remaining === 0
            ? t("pages.syncQueue.nothingToSync")
            : t("pages.syncQueue.stuckToast"),
        r.synced > 0 ? "success" : "info",
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id: string) => {
    await retryEntry(id);
    await load();
    void syncNow();
  };

  const failed = entries.filter((e) => e.status === "FAILED");

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <PageHeader
        title={t("shell.nav.offlineSync")}
        sub={t("pages.syncQueue.sub", {
          status: online
            ? `🟢 ${t("shell.offline.online")}`
            : `🔴 ${t("shell.offline.offline")}`,
          count: entries.length,
        })}
        actions={
          <Button
            onClick={syncNow}
            loading={busy}
            disabled={entries.length === 0}
          >
            {t("pages.syncQueue.syncNow")}
          </Button>
        }
      />

      {entries.length === 0 ? (
        <EmptyState emoji="✨" title={t("pages.syncQueue.emptyTitle")}>
          {t("pages.syncQueue.emptyBody")}
        </EmptyState>
      ) : (
        <>
          {failed.length > 0 ? (
            <p className="banner banner-warn" style={{ borderRadius: 10 }}>
              {t("pages.syncQueue.failedBanner", { count: failed.length })}
            </p>
          ) : null}
          <Card pad={false}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("pages.syncQueue.colTicket")}</th>
                    <th>{t("pages.syncQueue.colLocalDate")}</th>
                    <th className="num">{t("common.amount")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("pages.syncQueue.colAttempts")}</th>
                    <th aria-label={t("common.actions")} />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.clientSaleId}>
                      <td>
                        {e.label ?? (
                          <code className="muted">
                            {e.clientSaleId.slice(0, 8)}…
                          </code>
                        )}
                      </td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>
                        {formatDateTime(e.createdAt)}
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {e.total != null ? formatMoney(e.total) : "—"}
                      </td>
                      <td>{statusBadge(t, e.status)}</td>
                      <td className="num muted">{e.attempts}</td>
                      <td>
                        {e.status === "FAILED" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retry(e.clientSaleId)}
                          >
                            {t("common.retry")}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {failed.map((e) => (
            <p
              key={`err-${e.clientSaleId}`}
              className="muted"
              style={{ fontSize: "0.82rem" }}
            >
              ✖️ {e.label ?? e.clientSaleId.slice(0, 8)} : {e.lastError}
            </p>
          ))}
        </>
      )}

      <Card>
        <h3 style={{ marginTop: 0 }}>{t("pages.syncQueue.helpTitle")}</h3>
        <ul
          style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}
          className="muted"
        >
          <li>{t("pages.syncQueue.helpOffline")}</li>
          <li>{t("pages.syncQueue.helpAuto")}</li>
          <li>{t("pages.syncQueue.helpAuthority")}</li>
        </ul>
      </Card>
    </div>
  );
}
