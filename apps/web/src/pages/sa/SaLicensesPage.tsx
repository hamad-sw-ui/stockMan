/** Console éditeur — licences : liste globale filtrable par statut,
 *  renouvellement en N mois (prolongation depuis la fin courante). */
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "../../components/ui";
import { post } from "../../lib/http";
import { formatDate, formatMoney } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { LicenseRow } from "../../lib/types";

const tone = (s: string): "ok" | "info" | "danger" =>
  s === "ACTIVE" ? "ok" : s === "TRIAL" ? "info" : "danger";

/** Libellé i18n d'un statut de licence, repli sur le code brut si inconnu. */
const label = (t: (k: string) => string, s: string): string => {
  const key = `licenseStatus.${s}`;
  const v = t(key);
  return v === key ? s : v;
};

export default function SaLicensesPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [status, setStatus] = useState("");
  const path = `/licenses${status ? `?status=${status}` : ""}`;
  const q = useQuery<LicenseRow[]>(`licenses:${path}`, path);
  const [renew, setRenew] = useState<LicenseRow | null>(null);
  const [months, setMonths] = useState("1");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const doRenew = async () => {
    if (!renew) return;
    setBusy(true);
    try {
      await post(`/licenses/${renew.id}/renew`, {
        months: Number(months) || 1,
        notes: notes || null,
      });
      show(t("pages.sa.licenses.renewed"), "success");
      invalidateQueries("licenses:");
      invalidateQueries("sa-");
      setRenew(null);
      setNotes("");
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.sa.licenses.renewError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.sa.licenses.title")}
        sub={t("pages.sa.licenses.sub")}
        actions={
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ width: "auto" }}
            aria-label={t("pages.sa.licenses.filterAria")}
          >
            <option value="">{t("pages.sa.licenses.filterAll")}</option>
            <option value="TRIAL">{t("pages.sa.licenses.filterTrials")}</option>
            <option value="ACTIVE">
              {t("pages.sa.licenses.filterActive")}
            </option>
            <option value="EXPIRED">
              {t("pages.sa.licenses.filterExpired")}
            </option>
            <option value="SUSPENDED">
              {t("pages.sa.licenses.filterSuspended")}
            </option>
          </Select>
        }
      />

      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("licenses:")}
        />
      ) : !q.data?.length ? (
        <EmptyState emoji="📜" title={t("pages.sa.licenses.empty")} />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.sa.common.tenant")}</th>
                  <th>{t("pages.sa.common.plan")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("pages.subscription.rowStart")}</th>
                  <th>{t("pages.customers.colDueDate")}</th>
                  <th className="num">{t("pages.subscription.rowQuotas")}</th>
                  <th className="num">{t("pages.subscription.rowPrice")}</th>
                  <th aria-label={t("pages.sa.licenses.renewAria")} />
                </tr>
              </thead>
              <tbody>
                {q.data.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 700 }}>{l.tenant_name}</td>
                    <td>
                      {l.plan_name}{" "}
                      <span className="muted">({l.plan_code})</span>
                    </td>
                    <td>
                      <Badge tone={tone(l.status)}>{label(t, l.status)}</Badge>
                    </td>
                    <td className="muted">{formatDate(l.start_date)}</td>
                    <td style={{ fontWeight: 700 }}>
                      {formatDate(l.end_date)}
                    </td>
                    <td className="num muted">
                      {t("pages.sa.licenses.quotasShort", {
                        users: l.max_users,
                        depots: l.max_depots,
                      })}
                    </td>
                    <td className="num">
                      {l.monthly_price != null
                        ? t("pages.sa.licenses.priceMonthly", {
                            price: formatMoney(l.monthly_price),
                          })
                        : "—"}
                    </td>
                    <td>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRenew(l);
                          setMonths("1");
                        }}
                      >
                        {t("pages.sa.licenses.renewButton")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {renew ? (
        <Modal
          title={t("pages.sa.licenses.modalTitle", {
            name: renew.tenant_name,
          })}
          onClose={() => !busy && setRenew(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setRenew(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button loading={busy} onClick={doRenew}>
                {t("pages.sa.licenses.extendButton")}
              </Button>
            </>
          }
        >
          <p className="muted" style={{ marginTop: 0 }}>
            <Trans
              i18nKey="pages.sa.licenses.modalBody"
              values={{ date: formatDate(renew.end_date) }}
              components={{ b: <strong /> }}
            />
          </p>
          <div className="row">
            <Field label={t("pages.sa.licenses.durationField")} required>
              <Input
                inputMode="numeric"
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            </Field>
            <Field label={t("pages.sa.licenses.noteField")}>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("pages.sa.licenses.notePlaceholder")}
              />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
