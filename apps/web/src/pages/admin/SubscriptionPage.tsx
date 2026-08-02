/** Abonnement : plan courant, échéance, quotas (utilisateurs/dépôts) et
 *  marche à suivre pour renouveler (Mobile Money / WhatsApp). */
import {
  Badge,
  Card,
  ErrorState,
  Kpi,
  PageHeader,
  Spinner,
} from "../../components/ui";
import { formatDate, formatMoney } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import type { TenantCurrent } from "../../lib/types";

const statusLabel: Record<
  string,
  { label: string; tone: "ok" | "warn" | "danger" | "info" }
> = {
  TRIAL: { label: "Essai gratuit", tone: "info" },
  ACTIVE: { label: "Actif", tone: "ok" },
  EXPIRED: { label: "Expiré", tone: "danger" },
  SUSPENDED: { label: "Suspendu", tone: "danger" },
};

function daysLeft(endDate: string): number {
  const end = new Date(`${String(endDate).slice(0, 10)}T00:00:00Z`);
  const now = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((end.getTime() - now.getTime()) / 86_400_000);
}

export default function SubscriptionPage() {
  const q = useQuery<TenantCurrent>("tenant:current", "/tenants/current");

  if (q.loading)
    return (
      <div className="wrap">
        <Spinner label="Chargement de l’abonnement…" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="wrap">
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("tenant:")}
        />
      </div>
    );

  const lic = q.data.license;
  const st = lic
    ? (statusLabel[lic.status] ?? { label: lic.status, tone: "info" as const })
    : null;
  const left = lic ? daysLeft(lic.end_date) : null;

  return (
    <div className="wrap">
      <PageHeader
        title="Abonnement"
        sub="Votre formule StockMan et ses limites"
      />

      {!lic ? (
        <Card>
          <div className="empty">
            <span className="emoji" aria-hidden>
              💎
            </span>
            <h3>Aucune licence</h3>
            <p>Contactez le support StockMan pour activer votre abonnement.</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label="Formule"
              value={lic.plan_name}
              sub={`${formatMoney(lic.monthly_price)} / mois`}
            />
            <Kpi
              label="Statut"
              value={<Badge tone={st!.tone}>{st!.label}</Badge>}
              sub={
                left != null
                  ? left >= 0
                    ? `${left} jour(s) restant(s)`
                    : `expiré depuis ${-left} j`
                  : undefined
              }
            />
            <Kpi
              label="Utilisateurs"
              value={`${q.data.usage.users} / ${lic.max_users}`}
              tone={q.data.usage.users >= lic.max_users ? "warn" : undefined}
            />
            <Kpi
              label="Dépôts actifs"
              value={`${q.data.usage.depots} / ${lic.max_depots}`}
              tone={q.data.usage.depots >= lic.max_depots ? "warn" : undefined}
            />
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            }}
          >
            <Card title="Détails">
              <div className="table-wrap">
                <table>
                  <tbody>
                    <tr>
                      <td className="muted">Formule</td>
                      <td style={{ fontWeight: 700 }}>
                        {lic.plan_name} ({lic.plan_code})
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">Début</td>
                      <td>{formatDate(lic.start_date)}</td>
                    </tr>
                    <tr>
                      <td className="muted">Échéance</td>
                      <td style={{ fontWeight: 700 }}>
                        {formatDate(lic.end_date)}
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">Tarif</td>
                      <td>{formatMoney(lic.monthly_price)} / mois</td>
                    </tr>
                    <tr>
                      <td className="muted">Quotas</td>
                      <td>
                        {lic.max_users} utilisateur(s) · {lic.max_depots}{" "}
                        dépôt(s)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Renouveler ou changer de formule">
              {left != null && left <= 7 ? (
                <div
                  className={
                    left < 0 ? "banner banner-danger" : "banner banner-warn"
                  }
                  style={{ borderRadius: 10, marginBottom: 10 }}
                >
                  {left < 0
                    ? "Votre licence est expirée : les enregistrements sont bloqués jusqu’au renouvellement. Vos données restent accessibles en lecture."
                    : `Votre licence expire dans ${left} jour(s). Pensez à renouveler pour éviter toute interruption.`}
                </div>
              ) : null}
              <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                <li>
                  Envoyez le montant ({formatMoney(lic.monthly_price)}) par{" "}
                  <strong>MTN MoMo ou Orange Money</strong> au numéro communiqué
                  par le support.
                </li>
                <li>
                  Transférez la capture au support WhatsApp en précisant le nom
                  de votre entreprise (<strong>{q.data.name}</strong>).
                </li>
                <li>
                  Votre licence est prolongée sous quelques minutes par notre
                  équipe.
                </li>
              </ol>
              <div className="row" style={{ marginTop: 12 }}>
                <a
                  className="btn btn-primary"
                  href="https://wa.me/237600000000?text=Bonjour%2C%20je%20souhaite%20renouveler%20mon%20abonnement%20StockMan."
                  target="_blank"
                  rel="noreferrer"
                >
                  💬 Contacter le support (WhatsApp)
                </a>
              </div>
              <p
                className="muted"
                style={{ fontSize: "0.82rem", marginTop: 10 }}
              >
                Le numéro officiel de paiement est configuré par l’éditeur dans
                la console d’administration plateforme.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
