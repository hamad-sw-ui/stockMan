/** Console éditeur — vue d'ensemble : tenants, MRR, CA plateforme, essais
 *  arrivant à échéance et santé des notifications. */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  ErrorState,
  Kpi,
  PageHeader,
  Spinner,
} from "../../components/ui";
import { formatDate, formatMoney, formatQty } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import type { SaStats } from "../../lib/types";

export default function SaDashboardPage() {
  const { t } = useTranslation();
  const q = useQuery<SaStats>("sa:stats", "/reports/superadmin/stats");

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.sa.dashboard.title")}
        sub={t("pages.sa.dashboard.sub")}
      />
      {q.loading ? (
        <Spinner label={t("pages.sa.dashboard.loading")} />
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => invalidateQueries("sa:")} />
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label={t("pages.sa.dashboard.kpiTenants")}
              value={`${q.data.tenants.active} / ${q.data.tenants.total}`}
            />
            <Kpi
              label={t("pages.sa.dashboard.kpiUsers")}
              value={formatQty(q.data.tenants.active_users)}
            />
            <Kpi
              label="MRR"
              value={formatMoney(q.data.mrr)}
              tone="ok"
              sub={t("pages.sa.dashboard.mrrSub")}
            />
            <Kpi
              label={t("pages.sa.dashboard.kpiRevenue")}
              value={formatMoney(q.data.revenue.month)}
              sub={t("pages.sa.dashboard.revenueAllTime", {
                total: formatMoney(q.data.revenue.all_time),
              })}
            />
            <Kpi
              label={t("pages.sa.dashboard.kpiNew")}
              value={formatQty(q.data.newTenants30d)}
            />
            <Kpi
              label={t("pages.sa.dashboard.kpiNotif")}
              value={formatQty(q.data.failedNotifications24h)}
              tone={q.data.failedNotifications24h > 0 ? "warn" : undefined}
            />
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            }}
          >
            <Card
              title={t("pages.sa.dashboard.trialsTitle")}
              actions={
                <Link className="btn btn-outline btn-sm" to="/sa/licences">
                  {t("nav.saLicenses")}
                </Link>
              }
            >
              {q.data.trialsEndingSoon.length === 0 ? (
                <p className="muted">{t("pages.sa.dashboard.trialsEmpty")}</p>
              ) : (
                <div className="grid" style={{ gap: 6 }}>
                  {q.data.trialsEndingSoon.map((tr) => (
                    <div key={tr.tenant_name} className="row-between">
                      <span>{tr.tenant_name}</span>
                      <Badge tone="warn">
                        {t("pages.sa.dashboard.trialEndsOn", {
                          date: formatDate(tr.end_date),
                        })}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title={t("pages.sa.dashboard.topTitle")}>
              {q.data.topTenants.length === 0 ? (
                <p className="muted">{t("pages.sa.dashboard.topEmpty")}</p>
              ) : (
                <div className="grid" style={{ gap: 6 }}>
                  {q.data.topTenants.map((tr, i) => (
                    <div key={tr.name} className="row-between">
                      <span>
                        {i + 1}. {tr.name}
                      </span>
                      <strong>{formatMoney(tr.revenue)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
