/** Console éditeur — supervision : santé des notifications (7 j), derniers
 *  échecs d'envoi et audit des actions éditeur (support/impersonations). */
import {
  Badge,
  Card,
  ErrorState,
  PageHeader,
  Spinner,
  Tabs,
} from "../../components/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDateTime, notificationTypeLabel } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import type { AuditRow } from "../../lib/types";

interface Supervision {
  byStatus: Array<{ status: string; channel: string; n: number }>;
  lastFailures: Array<{
    created_at: string;
    tenant: string;
    type: string;
    channel: string;
    message: string;
    provider_response: string | null;
  }>;
}

const statusTone = (s: string): "ok" | "danger" | "warn" =>
  s === "SENT" ? "ok" : s === "FAILED" ? "danger" : "warn";

export default function SaSupervisionPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("notifications");
  const notif = useQuery<Supervision>(
    "sa:supervision",
    "/notifications/supervision",
  );
  const audit = useQuery<AuditRow[]>(
    "sa:audit-supervision",
    "/audit-logs/supervision",
  );

  const active =
    tab === "notifications"
      ? notif
      : { loading: audit.loading, error: audit.error };

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.sa.supervision.title")}
        sub={t("pages.sa.supervision.sub")}
      />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "notifications", label: t("pages.sa.supervision.tabNotifs") },
          { id: "audit", label: t("pages.sa.supervision.tabAudit") },
        ]}
      />

      {active.loading ? (
        <Spinner label={t("common.loading")} />
      ) : active.error ? (
        <ErrorState
          error={active.error}
          onRetry={() => invalidateQueries("sa:")}
        />
      ) : tab === "notifications" && notif.data ? (
        <>
          <Card title={t("pages.sa.supervision.byChannelTitle")} pad={false}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("pages.sa.supervision.colChannel")}</th>
                    <th>{t("common.status")}</th>
                    <th className="num">
                      {t("pages.sa.supervision.colCount")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {notif.data.byStatus.map((r, i) => (
                    <tr key={i}>
                      <td>
                        {r.channel === "IN_APP"
                          ? t("pages.sa.supervision.inApp")
                          : r.channel}
                      </td>
                      <td>
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {r.n}
                      </td>
                    </tr>
                  ))}
                  {notif.data.byStatus.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        {t("pages.sa.supervision.noSends")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={t("pages.sa.supervision.failuresTitle")} pad={false}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.date")}</th>
                    <th>{t("pages.sa.supervision.colTenant")}</th>
                    <th>{t("fields.type")}</th>
                    <th>{t("pages.sa.supervision.colMessage")}</th>
                    <th>{t("pages.sa.supervision.colProvider")}</th>
                  </tr>
                </thead>
                <tbody>
                  {notif.data.lastFailures.map((f, i) => (
                    <tr key={i}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>
                        {formatDateTime(f.created_at)}
                      </td>
                      <td>{f.tenant}</td>
                      <td className="muted">{notificationTypeLabel(f.type)}</td>
                      <td style={{ maxWidth: 320 }}>{f.message}</td>
                      <td className="muted" style={{ maxWidth: 220 }}>
                        {f.provider_response ?? "—"}
                      </td>
                    </tr>
                  ))}
                  {notif.data.lastFailures.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        {t("pages.sa.supervision.noFailures")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : audit.data ? (
        <Card title={t("pages.sa.supervision.auditTitle")} pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("pages.sa.supervision.colTenant")}</th>
                  <th>{t("pages.sa.supervision.colAction")}</th>
                  <th>{t("pages.sa.supervision.colEntity")}</th>
                  <th>{t("pages.movements.by")}</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.map((a) => (
                  <tr key={a.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(a.created_at)}
                    </td>
                    <td>{a.tenant_name}</td>
                    <td>
                      <Badge
                        tone={a.action === "IMPERSONATE" ? "warn" : "info"}
                      >
                        {a.action}
                      </Badge>
                    </td>
                    <td className="muted">{a.entity}</td>
                    <td className="muted">{a.user_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
