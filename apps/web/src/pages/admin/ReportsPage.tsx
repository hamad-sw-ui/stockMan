/** Rapports de pilotage : ventes, marges, valorisation, péremptions, prédictif et Z.
 *  Tous exportables en CSV (fichier généré côté serveur). */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, Donut } from '../../components/charts';
import { Badge, Button, Card, EmptyState, Field, Kpi, PageHeader, Spinner, Tabs } from '../../components/ui';
import { download, get } from '../../lib/http';
import { formatDate, formatMoney, formatQty, paymentMethodLabel } from '../../lib/format';
import { useToast } from '../../store/toast';

interface SalesRow { date: string; depot: string; vendor: string; sales_count: number; revenue: number }
interface MarginRow { product_id: string; name: string; qty_sold: number; revenue: number; cost: number; margin: number; margin_pct: number }
interface ValuationRow { depot: string; product: string; category: string; quantity: number; purchase_value: number; sale_value: number }
interface ExpiryRow { product: string; depot: string | null; batch_number: string; quantity: number; expiry_date: string; days_left: number }
interface PredictiveRow { product_id: string; name: string; current_stock: number; min_stock_level: number; avg_daily_sales: number; days_until_stockout: number }
interface ZData {
  date: string;
  timezone: string;
  totals: Array<{ depot: string; sales_count: number; revenue: number }>;
  byPayment: Array<{ payment_method: string; count: number; amount: number }>;
  byVendor: Array<{ vendor: string; count: number; amount: number }>;
  voids: { voided: number; amount: number };
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const fetchJson = <T,>(path: string): Promise<T> => get<T>(path);

const VALID_TABS = ['ventes', 'marges', 'stock', 'peremption', 'predictif', 'cloture'];

export default function ReportsPage() {
  const [params] = useSearchParams();
  const initial = params.get('tab');
  const [tab, setTab] = useState(initial && VALID_TABS.includes(initial) ? initial : 'ventes');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const { show } = useToast();
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const rangeQuery = `from=${from}&to=${to}`;
  const endpoints: Record<string, { path: string; csvName: string }> = {
    ventes: { path: `/reports/sales?${rangeQuery}`, csvName: `ventes_${from}_${to}.csv` },
    marges: { path: `/reports/margin?${rangeQuery}`, csvName: `marges_${from}_${to}.csv` },
    stock: { path: '/reports/stock-valuation', csvName: 'valorisation_stock.csv' },
    peremption: { path: '/reports/expiry?days=45', csvName: '' },
    predictif: { path: '/reports/predictive', csvName: '' },
    cloture: { path: `/reports/z-report?date=${to}`, csvName: '' },
  };

  const load = async (t = tab) => {
    setLoading(true);
    try {
      setData(await fetchJson<unknown>(endpoints[t]!.path));
    } catch (e) {
      show(e instanceof Error ? e.message : 'Rapport indisponible', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (t: string) => {
    setTab(t);
    setData(null);
    void load(t);
  };

  // Chargement initial automatique de l'onglet courant
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(tab); }, []);

  const exportCsv = async () => {
    const ep = endpoints[tab]!;
    if (!ep.csvName) return;
    try {
      await download(`${ep.path}&format=csv`, ep.csvName);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Export impossible', 'error');
    }
  };

  // Vue dérivée par onglet
  const view = useMemo(() => {
    if (!data) return null;
    if (tab === 'ventes') {
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
      return { kind: 'ventes', rows: d.data, total, count, days, vendors: [...byVendor.entries()].sort((a, b) => b[1] - a[1]) } as const;
    }
    if (tab === 'marges') {
      const d = data as { totals: { revenue: number; cost: number; margin: number }; data: MarginRow[] };
      return { kind: 'marges', ...d } as const;
    }
    if (tab === 'stock') {
      const d = data as { totals: { purchase: number; sale: number }; data: ValuationRow[] };
      return { kind: 'stock', ...d } as const;
    }
    if (tab === 'peremption') return { kind: 'peremption', rows: data as ExpiryRow[] } as const;
    if (tab === 'predictif') return { kind: 'predictif', rows: data as PredictiveRow[] } as const;
    return { kind: 'cloture', d: data as ZData } as const;
  }, [data, tab]);

  return (
    <div className="wrap">
      <PageHeader
        title="Rapports"
        sub="Analyse des ventes, marges, stock et prévisions"
        actions={
          <>
            {endpoints[tab]!.csvName ? (
              <Button variant="outline" size="sm" onClick={exportCsv}>⬇️ Export CSV</Button>
            ) : null}
            <Button size="sm" loading={loading} onClick={() => load()}>
              Actualiser
            </Button>
          </>
        }
      />

      <Card className="filters">
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Du">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Au">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="row">
            {[7, 30, 90].map((n) => (
              <Button key={n} variant="outline" size="sm" onClick={() => { setFrom(daysAgo(n - 1)); setTo(today()); }}>
                {n} j
              </Button>
            ))}
            <Button size="sm" loading={loading} onClick={() => load()}>Appliquer</Button>
          </div>
        </div>
      </Card>

      <Tabs
        active={tab}
        onChange={switchTab}
        tabs={[
          { id: 'ventes', label: '💳 Ventes' },
          { id: 'marges', label: '📈 Marges' },
          { id: 'stock', label: '📦 Valorisation' },
          { id: 'peremption', label: '⏳ Péremptions' },
          { id: 'predictif', label: '🔮 Prédictif' },
          { id: 'cloture', label: '🧮 Clôture Z' },
        ]}
      />

      {loading ? (
        <Spinner label="Calcul du rapport…" />
      ) : !view ? (
        <EmptyState emoji="📊" title="Choisissez une période" action={<Button onClick={() => load()}>Afficher le rapport</Button>}>
          Sélectionnez un onglet et une période, puis lancez le rapport.
        </EmptyState>
      ) : view.kind === 'ventes' ? (
        <>
          <div className="kpi-grid">
            <Kpi label="Chiffre d’affaires" value={formatMoney(view.total)} />
            <Kpi label="Ventes" value={formatQty(view.count)} />
            <Kpi label="Panier moyen" value={formatMoney(view.count ? view.total / view.count : 0)} />
          </div>
          {view.vendors.length ? (
            <Card title="Chiffre d’affaires par vendeur">
              <BarChart bars={view.vendors.slice(0, 10).map(([label, value]) => ({ label, value }))} formatValue={formatMoney} />
            </Card>
          ) : null}
          <Card title="Détail par jour, dépôt et vendeur" pad={false}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Dépôt</th><th>Vendeur</th><th className="num">Ventes</th><th className="num">CA</th></tr></thead>
                <tbody>
                  {view.rows.slice(0, 200).map((r, i) => (
                    <tr key={i}>
                      <td>{formatDate(r.date)}</td>
                      <td>{r.depot}</td>
                      <td>{r.vendor}</td>
                      <td className="num">{r.sales_count}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{formatMoney(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : view.kind === 'marges' ? (
        <>
          <div className="kpi-grid">
            <Kpi label="CA" value={formatMoney(view.totals.revenue)} />
            <Kpi label="Coût d’achat" value={formatMoney(view.totals.cost)} />
            <Kpi
              label="Marge brute"
              value={formatMoney(view.totals.margin)}
              sub={view.totals.revenue > 0 ? `${Math.round((1000 * view.totals.margin) / view.totals.revenue) / 10} % du CA` : undefined}
              tone={view.totals.margin >= 0 ? 'ok' : 'danger'}
            />
          </div>
          <Card title="Marge par produit" pad={false}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Produit</th><th className="num">Qté vendue</th><th className="num">CA</th><th className="num">Coût</th><th className="num">Marge</th><th className="num">Marge %</th></tr></thead>
                <tbody>
                  {view.data.map((r) => (
                    <tr key={r.product_id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td className="num">{formatQty(r.qty_sold)}</td>
                      <td className="num">{formatMoney(r.revenue)}</td>
                      <td className="num">{formatMoney(r.cost)}</td>
                      <td className="num" style={{ color: r.margin >= 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 700 }}>{formatMoney(r.margin)}</td>
                      <td className="num">{r.margin_pct} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : view.kind === 'stock' ? (
        <>
          <div className="kpi-grid">
            <Kpi label="Valeur d’achat du stock" value={formatMoney(view.totals.purchase)} />
            <Kpi label="Valeur de vente potentielle" value={formatMoney(view.totals.sale)} />
            <Kpi label="Marge potentielle" value={formatMoney(view.totals.sale - view.totals.purchase)} tone="ok" />
          </div>
          <Card title="Valorisation par dépôt et produit" pad={false}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Dépôt</th><th>Produit</th><th>Catégorie</th><th className="num">Quantité</th><th className="num">Valeur achat</th><th className="num">Valeur vente</th></tr></thead>
                <tbody>
                  {view.data.map((r, i) => (
                    <tr key={i}>
                      <td>{r.depot}</td>
                      <td style={{ fontWeight: 600 }}>{r.product}</td>
                      <td className="muted">{r.category}</td>
                      <td className="num">{formatQty(r.quantity)}</td>
                      <td className="num">{formatMoney(r.purchase_value)}</td>
                      <td className="num">{formatMoney(r.sale_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : view.kind === 'peremption' ? (
        <Card title="Lots expirés ou proches de la péremption (45 jours)" pad={false}>
          {view.rows.length === 0 ? (
            <div style={{ padding: 18 }}><EmptyState emoji="🎉" title="Aucun lot à risque">Aucune péremption dans les 45 prochains jours.</EmptyState></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Produit</th><th>Lot</th><th>Dépôt</th><th className="num">Quantité</th><th>Péremption</th><th>Statut</th></tr></thead>
                <tbody>
                  {view.rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{r.product}</td>
                      <td className="mono muted">{r.batch_number}</td>
                      <td>{r.depot ?? '—'}</td>
                      <td className="num">{formatQty(r.quantity)}</td>
                      <td>{formatDate(r.expiry_date)}</td>
                      <td>
                        <Badge tone={r.days_left < 0 ? 'danger' : r.days_left <= 14 ? 'warn' : 'info'}>
                          {r.days_left < 0 ? `Expiré depuis ${-r.days_left} j` : `J−${r.days_left}`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : view.kind === 'predictif' ? (
        <Card
          title={
            <div>
              <h2>Prévision de rupture &amp; suggestions de réassort</h2>
              <p className="panel-sub">Basé sur les ventes des 30 derniers jours</p>
            </div>
          }
          pad={false}
        >
          {view.rows.length === 0 ? (
            <div style={{ padding: 18 }}><EmptyState emoji="✅" title="Stocks sains">Aucune rupture prévue d’ici 14 jours.</EmptyState></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Produit</th><th className="num">Stock actuel</th><th className="num">Seuil</th><th className="num">Ventes/jour</th><th className="num">Rupture dans</th></tr></thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.product_id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td className="num">{formatQty(r.current_stock)}</td>
                      <td className="num muted">{formatQty(r.min_stock_level)}</td>
                      <td className="num">{formatQty(r.avg_daily_sales)}</td>
                      <td className="num">
                        <Badge tone={r.days_until_stockout >= 900 ? 'info' : r.days_until_stockout <= 5 ? 'danger' : 'warn'}>
                          {r.days_until_stockout >= 900 ? 'Pas de vente' : r.days_until_stockout <= 0 ? 'Rupture' : `${r.days_until_stockout} j`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        (() => {
          const z = view.d;
          const grandRevenue = z.totals.reduce((a, t) => a + t.revenue, 0);
          const grandCount = z.totals.reduce((a, t) => a + t.sales_count, 0);
          return (
            <>
              <div className="kpi-grid">
                <Kpi label={`CA du ${formatDate(z.date)}`} value={formatMoney(grandRevenue)} />
                <Kpi label="Ventes" value={formatQty(grandCount)} />
                <Kpi label="Ventes annulées" value={formatQty(z.voids?.voided ?? 0)} sub={formatMoney(z.voids?.amount ?? 0)} tone={(z.voids?.voided ?? 0) > 0 ? 'warn' : undefined} />
                <Kpi label="Panier moyen" value={formatMoney(grandCount ? grandRevenue / grandCount : 0)} />
              </div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
                <Card title="Par mode de paiement">
                  <Donut segments={z.byPayment.map((p) => ({ label: paymentMethodLabel(p.payment_method), value: p.amount }))} />
                </Card>
                <Card title="Par vendeur" pad={false}>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Vendeur</th><th className="num">Ventes</th><th className="num">Montant</th></tr></thead>
                      <tbody>
                        {z.byVendor.map((v) => (
                          <tr key={v.vendor}><td>{v.vendor}</td><td className="num">{v.count}</td><td className="num">{formatMoney(v.amount)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
                <Card title="Par dépôt" pad={false}>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Dépôt</th><th className="num">Ventes</th><th className="num">CA</th></tr></thead>
                      <tbody>
                        {z.totals.map((t) => (
                          <tr key={t.depot}><td>{t.depot}</td><td className="num">{t.sales_count}</td><td className="num">{formatMoney(t.revenue)}</td></tr>
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
