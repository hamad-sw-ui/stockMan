/** Dépôts & transferts : CRUD des emplacements, vue stock par dépôt et
 *  transferts inter-dépôts (création, réception, annulation). */
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
  Select,
  Spinner,
  Tabs,
} from "../../components/ui";
import { get, patch, post } from "../../lib/http";
import { formatDateTime, formatQty } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type {
  Depot,
  Paged,
  ProductListItem,
  TransferRow,
  VendorRow,
} from "../../lib/types";

/* ------------------------------- Onglet Dépôts ------------------------------ */
function DepotsTab() {
  const { show } = useToast();
  const q = useQuery<Depot[]>("depots:list", "/depots");
  const users = useQuery<VendorRow[]>(
    "users:short",
    "/users?includeInactive=true",
  );
  const [form, setForm] = useState<{
    id?: string;
    name: string;
    address: string;
    phone: string;
    ownerId: string;
    isActive: boolean;
  } | null>(null);
  const [stockView, setStockView] = useState<{
    depot: Depot;
    rows: Array<{
      id: string;
      name: string;
      barcode: string | null;
      selling_price: number;
      min_stock_level: number;
      unit_symbol: string | null;
      quantity: number;
    }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        address: form.address || null,
        phone: form.phone || null,
        ownerId: form.ownerId || null,
        isActive: form.isActive,
      };
      if (form.id) await patch(`/depots/${form.id}`, body);
      else await post("/depots", body);
      show(form.id ? "Dépôt mis à jour." : "Dépôt créé.", "success");
      invalidateQueries("depots:");
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

  const viewStock = async (d: Depot) => {
    try {
      const rows = await get<
        typeof stockView extends null
          ? never
          : NonNullable<typeof stockView>["rows"]
      >(`/depots/${d.id}/stock`);
      setStockView({
        depot: d,
        rows: rows as NonNullable<typeof stockView>["rows"],
      });
    } catch (e) {
      show(e instanceof Error ? e.message : "Stock indisponible", "error");
    }
  };

  return (
    <>
      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("depots:")}
        />
      ) : (
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          }}
        >
          {(q.data ?? []).map((d) => (
            <Card key={d.id}>
              <div className="row-between">
                <h3 style={{ margin: 0 }}>🏬 {d.name}</h3>
                <Badge tone={d.is_active ? "ok" : "danger"}>
                  {d.is_active ? "Actif" : "Inactif"}
                </Badge>
              </div>
              <p className="muted" style={{ fontSize: "0.88rem" }}>
                {d.address ?? "—"}
                <br />
                {[
                  d.phone,
                  d.owner_name ? `resp. ${d.owner_name}` : null,
                  `${d.user_count ?? 0} utilisateur(s)`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="row">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => viewStock(d)}
                >
                  📦 Stock
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({
                      id: d.id,
                      name: d.name,
                      address: d.address ?? "",
                      phone: d.phone ?? "",
                      ownerId: d.owner_id ?? "",
                      isActive: d.is_active,
                    })
                  }
                >
                  ✏️ Modifier
                </Button>
              </div>
            </Card>
          ))}
          <Card>
            <div className="empty" style={{ padding: 18 }}>
              <span className="emoji" aria-hidden>
                ➕
              </span>
              <h3>Nouveau dépôt</h3>
              <p>Boutique, entrepôt, camion de livraison…</p>
              <Button
                onClick={() =>
                  setForm({
                    name: "",
                    address: "",
                    phone: "",
                    ownerId: "",
                    isActive: true,
                  })
                }
              >
                Créer
              </Button>
            </div>
          </Card>
        </div>
      )}

      {form ? (
        <Modal
          title={form.id ? "Modifier le dépôt" : "Nouveau dépôt"}
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
            <Field label="Adresse">
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Field label="Téléphone">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Responsable">
            <Select
              value={form.ownerId}
              onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
            >
              <option value="">— Aucun —</option>
              {(users.data ?? [])
                .filter((u) => u.is_active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
          </Field>
          {form.id ? (
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
              />{" "}
              Dépôt actif (les dépôts inactifs ne peuvent ni vendre ni recevoir)
            </label>
          ) : null}
        </Modal>
      ) : null}

      {stockView ? (
        <Modal
          title={`📦 Stock — ${stockView.depot.name}`}
          onClose={() => setStockView(null)}
          wide
        >
          {stockView.rows.length === 0 ? (
            <EmptyState emoji="📦" title="Aucun stock sur ce dépôt" />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table>
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th className="num">Quantité</th>
                    <th className="num">Seuil</th>
                  </tr>
                </thead>
                <tbody>
                  {stockView.rows
                    .filter((r) => r.quantity > 0 || true)
                    .map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td
                          className="num"
                          style={{
                            fontWeight: 700,
                            color:
                              r.quantity <= r.min_stock_level
                                ? "var(--warn)"
                                : undefined,
                          }}
                        >
                          {formatQty(r.quantity)} {r.unit_symbol ?? ""}
                        </td>
                        <td className="num muted">
                          {formatQty(r.min_stock_level)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}

/* ----------------------------- Onglet Transferts ---------------------------- */
function TransfersTab() {
  const { show } = useToast();
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const q = useQuery<Paged<TransferRow>>(
    "transfers:list",
    "/stock/transfers?size=50",
  );
  const [form, setForm] = useState<{
    fromDepotId: string;
    toDepotId: string;
    note: string;
    items: Array<{ productId: string; quantity: string }>;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    action: "receive" | "cancel";
    transfer: TransferRow;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductListItem[]>([]);

  const searchProducts = async (value: string) => {
    setProductQuery(value);
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

  const create = async () => {
    if (!form) return;
    const items = form.items
      .filter((i) => i.productId && Number(i.quantity.replace(",", ".")) > 0)
      .map((i) => ({
        productId: i.productId,
        quantity: Number(i.quantity.replace(",", ".")),
      }));
    if (items.length === 0) {
      show("Ajoutez au moins une ligne avec une quantité.", "error");
      return;
    }
    setBusy(true);
    try {
      await post("/stock/transfers", {
        fromDepotId: form.fromDepotId,
        toDepotId: form.toDepotId,
        note: form.note || null,
        items,
      });
      show(
        "Transfert créé (statut « en transit ») : le stock sort immédiatement du dépôt source.",
        "success",
      );
      invalidateQueries("transfers:");
      setForm(null);
    } catch (e) {
      show(e instanceof Error ? e.message : "Création impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await post(`/stock/transfers/${confirm.transfer.id}/${confirm.action}`);
      show(
        confirm.action === "receive"
          ? "Transfert réceptionné : stock crédité au dépôt destination."
          : "Transfert annulé : stock restitué au dépôt source.",
        "success",
      );
      invalidateQueries("transfers:");
      setConfirm(null);
    } catch (e) {
      show(e instanceof Error ? e.message : "Action impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (s: string) =>
    s === "PENDING" ? (
      <Badge tone="warn">En transit</Badge>
    ) : s === "RECEIVED" ? (
      <Badge tone="ok">Reçu</Badge>
    ) : (
      <Badge>Annulé</Badge>
    );

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button
          onClick={() =>
            setForm({
              fromDepotId: depots.data?.[0]?.id ?? "",
              toDepotId: depots.data?.[1]?.id ?? "",
              note: "",
              items: [{ productId: "", quantity: "1" }],
            })
          }
          disabled={(depots.data ?? []).filter((d) => d.is_active).length < 2}
        >
          🔄 Nouveau transfert
        </Button>
        {(depots.data ?? []).filter((d) => d.is_active).length < 2 ? (
          <span className="muted">
            Créez au moins deux dépôts actifs pour transférer.
          </span>
        ) : null}
      </div>

      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : !q.data?.data.length ? (
        <EmptyState emoji="🔄" title="Aucun transfert" />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>De</th>
                  <th>Vers</th>
                  <th>Note</th>
                  <th>Statut</th>
                  <th>Par</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((t) => (
                  <tr key={t.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(t.created_at)}
                    </td>
                    <td>{t.from_depot_name}</td>
                    <td>{t.to_depot_name}</td>
                    <td className="muted">{t.note ?? "—"}</td>
                    <td>{statusBadge(t.status)}</td>
                    <td className="muted">{t.created_by_name ?? "—"}</td>
                    <td>
                      {t.status === "PENDING" ? (
                        <div
                          className="row"
                          style={{ gap: 4, flexWrap: "nowrap" }}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setConfirm({ action: "receive", transfer: t })
                            }
                          >
                            ✅ Réceptionner
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setConfirm({ action: "cancel", transfer: t })
                            }
                          >
                            Annuler
                          </Button>
                        </div>
                      ) : null}
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
          title="Nouveau transfert inter-dépôts"
          onClose={() => !busy && setForm(null)}
          wide
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
                onClick={create}
                disabled={
                  !form.fromDepotId ||
                  !form.toDepotId ||
                  form.fromDepotId === form.toDepotId
                }
              >
                Créer le transfert
              </Button>
            </>
          }
        >
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Dépôt source" required>
              <Select
                value={form.fromDepotId}
                onChange={(e) =>
                  setForm({ ...form, fromDepotId: e.target.value })
                }
              >
                {(depots.data ?? [])
                  .filter((d) => d.is_active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Dépôt destination" required>
              <Select
                value={form.toDepotId}
                onChange={(e) =>
                  setForm({ ...form, toDepotId: e.target.value })
                }
              >
                {(depots.data ?? [])
                  .filter((d) => d.is_active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Note">
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Field>
          </div>
          {form.fromDepotId === form.toDepotId ? (
            <p style={{ color: "var(--danger)" }}>
              Les dépôts source et destination doivent différer.
            </p>
          ) : null}

          <h3 style={{ margin: "10px 0" }}>Lignes</h3>
          <Field label="Ajouter un produit (recherche)">
            <Input
              value={productQuery}
              onChange={(e) => searchProducts(e.target.value)}
              placeholder="Tapez le nom d’un produit…"
            />
          </Field>
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
                    if (!form.items.some((i) => i.productId === p.id))
                      setForm({
                        ...form,
                        items: [
                          ...form.items,
                          { productId: p.id, quantity: "1" },
                        ],
                      });
                    setProductQuery("");
                    setProductResults([]);
                  }}
                >
                  <strong>{p.name}</strong>
                  <span className="muted">
                    stock global {formatQty(p.total_qty)}
                  </span>
                </button>
              ))}
            </div>
          ) : productQuery.length >= 2 ? (
            <p className="muted">Aucun produit trouvé.</p>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th className="num">Quantité</th>
                  <th aria-label="Retirer" />
                </tr>
              </thead>
              <tbody>
                {form.items
                  .filter((i) => i.productId)
                  .map((i, idx) => (
                    <tr key={i.productId}>
                      <td>
                        {productResults.find((p) => p.id === i.productId)
                          ?.name ?? (
                          <code className="muted">
                            {i.productId.slice(0, 8)}…
                          </code>
                        )}
                      </td>
                      <td className="num" style={{ maxWidth: 100 }}>
                        <Input
                          inputMode="decimal"
                          value={i.quantity}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              items: form.items.map((x) =>
                                x.productId === i.productId
                                  ? { ...x, quantity: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setForm({
                              ...form,
                              items: form.items.filter((_, j) => j !== idx),
                            })
                          }
                        >
                          🗑️
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            ⚠️ Le stock part immédiatement du dépôt source et n’arrive qu’à la
            réception (double validation). L’annulation restitue le stock.
          </p>
        </Modal>
      ) : null}

      {confirm ? (
        <ConfirmModal
          title={
            confirm.action === "receive"
              ? "Réceptionner le transfert"
              : "Annuler le transfert"
          }
          danger={confirm.action === "cancel"}
          confirmLabel={
            confirm.action === "receive"
              ? "Réceptionner"
              : "Annuler le transfert"
          }
          message={
            confirm.action === "receive" ? (
              <>
                Le stock sera crédité au dépôt{" "}
                <strong>{confirm.transfer.to_depot_name}</strong>.
              </>
            ) : (
              <>
                Le stock sera restitué au dépôt{" "}
                <strong>{confirm.transfer.from_depot_name}</strong>.
              </>
            )
          }
          onConfirm={doConfirm}
          onClose={() => setConfirm(null)}
          loading={busy}
        />
      ) : null}
    </>
  );
}

export default function DepotsPage() {
  const [tab, setTab] = useState("depots");
  return (
    <div className="wrap">
      <PageHeader
        title="Dépôts & transferts"
        sub="Emplacements de stockage et mouvements inter-dépôts"
      />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "depots", label: "🏬 Dépôts" },
          { id: "transferts", label: "🔄 Transferts" },
        ]}
      />
      {tab === "depots" ? <DepotsTab /> : <TransfersTab />}
    </div>
  );
}
