/** Tableau de bord gérant : ventes du jour, courbe de CA, top produits,
 *  mix de paiement et raccourcis vers les alertes (stock bas / péremption). */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { BarChart, Donut, LineChart } from "../../components/charts";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Kpi,
  PageHeader,
  Spinner,
} from "../../components/ui";
import { formatMoney, formatQty, paymentMethodLabel } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { currentLocale } from "../../i18n";
import type { DashboardData } from "../../lib/types";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
/** Jour court jj/mm (resp. mm/dd en anglais) — suit la langue courante. */
const shortDay = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(currentLocale(), {
    day: "2-digit",
    month: "2-digit",
  });
};

export default function DashboardPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const path = `/reports/dashboard?from=${from}&to=${to}`;
  const q = useQuery<DashboardData>(`dashboard:${path}`, path);

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.dashboard.title")}
        sub={
          q.data
            ? t("pages.dashboard.subPeriod", {
                from: shortDay(q.data.range.from),
                to: shortDay(q.data.range.to),
                timezone: q.data.range.timezone,
              })
            : undefined
        }
        actions={
          <div className="row">
            {[7, 30].map((n) => (
              <Button
                key={n}
                size="sm"
                variant="outline"
                onClick={() => {
                  setFrom(daysAgo(n - 1));
                  setTo(today());
                }}
              >
                {t("pages.dashboard.rangeDays", { count: n })}
              </Button>
            ))}
            <Link className="btn btn-outline btn-sm" to="/caisse">
              {t("pages.dashboard.openPos")}
            </Link>
          </div>
        }
      />

      {q.loading ? (
        <Spinner label={t("pages.dashboard.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("dashboard:")}
        />
      ) : q.data ? (
        <>
          <div className="kpi-grid">
            <Kpi
              label={t("pages.dashboard.kpiToday")}
              value={formatMoney(q.data.summary.today_revenue)}
              tone="ok"
            />
            <Kpi
              label={t("pages.dashboard.kpiPeriod")}
              value={formatMoney(q.data.summary.revenue)}
              sub={t("pages.dashboard.salesCountSub", {
                count: formatQty(q.data.summary.sales_count),
              })}
            />
            <Kpi
              label={t("pages.dashboard.kpiBasket")}
              value={formatMoney(q.data.summary.avg_basket)}
            />
            <Kpi
              label={t("pages.dashboard.kpiLowStock")}
              value={formatQty(q.data.lowStockCount)}
              tone={q.data.lowStockCount > 0 ? "warn" : undefined}
              sub={
                q.data.summary.voided_count > 0
                  ? t("pages.dashboard.voidedSub", {
                      count: q.data.summary.voided_count,
                    })
                  : undefined
              }
            />
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            }}
          >
            <Card title={t("pages.dashboard.chartRevenue")}>
              <LineChart
                points={q.data.series.map((s) => ({
                  label: shortDay(s.date),
                  value: Math.round(s.amount),
                }))}
                formatValue={formatMoney}
              />
            </Card>
            <Card title={t("pages.dashboard.chartPayments")}>
              <Donut
                segments={q.data.paymentMix.map((p) => ({
                  label: paymentMethodLabel(p.payment_method),
                  value: p.amount,
                }))}
              />
            </Card>
            <Card title={t("pages.dashboard.chartTop")}>
              {q.data.topProducts.length ? (
                <BarChart
                  bars={q.data.topProducts.map((p) => ({
                    label: p.name,
                    value: Math.round(p.revenue),
                  }))}
                  formatValue={formatMoney}
                />
              ) : (
                <p className="muted">{t("pages.dashboard.noSales")}</p>
              )}
            </Card>
            <Card title={t("pages.dashboard.alertsTitle")}>
              <div className="grid" style={{ gap: 8 }}>
                <Link
                  className="btn btn-outline"
                  to="/admin/produits?status=low"
                >
                  {t("pages.dashboard.lowStockLink", {
                    count: q.data.lowStockCount,
                  })}
                </Link>
                <Link
                  className="btn btn-outline"
                  to="/admin/rapports?tab=peremption"
                >
                  {t("pages.dashboard.expiryLink")}
                </Link>
                <Link
                  className="btn btn-outline"
                  to="/admin/rapports?tab=predictif"
                >
                  {t("pages.dashboard.restockLink")}
                </Link>
                <Link className="btn btn-outline" to="/admin/receptions">
                  {t("pages.dashboard.newReceiptLink")}
                </Link>
              </div>
              <p
                className="muted"
                style={{ marginTop: 10, fontSize: "0.85rem" }}
              >
                {t("pages.dashboard.smsAlertsPrefix")}{" "}
                <Link to="/admin/parametres">
                  {t("pages.dashboard.settingsLabel")}
                </Link>
                .
              </p>
            </Card>
          </div>

          {q.data.summary.sales_count === 0 ? (
            <Card>
              <div className="empty">
                <span className="emoji" aria-hidden>
                  🚀
                </span>
                <h3>{t("pages.dashboard.launchTitle")}</h3>
                <p>{t("pages.dashboard.launchBody")}</p>
                <div
                  className="row"
                  style={{ justifyContent: "center", marginTop: 12 }}
                >
                  <Link
                    className="btn btn-primary"
                    to="/admin/produits/nouveau"
                  >
                    {t("pages.dashboard.createProduct")}
                  </Link>
                  <Link className="btn btn-outline" to="/caisse">
                    {t("pages.dashboard.goToPos")}
                  </Link>
                </div>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {q.data && q.data.lowStockCount > 0 ? (
        <Card>
          <Badge tone="warn">
            {t("pages.dashboard.lowStockBadge", {
              count: q.data.lowStockCount,
            })}
          </Badge>{" "}
          <Link to="/admin/produits?status=low">
            {t("pages.dashboard.treatNow")}
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
