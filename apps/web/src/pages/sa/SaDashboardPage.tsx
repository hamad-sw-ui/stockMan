/** Console éditeur — vue d'ensemble : tenants, MRR, CA plateforme, essais
 *  arrivant à échéance et santé des notifications. */
import { Link } from "react-router-dom";
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
  const q = useQuery<SaStats>("sa:stats", "/reports/superadmin/stats");

  return (
    <div className="wrap">
      <PageHeader
        title="Vue d’ensemble"
        sub="Activité de la plateforme StockMan"
      />
      {q.loading ? (
        <Spinner label="Chargement des statistiques…" />
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => invalidateQueries("sa:")} />
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label="Tenants (actifs)"
              value={`${q.data.tenants.active} / ${q.data.tenants.total}`}
            />
            <Kpi
              label="Utilisateurs actifs"
              value={formatQty(q.data.tenants.active_users)}
            />
            <Kpi
              label="MRR"
              value={formatMoney(q.data.mrr)}
              tone="ok"
              sub="licences payantes actives"
            />
            <Kpi
              label="CA plateforme (mois)"
              value={formatMoney(q.data.revenue.month)}
              sub={`total historique ${formatMoney(q.data.revenue.all_time)}`}
            />
            <Kpi
              label="Nouveaux tenants (30 j)"
              value={formatQty(q.data.newTenants30d)}
            />
            <Kpi
              label="Notifications en échec (24 h)"
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
              title="Essais arrivant à échéance (7 j)"
              actions={
                <Link className="btn btn-outline btn-sm" to="/sa/licences">
                  Licences
                </Link>
              }
            >
              {q.data.trialsEndingSoon.length === 0 ? (
                <p className="muted">Aucun essai n’expire cette semaine.</p>
              ) : (
                <div className="grid" style={{ gap: 6 }}>
                  {q.data.trialsEndingSoon.map((t) => (
                    <div key={t.tenant_name} className="row-between">
                      <span>{t.tenant_name}</span>
                      <Badge tone="warn">fin {formatDate(t.end_date)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Top tenants (CA 30 j)">
              {q.data.topTenants.length === 0 ? (
                <p className="muted">Aucune vente sur les 30 derniers jours.</p>
              ) : (
                <div className="grid" style={{ gap: 6 }}>
                  {q.data.topTenants.map((t, i) => (
                    <div key={t.name} className="row-between">
                      <span>
                        {i + 1}. {t.name}
                      </span>
                      <strong>{formatMoney(t.revenue)}</strong>
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
