/** Rapports de pilotage : ventes, marges, valorisation, péremptions, prédictif et Z.
 *  Tous exportables en CSV (fichier généré côté serveur). */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { BarChart, Donut } from "../../components/charts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Kpi,
  PageHeader,
  Spinner,
  Tabs,
} from "../../components/ui";
import { download, get } from "../../lib/http";
import {
  formatDate,
  formatMoney,
  formatQty,
  paymentMethodLabel,
} from "../../lib/format";
import type { VatJournal } from "../../lib/types";
import { useToast } from "../../store/toast";

interface SalesRow {
  date: string;
  depot: string;
  vendor: string;
  sales_count: number;
  revenue: number;
}
interface MarginRow {
  product_id: string;
  name: string;
  qty_sold: number;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number;
}
interface ValuationRow {
  depot: string;
  product: string;
  category: string;
  quantity: number;
  cump?: number;
  purchase_value: number;
  sale_value: number;
}
interface ExpiryRow {
  product: string;
  depot: string | null;
  batch_number: string;
  quantity: number;
  expiry_date: string;
  days_left: number;
}
interface PredictiveRow {
  product_id: string;
  name: string;
  current_stock: number;
  min_stock_level: number;
  avg_daily_sales: number;
  days_until_stockout: number;
  suggested_qty: number;
  purchase_price: number;
  supplier_id: string | null;
  supplier_name: string | null;
  lead_days: number | null;
}
interface ZData {
  date: string;
  timezone: string;
  totals: Array<{ depot: string; sales_count: number; revenue: number }>;
  byPayment: Array<{ payment_method: string; count: number; amount: number }>;
  byVendor: Array<{ vendor: string; count: number; amount: number }>;
  voids: { voided: number; amount: number };
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const fetchJson = <T,>(path: string): Promise<T> => get<T>(path);

const VALID_TABS = [
  "ventes",
  "marges",
  "stock",
  "peremption",
  "predictif",
  "cloture",
  "tva",
];

export default function ReportsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const initial = params.get("tab");
  const [tab, setTab] = useState(
    initial && VALID_TABS.includes(initial) ? initial : "ventes",
  );
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const { show } = useToast();
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const rangeQuery = `from=${from}&to=${to}`;
  const endpoints: Record<string, { path: string; csvName: string }> = {
    ventes: {
      path: `/reports/sales?${rangeQuery}`,
      csvName: `ventes_${from}_${to}.csv`,
    },
    marges: {
      path: `/reports/margin?${rangeQuery}`,
      csvName: `marges_${from}_${to}.csv`,
    },
    stock: {
      path: "/reports/stock-valuation",
      csvName: "valorisation_stock.csv",
    },
    peremption: { path: "/reports/expiry?days=45", csvName: "" },
    predictif: { path: "/reports/predictive", csvName: "" },
    cloture: { path: `/reports/z-report?date=${to}`, csvName: "" },
    tva: {
      path: `/reports/vat-journal?${rangeQuery}`,
      csvName: `journal_tva_${from}_${to}.csv`,
    },
  };

  const load = async (tabId = tab) => {
    setLoading(true);
    try {
      setData(await fetchJson<unknown>(endpoints[tabId]!.path));
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.reports.loadError"),
        "error",
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (tabId: string) => {
    setTab(tabId);
    setData(null);
    void load(tabId);
  };

  // Chargement initial automatique de l'onglet courant
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load(tab);
  }, []);

  const exportCsv = async () => {
    const ep = endpoints[tab]!;
    if (!ep.csvName) return;
    try {
      await download(`${ep.path}&format=csv`, ep.csvName);
    } catch (e) {
      show(e instanceof Error ? e.message : t("csv.exportError"), "error");
    }
  };

  // Vue dérivée par onglet
  const view = useMemo(() => {
    if (!data) return null;
    if (tab === "ventes") {
      const d = data as { data: SalesRow[] };
      const byDay = new Map<string, number>();
      const byVendor = new Map<string, number>();
      let total = 0;
      let count = 0;
      for (const r of d.data) {
        byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.revenue);
        byVendor.set(r.vendor, (byVendor.get(r.vendor) ?? 0) + r.revenue);
        total += r.revenue;
        count += r.sales_count;
      }
      const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
      return {
        kind: "ventes",
        rows: d.data,
        total,
        count,
        days,
        vendors: [...byVendor.entries()].sort((a, b) => b[1] - a[1]),
      } as const;
    }
    if (tab === "marges") {
      const d = data as {
        totals: { revenue: number; cost: number; margin: number };
        data: MarginRow[];
      };
      return { kind: "marges", ...d } as const;
    }
    if (tab === "stock") {
      const d = data as {
        totals: { purchase: number; sale: number };
        data: ValuationRow[];
      };
      return { kind: "stock", ...d } as const;
    }
    if (tab === "peremption")
      return { kind: "peremption", rows: data as ExpiryRow[] } as const;
    if (tab === "predictif")
      return { kind: "predictif", rows: data as PredictiveRow[] } as const;
    if (tab === "tva") return { kind: "tva", d: data as VatJournal } as const;
    return { kind: "cloture", d: data as ZData } as const;
  }, [data, tab]);

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.reports.title")}
        sub={t("pages.reports.sub")}
        actions={
          <>
            {endpoints[tab]!.csvName ? (
              <Button variant="outline" size="sm" onClick={exportCsv}>
                {t("csv.export")}
              </Button>
            ) : null}
            <Button size="sm" loading={loading} onClick={() => load()}>
              {t("pages.reports.refreshButton")}
            </Button>
          </>
        }
      />

      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label={t("common.from")}>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t("common.to")}>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <div className="row">
            {[7, 30, 90].map((n) => (
              <Button
                key={n}
                variant="outline"
                size="sm"
                onClick={() => {
                  setFrom(daysAgo(n - 1));
                  setTo(today());
                }}
              >
                {t("pages.reports.quickDays", { count: n })}
              </Button>
            ))}
            <Button size="sm" loading={loading} onClick={() => load()}>
              {t("pages.reports.applyButton")}
            </Button>
          </div>
        </div>
      </Card>

      <Tabs
        active={tab}
        onChange={switchTab}
        tabs={[
          { id: "ventes", label: t("pages.reports.tabSales") },
          { id: "marges", label: t("pages.reports.tabMargins") },
          { id: "stock", label: t("pages.reports.tabStock") },
          { id: "peremption", label: t("pages.reports.tabExpiry") },
          { id: "predictif", label: t("pages.reports.tabPredictive") },
          { id: "cloture", label: t("pages.reports.tabZ") },
          { id: "tva", label: t("pages.reports.tabVat") },
        ]}
      />

      {loading ? (
        <Spinner label={t("pages.reports.loading")} />
      ) : !view ? (
        <EmptyState
          emoji="📊"
          title={t("pages.reports.empty")}
          action={
            <Button onClick={() => load()}>
              {t("pages.reports.showButton")}
            </Button>
          }
        >
          {t("pages.reports.emptyBody")}
        </EmptyState>
      ) : view.kind === "ventes" ? (
        <>
          <div className="kpi-grid">
            <Kpi
              label={t("pages.reports.kpiRevenue")}
              value={formatMoney(view.total)}
            />
            <Kpi
              label={t("pages.cashSessions.kpiSalesCount")}
              value={formatQty(view.count)}
            />
            <Kpi
              label={t("pages.dashboard.kpiBasket")}
              value={formatMoney(view.count ? view.total / view.count : 0)}
            />
          </div>
          {view.vendors.length ? (
            <Card title={t("pages.reports.chartByVendor")}>
              <BarChart
                bars={view.vendors
                  .slice(0, 10)
                  .map(([label, value]) => ({ label, value }))}
                formatValue={formatMoney}
              />
            </Card>
          ) : null}
          <Card title={t("pages.reports.detailCardTitle")} pad={false}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.date")}</th>
                    <th>{t("fields.depot")}</th>
                    <th>{t("fields.vendor")}</th>
                    <th className="num">
                      {t("pages.cashSessions.kpiSalesCount")}
                    </th>
                    <th className="num">
                      {t("pages.cashSessions.kpiRevenue")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.slice(0, 200).map((r, i) => (
                    <tr key={i}>
                      <td>{formatDate(r.date)}</td>
                      <td>{r.depot}</td>
                      <td>{r.vendor}</td>
                      <td className="num">{r.sales_count}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {formatMoney(r.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : view.kind === "marges" ? (
        <>
          <div className="kpi-grid">
            <Kpi
              label={t("pages.cashSessions.kpiRevenue")}
              value={formatMoney(view.totals.revenue)}
            />
            <Kpi
              label={t("pages.reports.kpiCost")}
              value={formatMoney(view.totals.cost)}
              sub={t("pages.reports.kpiCostSub")}
            />
            <Kpi
              label={t("pages.reports.kpiMargin")}
              value={formatMoney(view.totals.margin)}
              sub={
                view.totals.revenue > 0
                  ? t("pages.reports.marginPctSub", {
                      pct: String(
                        Math.round(
                          (1000 * view.totals.margin) / view.totals.revenue,
                        ) / 10,
                      ),
                    })
                  : undefined
              }
              tone={view.totals.margin >= 0 ? "ok" : "danger"}
            />
          </div>
          <Card title={t("pages.reports.marginCardTitle")} pad={false}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("fields.product")}</th>
                    <th className="num">{t("pages.saleDetail.colQtySold")}</th>
                    <th className="num">
                      {t("pages.cashSessions.kpiRevenue")}
                    </th>
                    <th className="num">{t("pages.reports.colCost")}</th>
                    <th className="num">{t("pages.reports.colMargin")}</th>
                    <th className="num">{t("pages.reports.colMarginPct")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.data.map((r) => (
                    <tr key={r.product_id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td className="num">{formatQty(r.qty_sold)}</td>
                      <td className="num">{formatMoney(r.revenue)}</td>
                      <td className="num">{formatMoney(r.cost)}</td>
                      <td
                        className="num"
                        style={{
                          color: r.margin >= 0 ? "var(--ok)" : "var(--danger)",
                          fontWeight: 700,
                        }}
                      >
                        {formatMoney(r.margin)}
                      </td>
                      <td className="num">{r.margin_pct} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : view.kind === "stock" ? (
        <>
          <div className="kpi-grid">
            <Kpi
              label={t("pages.reports.kpiPurchaseValue")}
              value={formatMoney(view.totals.purchase)}
            />
            <Kpi
              label={t("pages.reports.kpiSaleValue")}
              value={formatMoney(view.totals.sale)}
            />
            <Kpi
              label={t("pages.reports.kpiPotentialMargin")}
              value={formatMoney(view.totals.sale - view.totals.purchase)}
              tone="ok"
            />
          </div>
          <Card title={t("pages.reports.valuationTitle")} pad={false}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("fields.depot")}</th>
                    <th>{t("fields.product")}</th>
                    <th>{t("fields.category")}</th>
                    <th className="num">{t("fields.quantity")}</th>
                    <th className="num">CUMP</th>
                    <th className="num">
                      {t("pages.reports.colPurchaseValue")}
                    </th>
                    <th className="num">{t("pages.reports.colSaleValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.data.map((r, i) => (
                    <tr key={i}>
                      <td>{r.depot}</td>
                      <td style={{ fontWeight: 600 }}>{r.product}</td>
                      <td className="muted">{r.category}</td>
                      <td className="num">{formatQty(r.quantity)}</td>
                      <td className="num muted">
                        {r.cump != null ? formatMoney(r.cump) : "—"}
                      </td>
                      <td className="num">{formatMoney(r.purchase_value)}</td>
                      <td className="num">{formatMoney(r.sale_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : view.kind === "peremption" ? (
        <Card title={t("pages.reports.expiryCardTitle")} pad={false}>
          {view.rows.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState emoji="🎉" title={t("pages.reports.expiryEmpty")}>
                {t("pages.reports.expiryEmptyBody")}
              </EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("fields.product")}</th>
                    <th>{t("pages.purchaseOrders.colBatch")}</th>
                    <th>{t("fields.depot")}</th>
                    <th className="num">{t("fields.quantity")}</th>
                    <th>{t("pages.reports.colExpiry")}</th>
                    <th>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{r.product}</td>
                      <td className="mono muted">{r.batch_number}</td>
                      <td>{r.depot ?? "—"}</td>
                      <td className="num">{formatQty(r.quantity)}</td>
                      <td>{formatDate(r.expiry_date)}</td>
                      <td>
                        <Badge
                          tone={
                            r.days_left < 0
                              ? "danger"
                              : r.days_left <= 14
                                ? "warn"
                                : "info"
                          }
                        >
                          {r.days_left < 0
                            ? t("pages.reports.expiredSince", {
                                days: -r.days_left,
                              })
                            : t("pages.reports.daysLeft", {
                                days: r.days_left,
                              })}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : view.kind === "predictif" ? (
        <Card
          title={
            <div>
              <h2>{t("pages.reports.predictiveTitle")}</h2>
              <p className="panel-sub">{t("pages.reports.predictiveSub")}</p>
            </div>
          }
          pad={false}
        >
          {view.rows.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState emoji="✅" title={t("pages.reports.predictiveEmpty")}>
                {t("pages.reports.predictiveEmptyBody")}
              </EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("fields.product")}</th>
                    <th className="num">
                      {t("pages.reports.colCurrentStock")}
                    </th>
                    <th className="num">{t("pages.products.colThreshold")}</th>
                    <th className="num">{t("pages.reports.colSalesPerDay")}</th>
                    <th className="num">{t("pages.reports.colStockoutIn")}</th>
                    <th className="num">{t("pages.reports.colToOrder")}</th>
                    <th aria-label={t("pages.reports.orderAria")} />
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.product_id}>
                      <td style={{ fontWeight: 600 }}>
                        {r.name}
                        {r.supplier_name ? (
                          <div
                            className="muted"
                            style={{ fontSize: "0.78rem" }}
                          >
                            🚚 {r.supplier_name}
                            {r.lead_days != null
                              ? t("pages.reports.leadTimeSuffix", {
                                  days: r.lead_days,
                                })
                              : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{formatQty(r.current_stock)}</td>
                      <td className="num muted">
                        {formatQty(r.min_stock_level)}
                      </td>
                      <td className="num">{formatQty(r.avg_daily_sales)}</td>
                      <td className="num">
                        <Badge
                          tone={
                            r.days_until_stockout >= 900
                              ? "info"
                              : r.days_until_stockout <= 5
                                ? "danger"
                                : "warn"
                          }
                        >
                          {r.days_until_stockout >= 900
                            ? t("pages.reports.noSalesBadge")
                            : r.days_until_stockout <= 0
                              ? t("pages.reports.stockoutBadge")
                              : t("pages.suppliers.daysShort", {
                                  days: r.days_until_stockout,
                                })}
                        </Badge>
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {r.suggested_qty > 0 ? formatQty(r.suggested_qty) : "—"}
                      </td>
                      <td>
                        {r.suggested_qty > 0 ? (
                          <Link
                            className="btn btn-outline btn-sm"
                            to={`/admin/commandes?new=1&supplierId=${r.supplier_id ?? ""}&productId=${r.product_id}&qty=${r.suggested_qty}`}
                            title={
                              r.supplier_id
                                ? t("pages.reports.orderTitlePrefilled")
                                : t("pages.reports.orderTitlePick")
                            }
                          >
                            {t("pages.reports.orderButton")}
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : view.kind === "tva" ? (
        <>
          <div className="kpi-grid">
            <Kpi
              label={t("pages.reports.kpiHt")}
              value={formatMoney(view.d.totals.ht)}
            />
            <Kpi
              label={t("pages.reports.kpiVat")}
              value={formatMoney(view.d.totals.vat)}
            />
            <Kpi
              label={t("pages.reports.kpiTtc")}
              value={formatMoney(view.d.totals.ttc)}
            />
          </div>

          <Card title={t("pages.reports.vatByRateTitle")}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("pages.reports.colRate")}</th>
                    <th className="num">{t("pages.reports.colBaseHt")}</th>
                    <th className="num">{t("pages.invoices.colVat")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.d.byRate.map((r) => (
                    <tr key={r.rate}>
                      <td>
                        <Badge tone={r.rate === 0 ? "muted" : "info"}>
                          {formatQty(r.rate)} %
                        </Badge>
                      </td>
                      <td className="num">{formatMoney(r.ht)}</td>
                      <td className="num">{formatMoney(r.vat)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t("pages.reports.vatJournalTitle")} pad={false}>
            <div
              className="table-wrap"
              style={{ maxHeight: 420, overflow: "auto" }}
            >
              <table>
                <thead>
                  <tr>
                    <th>{t("pages.invoices.colNumber")}</th>
                    <th>{t("common.date")}</th>
                    <th>{t("fields.depot")}</th>
                    <th>{t("fields.type")}</th>
                    <th>{t("fields.customer")}</th>
                    <th className="num">{t("pages.invoices.colHt")}</th>
                    <th className="num">{t("pages.invoices.colVat")}</th>
                    <th className="num">{t("pages.invoices.colTtc")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.d.rows.map((r) => (
                    <tr key={r.number}>
                      <td>
                        <code>{r.number}</code>
                      </td>
                      <td>{r.date}</td>
                      <td>{r.depot}</td>
                      <td>
                        <Badge tone={r.kind === "CREDIT_NOTE" ? "warn" : "ok"}>
                          {t(
                            r.kind === "CREDIT_NOTE"
                              ? "pages.invoices.badgeCreditNote"
                              : "pages.invoices.badgeInvoice",
                          )}
                        </Badge>
                      </td>
                      <td>{r.customer ?? t("pages.invoices.cashCustomer")}</td>
                      <td className="num">{formatMoney(r.ht)}</td>
                      <td className="num">{formatMoney(r.vat)}</td>
                      <td className="num">{formatMoney(r.ttc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t("pages.reports.syscohadaTitle")}>
            <p className="muted">{t("pages.reports.syscohadaBody")}</p>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  download(
                    `/reports/exports/syscohada-sales?${rangeQuery}`,
                    `syscohada_ventes_${from}_${to}.csv`,
                  )
                }
              >
                {t("pages.reports.exportSales")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  download(
                    "/reports/exports/syscohada-receivables",
                    `syscohada_creances_${to}.csv`,
                  )
                }
              >
                {t("pages.reports.exportReceivables")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  download(
                    "/reports/exports/syscohada-inventory",
                    `syscohada_inventaire_${to}.csv`,
                  )
                }
              >
                {t("pages.reports.exportInventory")}
              </Button>
            </div>
          </Card>
        </>
      ) : (
        (() => {
          const z = view.d;
          const grandRevenue = z.totals.reduce((a, tr) => a + tr.revenue, 0);
          const grandCount = z.totals.reduce((a, tr) => a + tr.sales_count, 0);
          return (
            <>
              <div className="kpi-grid">
                <Kpi
                  label={t("pages.reports.zRevenueOf", {
                    date: formatDate(z.date),
                  })}
                  value={formatMoney(grandRevenue)}
                />
                <Kpi
                  label={t("pages.cashSessions.kpiSalesCount")}
                  value={formatQty(grandCount)}
                />
                <Kpi
                  label={t("pages.reports.kpiVoided")}
                  value={formatQty(z.voids?.voided ?? 0)}
                  sub={formatMoney(z.voids?.amount ?? 0)}
                  tone={(z.voids?.voided ?? 0) > 0 ? "warn" : undefined}
                />
                <Kpi
                  label={t("pages.dashboard.kpiBasket")}
                  value={formatMoney(
                    grandCount ? grandRevenue / grandCount : 0,
                  )}
                />
              </div>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                }}
              >
                <Card title={t("pages.reports.zByPayment")}>
                  <Donut
                    segments={z.byPayment.map((p) => ({
                      label: paymentMethodLabel(p.payment_method),
                      value: p.amount,
                    }))}
                  />
                </Card>
                <Card title={t("pages.reports.zByVendor")} pad={false}>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("fields.vendor")}</th>
                          <th className="num">
                            {t("pages.cashSessions.kpiSalesCount")}
                          </th>
                          <th className="num">{t("common.amount")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {z.byVendor.map((v) => (
                          <tr key={v.vendor}>
                            <td>{v.vendor}</td>
                            <td className="num">{v.count}</td>
                            <td className="num">{formatMoney(v.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
                <Card title={t("pages.reports.zByDepot")} pad={false}>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("fields.depot")}</th>
                          <th className="num">
                            {t("pages.cashSessions.kpiSalesCount")}
                          </th>
                          <th className="num">
                            {t("pages.cashSessions.kpiRevenue")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {z.totals.map((tr) => (
                          <tr key={tr.depot}>
                            <td>{tr.depot}</td>
                            <td className="num">{tr.sales_count}</td>
                            <td className="num">{formatMoney(tr.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}
