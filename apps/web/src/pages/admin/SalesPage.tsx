/** Historique des ventes (admin) : filtres période/dépôt/vendeur/paiement/statut,
 *  pagination serveur, accès au détail (annulation, retours, reçu). */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  Kpi,
  PageHeader,
  Pagination,
  Select,
  Spinner,
} from "../../components/ui";
import {
  formatDateTime,
  formatMoney,
  formatQty,
  paymentMethodLabel,
} from "../../lib/format";
import { useQuery } from "../../lib/query";
import type { Depot, Paged, SaleListItem, VendorRow } from "../../lib/types";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function SalesPage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [depotId, setDepotId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const navigate = useNavigate();

  const params = new URLSearchParams({
    from,
    to,
    page: String(page),
    size: "25",
  });
  if (depotId) params.set("depotId", depotId);
  if (vendorId) params.set("vendorId", vendorId);
  if (method) params.set("paymentMethod", method);
  if (status) params.set("status", status);
  const path = `/sales?${params}`;

  const q = useQuery<Paged<SaleListItem>>(`sales:${path}`, path);
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const users = useQuery<VendorRow[]>(
    "users:short",
    "/users?includeInactive=true",
  );

  const resetPage = () => setPage(1);
  const rows = q.data?.data ?? [];
  const pageTotal = rows
    .filter((s) => s.status === "COMPLETED")
    .reduce((a, s) => a + s.total_amount, 0);

  return (
    <div className="wrap">
      <PageHeader
        title="Ventes"
        sub={
          q.data
            ? `${q.data.total} vente(s) sur la période`
            : "Historique complet"
        }
        actions={
          <Link className="btn btn-primary btn-sm" to="/caisse">
            🧾 Nouvelle vente (caisse)
          </Link>
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
          <Field label="Vendeur">
            <Select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                resetPage();
              }}
            >
              <option value="">Tous</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Paiement">
            <Select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value);
                resetPage();
              }}
            >
              <option value="">Tous</option>
              <option value="CASH">Espèces</option>
              <option value="MTN_MOMO">MTN MoMo</option>
              <option value="ORANGE_MONEY">Orange Money</option>
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
              <option value="">Validées & annulées</option>
              <option value="COMPLETED">Validées</option>
              <option value="VOIDED">Annulées</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div className="kpi-grid">
        <Kpi label="Total page courante" value={formatMoney(pageTotal)} />
        <Kpi label="Ventes trouvées" value={formatQty(q.data?.total ?? 0)} />
      </div>

      {q.loading ? (
        <Spinner label="Chargement des ventes…" />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="💳"
          title="Aucune vente sur ces critères"
          action={
            <Link className="btn btn-primary" to="/caisse">
              Ouvrir la caisse
            </Link>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendeur</th>
                  <th>Dépôt</th>
                  <th className="num">Lignes</th>
                  <th className="num">Montant</th>
                  <th>Paiement</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/admin/ventes/${s.id}`)}
                  >
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(s.created_at)}
                    </td>
                    <td>{s.vendor_name}</td>
                    <td className="muted">{s.depot_name}</td>
                    <td className="num">{s.line_count}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatMoney(s.total_amount)}
                      {s.returned_amount > 0 ? (
                        <span className="muted" style={{ fontWeight: 400 }}>
                          {" "}
                          (−{formatMoney(s.returned_amount)})
                        </span>
                      ) : null}
                    </td>
                    <td>{paymentMethodLabel(s.payment_method)}</td>
                    <td>
                      {s.status === "VOIDED" ? (
                        <Badge tone="danger">Annulée</Badge>
                      ) : (
                        <Badge tone="ok">Validée</Badge>
                      )}
                      {s.synced_at ? (
                        <Badge tone="info">hors-ligne</Badge>
                      ) : null}
                    </td>
                  </tr>
                ))}
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
    </div>
  );
}
