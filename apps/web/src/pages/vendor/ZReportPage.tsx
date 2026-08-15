/** Clôture de caisse (rapport Z) : synthèse de la journée du vendeur/dépôt —
 *  à imprimer en fin de service pour le contrôle des espèces. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Donut } from "../../components/charts";
import {
  Button,
  Card,
  EmptyState,
  Kpi,
  PageHeader,
  Spinner,
} from "../../components/ui";
import { get } from "../../lib/http";
import {
  formatDate,
  formatMoney,
  formatQty,
  paymentMethodLabel,
} from "../../lib/format";
import { useAuth } from "../../store/auth";

interface ZData {
  date: string;
  timezone: string;
  totals: Array<{ depot: string; sales_count: number; revenue: number }>;
  byPayment: Array<{ payment_method: string; count: number; amount: number }>;
  byVendor: Array<{ vendor: string; count: number; amount: number }>;
  voids: { voided: number; amount: number };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function ZReportPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [date, setDate] = useState(iso(new Date()));
  const [data, setData] = useState<ZData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (d = date) => {
    setLoading(true);
    setError(null);
    try {
      setData(await get<ZData>(`/reports/z-report?date=${d}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("pages.reports.loadError"));
    } finally {
      setLoading(false);
    }
  };

  const revenue = data?.totals.reduce((a, tr) => a + tr.revenue, 0) ?? 0;
  const count = data?.totals.reduce((a, tr) => a + tr.sales_count, 0) ?? 0;

  return (
    <div className="wrap" style={{ maxWidth: 860 }}>
      <PageHeader
        title={t("pages.zreport.title")}
        sub={
          user?.depotId
            ? t("pages.zreport.subDepot", { date: formatDate(date) })
            : t("common.dayOf", { date: formatDate(date) })
        }
        actions={
          <div className="row">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label={t("pages.zreport.dateAria")}
            />
            <Button size="sm" loading={loading} onClick={() => load()}>
              {t("pages.zreport.showButton")}
            </Button>
          </div>
        }
      />

      {loading ? (
        <Spinner label={t("pages.zreport.loading")} />
      ) : error ? (
        <EmptyState
          emoji="⚠️"
          title={t("pages.zreport.errorTitle")}
          action={
            <Button variant="outline" onClick={() => load()}>
              {t("common.retry")}
            </Button>
          }
        >
          {error}
        </EmptyState>
      ) : !data ? (
        <EmptyState
          emoji="🧮"
          title={t("pages.zreport.emptyTitle")}
          action={
            <Button onClick={() => load()}>
              {t("pages.zreport.closeTodayButton")}
            </Button>
          }
        >
          {t("pages.zreport.emptyBody")}
        </EmptyState>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label={t("pages.zreport.kpiRevenue")}
              value={formatMoney(revenue)}
              tone="ok"
            />
            <Kpi
              label={t("pages.zreport.kpiSalesCount")}
              value={formatQty(count)}
            />
            <Kpi
              label={t("pages.zreport.kpiVoids")}
              value={formatQty(data.voids?.voided ?? 0)}
              sub={formatMoney(data.voids?.amount ?? 0)}
              tone={(data.voids?.voided ?? 0) > 0 ? "warn" : undefined}
            />
            <Kpi
              label={t("pages.dashboard.kpiBasket")}
              value={formatMoney(count ? revenue / count : 0)}
            />
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            }}
          >
            <Card title={t("pages.zreport.paymentsCardTitle")}>
              {data.byPayment.length === 0 ? (
                <EmptyState emoji="💳" title={t("pages.zreport.donutEmpty")} />
              ) : (
                <Donut
                  segments={data.byPayment.map((p) => ({
                    label: `${paymentMethodLabel(p.payment_method)} (${p.count})`,
                    value: p.amount,
                  }))}
                />
              )}
            </Card>
            <Card title={t("pages.zreport.cashCardTitle")}>
              <p className="muted" style={{ marginTop: 0 }}>
                {t("pages.zreport.cashExpected")}
              </p>
              <div className="kpi-value" style={{ fontSize: "1.8rem" }}>
                {formatMoney(
                  data.byPayment.find((p) => p.payment_method === "CASH")
                    ?.amount ?? 0,
                )}
              </div>
              <p className="muted">{t("pages.zreport.cashNote")}</p>
              <Button variant="outline" onClick={() => window.print()}>
                {t("pages.zreport.printButton")}
              </Button>
            </Card>
          </div>
          <p className="muted" style={{ textAlign: "center", marginTop: 14 }}>
            <Link to="/caisse/mes-ventes">{t("pages.zreport.salesLink")}</Link>
          </p>
        </>
      )}
    </div>
  );
}
