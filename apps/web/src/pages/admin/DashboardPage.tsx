/** Tableau de bord gérant : ventes du jour, courbe de CA, top produits,
 *  mix de paiement et raccourcis vers les alertes (stock bas / péremption). */
import { useState } from "react";
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
import type { DashboardData } from "../../lib/types";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const frDay = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
};

export default function DashboardPage() {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const path = `/reports/dashboard?from=${from}&to=${to}`;
  const q = useQuery<DashboardData>(`dashboard:${path}`, path);

  return (
    <div className="wrap">
      <PageHeader
        title="Tableau de bord"
        sub={
          q.data
            ? `Période du ${frDay(q.data.range.from)} au ${frDay(q.data.range.to)} · ${q.data.range.timezone}`
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
                {n} jours
              </Button>
            ))}
            <Link className="btn btn-outline btn-sm" to="/caisse">
              🧾 Ouvrir la caisse
            </Link>
          </div>
        }
      />

      {q.loading ? (
        <Spinner label="Chargement du tableau de bord…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("dashboard:")}
        />
      ) : q.data ? (
        <>
          <div className="kpi-grid">
            <Kpi
              label="CA du jour"
              value={formatMoney(q.data.summary.today_revenue)}
              tone="ok"
            />
            <Kpi
              label="CA de la période"
              value={formatMoney(q.data.summary.revenue)}
              sub={`${formatQty(q.data.summary.sales_count)} vente(s)`}
            />
            <Kpi
              label="Panier moyen"
              value={formatMoney(q.data.summary.avg_basket)}
            />
            <Kpi
              label="Produits en alerte stock"
              value={formatQty(q.data.lowStockCount)}
              tone={q.data.lowStockCount > 0 ? "warn" : undefined}
              sub={
                q.data.summary.voided_count > 0
                  ? `${q.data.summary.voided_count} vente(s) annulée(s)`
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
            <Card title="Évolution du chiffre d’affaires">
              <LineChart
                points={q.data.series.map((s) => ({
                  label: frDay(s.date),
                  value: Math.round(s.amount),
                }))}
                formatValue={formatMoney}
              />
            </Card>
            <Card title="Répartition des paiements">
              <Donut
                segments={q.data.paymentMix.map((p) => ({
                  label: paymentMethodLabel(p.payment_method),
                  value: p.amount,
                }))}
              />
            </Card>
            <Card title="Top 5 produits (CA)">
              {q.data.topProducts.length ? (
                <BarChart
                  bars={q.data.topProducts.map((p) => ({
                    label: p.name,
                    value: Math.round(p.revenue),
                  }))}
                  formatValue={formatMoney}
                />
              ) : (
                <p className="muted">Aucune vente sur la période.</p>
              )}
            </Card>
            <Card title="Alertes & actions rapides">
              <div className="grid" style={{ gap: 8 }}>
                <Link
                  className="btn btn-outline"
                  to="/admin/produits?status=low"
                >
                  ⚠️ Voir les produits en stock bas ({q.data.lowStockCount})
                </Link>
                <Link
                  className="btn btn-outline"
                  to="/admin/rapports?tab=peremption"
                >
                  ⏳ Péremptions à venir
                </Link>
                <Link
                  className="btn btn-outline"
                  to="/admin/rapports?tab=predictif"
                >
                  🔮 Réassort suggéré
                </Link>
                <Link className="btn btn-outline" to="/admin/receptions">
                  📥 Nouvelle réception fournisseur
                </Link>
              </div>
              <p
                className="muted"
                style={{ marginTop: 10, fontSize: "0.85rem" }}
              >
                Les alertes SMS/WhatsApp quotidiennes se configurent dans{" "}
                <Link to="/admin/parametres">Paramètres</Link>.
              </p>
            </Card>
          </div>

          {q.data.summary.sales_count === 0 ? (
            <Card>
              <div className="empty">
                <span className="emoji" aria-hidden>
                  🚀
                </span>
                <h3>Lancez votre activité</h3>
                <p>
                  Créez vos premiers produits, alimentez le stock, puis vendez
                  depuis la caisse.
                </p>
                <div
                  className="row"
                  style={{ justifyContent: "center", marginTop: 12 }}
                >
                  <Link
                    className="btn btn-primary"
                    to="/admin/produits/nouveau"
                  >
                    ➕ Créer un produit
                  </Link>
                  <Link className="btn btn-outline" to="/caisse">
                    🧾 Aller à la caisse
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
            {q.data.lowStockCount} produit(s) sous le seuil d’alerte
          </Badge>{" "}
          <Link to="/admin/produits?status=low">Traiter maintenant →</Link>
        </Card>
      ) : null}
    </div>
  );
}
