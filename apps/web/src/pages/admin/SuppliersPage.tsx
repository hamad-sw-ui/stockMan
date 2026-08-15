/** Fournisseurs : CRUD complet + fiche avec historique des réceptions. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Spinner,
} from "../../components/ui";
import { del, get, patch, post } from "../../lib/http";
import { formatDate, formatMoney, formatQty } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { ExportCsvButton, ImportCsvButton } from "../../components/CsvTransfer";
import { useToast } from "../../store/toast";
import type { Supplier } from "../../lib/types";

interface SupplierDetail extends Supplier {
  receipts: Array<{
    id: string;
    reference: string | null;
    created_at: string;
    depot_name: string;
    total_cost: number;
    line_count: number;
  }>;
}

const blank = {
  name: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  leadTime: "",
};

export default function SuppliersPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [search, setSearch] = useState("");
  const q = useQuery<Supplier[]>("suppliers:list", "/suppliers");
  const [form, setForm] = useState<({ id?: string } & typeof blank) | null>(
    null,
  );
  const [toDelete, setToDelete] = useState<Supplier | null>(null);
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        notes: form.notes || null,
        defaultLeadTimeDays: form.leadTime ? Number(form.leadTime) : undefined,
      };
      if (form.id) await patch(`/suppliers/${form.id}`, body);
      else await post("/suppliers", body);
      show(
        form.id
          ? t("pages.suppliers.updatedToast")
          : t("pages.suppliers.createdToast"),
        "success",
      );
      invalidateQueries("suppliers:");
      setForm(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.suppliers.saveError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (s: Supplier) => {
    try {
      setDetail(await get<SupplierDetail>(`/suppliers/${s.id}`));
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.suppliers.detailError"),
        "error",
      );
    }
  };

  const doDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await del(`/suppliers/${toDelete.id}`);
      show(t("pages.suppliers.deletedToast"), "success");
      invalidateQueries("suppliers:");
      setToDelete(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.suppliers.deleteError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const filtered = (q.data ?? []).filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.phone ?? "").includes(search),
  );

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.suppliers.title")}
        sub={t("pages.suppliers.sub")}
        actions={
          <>
            <ExportCsvButton
              endpoint="/suppliers/export/csv"
              filename="fournisseurs-stockman.csv"
            />
            <ImportCsvButton
              endpoint="/suppliers/import"
              /* Contrat CSV : les en-têtes FR sont ceux que l'API sait
                 parser — la note reste volontairement en français. */
              acceptNote="Colonnes : Nom;Email;Téléphone;Adresse;Délai livraison (jours);Notes."
              onDone={() => invalidateQueries("suppliers:")}
            />
            <Button onClick={() => setForm({ ...blank })}>
              {t("pages.suppliers.newSupplier")}
            </Button>
          </>
        }
      />
      <Card className="filters">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("pages.suppliers.searchPlaceholder")}
        />
      </Card>
      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("suppliers:")}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          emoji="🚚"
          title={search ? t("common.noResults") : t("pages.suppliers.empty")}
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
                  <th>{t("fields.email")}</th>
                  <th className="num">{t("pages.suppliers.colDelay")}</th>
                  <th className="num">{t("pages.suppliers.colReceipts")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td data-label={t("fields.name")}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontWeight: 700, padding: 0 }}
                        onClick={() => openDetail(s)}
                      >
                        {s.name}
                      </button>
                    </td>
                    <td className="muted" data-label={t("fields.phone")}>
                      {s.phone ?? "—"}
                    </td>
                    <td className="muted" data-label={t("fields.email")}>
                      {s.email ?? "—"}
                    </td>
                    <td
                      className="num muted"
                      data-label={t("pages.suppliers.colDelay")}
                    >
                      {s.default_lead_time_days != null
                        ? t("pages.suppliers.daysShort", {
                            days: s.default_lead_time_days,
                          })
                        : "—"}
                    </td>
                    <td
                      className="num"
                      data-label={t("pages.suppliers.colReceipts")}
                    >
                      {s.receipt_count ?? 0}
                    </td>
                    <td data-label="" className="col-actions">
                      <div
                        className="row"
                        style={{ gap: 4, flexWrap: "nowrap" }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setForm({
                              id: s.id,
                              name: s.name,
                              email: s.email ?? "",
                              phone: s.phone ?? "",
                              address: s.address ?? "",
                              notes: s.notes ?? "",
                              leadTime:
                                s.default_lead_time_days != null
                                  ? String(s.default_lead_time_days)
                                  : "",
                            })
                          }
                        >
                          ✏️
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setToDelete(s)}
                        >
                          🗑️
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {form ? (
        <Modal
          title={
            form.id
              ? t("pages.suppliers.editTitle")
              : t("pages.suppliers.createTitle")
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
            <Field label={t("fields.email")}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
          </div>
          <Field
            label={t("pages.suppliers.leadTimeField")}
            hint={t("pages.suppliers.leadTimeHint")}
          >
            <Input
              inputMode="numeric"
              value={form.leadTime}
              placeholder="3"
              onChange={(e) => setForm({ ...form, leadTime: e.target.value })}
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

      {toDelete ? (
        <ConfirmModal
          title={t("pages.suppliers.deleteTitle")}
          message={
            <>
              {t("pages.suppliers.deleteConfirm", { name: toDelete.name })}{" "}
              {(toDelete.receipt_count ?? 0) > 0 ? (
                <>{t("pages.suppliers.deleteLinked")}</>
              ) : (
                t("pages.suppliers.deleteNoLink")
              )}
            </>
          }
          confirmLabel={t("common.delete")}
          onConfirm={doDelete}
          onClose={() => setToDelete(null)}
          loading={busy}
        />
      ) : null}

      {detail ? (
        <Modal title={`🚚 ${detail.name}`} onClose={() => setDetail(null)} wide>
          <p className="muted" style={{ marginTop: 0 }}>
            {[detail.phone, detail.email, detail.address]
              .filter(Boolean)
              .join(" · ") || t("pages.suppliers.noContact")}
          </p>
          <h3 style={{ margin: "8px 0" }}>
            {t("pages.suppliers.receiptsTitle")}
          </h3>
          {detail.receipts.length === 0 ? (
            <EmptyState emoji="📥" title={t("pages.suppliers.noReceipts")} />
          ) : (
            <div className="table-wrap table-cards">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.date")}</th>
                    <th>{t("fields.reference")}</th>
                    <th>{t("fields.depot")}</th>
                    <th className="num">{t("pages.receipts.colLines")}</th>
                    <th className="num">{t("common.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.receipts.map((r) => (
                    <tr key={r.id}>
                      <td className="muted" data-label={t("common.date")}>
                        {formatDate(r.created_at)}
                      </td>
                      <td className="mono" data-label={t("fields.reference")}>
                        {r.reference ?? "—"}
                      </td>
                      <td data-label={t("fields.depot")}>{r.depot_name}</td>
                      <td
                        className="num"
                        data-label={t("pages.receipts.colLines")}
                      >
                        {formatQty(r.line_count)}
                      </td>
                      <td
                        className="num"
                        style={{ fontWeight: 700 }}
                        data-label={t("common.amount")}
                      >
                        {formatMoney(r.total_cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
