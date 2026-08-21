/** Abonnement : plan courant, échéance, quotas (utilisateurs/dépôts) et
 *  marche à suivre pour renouveler (Mobile Money / WhatsApp). */
import { Trans, useTranslation } from "react-i18next";
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

const statusTone: Record<string, "ok" | "warn" | "danger" | "info"> = {
  TRIAL: "info",
  ACTIVE: "ok",
  EXPIRED: "danger",
  SUSPENDED: "danger",
};

/** Libellé i18n du statut d'abonnement, repli sur le code brut si inconnu. */
function subStatusLabel(t: (k: string) => string, code: string): string {
  const key = `pages.subscription.status.${code}`;
  const v = t(key);
  return v === key ? code : v;
}

function daysLeft(endDate: string): number {
  const end = new Date(`${String(endDate).slice(0, 10)}T00:00:00Z`);
  const now = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((end.getTime() - now.getTime()) / 86_400_000);
}

interface PublicConfig {
  supportWhatsapp: string | null;
}

export default function SubscriptionPage() {
  const { t } = useTranslation();
  const q = useQuery<TenantCurrent>("tenant:current", "/tenants/current");
  const pub = useQuery<PublicConfig>("configs:public", "/configs/public");

  if (q.loading)
    return (
      <div className="wrap">
        <Spinner label={t("pages.subscription.loading")} />
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
    ? {
        label: subStatusLabel(t, lic.status),
        tone: statusTone[lic.status] ?? ("info" as const),
      }
    : null;
  const left = lic ? daysLeft(lic.end_date) : null;

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.subscription.title")}
        sub={t("pages.subscription.sub")}
      />

      {!lic ? (
        <Card>
          <div className="empty">
            <span className="emoji" aria-hidden>
              💎
            </span>
            <h3>{t("pages.subscription.noLicense")}</h3>
            <p>{t("pages.subscription.noLicenseBody")}</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label={t("pages.subscription.kpiPlan")}
              value={lic.plan_name}
              sub={t("pages.subscription.monthlySuffix", {
                price: formatMoney(lic.monthly_price),
              })}
            />
            <Kpi
              label={t("common.status")}
              value={<Badge tone={st!.tone}>{st!.label}</Badge>}
              sub={
                left != null
                  ? left >= 0
                    ? t("shell.license.daysLeft", { count: left })
                    : t("pages.subscription.expiredSinceSub", { count: -left })
                  : undefined
              }
            />
            <Kpi
              label={t("pages.subscription.kpiUsers")}
              value={`${q.data.usage.users} / ${lic.max_users}`}
              tone={q.data.usage.users >= lic.max_users ? "warn" : undefined}
            />
            <Kpi
              label={t("pages.subscription.kpiDepots")}
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
            <Card title={t("pages.subscription.detailsTitle")}>
              <div className="table-wrap">
                <table>
                  <tbody>
                    <tr>
                      <td className="muted">
                        {t("pages.subscription.kpiPlan")}
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        {lic.plan_name} ({lic.plan_code})
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">
                        {t("pages.subscription.rowStart")}
                      </td>
                      <td>{formatDate(lic.start_date)}</td>
                    </tr>
                    <tr>
                      <td className="muted">
                        {t("pages.customers.colDueDate")}
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        {formatDate(lic.end_date)}
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">
                        {t("pages.subscription.rowPrice")}
                      </td>
                      <td>
                        {t("pages.subscription.monthlySuffix", {
                          price: formatMoney(lic.monthly_price),
                        })}
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">
                        {t("pages.subscription.rowQuotas")}
                      </td>
                      <td>
                        {t("pages.subscription.quotasValue", {
                          users: lic.max_users,
                          depots: lic.max_depots,
                        })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title={t("pages.subscription.renewTitle")}>
              {left != null && left <= 7 ? (
                <div
                  className={
                    left < 0 ? "banner banner-danger" : "banner banner-warn"
                  }
                  style={{ borderRadius: 10, marginBottom: 10 }}
                >
                  {left < 0
                    ? t("pages.subscription.bannerExpired")
                    : t("pages.subscription.bannerExpiring", { count: left })}
                </div>
              ) : null}
              <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                <li>
                  <Trans
                    i18nKey="pages.subscription.step1"
                    values={{ price: formatMoney(lic.monthly_price) }}
                    components={{ b: <strong /> }}
                  />
                </li>
                <li>
                  <Trans
                    i18nKey="pages.subscription.step2"
                    values={{ name: q.data.name }}
                    components={{ b: <strong /> }}
                  />
                </li>
                <li>{t("pages.subscription.step3")}</li>
              </ol>
              <div className="row" style={{ marginTop: 12 }}>
                {pub.data?.supportWhatsapp ? (
                  <a
                    className="btn btn-primary"
                    href={`https://wa.me/${pub.data.supportWhatsapp}?text=${encodeURIComponent(t("pages.subscription.whatsappMsg"))}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("pages.subscription.whatsappButton")}
                  </a>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    {t("pages.subscription.noSupport")}
                  </p>
                )}
              </div>
              <p
                className="muted"
                style={{ fontSize: "0.82rem", marginTop: 10 }}
              >
                {t("pages.subscription.paymentNote")}
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
