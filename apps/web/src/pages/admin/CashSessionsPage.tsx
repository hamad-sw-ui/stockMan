/** Sessions de caisse (E6, gérant) : historique filtré par dépôt/statut/
 *  journée, fond d'ouverture et comptés, écarts de clôture mis en évidence,
 *  Z détaillé en lecture (immuable). */
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
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
} from "../../components/ui";
import {
  formatDateTime,
  formatMoney,
  paymentMethodLabel,
} from "../../lib/format";
import { useQuery } from "../../lib/query";
import { get } from "../../lib/http";
import type { CashSession, Depot, Paged } from "../../lib/types";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const METHODS = ["CASH", "MTN_MOMO", "ORANGE_MONEY"] as const;

const varianceTone = (v: number | null | undefined) =>
  v == null || v === 0 ? "ok" : v < 0 ? "danger" : "warn";

/** Détail d'une session : comptés, Z figé et écarts par méthode. */
function SessionModal({
  session,
  onClose,
}: {
  session: CashSession;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const z = session.zReport;
  return (
    <Modal
      title={t("pages.cashSessions.sessionTitle", {
        date: session.businessDate,
        depot: session.depotName ?? "",
      })}
      onClose={onClose}
      wide
      footer={<Button onClick={onClose}>{t("common.close")}</Button>}
    >
      <div className="grid kpis" style={{ marginBottom: 10 }}>
        <Kpi
          label={t("pages.cashSessions.kpiFloat")}
          value={formatMoney(session.openingFloat)}
        />
        {z ? (
          <>
            <Kpi
              label={t("pages.cashSessions.kpiSalesCount")}
              value={String(z.sales.count)}
            />
            <Kpi
              label={t("pages.cashSessions.kpiRevenue")}
              value={formatMoney(z.sales.totalSold)}
            />
            <Kpi
              label={t("pages.cashSessions.kpiVariance")}
              value={formatMoney(z.varianceTotal)}
              tone={varianceTone(z.varianceTotal)}
            />
          </>
        ) : (
          <Kpi
            label={t("common.status")}
            value={t("pages.cashSessions.statusOpen")}
          />
        )}
      </div>

      <p className="muted">
        {t("pages.cashSessions.openedInfo", {
          name: session.openedByName ?? "—",
          date: formatDateTime(session.openedAt),
        })}
        {session.closedAt
          ? t("pages.cashSessions.closedSuffix", {
              name: session.closedByName ?? "—",
              date: formatDateTime(session.closedAt),
            })
          : ""}
        {session.note
          ? t("pages.cashSessions.noteSuffix", { note: session.note })
          : ""}
      </p>

      {z ? (
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
                          {line.variance > 0 ? "+" : ""}
                          {formatMoney(line.variance)}
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted" style={{ marginBottom: 0 }}>
            {t("pages.cashSessions.creditLine")}{" "}
            {formatMoney(z.sales.creditOutstanding)}
            {t("pages.cashSessions.voidedPart")} {z.sales.voided}
            {t("pages.cashSessions.zImmutable", {
              date: formatDateTime(z.generatedAt),
            })}
          </p>
        </div>
      ) : (
        <EmptyState emoji="🔓" title={t("pages.cashSessions.sessionOpenTitle")}>
          {t("pages.cashSessions.sessionOpenBody")}
        </EmptyState>
      )}
    </Modal>
  );
}

export default function CashSessionsPage() {
  const { t } = useTranslation();
  const [depotId, setDepotId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(iso(new Date(Date.now() - 13 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<CashSession | null>(null);

  const params = new URLSearchParams({ page: String(page), size: "25" });
  if (depotId) params.set("depotId", depotId);
  if (status) params.set("status", status);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const path = `/cash-sessions?${params}`;

  const q = useQuery<Paged<CashSession>>(`cash-sessions:${path}`, path);
  const depots = useQuery<Depot[]>("depots:list", "/depots");

  const resetPage = () => setPage(1);
  const rows = q.data?.data ?? [];
  const totalVariance = rows
    .filter((s) => s.zReport)
    .reduce((a, s) => a + (s.zReport?.varianceTotal ?? 0), 0);

  const openDetail = async (id: string) => {
    setDetail(await get<CashSession>(`/cash-sessions/${id}`));
  };

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.cashSessions.title")}
        sub={
          q.data
            ? t("pages.cashSessions.subCount", {
                count: q.data.total,
                variance: formatMoney(totalVariance),
              })
            : t("pages.cashSessions.subDefault")
        }
      />

      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label={t("common.from")}>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                resetPage();
              }}
            />
          </Field>
          <Field label={t("common.to")}>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                resetPage();
              }}
            />
          </Field>
          <Field label={t("fields.depot")}>
            <Select
              value={depotId}
              onChange={(e) => {
                setDepotId(e.target.value);
                resetPage();
              }}
            >
              <option value="">{t("common.all")}</option>
              {(depots.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.status")}>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                resetPage();
              }}
            >
              <option value="">{t("common.allFeminine")}</option>
              <option value="OPEN">{t("pages.cashSessions.filterOpen")}</option>
              <option value="CLOSED">
                {t("pages.cashSessions.filterClosed")}
              </option>
            </Select>
          </Field>
        </div>
      </Card>

      {q.loading && !q.data ? (
        <Spinner label={t("pages.cashSessions.loading")} />
      ) : rows.length === 0 ? (
        <EmptyState emoji="💵" title={t("pages.cashSessions.empty")}>
          {t("pages.cashSessions.emptyBody")}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.cashSessions.colDay")}</th>
                  <th>{t("fields.depot")}</th>
                  <th>{t("pages.cashSessions.colOpenedBy")}</th>
                  <th className="num">{t("pages.cashSessions.colFloat")}</th>
                  <th>{t("common.status")}</th>
                  <th className="num">{t("pages.cashSessions.kpiRevenue")}</th>
                  <th className="num">
                    {t("pages.cashSessions.colVarianceClose")}
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const v = s.zReport?.varianceTotal ?? null;
                  return (
                    <tr key={s.id}>
                      <td>{s.businessDate}</td>
                      <td>{s.depotName ?? "—"}</td>
                      <td>{s.openedByName ?? "—"}</td>
                      <td className="num">{formatMoney(s.openingFloat)}</td>
                      <td>
                        <Badge tone={s.status === "OPEN" ? "warn" : "ok"}>
                          {s.status === "OPEN"
                            ? t("pages.cashSessions.statusOpen")
                            : t("pages.cashSessions.statusClosed")}
                        </Badge>
                      </td>
                      <td className="num">
                        {s.zReport
                          ? formatMoney(s.zReport.sales.totalSold)
                          : "—"}
                      </td>
                      <td className="num">
                        {v == null ? (
                          "—"
                        ) : (
                          <Badge tone={varianceTone(v)}>
                            {v > 0 ? "+" : ""}
                            {formatMoney(v)}
                          </Badge>
                        )}
                      </td>
                      <td className="num">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openDetail(s.id)}
                        >
                          {t("pages.cashSessions.viewButton")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {q.data ? (
        <Pagination
          page={q.data.page}
          totalPages={q.data.totalPages}
          total={q.data.total}
          onPage={setPage}
        />
      ) : null}

      {detail ? (
        <SessionModal session={detail} onClose={() => setDetail(null)} />
      ) : null}
    </div>
  );
}
