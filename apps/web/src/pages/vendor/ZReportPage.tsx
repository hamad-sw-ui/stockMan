/** Clôture de caisse (rapport Z) : synthèse de la journée du vendeur/dépôt —
 *  à imprimer en fin de service pour le contrôle des espèces. */
import { useState } from "react";
import { Link } from "react-router-dom";
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
      setError(e instanceof Error ? e.message : "Rapport indisponible");
    } finally {
      setLoading(false);
    }
  };

  const revenue = data?.totals.reduce((a, t) => a + t.revenue, 0) ?? 0;
  const count = data?.totals.reduce((a, t) => a + t.sales_count, 0) ?? 0;

  return (
    <div className="wrap" style={{ maxWidth: 860 }}>
      <PageHeader
        title="Clôture de caisse (Z)"
        sub={
          user?.depotId
            ? `Votre dépôt · ${formatDate(date)}`
            : `Journée du ${formatDate(date)}`
        }
        actions={
          <div className="row">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Date de clôture"
            />
            <Button size="sm" loading={loading} onClick={() => load()}>
              Afficher
            </Button>
          </div>
        }
      />

      {loading ? (
        <Spinner label="Calcul de la clôture…" />
      ) : error ? (
        <EmptyState
          emoji="⚠️"
          title="Clôture indisponible"
          action={
            <Button variant="outline" onClick={() => load()}>
              Réessayer
            </Button>
          }
        >
          {error}
        </EmptyState>
      ) : !data ? (
        <EmptyState
          emoji="🧮"
          title="Choisissez la journée"
          action={<Button onClick={() => load()}>Clôturer aujourd’hui</Button>}
        >
          Le Z récapitule les ventes de la journée : total par paiement et
          éventuelles annulations.
        </EmptyState>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label="CA de la journée"
              value={formatMoney(revenue)}
              tone="ok"
            />
            <Kpi label="Nombre de ventes" value={formatQty(count)} />
            <Kpi
              label="Annulations"
              value={formatQty(data.voids?.voided ?? 0)}
              sub={formatMoney(data.voids?.amount ?? 0)}
              tone={(data.voids?.voided ?? 0) > 0 ? "warn" : undefined}
            />
            <Kpi
              label="Panier moyen"
              value={formatMoney(count ? revenue / count : 0)}
            />
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            }}
          >
            <Card title="Encaissements par mode de paiement">
              {data.byPayment.length === 0 ? (
                <EmptyState emoji="💳" title="Aucune vente ce jour" />
              ) : (
                <Donut
                  segments={data.byPayment.map((p) => ({
                    label: `${paymentMethodLabel(p.payment_method)} (${p.count})`,
                    value: p.amount,
                  }))}
                />
              )}
            </Card>
            <Card title="Contrôle espèces">
              <p className="muted" style={{ marginTop: 0 }}>
                Espèces attendues en tiroir (hors fonds de caisse) :
              </p>
              <div className="kpi-value" style={{ fontSize: "1.8rem" }}>
                {formatMoney(
                  data.byPayment.find((p) => p.payment_method === "CASH")
                    ?.amount ?? 0,
                )}
              </div>
              <p className="muted">
                Comptez le tiroir puis remettez l’excédent au gérant.
              </p>
              <Button variant="outline" onClick={() => window.print()}>
                🖨️ Imprimer le Z
              </Button>
            </Card>
          </div>
          <p className="muted" style={{ textAlign: "center", marginTop: 14 }}>
            <Link to="/caisse/mes-ventes">Voir le détail de mes ventes →</Link>
          </p>
        </>
      )}
    </div>
  );
}
