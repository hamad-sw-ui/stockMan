/** Ma caisse (E6) : ouverture avec fond de caisse, suivi des attendus en
 *  direct par méthode, clôture avec comptage physique et émission du Z
 *  (immuable, écart = compté − attendu). */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Kpi,
  PageHeader,
  Spinner,
} from "../../components/ui";
import { post } from "../../lib/http";
import { invalidateQueries, useQuery } from "../../lib/query";
import {
  formatDateTime,
  formatMoney,
  paymentMethodLabel,
} from "../../lib/format";
import { useToast } from "../../store/toast";
import type { CashSession, CashSessionCurrent } from "../../lib/types";

const METHODS = ["CASH", "MTN_MOMO", "ORANGE_MONEY"] as const;

/** Formulaire d'ouverture de caisse (fond + note). */
export function OpenSessionForm({
  depotId,
  onOpened,
}: {
  depotId?: string | null;
  onOpened: (s: CashSession) => void;
}) {
  const { t } = useTranslation();
  const { show } = useToast();
  const [floatStr, setFloatStr] = useState("0");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const open = async () => {
    const openingFloat = Math.max(0, Math.round(Number(floatStr) || 0));
    setBusy(true);
    try {
      const s = await post<CashSession>(`/cash-sessions`, {
        ...(depotId ? { depotId } : {}),
        openingFloat,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      show(t("pages.cashSession.openedToast"), "success");
      invalidateQueries("cash:");
      onOpened(s);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.cashSession.openError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form" style={{ maxWidth: 380 }}>
      <Field label={t("pages.cashSession.floatField")}>
        <Input
          type="number"
          min={0}
          step={100}
          value={floatStr}
          onChange={(e) => setFloatStr(e.target.value)}
          autoFocus
        />
      </Field>
      <Field label={t("pages.cashSession.noteField")}>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("pages.cashSession.notePlaceholder")}
        />
      </Field>
      <Button onClick={open} loading={busy}>
        {t("pages.cashSession.openButton")}
      </Button>
    </div>
  );
}

export default function CashSessionPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const q = useQuery<CashSessionCurrent>(
    "cash:current",
    "/cash-sessions/current",
  );
  const [closedZ, setClosedZ] = useState<CashSession | null>(null);

  // Comptage physique de clôture
  const [countCash, setCountCash] = useState("");
  const [countMtn, setCountMtn] = useState("");
  const [countOm, setCountOm] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [busy, setBusy] = useState(false);

  const session = q.data?.session ?? null;

  const close = async () => {
    if (!session) return;
    if (countCash === "" || Number(countCash) < 0) {
      show(t("pages.cashSession.countRequired"), "error");
      return;
    }
    setBusy(true);
    try {
      const s = await post<CashSession>(`/cash-sessions/${session.id}/close`, {
        countedCash: Math.round(Number(countCash)),
        ...(countMtn !== ""
          ? { countedMtn: Math.round(Number(countMtn)) }
          : {}),
        ...(countOm !== "" ? { countedOm: Math.round(Number(countOm)) } : {}),
        ...(closeNote.trim() ? { note: closeNote.trim() } : {}),
      });
      setClosedZ(s);
      invalidateQueries("cash:");
      show(t("pages.cashSession.closedToast"), "success");
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.cashSession.closeError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  if (q.loading && !q.data)
    return <Spinner label={t("pages.cashSession.loading")} />;

  /* ---------------- Z de clôture (après clôture réussie) ---------------- */
  const z = closedZ?.zReport;
  if (closedZ && z) {
    const varianceTone = (v: number | null) =>
      v == null || v === 0 ? "ok" : v < 0 ? "danger" : "warn";
    return (
      <div className="wrap" style={{ maxWidth: 760 }}>
        <PageHeader
          title={t("pages.cashSession.zTitle", {
            date: closedZ.businessDate,
          })}
          sub={t("pages.cashSession.zSub", { name: z.closedBy })}
          actions={
            <Button variant="ghost" onClick={() => window.print()}>
              🖨️ {t("common.print")}
            </Button>
          }
        />
        <div className="grid kpis">
          <Kpi
            label={t("pages.cashSessions.kpiSalesCount")}
            value={String(z.sales.count)}
          />
          <Kpi
            label={t("pages.cashSession.kpiRevenue")}
            value={formatMoney(z.sales.totalSold)}
          />
          <Kpi
            label={t("pages.cashSession.kpiPaid")}
            value={formatMoney(z.sales.totalPaid)}
          />
          <Kpi
            label={t("pages.cashSessions.kpiVariance")}
            value={formatMoney(z.varianceTotal)}
            tone={varianceTone(z.varianceTotal)}
          />
        </div>
        <Card title={t("pages.cashSession.controlTitle")}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.cashSessions.colMethod")}</th>
                  <th className="num">{t("pages.cashSessions.colPayments")}</th>
                  <th className="num">{t("pages.cashSessions.colExpected")}</th>
                  <th className="num">{t("pages.cashSessions.colCounted")}</th>
                  <th className="num">{t("pages.cashSessions.colVariance")}</th>
                </tr>
              </thead>
              <tbody>
                {METHODS.map((m) => {
                  const line = z.methods[m];
                  return (
                    <tr key={m}>
                      <td>{paymentMethodLabel(m)}</td>
                      <td className="num">{formatMoney(line.payments)}</td>
                      <td className="num">{formatMoney(line.expected)}</td>
                      <td className="num">
                        {line.counted == null ? "—" : formatMoney(line.counted)}
                      </td>
                      <td className="num">
                        {line.variance == null ? (
                          "—"
                        ) : (
                          <Badge tone={varianceTone(line.variance)}>
                            {formatMoney(line.variance)}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            {t("pages.cashSession.zFootnote", {
              float: formatMoney(z.openingFloat),
              credit: formatMoney(z.sales.creditOutstanding),
            })}{" "}
            <strong>{t("pages.cashSession.zDefinitive")}</strong>{" "}
            {t("pages.cashSession.zFootnoteEnd")}
          </p>
        </Card>
      </div>
    );
  }

  /* ---------------------- Aucune session ouverte ------------------------ */
  if (!session) {
    return (
      <div className="wrap" style={{ maxWidth: 620 }}>
        <PageHeader
          title={t("pages.cashSession.title")}
          sub={
            q.data?.required
              ? t("pages.cashSession.requiredSub")
              : t("pages.cashSession.noneSub")
          }
        />
        <Card title={t("pages.cashSession.openButton")}>
          {q.data?.required ? (
            <p className="muted">{t("pages.cashSession.requiredWarn")}</p>
          ) : null}
          <OpenSessionForm onOpened={() => invalidateQueries("cash:")} />
        </Card>
      </div>
    );
  }

  /* ------------------------ Session ouverte ----------------------------- */
  const expected = session.expected;
  const numOrNull = (s: string) => (s === "" ? null : Math.round(Number(s)));
  const previewVar = (counted: number | null, exp: number) =>
    counted == null ? null : counted - exp;

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <PageHeader
        title={t("pages.cashSession.title")}
        sub={t("pages.cashSession.openSub", {
          date: formatDateTime(session.openedAt),
          day: session.businessDate,
        })}
        actions={<Badge tone="ok">{t("pages.cashSession.openBadge")}</Badge>}
      />

      <div className="grid kpis">
        <Kpi
          label={t("pages.cashSessions.kpiFloat")}
          value={formatMoney(session.openingFloat)}
        />
        <Kpi
          label={t("pages.cashSession.kpiExpectedCash")}
          value={formatMoney(expected.CASH)}
        />
        <Kpi
          label={t("pages.cashSession.kpiExpectedMtn")}
          value={formatMoney(expected.MTN_MOMO)}
        />
        <Kpi
          label={t("pages.cashSession.kpiExpectedOm")}
          value={formatMoney(expected.ORANGE_MONEY)}
        />
      </div>

      <Card title={t("pages.cashSession.closeCardTitle")}>
        <p className="muted">
          {t("pages.cashSession.closeIntro1")}{" "}
          <strong>{t("pages.cashSession.closeIntroFrozen")}</strong>{" "}
          {t("pages.cashSession.closeIntro2")}
        </p>
        <div className="grid grid-3">
          <Field label={t("pages.cashSession.countedCashField")}>
            <Input
              type="number"
              min={0}
              step={100}
              value={countCash}
              onChange={(e) => setCountCash(e.target.value)}
              placeholder={String(expected.CASH)}
            />
          </Field>
          <Field label={t("pages.cashSession.countedMtnField")}>
            <Input
              type="number"
              min={0}
              step={100}
              value={countMtn}
              onChange={(e) => setCountMtn(e.target.value)}
              placeholder={String(expected.MTN_MOMO)}
            />
          </Field>
          <Field label={t("pages.cashSession.countedOmField")}>
            <Input
              type="number"
              min={0}
              step={100}
              value={countOm}
              onChange={(e) => setCountOm(e.target.value)}
              placeholder={String(expected.ORANGE_MONEY)}
            />
          </Field>
        </div>
        {/* Aperçu des écarts avant validation */}
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          {METHODS.map((m) => {
            const counted =
              m === "CASH"
                ? numOrNull(countCash)
                : m === "MTN_MOMO"
                  ? numOrNull(countMtn)
                  : numOrNull(countOm);
            const v = previewVar(counted, expected[m]);
            return (
              <span key={m} className="muted">
                {paymentMethodLabel(m)} :{" "}
                {v == null ? (
                  "—"
                ) : (
                  <Badge tone={v === 0 ? "ok" : v < 0 ? "danger" : "warn"}>
                    {v > 0 ? "+" : ""}
                    {formatMoney(v)}
                  </Badge>
                )}
              </span>
            );
          })}
        </div>
        <Field label={t("pages.cashSession.closeNoteField")}>
          <Input
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
            placeholder={t("pages.cashSession.closeNotePlaceholder")}
          />
        </Field>
        <Button variant="danger" onClick={close} loading={busy}>
          {t("pages.cashSession.closeButton")}
        </Button>
      </Card>

      <EmptyState emoji="ℹ️" title={t("pages.cashSession.onePerDayTitle")}>
        {t("pages.cashSession.onePerDayBody")}
      </EmptyState>
    </div>
  );
}
