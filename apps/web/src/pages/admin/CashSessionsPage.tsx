/** Sessions de caisse (E6, gérant) : historique filtré par dépôt/statut/
 *  journée, fond d'ouverture et comptés, écarts de clôture mis en évidence,
 *  Z détaillé en lecture (immuable). */
import { useState } from "react";
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
  const z = session.zReport;
  return (
    <Modal
      title={`Session du ${session.businessDate} — ${session.depotName ?? ""}`}
      onClose={onClose}
      wide
      footer={<Button onClick={onClose}>Fermer</Button>}
    >
      <div className="grid kpis" style={{ marginBottom: 10 }}>
        <Kpi
          label="Fond d'ouverture"
          value={formatMoney(session.openingFloat)}
        />
        {z ? (
          <>
            <Kpi label="Ventes" value={String(z.sales.count)} />
            <Kpi label="CA" value={formatMoney(z.sales.totalSold)} />
            <Kpi
              label="Écart total"
              value={formatMoney(z.varianceTotal)}
              tone={varianceTone(z.varianceTotal)}
            />
          </>
        ) : (
          <Kpi label="Statut" value="Ouverte" />
        )}
      </div>

      <p className="muted">
        Ouverte par {session.openedByName ?? "—"} le{" "}
        {formatDateTime(session.openedAt)}
        {session.closedAt
          ? ` · clôturée par ${session.closedByName ?? "—"} le ${formatDateTime(session.closedAt)}`
          : ""}
        {session.note ? ` · « ${session.note} »` : ""}
      </p>

      {z ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Méthode</th>
                <th className="num">Encaissements</th>
                <th className="num">Attendu</th>
                <th className="num">Compté</th>
                <th className="num">Écart</th>
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
            Crédit restant sur les ventes de la journée :{" "}
            {formatMoney(z.sales.creditOutstanding)} · ventes annulées :{" "}
            {z.sales.voided} · Z émis le {formatDateTime(z.generatedAt)} —
            immuable.
          </p>
        </div>
      ) : (
        <EmptyState emoji="🔓" title="Session encore ouverte">
          Le Z sera émis à la clôture ; il est ensuite définitif.
        </EmptyState>
      )}
    </Modal>
  );
}

export default function CashSessionsPage() {
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
        title="Sessions de caisse"
        sub={
          q.data
            ? `${q.data.total} session(s) · écart cumulé (page) : ${formatMoney(totalVariance)}`
            : "Fonds, comptés et écarts de clôture"
        }
      />

      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label="Du">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                resetPage();
              }}
            />
          </Field>
          <Field label="Au">
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                resetPage();
              }}
            />
          </Field>
          <Field label="Dépôt">
            <Select
              value={depotId}
              onChange={(e) => {
                setDepotId(e.target.value);
                resetPage();
              }}
            >
              <option value="">Tous</option>
              {(depots.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statut">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                resetPage();
              }}
            >
              <option value="">Toutes</option>
              <option value="OPEN">Ouvertes</option>
              <option value="CLOSED">Clôturées</option>
            </Select>
          </Field>
        </div>
      </Card>

      {q.loading && !q.data ? (
        <Spinner label="Chargement des sessions…" />
      ) : rows.length === 0 ? (
        <EmptyState emoji="💵" title="Aucune session">
          Aucune session de caisse sur ces critères.
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Journée</th>
                  <th>Dépôt</th>
                  <th>Ouverte par</th>
                  <th className="num">Fond</th>
                  <th>Statut</th>
                  <th className="num">CA</th>
                  <th className="num">Écart clôture</th>
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
                          {s.status === "OPEN" ? "Ouverte" : "Clôturée"}
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
                          Détail
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
