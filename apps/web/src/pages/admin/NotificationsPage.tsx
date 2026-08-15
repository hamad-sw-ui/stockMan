/** Centre de notifications : historique des envois + marquage lus.
 *  Les paramètres d'alertes SMS/WhatsApp sont dans Paramètres > Alertes. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Spinner,
} from "../../components/ui";
import { patch, post } from "../../lib/http";
import { formatDateTime, notificationTypeLabel } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { NotificationRow, Paged } from "../../lib/types";

const statusTone = (s: string): "ok" | "warn" | "danger" | "info" =>
  s === "SENT"
    ? "ok"
    : s === "FAILED"
      ? "danger"
      : s === "READ"
        ? "info"
        : "warn";
/** Libellés de statut/canal via i18n (FR = source historique). */
const notifStatusLabel = (t: (k: string) => string, s: string): string =>
  s === "SENT"
    ? t("pages.notifications.statusSent")
    : s === "FAILED"
      ? t("pages.notifications.statusFailed")
      : s === "READ"
        ? t("pages.notifications.statusRead")
        : t("pages.notifications.statusPending");
const channelLabel = (t: (k: string) => string, c: string): string =>
  c === "IN_APP" ? t("pages.notifications.channelInApp") : c;

export default function NotificationsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const path = `/notifications?page=${page}&size=25${status ? `&status=${status}` : ""}`;
  const q = useQuery<Paged<NotificationRow> & { unread: number }>(
    `notifications:${path}`,
    path,
  );
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  const markAll = async () => {
    setBusy(true);
    try {
      await post("/notifications/read-all");
      invalidateQueries("notifications:");
      show(t("pages.notifications.markAllToast"), "success");
    } catch (e) {
      show(e instanceof Error ? e.message : t("common.unknownError"), "error");
    } finally {
      setBusy(false);
    }
  };

  const markOne = async (id: string) => {
    try {
      await patch(`/notifications/${id}/read`);
      invalidateQueries("notifications:");
    } catch (e) {
      show(e instanceof Error ? e.message : t("common.unknownError"), "error");
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.notifications.title")}
        sub={t("pages.notifications.sub")}
        actions={
          <>
            {q.data && q.data.unread > 0 ? (
              <Button
                variant="outline"
                size="sm"
                loading={busy}
                onClick={markAll}
              >
                {t("pages.notifications.markAll", { count: q.data.unread })}
              </Button>
            ) : null}
            <Link className="btn btn-outline btn-sm" to="/admin/parametres">
              {t("pages.notifications.settingsLink")}
            </Link>
          </>
        }
      />

      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <select
          className="select"
          style={{ width: "auto" }}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label={t("pages.notifications.filterAria")}
        >
          <option value="">{t("pages.notifications.filterAll")}</option>
          <option value="PENDING">
            {t("pages.notifications.statusPending")}
          </option>
          <option value="SENT">{t("pages.notifications.filterSent")}</option>
          <option value="FAILED">
            {t("pages.notifications.filterFailed")}
          </option>
          <option value="READ">{t("pages.notifications.filterRead")}</option>
        </select>
      </div>

      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("notifications:")}
        />
      ) : !q.data?.data.length ? (
        <EmptyState emoji="🔕" title={t("pages.notifications.empty")}>
          {t("pages.notifications.emptyBody")}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.notifications.colMessage")}</th>
                  <th>{t("fields.type")}</th>
                  <th>{t("pages.notifications.colChannel")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("common.date")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((n) => (
                  <tr
                    key={n.id}
                    style={
                      n.channel === "IN_APP" && n.status === "SENT"
                        ? { fontWeight: 700 }
                        : undefined
                    }
                  >
                    <td style={{ maxWidth: 420 }}>{n.message}</td>
                    <td className="muted">{notificationTypeLabel(n.type)}</td>
                    <td className="muted">{channelLabel(t, n.channel)}</td>
                    <td>
                      <Badge tone={statusTone(n.status)}>
                        {notifStatusLabel(t, n.status)}
                      </Badge>
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(n.created_at)}
                    </td>
                    <td>
                      {n.channel === "IN_APP" && n.status === "SENT" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markOne(n.id)}
                        >
                          {t("pages.notifications.markRead")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {q.data ? (
        <Pagination
          page={q.data.page}
          totalPages={q.data.totalPages}
          total={q.data.total}
          onPage={setPage}
        />
      ) : null}
    </div>
  );
}
