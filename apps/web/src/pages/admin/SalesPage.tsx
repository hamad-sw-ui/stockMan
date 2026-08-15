/** Historique des ventes (admin) : filtres période/dépôt/vendeur/paiement/statut,
 *  pagination serveur, accès au détail (annulation, retours, reçu). */
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
        title={t("pages.sales.title")}
        sub={
          q.data
            ? t("pages.sales.subCount", { count: q.data.total })
            : t("pages.sales.subDefault")
        }
        actions={
          <Link className="btn btn-primary btn-sm" to="/caisse">
            {t("pages.sales.newSale")}
          </Link>
        }
      />

      <Card className="filters">
        <div
          className="row filters-row"
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
          <Field label={t("fields.vendor")}>
            <Select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                resetPage();
              }}
            >
              <option value="">{t("common.all")}</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fields.payment")}>
            <Select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value);
                resetPage();
              }}
            >
              <option value="">{t("common.all")}</option>
              <option value="CASH">{t("format.payment.CASH")}</option>
              <option value="MTN_MOMO">{t("format.payment.MTN_MOMO")}</option>
              <option value="ORANGE_MONEY">
                {t("format.payment.ORANGE_MONEY")}
              </option>
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
              <option value="">{t("pages.sales.statusAll")}</option>
              <option value="COMPLETED">
                {t("pages.sales.statusCompleted")}
              </option>
              <option value="VOIDED">{t("pages.sales.statusVoided")}</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div className="kpi-grid">
        <Kpi
          label={t("pages.sales.kpiPageTotal")}
          value={formatMoney(pageTotal)}
        />
        <Kpi
          label={t("pages.sales.kpiFound")}
          value={formatQty(q.data?.total ?? 0)}
        />
      </div>

      {q.loading ? (
        <Spinner label={t("pages.sales.loading")} />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="💳"
          title={t("pages.sales.empty")}
          action={
            <Link className="btn btn-primary" to="/caisse">
              {t("pages.sales.openPos")}
            </Link>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("fields.vendor")}</th>
                  <th>{t("fields.depot")}</th>
                  <th className="num">{t("pages.receipts.colLines")}</th>
                  <th className="num">{t("common.amount")}</th>
                  <th>{t("fields.payment")}</th>
                  <th>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/admin/ventes/${s.id}`)}
                  >
                    <td
                      className="muted"
                      style={{ whiteSpace: "nowrap" }}
                      data-label={t("common.date")}
                    >
                      {formatDateTime(s.created_at)}
                    </td>
                    <td data-label={t("fields.vendor")}>{s.vendor_name}</td>
                    <td className="muted" data-label={t("fields.depot")}>
                      {s.depot_name}
                    </td>
                    <td
                      className="num"
                      data-label={t("pages.receipts.colLines")}
                    >
                      {s.line_count}
                    </td>
                    <td
                      className="num"
                      style={{ fontWeight: 700 }}
                      data-label={t("common.amount")}
                    >
                      {formatMoney(s.total_amount)}
                      {s.returned_amount > 0 ? (
                        <span className="muted" style={{ fontWeight: 400 }}>
                          {" "}
                          (−{formatMoney(s.returned_amount)})
                        </span>
                      ) : null}
                    </td>
                    <td data-label={t("fields.payment")}>
                      {paymentMethodLabel(s.payment_method)}
                    </td>
                    <td data-label={t("common.status")}>
                      {s.status === "VOIDED" ? (
                        <Badge tone="danger">
                          {t("pages.sales.badgeVoided")}
                        </Badge>
                      ) : (
                        <Badge tone="ok">
                          {t("pages.sales.badgeCompleted")}
                        </Badge>
                      )}
                      {s.synced_at ? (
                        <Badge tone="info">
                          {t("pages.sales.badgeOffline")}
                        </Badge>
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
