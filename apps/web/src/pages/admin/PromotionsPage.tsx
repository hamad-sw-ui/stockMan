/** Promotions datées (E8) : remises automatiques à la caisse dans une
 *  fenêtre de dates, ciblées sur un produit précis ou sur tout le catalogue.
 *  La promo produit est prioritaire sur la promo globale ; la remise est
 *  figée sur chaque ligne de vente (preuve du prix). */
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
} from "../../components/ui";
import { del, get, patch, post } from "../../lib/http";
import { formatDate, formatDateTime } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { Paged, ProductListItem, Promotion } from "../../lib/types";

interface PromoForm {
  id?: string;
  name: string;
  scope: "GLOBAL" | "PRODUCT";
  productId: string;
  discountPct: string;
  startsAt: string; // datetime-local
  endsAt: string;
  isActive: boolean;
}

/** Conversion datetime-local ⇄ ISO (API). */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (local: string) => new Date(local).toISOString();

function badgeFor(p: Promotion) {
  const live =
    p.is_active &&
    new Date(p.starts_at) <= new Date() &&
    new Date(p.ends_at) >= new Date();
  if (!p.is_active) return <Badge tone="muted">Inactive</Badge>;
  if (live) return <Badge tone="ok">En cours</Badge>;
  if (new Date(p.starts_at) > new Date())
    return <Badge tone="info">À venir</Badge>;
  return <Badge tone="warn">Terminée</Badge>;
}

export default function PromotionsPage() {
  const { show } = useToast();
  const [page, setPage] = useState(1);
  const [onlyActive, setOnlyActive] = useState(false);
  const q = useQuery<Paged<Promotion>>(
    `promotions:list:${page}:${onlyActive}`,
    `/pricing/promotions?page=${page}&size=15${onlyActive ? "&active=true" : ""}`,
  );
  const [form, setForm] = useState<PromoForm | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductListItem[]>([]);
  const [productName, setProductName] = useState("");
  const [toDelete, setToDelete] = useState<Promotion | null>(null);
  const [busy, setBusy] = useState(false);

  const searchProducts = async (value: string) => {
    setProductQuery(value);
    setProductName(value);
    if (value.length < 2) {
      setProductResults([]);
      return;
    }
    try {
      const res = await get<Paged<ProductListItem>>(
        `/products?search=${encodeURIComponent(value)}&size=8`,
      );
      setProductResults(res.data);
    } catch {
      setProductResults([]);
    }
  };

  const openCreate = () => {
    const start = new Date();
    const end = new Date(Date.now() + 7 * 86_400_000);
    setForm({
      name: "",
      scope: "GLOBAL",
      productId: "",
      discountPct: "10",
      startsAt: toLocalInput(start.toISOString()),
      endsAt: toLocalInput(end.toISOString()),
      isActive: true,
    });
    setProductQuery("");
    setProductName("");
  };

  const openEdit = (p: Promotion) => {
    setForm({
      id: p.id,
      name: p.name,
      scope: p.product_id ? "PRODUCT" : "GLOBAL",
      productId: p.product_id ?? "",
      discountPct: String(p.discount_pct),
      startsAt: toLocalInput(p.starts_at),
      endsAt: toLocalInput(p.ends_at),
      isActive: p.is_active,
    });
    setProductName(p.product_name ?? "");
    setProductQuery("");
  };

  const save = async () => {
    if (!form) return;
    const pct = Number(form.discountPct.replace(",", "."));
    if (!form.name.trim()) return show("Le nom est obligatoire.", "error");
    if (!(pct > 0 && pct <= 100))
      return show("La remise doit être comprise entre 0 et 100 %.", "error");
    if (form.scope === "PRODUCT" && !form.productId)
      return show("Sélectionnez le produit concerné.", "error");
    if (new Date(form.endsAt) <= new Date(form.startsAt))
      return show("La fin doit être postérieure au début.", "error");
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        productId: form.scope === "PRODUCT" ? form.productId : null,
        discountPct: pct,
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
        isActive: form.isActive,
      };
      if (form.id) await patch(`/pricing/promotions/${form.id}`, body);
      else await post("/pricing/promotions", body);
      show(form.id ? "Promotion mise à jour." : "Promotion créée.", "success");
      invalidateQueries("promotions:");
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

  const toggle = async (p: Promotion) => {
    try {
      await patch(`/pricing/promotions/${p.id}`, { isActive: !p.is_active });
      invalidateQueries("promotions:");
    } catch (e) {
      show(e instanceof Error ? e.message : "Action impossible", "error");
    }
  };

  const doDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await del(`/pricing/promotions/${toDelete.id}`);
      show("Promotion supprimée.", "success");
      invalidateQueries("promotions:");
      setToDelete(null);
    } catch (e) {
      show(e instanceof Error ? e.message : "Suppression impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title="Promotions"
        sub="Remises automatiques datées à la caisse — produit précis ou tout le catalogue"
        actions={<Button onClick={openCreate}>➕ Nouvelle promotion</Button>}
      />
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => {
              setOnlyActive(e.target.checked);
              setPage(1);
            }}
          />
          En cours uniquement
        </label>
      </div>

      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("promotions:")}
        />
      ) : !q.data?.data.length ? (
        <EmptyState
          emoji="🏷️"
          title="Aucune promotion"
          action={<Button onClick={openCreate}>Créer une promotion</Button>}
        >
          Les promotions appliquent une remise automatique à la caisse dans leur
          fenêtre de validité.
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Portée</th>
                  <th>Remise</th>
                  <th>Début</th>
                  <th>Fin</th>
                  <th>Statut</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td className="muted">
                      {p.product_id
                        ? (p.product_name ?? "Produit")
                        : "Tout le catalogue"}
                    </td>
                    <td>
                      <Badge tone="info">−{p.discount_pct} %</Badge>
                    </td>
                    <td className="muted">{formatDate(p.starts_at)}</td>
                    <td className="muted" title={formatDateTime(p.ends_at)}>
                      {formatDate(p.ends_at)}
                    </td>
                    <td>{badgeFor(p)}</td>
                    <td>
                      <div
                        className="row"
                        style={{ gap: 4, flexWrap: "nowrap" }}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(p)}
                        >
                          Modifier
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggle(p)}
                        >
                          {p.is_active ? "Désactiver" : "Activer"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setToDelete(p)}
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
      {q.data ? (
        <Pagination
          page={q.data.page}
          totalPages={q.data.totalPages}
          total={q.data.total}
          onPage={setPage}
        />
      ) : null}

      {form ? (
        <Modal
          title={form.id ? "Modifier la promotion" : "Nouvelle promotion"}
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
              <Button loading={busy} onClick={save}>
                {form.id ? "Enregistrer" : "Créer la promotion"}
              </Button>
            </>
          }
        >
          <Field label="Nom de la promotion" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex. : Rentrée scolaire, Black Friday…"
            />
          </Field>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Portée" required>
              <Select
                value={form.scope}
                onChange={(e) =>
                  setForm({
                    ...form,
                    scope: e.target.value as "GLOBAL" | "PRODUCT",
                  })
                }
              >
                <option value="GLOBAL">Tout le catalogue</option>
                <option value="PRODUCT">Un produit précis</option>
              </Select>
            </Field>
            <Field
              label="Remise (%)"
              hint="Appliquée automatiquement à la caisse — la promo produit est prioritaire sur la promo globale."
              required
            >
              <Input
                inputMode="decimal"
                value={form.discountPct}
                onChange={(e) =>
                  setForm({ ...form, discountPct: e.target.value })
                }
              />
            </Field>
          </div>
          {form.scope === "PRODUCT" ? (
            <Field label="Produit concerné" required>
              <Input
                value={productQuery || productName}
                onChange={(e) => searchProducts(e.target.value)}
                placeholder="Rechercher un produit (2 lettres min.)…"
              />
              {productResults.length > 0 ? (
                <div
                  className="pos-hits"
                  style={{ position: "static", maxHeight: 180 }}
                >
                  {productResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setForm({ ...form, productId: p.id });
                        setProductName(p.name);
                        setProductQuery("");
                        setProductResults([]);
                      }}
                    >
                      <strong>{p.name}</strong>
                    </button>
                  ))}
                </div>
              ) : null}
              {form.productId ? (
                <span className="muted">
                  Sélectionné : <strong>{productName}</strong>
                </span>
              ) : null}
            </Field>
          ) : null}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Début" required>
              <Input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </Field>
            <Field label="Fin" required>
              <Input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </Field>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Promotion active
          </label>
        </Modal>
      ) : null}

      {toDelete ? (
        <ConfirmModal
          title="Supprimer la promotion"
          danger
          confirmLabel="Supprimer"
          message={
            <>
              Supprimer définitivement « <strong>{toDelete.name}</strong> » ?
              Les lignes de vente déjà facturées conservent leur prix figé.
            </>
          }
          onConfirm={doDelete}
          onClose={() => setToDelete(null)}
          loading={busy}
        />
      ) : null}
    </div>
  );
}
