/** Clients & crédit (E3) : carnet de dettes du point de vente —
 *  fiches avec plafond de crédit, vieillissement 30/60/90, encaissement des
 *  versements (idempotent via clientPaymentId) et relance SMS/WhatsApp. */
import { useState } from "react";
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
      show(form.id ? "Client mis à jour." : "Client créé.", "success");
      invalidateQueries("customers:");
      setForm(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
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
      show(e instanceof Error ? e.message : "Fiche indisponible", "error");
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
      show("Versement enregistré.", "success");
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
      show(e instanceof Error ? e.message : "Versement refusé", "error");
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
        `Relance ${channel === "SMS" ? "SMS" : "WhatsApp"} envoyée.`,
        "success",
      );
      setRemind(null);
    } catch (e) {
      show(e instanceof Error ? e.message : "Relance impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title="Clients & crédit"
        sub="Carnet de dettes, plafonds de crédit et relances"
        actions={
          <>
            <ExportCsvButton
              endpoint="/customers/export/csv"
              filename="clients-stockman.csv"
            />
            <ImportCsvButton
              endpoint="/customers/import"
              acceptNote="Colonnes : Nom;Téléphone;Email;Adresse;Plafond crédit;Canal prix (gros/détail);Notes."
              onDone={() => invalidateQueries("customers:")}
            />
            <Button onClick={() => setForm({ ...blank })}>
              ➕ Nouveau client
            </Button>
          </>
        }
      />

      <div className="grid kpis">
        <Kpi label="Clients" value={String(q.data?.total ?? 0)} />
        <Kpi
          label="Encours (page)"
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
            placeholder="Nom ou téléphone…"
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
            Débiteurs seulement
          </label>
        </div>
      </Card>

      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("customers:")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🤝"
          title={search || withDebt ? "Aucun résultat" : "Aucun client"}
          action={
            <Button onClick={() => setForm({ ...blank })}>
              Ajouter le premier
            </Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Téléphone</th>
                  <th className="num">Plafond</th>
                  <th className="num">Solde dû</th>
                  <th>Statut</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Nom">
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontWeight: 700, padding: 0 }}
                        onClick={() => openDetail(c)}
                      >
                        {c.name}
                      </button>
                    </td>
                    <td className="muted" data-label="Téléphone">
                      {c.phone ?? "—"}
                    </td>
                    <td className="num muted" data-label="Plafond">
                      {c.credit_limit > 0 ? formatMoney(c.credit_limit) : "—"}
                    </td>
                    <td
                      className="num"
                      data-label="Solde dû"
                      style={{
                        fontWeight: 700,
                        color: c.balance > 0 ? "var(--danger)" : undefined,
                      }}
                    >
                      {c.balance > 0 ? formatMoney(c.balance) : "—"}
                    </td>
                    <td data-label="Statut">
                      {c.is_active ? (
                        c.balance > 0 &&
                        c.credit_limit > 0 &&
                        c.balance > c.credit_limit ? (
                          <Badge tone="danger">Plafond dépassé</Badge>
                        ) : c.balance > 0 ? (
                          <Badge tone="warn">Débiteur</Badge>
                        ) : (
                          <Badge tone="ok">À jour</Badge>
                        )
                      ) : (
                        <Badge tone="muted">Inactif</Badge>
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
                          title="Modifier"
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
                            title="Relancer le client"
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
                                      : "Fiche indisponible",
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
              .join(" · ") || "Aucune coordonnée"}
            {detail.credit_limit > 0
              ? ` · Plafond de crédit : ${formatMoney(detail.credit_limit)}`
              : ""}
          </p>
          <div className="grid kpis" style={{ marginBottom: 12 }}>
            <Kpi
              label="Solde dû"
              value={formatMoney(detail.balance)}
              tone={detail.balance > 0 ? "warn" : "ok"}
            />
            <Kpi label="0–30 j" value={formatMoney(detail.aging.d0_30)} />
            <Kpi
              label="31–60 j"
              value={formatMoney(detail.aging.d31_60)}
              tone={detail.aging.d31_60 > 0 ? "warn" : undefined}
            />
            <Kpi
              label="61–90 j"
              value={formatMoney(detail.aging.d61_90)}
              tone={detail.aging.d61_90 > 0 ? "danger" : undefined}
            />
            <Kpi
              label="+90 j"
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
                🔔 Relancer (SMS / WhatsApp)
              </Button>
            </div>
          ) : null}

          <h3 style={{ margin: "8px 0" }}>
            Dettes en cours ({detail.debts.length})
          </h3>
          {detail.debts.length === 0 ? (
            <EmptyState emoji="✅" title="Aucune dette en cours" />
          ) : (
            <div className="table-wrap table-cards">
              <table>
                <thead>
                  <tr>
                    <th>Vente</th>
                    <th>Échéance</th>
                    <th className="num">Total</th>
                    <th className="num">Payé</th>
                    <th className="num">Reste</th>
                    <th aria-label="Versement" />
                  </tr>
                </thead>
                <tbody>
                  {detail.debts.map((d) => (
                    <tr key={d.saleId}>
                      <td data-label="Vente">
                        <div>{d.date ? formatDate(d.date) : "—"}</div>
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {d.days > 30
                            ? `⚠️ ${d.days} j de retard`
                            : `${d.days} j`}
                        </div>
                      </td>
                      <td className="muted" data-label="Échéance">
                        {d.dueDate ? formatDate(d.dueDate) : "—"}
                      </td>
                      <td className="num" data-label="Total">
                        {formatMoney(d.total)}
                      </td>
                      <td className="num muted" data-label="Payé">
                        {formatMoney(d.paid)}
                      </td>
                      <td
                        className="num"
                        data-label="Reste"
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
                          💵 Versement
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ margin: "14px 0 8px" }}>Derniers versements</h3>
          {detail.recentPayments.length === 0 ? (
            <p className="muted">Aucun versement enregistré.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Mode</th>
                    <th className="num">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="muted" data-label="Date">
                        {formatDateTime(p.created_at)}
                      </td>
                      <td data-label="Mode">{paymentMethodLabel(p.method)}</td>
                      <td
                        className="num"
                        style={{ fontWeight: 700 }}
                        data-label="Montant"
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
          title={`💵 Versement — ${payment.customerName}`}
          onClose={() => !busy && setPayment(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setPayment(null)}
                disabled={busy}
              >
                Annuler
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
                Encaisser
              </Button>
            </>
          }
        >
          <p className="muted" style={{ marginTop: 0 }}>
            Reste à payer sur cette vente :{" "}
            <strong>{formatMoney(payment.debt.outstanding)}</strong>
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Montant" required>
              <Input
                inputMode="decimal"
                value={payment.amount}
                onChange={(e) =>
                  setPayment({ ...payment, amount: e.target.value })
                }
              />
            </Field>
            <Field label="Mode" required>
              <Select
                value={payment.method}
                onChange={(e) =>
                  setPayment({
                    ...payment,
                    method: e.target.value as PaymentMethod,
                  })
                }
              >
                <option value="CASH">💵 Espèces</option>
                <option value="MTN_MOMO">🟡 MTN MoMo</option>
                <option value="ORANGE_MONEY">🟠 Orange Money</option>
              </Select>
            </Field>
          </div>
          <Field label="Référence (mobile money)">
            <Input
              value={payment.reference}
              onChange={(e) =>
                setPayment({ ...payment, reference: e.target.value })
              }
              placeholder="ID transaction…"
            />
          </Field>
        </Modal>
      ) : null}

      {/* ----------------------------- Relance ------------------------------- */}
      {remind ? (
        <Modal
          title={`🔔 Relancer ${remind.name}`}
          onClose={() => !busy && setRemind(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setRemind(null)}
                disabled={busy}
              >
                Fermer
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
            Une relance de solde ({formatMoney(remind.balance)}) sera envoyée à{" "}
            <strong>{remind.phone ?? "—"}</strong>. Une seule relance par jour,
            par canal et par client (déduplication).
          </p>
          {!remind.phone ? (
            <p style={{ color: "var(--danger)", fontWeight: 600 }}>
              ⚠️ Ce client n'a pas de numéro : la relance sera refusée par le
              serveur.
            </p>
          ) : null}
        </Modal>
      ) : null}

      {/* ---------------------------- Création/édition ----------------------- */}
      {form ? (
        <Modal
          title={form.id ? "Modifier le client" : "Nouveau client"}
          onClose={() => !busy && setForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setForm(null)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button
                loading={busy}
                onClick={save}
                disabled={form.name.trim().length < 2}
              >
                Enregistrer
              </Button>
            </>
          }
        >
          <Field label="Nom" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Téléphone">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field
              label="Plafond de crédit (FCFA)"
              hint="0 = aucun crédit autorisé"
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
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Adresse">
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
          <Field label="Notes">
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
