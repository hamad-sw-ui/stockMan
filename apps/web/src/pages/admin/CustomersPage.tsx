/** Clients & crédit (E3) : carnet de dettes du point de vente —
 *  fiches avec plafond de crédit, vieillissement 30/60/90, encaissement des
 *  versements (idempotent via clientPaymentId) et relance SMS/WhatsApp. */
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Kpi,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Spinner,
  Badge,
} from "../../components/ui";
import { get, patch, post } from "../../lib/http";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  paymentMethodLabel,
} from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { ExportCsvButton, ImportCsvButton } from "../../components/CsvTransfer";
import { useToast } from "../../store/toast";
import type {
  Customer,
  CustomerDebt,
  CustomerDetail,
  Paged,
  PaymentMethod,
} from "../../lib/types";

const blank = {
  name: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  creditLimit: "",
};

/** Clé d'idempotence du versement : régénérée à chaque ouverture du modal
 *  (un double-clic / renvoi réseau ne créera jamais deux paiements). */
const newPaymentKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

export default function CustomersPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [search, setSearch] = useState("");
  const [withDebt, setWithDebt] = useState(false);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<({ id?: string } & typeof blank) | null>(
    null,
  );
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [payment, setPayment] = useState<{
    debt: CustomerDebt;
    customerName: string;
    key: string;
    amount: string;
    method: PaymentMethod;
    reference: string;
  } | null>(null);
  const [remind, setRemind] = useState<CustomerDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const params = new URLSearchParams({ page: String(page), size: "25" });
  if (search.trim()) params.set("q", search.trim());
  if (withDebt) params.set("withDebt", "true");
  const path = `/customers?${params}`;
  const q = useQuery<Paged<Customer>>(`customers:${path}`, path);
  const rows = q.data?.data ?? [];
  const totalDebt = rows.reduce((a, c) => a + Number(c.balance ?? 0), 0);

  /* ------------------------------- CRUD fiche ------------------------------ */
  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        notes: form.notes || null,
        creditLimit: form.creditLimit ? Number(form.creditLimit) : 0,
      };
      if (form.id) await patch(`/customers/${form.id}`, body);
      else await post("/customers", body);
      show(
        form.id
          ? t("pages.customers.updatedToast")
          : t("pages.customers.createdToast"),
        "success",
      );
      invalidateQueries("customers:");
      setForm(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.customers.saveError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (c: Customer) => {
    try {
      setDetail(await get<CustomerDetail>(`/customers/${c.id}`));
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.customers.detailError"),
        "error",
      );
    }
  };

  /* ------------------------------ Versement -------------------------------- */
  const payDebt = async () => {
    if (!payment) return;
    setBusy(true);
    try {
      await post(`/sales/${payment.debt.saleId}/payments`, {
        method: payment.method,
        amount: Number(payment.amount),
        reference: payment.reference || null,
        clientPaymentId: payment.key,
      });
      show(t("pages.customers.paymentSaved"), "success");
      invalidateQueries("customers:");
      setPayment(null);
      // Rafraîchit la fiche ouverte (soldes / vieillissement à jour)
      if (detail) {
        try {
          setDetail(await get<CustomerDetail>(`/customers/${detail.id}`));
        } catch {
          /* la liste est déjà invalidée : fiche rafraîchie à la prochaine ouverture */
        }
      }
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.customers.paymentRefused"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------- Relance -------------------------------- */
  const doRemind = async (channel: "SMS" | "WHATSAPP") => {
    if (!remind) return;
    setBusy(true);
    try {
      await post(`/customers/${remind.id}/remind`, { channel });
      show(
        t("pages.customers.remindSent", {
          channel: channel === "SMS" ? "SMS" : "WhatsApp",
        }),
        "success",
      );
      setRemind(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.customers.remindError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.customers.title")}
        sub={t("pages.customers.sub")}
        actions={
          <>
            <ExportCsvButton
              endpoint="/customers/export/csv"
              filename="clients-stockman.csv"
            />
            <ImportCsvButton
              endpoint="/customers/import"
              /* Contrat CSV : les en-têtes FR sont ceux que l'API sait
                 parser — la note reste volontairement en français. */
              acceptNote="Colonnes : Nom;Téléphone;Email;Adresse;Plafond crédit;Canal prix (gros/détail);Notes."
              onDone={() => invalidateQueries("customers:")}
            />
            <Button onClick={() => setForm({ ...blank })}>
              {t("pages.customers.newCustomer")}
            </Button>
          </>
        }
      />

      <div className="grid kpis">
        <Kpi
          label={t("pages.customers.kpiCustomers")}
          value={String(q.data?.total ?? 0)}
        />
        <Kpi
          label={t("pages.customers.kpiDebt")}
          value={formatMoney(totalDebt)}
          tone={totalDebt > 0 ? "warn" : "ok"}
        />
      </div>

      <Card className="filters">
        <div
          className="row filters-row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder={t("pages.customers.searchPlaceholder")}
          />
          <label
            className="row muted"
            style={{ gap: 6, fontSize: "0.9rem", cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={withDebt}
              onChange={(e) => {
                setWithDebt(e.target.checked);
                setPage(1);
              }}
            />
            {t("pages.customers.debtorsOnly")}
          </label>
        </div>
      </Card>

      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("customers:")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🤝"
          title={
            search || withDebt
              ? t("common.noResults")
              : t("pages.customers.empty")
          }
          action={
            <Button onClick={() => setForm({ ...blank })}>
              {t("common.addFirst")}
            </Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.name")}</th>
                  <th>{t("fields.phone")}</th>
                  <th className="num">{t("pages.customers.colLimit")}</th>
                  <th className="num">{t("pages.customers.colDue")}</th>
                  <th>{t("common.status")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td data-label={t("fields.name")}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontWeight: 700, padding: 0 }}
                        onClick={() => openDetail(c)}
                      >
                        {c.name}
                      </button>
                    </td>
                    <td className="muted" data-label={t("fields.phone")}>
                      {c.phone ?? "—"}
                    </td>
                    <td
                      className="num muted"
                      data-label={t("pages.customers.colLimit")}
                    >
                      {c.credit_limit > 0 ? formatMoney(c.credit_limit) : "—"}
                    </td>
                    <td
                      className="num"
                      data-label={t("pages.customers.colDue")}
                      style={{
                        fontWeight: 700,
                        color: c.balance > 0 ? "var(--danger)" : undefined,
                      }}
                    >
                      {c.balance > 0 ? formatMoney(c.balance) : "—"}
                    </td>
                    <td data-label={t("common.status")}>
                      {c.is_active ? (
                        c.balance > 0 &&
                        c.credit_limit > 0 &&
                        c.balance > c.credit_limit ? (
                          <Badge tone="danger">
                            {t("pages.customers.badgeOverLimit")}
                          </Badge>
                        ) : c.balance > 0 ? (
                          <Badge tone="warn">
                            {t("pages.customers.badgeDebtor")}
                          </Badge>
                        ) : (
                          <Badge tone="ok">
                            {t("pages.customers.badgeUpToDate")}
                          </Badge>
                        )
                      ) : (
                        <Badge tone="muted">{t("common.inactive")}</Badge>
                      )}
                    </td>
                    <td data-label="" className="col-actions">
                      <div
                        className="row"
                        style={{ gap: 4, flexWrap: "nowrap" }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t("common.edit")}
                          onClick={() =>
                            setForm({
                              id: c.id,
                              name: c.name,
                              phone: c.phone ?? "",
                              email: c.email ?? "",
                              address: c.address ?? "",
                              notes: c.notes ?? "",
                              creditLimit: c.credit_limit
                                ? String(c.credit_limit)
                                : "",
                            })
                          }
                        >
                          ✏️
                        </Button>
                        {c.balance > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t("pages.customers.remindTitle")}
                            onClick={() =>
                              void (async () => {
                                try {
                                  setRemind(
                                    await get<CustomerDetail>(
                                      `/customers/${c.id}`,
                                    ),
                                  );
                                } catch (e) {
                                  show(
                                    e instanceof Error
                                      ? e.message
                                      : t("pages.customers.detailError"),
                                    "error",
                                  );
                                }
                              })()
                            }
                          >
                            🔔
                          </Button>
                        ) : null}
                      </div>
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

      {/* ---------------------------- Fiche client --------------------------- */}
      {detail ? (
        <Modal title={`🤝 ${detail.name}`} onClose={() => setDetail(null)} wide>
          <p className="muted" style={{ marginTop: 0 }}>
            {[detail.phone, detail.email, detail.address]
              .filter(Boolean)
              .join(" · ") || t("pages.customers.noContact")}
            {detail.credit_limit > 0
              ? t("pages.customers.creditLimitSuffix", {
                  amount: formatMoney(detail.credit_limit),
                })
              : ""}
          </p>
          <div className="grid kpis" style={{ marginBottom: 12 }}>
            <Kpi
              label={t("pages.customers.colDue")}
              value={formatMoney(detail.balance)}
              tone={detail.balance > 0 ? "warn" : "ok"}
            />
            <Kpi
              label={t("pages.customers.aging30")}
              value={formatMoney(detail.aging.d0_30)}
            />
            <Kpi
              label={t("pages.customers.aging60")}
              value={formatMoney(detail.aging.d31_60)}
              tone={detail.aging.d31_60 > 0 ? "warn" : undefined}
            />
            <Kpi
              label={t("pages.customers.aging90")}
              value={formatMoney(detail.aging.d61_90)}
              tone={detail.aging.d61_90 > 0 ? "danger" : undefined}
            />
            <Kpi
              label={t("pages.customers.aging90plus")}
              value={formatMoney(detail.aging.over90)}
              tone={detail.aging.over90 > 0 ? "danger" : undefined}
            />
          </div>
          {detail.balance > 0 ? (
            <div className="row" style={{ marginBottom: 12 }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRemind(detail)}
              >
                {t("pages.customers.remindButton")}
              </Button>
            </div>
          ) : null}

          <h3 style={{ margin: "8px 0" }}>
            {t("pages.customers.debtsTitle", { count: detail.debts.length })}
          </h3>
          {detail.debts.length === 0 ? (
            <EmptyState emoji="✅" title={t("pages.customers.noDebts")} />
          ) : (
            <div className="table-wrap table-cards">
              <table>
                <thead>
                  <tr>
                    <th>{t("pages.customers.colSale")}</th>
                    <th>{t("pages.customers.colDueDate")}</th>
                    <th className="num">{t("common.total")}</th>
                    <th className="num">{t("pages.customers.colPaid")}</th>
                    <th className="num">{t("pages.customers.colRemaining")}</th>
                    <th aria-label={t("pages.customers.ariaPayment")} />
                  </tr>
                </thead>
                <tbody>
                  {detail.debts.map((d) => (
                    <tr key={d.saleId}>
                      <td data-label={t("pages.customers.colSale")}>
                        <div>{d.date ? formatDate(d.date) : "—"}</div>
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {d.days > 30
                            ? t("pages.customers.daysLate", { days: d.days })
                            : t("pages.customers.daysShort", { days: d.days })}
                        </div>
                      </td>
                      <td
                        className="muted"
                        data-label={t("pages.customers.colDueDate")}
                      >
                        {d.dueDate ? formatDate(d.dueDate) : "—"}
                      </td>
                      <td className="num" data-label={t("common.total")}>
                        {formatMoney(d.total)}
                      </td>
                      <td
                        className="num muted"
                        data-label={t("pages.customers.colPaid")}
                      >
                        {formatMoney(d.paid)}
                      </td>
                      <td
                        className="num"
                        data-label={t("pages.customers.colRemaining")}
                        style={{ fontWeight: 700, color: "var(--danger)" }}
                      >
                        {formatMoney(d.outstanding)}
                      </td>
                      <td data-label="" className="col-actions">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setPayment({
                              debt: d,
                              customerName: detail.name,
                              key: newPaymentKey(),
                              amount: String(d.outstanding),
                              method: "CASH",
                              reference: "",
                            })
                          }
                        >
                          {t("pages.customers.paymentButton")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ margin: "14px 0 8px" }}>
            {t("pages.customers.recentPaymentsTitle")}
          </h3>
          {detail.recentPayments.length === 0 ? (
            <p className="muted">{t("pages.customers.noPayments")}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.date")}</th>
                    <th>{t("pages.customers.colMode")}</th>
                    <th className="num">{t("common.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="muted" data-label={t("common.date")}>
                        {formatDateTime(p.created_at)}
                      </td>
                      <td data-label={t("pages.customers.colMode")}>
                        {paymentMethodLabel(p.method)}
                      </td>
                      <td
                        className="num"
                        style={{ fontWeight: 700 }}
                        data-label={t("common.amount")}
                      >
                        {formatMoney(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      ) : null}

      {/* ---------------------------- Versement ------------------------------ */}
      {payment ? (
        <Modal
          title={t("pages.customers.paymentTitle", {
            name: payment.customerName,
          })}
          onClose={() => !busy && setPayment(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setPayment(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                loading={busy}
                onClick={payDebt}
                disabled={
                  !payment.amount ||
                  Number(payment.amount) <= 0 ||
                  Number(payment.amount) > payment.debt.outstanding
                }
              >
                {t("pages.customers.cashIn")}
              </Button>
            </>
          }
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {t("pages.customers.remainingOnSale")}{" "}
            <strong>{formatMoney(payment.debt.outstanding)}</strong>
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("common.amount")} required>
              <Input
                inputMode="decimal"
                value={payment.amount}
                onChange={(e) =>
                  setPayment({ ...payment, amount: e.target.value })
                }
              />
            </Field>
            <Field label={t("pages.customers.colMode")} required>
              <Select
                value={payment.method}
                onChange={(e) =>
                  setPayment({
                    ...payment,
                    method: e.target.value as PaymentMethod,
                  })
                }
              >
                <option value="CASH">💵 {t("format.payment.CASH")}</option>
                <option value="MTN_MOMO">
                  🟡 {t("format.payment.MTN_MOMO")}
                </option>
                <option value="ORANGE_MONEY">
                  🟠 {t("format.payment.ORANGE_MONEY")}
                </option>
              </Select>
            </Field>
          </div>
          <Field label={t("pages.customers.referenceField")}>
            <Input
              value={payment.reference}
              onChange={(e) =>
                setPayment({ ...payment, reference: e.target.value })
              }
              placeholder={t("pages.customers.referencePlaceholder")}
            />
          </Field>
        </Modal>
      ) : null}

      {/* ----------------------------- Relance ------------------------------- */}
      {remind ? (
        <Modal
          title={t("pages.customers.remindModalTitle", { name: remind.name })}
          onClose={() => !busy && setRemind(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setRemind(null)}
                disabled={busy}
              >
                {t("common.close")}
              </Button>
              <Button
                variant="outline"
                loading={busy}
                onClick={() => doRemind("WHATSAPP")}
              >
                💬 WhatsApp
              </Button>
              <Button loading={busy} onClick={() => doRemind("SMS")}>
                📩 SMS
              </Button>
            </>
          }
        >
          <p>
            <Trans
              i18nKey="pages.customers.remindBody"
              values={{
                balance: formatMoney(remind.balance),
                phone: remind.phone ?? "—",
              }}
              components={{ b: <strong /> }}
            />
          </p>
          {!remind.phone ? (
            <p style={{ color: "var(--danger)", fontWeight: 600 }}>
              {t("pages.customers.remindNoPhone")}
            </p>
          ) : null}
        </Modal>
      ) : null}

      {/* ---------------------------- Création/édition ----------------------- */}
      {form ? (
        <Modal
          title={
            form.id
              ? t("pages.customers.editTitle")
              : t("pages.customers.createTitle")
          }
          onClose={() => !busy && setForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setForm(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                loading={busy}
                onClick={save}
                disabled={form.name.trim().length < 2}
              >
                {t("common.save")}
              </Button>
            </>
          }
        >
          <Field label={t("fields.name")} required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("fields.phone")}>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field
              label={t("pages.customers.creditLimitField")}
              hint={t("pages.customers.creditLimitHint")}
            >
              <Input
                inputMode="numeric"
                value={form.creditLimit}
                onChange={(e) =>
                  setForm({ ...form, creditLimit: e.target.value })
                }
              />
            </Field>
          </div>
          <Field label={t("fields.email")}>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label={t("fields.address")}>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
          <Field label={t("fields.notes")}>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}
