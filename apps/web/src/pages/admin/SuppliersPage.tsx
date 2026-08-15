/** Fournisseurs : CRUD complet + fiche avec historique des réceptions. */
import { useState } from "react";
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
        form.id ? "Fournisseur mis à jour." : "Fournisseur créé.",
        "success",
      );
      invalidateQueries("suppliers:");
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

  const openDetail = async (s: Supplier) => {
    try {
      setDetail(await get<SupplierDetail>(`/suppliers/${s.id}`));
    } catch (e) {
      show(e instanceof Error ? e.message : "Fiche indisponible", "error");
    }
  };

  const doDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await del(`/suppliers/${toDelete.id}`);
      show("Fournisseur supprimé.", "success");
      invalidateQueries("suppliers:");
      setToDelete(null);
    } catch (e) {
      show(e instanceof Error ? e.message : "Suppression impossible", "error");
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
        title="Fournisseurs"
        sub="Carnet d’adresses et historique des livraisons"
        actions={
          <>
            <ExportCsvButton
              endpoint="/suppliers/export/csv"
              filename="fournisseurs-stockman.csv"
            />
            <ImportCsvButton
              endpoint="/suppliers/import"
              acceptNote="Colonnes : Nom;Email;Téléphone;Adresse;Délai livraison (jours);Notes."
              onDone={() => invalidateQueries("suppliers:")}
            />
            <Button onClick={() => setForm({ ...blank })}>
              ➕ Nouveau fournisseur
            </Button>
          </>
        }
      />
      <Card className="filters">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Nom ou téléphone…"
        />
      </Card>
      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("suppliers:")}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          emoji="🚚"
          title={search ? "Aucun résultat" : "Aucun fournisseur"}
          action={
            <Button onClick={() => setForm({ ...blank })}>
              Ajouter le premier
            </Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Téléphone</th>
                  <th>Email</th>
                  <th className="num">Délai</th>
                  <th className="num">Réceptions</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontWeight: 700, padding: 0 }}
                        onClick={() => openDetail(s)}
                      >
                        {s.name}
                      </button>
                    </td>
                    <td className="muted">{s.phone ?? "—"}</td>
                    <td className="muted">{s.email ?? "—"}</td>
                    <td className="num muted">
                      {s.default_lead_time_days != null
                        ? `${s.default_lead_time_days} j`
                        : "—"}
                    </td>
                    <td className="num">{s.receipt_count ?? 0}</td>
                    <td>
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
          title={form.id ? "Modifier le fournisseur" : "Nouveau fournisseur"}
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
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
          </div>
          <Field
            label="Délai d'approvisionnement (jours)"
            hint="Alimente le rapport prédictif (quantité à commander) et le délai prévu des commandes."
          >
            <Input
              inputMode="numeric"
              value={form.leadTime}
              placeholder="3"
              onChange={(e) => setForm({ ...form, leadTime: e.target.value })}
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

      {toDelete ? (
        <ConfirmModal
          title="Supprimer le fournisseur"
          message={
            <>
              Supprimer « {toDelete.name} » ?{" "}
              {(toDelete.receipt_count ?? 0) > 0 ? (
                <>
                  Des réceptions y sont liées : la suppression sera refusée pour
                  préserver l’historique.
                </>
              ) : (
                "Aucune réception liée."
              )}
            </>
          }
          confirmLabel="Supprimer"
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
              .join(" · ") || "Aucune coordonnée"}
          </p>
          <h3 style={{ margin: "8px 0" }}>25 dernières réceptions</h3>
          {detail.receipts.length === 0 ? (
            <EmptyState emoji="📥" title="Aucune réception" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Référence</th>
                    <th>Dépôt</th>
                    <th className="num">Lignes</th>
                    <th className="num">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.receipts.map((r) => (
                    <tr key={r.id}>
                      <td className="muted">{formatDate(r.created_at)}</td>
                      <td className="mono">{r.reference ?? "—"}</td>
                      <td>{r.depot_name}</td>
                      <td className="num">{formatQty(r.line_count)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
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
