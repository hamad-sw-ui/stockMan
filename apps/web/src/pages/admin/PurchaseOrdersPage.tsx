/** Approvisionnement (E4) : bons de commande fournisseurs à cycle complet —
 *  brouillon → envoyée → réceptions PARTIELLES avec reliquats et motifs
 *  d'écart codifiés → clôture ; retours fournisseur valorisés au coût réel
 *  du lot ; taux de service OTIF mesuré (prévu vs réel). */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Badge,
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
  Select,
  Spinner,
} from "../../components/ui";
import { get, post } from "../../lib/http";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatQty,
} from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import { ScanField } from "../../components/ScanField";
import type { BarcodeLookupResult } from "../../lib/scanLookup";
import type {
  Batch,
  Depot,
  OtifRow,
  Paged,
  ProductDetail,
  ProductListItem,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  Supplier,
  SupplierReturnDetail,
  SupplierReturnListItem,
  PoStatus,
} from "../../lib/types";

const PO_STATUS: Record<
  PoStatus,
  { label: string; tone: "muted" | "info" | "warn" | "ok" | "danger" }
> = {
  DRAFT: { label: "Brouillon", tone: "muted" },
  SENT: { label: "Envoyée", tone: "info" },
  PARTIALLY_RECEIVED: { label: "Réception partielle", tone: "warn" },
  CLOSED: { label: "Clôturée", tone: "ok" },
  CANCELLED: { label: "Annulée", tone: "danger" },
};

const RETURN_REASONS: Array<{ id: string; label: string }> = [
  { id: "DAMAGED", label: "Marchandise endommagée" },
  { id: "EXPIRED", label: "Périmé" },
  { id: "WRONG_PRODUCT", label: "Erreur de produit" },
  { id: "QUALITY", label: "Qualité non conforme" },
  { id: "OVERDELIVERY", label: "Sur-livraison" },
  { id: "OTHER", label: "Autre" },
];

const CLOSE_REASONS: Array<{ id: string; label: string }> = [
  { id: "DELIVERED", label: "Livrée (solde)" },
  { id: "SUPPLIER_SHORTAGE", label: "Rupture fournisseur" },
  { id: "CANCELLED_BY_SUPPLIER", label: "Annulée par le fournisseur" },
  { id: "PRICE_DISPUTE", label: "Litige tarifaire" },
  { id: "OTHER", label: "Autre" },
];

const discrepancyLabel: Record<string, string> = {
  NONE: "Aucun",
  SHORT_DELIVERY: "Livraison partielle",
  DAMAGED: "Endommagé",
  WRONG_PRODUCT: "Erreur de produit",
  QUALITY: "Qualité",
  PRICE_CHANGE: "Prix modifié",
  OTHER: "Autre",
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function PurchaseOrdersPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "commandes");

  return (
    <div className="wrap">
      <PageHeader
        title="Approvisionnement"
        sub="Commandes fournisseurs, réceptions avec reliquats, retours et taux de service"
      />
      <div className="chips" style={{ marginBottom: 12 }}>
        {(
          [
            ["commandes", "📋 Commandes"],
            ["retours", "↩️ Retours fournisseur"],
            ["otif", "🎯 Taux de service (OTIF)"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`chip ${tab === id ? "active" : ""}`}
            onClick={() => {
              setTab(id);
              setParams((p) => {
                p.set("tab", id);
                return p;
              });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "commandes" ? <OrdersTab /> : null}
      {tab === "retours" ? <ReturnsTab /> : null}
      {tab === "otif" ? <OtifTab /> : null}
    </div>
  );
}

/* ============================ ONGLET COMMANDES ============================ */
function OrdersTab() {
  const { show } = useToast();
  const [params] = useSearchParams();
  const [status, setStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);

  const qs = new URLSearchParams({ page: String(page), size: "20" });
  if (status) qs.set("status", status);
  if (supplierId) qs.set("supplierId", supplierId);
  const path = `/purchase-orders?${qs}`;
  const q = useQuery<Paged<PurchaseOrderListItem>>(`po:${path}`, path);
  const suppliers = useQuery<Supplier[]>("suppliers:list", "/suppliers");

  const [creating, setCreating] = useState(false);
  // Pré-remplissage « commander » depuis le rapport prédictif
  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  const openDetail = async (id: string) => {
    try {
      setDetail(await get<PurchaseOrderDetail>(`/purchase-orders/${id}`));
    } catch (e) {
      show(e instanceof Error ? e.message : "Commande introuvable", "error");
    }
  };

  const rows = q.data?.data ?? [];
  const openCount = rows.filter(
    (r) => r.status === "SENT" || r.status === "PARTIALLY_RECEIVED",
  ).length;

  return (
    <>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <div className="grid kpis" style={{ flex: 1, minWidth: 240 }}>
          <Kpi label="Commandes" value={String(q.data?.total ?? 0)} />
          <Kpi
            label="En cours (page)"
            value={String(openCount)}
            tone={openCount > 0 ? "warn" : "ok"}
          />
        </div>
        <Button onClick={() => setCreating(true)}>➕ Nouvelle commande</Button>
      </div>

      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label="Statut">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous</option>
              <option value="DRAFT">Brouillons</option>
              <option value="SENT">Envoyées</option>
              <option value="PARTIALLY_RECEIVED">Réceptions partielles</option>
              <option value="CLOSED">Clôturées</option>
              <option value="CANCELLED">Annulées</option>
            </Select>
          </Field>
          <Field label="Fournisseur">
            <Select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => invalidateQueries("po:")} />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📋"
          title="Aucune commande"
          action={
            <Button onClick={() => setCreating(true)}>Créer la première</Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Créée le</th>
                  <th>Fournisseur</th>
                  <th>Dépôt</th>
                  <th className="num">Lignes</th>
                  <th className="num">Réceptionné</th>
                  <th>Prévue le</th>
                  <th>Statut</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const late =
                    r.expected_at != null &&
                    r.expected_at.slice(0, 10) < iso(new Date()) &&
                    (r.status === "SENT" || r.status === "PARTIALLY_RECEIVED");
                  return (
                    <tr key={r.id}>
                      <td className="muted">{formatDate(r.created_at)}</td>
                      <td style={{ fontWeight: 600 }}>{r.supplier_name}</td>
                      <td className="muted">{r.depot_name}</td>
                      <td className="num">{r.line_count ?? 0}</td>
                      <td className="num">
                        {formatQty(r.received_total ?? 0)} /{" "}
                        {formatQty(r.ordered_total ?? 0)}
                      </td>
                      <td className="muted">
                        {r.expected_at ? formatDate(r.expected_at) : "—"}
                        {late ? (
                          <>
                            {" "}
                            <Badge tone="danger">En retard</Badge>
                          </>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone={PO_STATUS[r.status].tone}>
                          {PO_STATUS[r.status].label}
                        </Badge>
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDetail(r.id)}
                        >
                          👁️
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

      {creating ? (
        <PoCreateModal
          presetSupplier={params.get("supplierId") ?? ""}
          presetProduct={params.get("productId") ?? ""}
          presetQty={params.get("qty") ?? ""}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            invalidateQueries("po:");
            setCreating(false);
            void openDetail(id);
          }}
        />
      ) : null}

      {detail ? (
        <PoDetailModal
          detail={detail}
          onClose={() => setDetail(null)}
          onChanged={async () => {
            invalidateQueries("po:");
            try {
              setDetail(
                await get<PurchaseOrderDetail>(`/purchase-orders/${detail.id}`),
              );
            } catch {
              setDetail(null);
            }
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------- Création de commande -------------------------- */
function PoCreateModal({
  presetSupplier,
  presetProduct,
  presetQty,
  onClose,
  onCreated,
}: {
  presetSupplier: string;
  presetProduct: string;
  presetQty: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [supplierId, setSupplierId] = useState(presetSupplier);
  const [depotId, setDepotId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<
    Array<{
      productId: string;
      /** C3 — variante scannée (les commandes sont en unités de base). */
      variantId: string | null;
      quantity: string;
      unitCost: string;
    }>
  >([
    {
      productId: presetProduct,
      variantId: null,
      quantity: presetQty || "1",
      unitCost: "",
    },
  ]);

  /** C3 — ligne alimentée au scan ; le facteur du conditionnement est
   *  matérialisé dans la quantité (les commandes sont en unités de base). */
  const addScanned = (r: BarcodeLookupResult) => {
    setLines((prev) => {
      const draft = {
        productId: r.productId,
        variantId: r.variantId,
        quantity: String(r.unitFactor !== 1 ? r.unitFactor : 1),
        unitCost: "",
      };
      const free = prev.findIndex((l) => !l.productId);
      if (free >= 0) return prev.map((l, j) => (j === free ? draft : l));
      return [...prev, draft];
    });
    if (r.unitFactor !== 1)
      show(
        `Conditionnement « ${r.unitSymbol} » : quantité pré-remplie ×${r.unitFactor}.`,
        "info",
      );
  };

  const suppliers = useQuery<Supplier[]>("suppliers:list", "/suppliers");
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const products = useQuery<Paged<ProductListItem>>(
    "products:po",
    "/products?size=200&includeArchived=false",
  );
  const supplier = (suppliers.data ?? []).find((s) => s.id === supplierId);
  const effectiveDepot = depotId || (depots.data?.[0]?.id ?? "");

  // Coût catalogue pré-rempli à la sélection du produit
  const presetCost = (productId: string) =>
    products.data?.data.find((p) => p.id === productId)?.purchase_price;

  const ready =
    supplierId !== "" &&
    effectiveDepot !== "" &&
    lines.length > 0 &&
    lines.every((l) => l.productId && Number(l.quantity) > 0);

  const estimated = useMemo(
    () =>
      lines.reduce((a, l) => {
        const cost = l.unitCost
          ? Number(l.unitCost)
          : (presetCost(l.productId) ?? 0);
        return a + (Number(l.quantity) || 0) * cost;
      }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, products.data],
  );

  const setLine = (
    i: number,
    patch: Partial<{
      productId: string;
      variantId: string | null;
      quantity: string;
      unitCost: string;
    }>,
  ) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setBusy(true);
    try {
      const po = await post<{ id: string }>("/purchase-orders", {
        supplierId,
        depotId: effectiveDepot,
        reference: reference.trim() || null,
        expectedAt: expectedAt || null,
        note: note.trim() || null,
        items: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId ?? null,
          quantity: Number(l.quantity),
          unitCost: l.unitCost
            ? Number(l.unitCost)
            : (presetCost(l.productId) ?? 0),
        })),
      });
      show("Commande créée (brouillon).", "success");
      onCreated(po.id);
    } catch (e) {
      show(e instanceof Error ? e.message : "Création impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="📋 Nouvelle commande fournisseur"
      onClose={() => !busy && onClose()}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button loading={busy} onClick={save} disabled={!ready}>
            Créer le brouillon
          </Button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label="Fournisseur" required>
          <Select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choisir…</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dépôt de livraison" required>
          <Select
            value={effectiveDepot}
            onChange={(e) => setDepotId(e.target.value)}
          >
            {(depots.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Livraison prévue le"
          hint={`Défaut : aujourd'hui + délai fournisseur${supplier ? ` (${supplier.default_lead_time_days ?? 3} j)` : ""}`}
        >
          <Input
            type="date"
            value={expectedAt}
            onChange={(e) => setExpectedAt(e.target.value)}
          />
        </Field>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label="Référence fournisseur">
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="N° devis/proforma…"
          />
        </Field>
        <Field label="Note">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Conditions…"
          />
        </Field>
      </div>

      <h3 style={{ margin: "12px 0 6px" }}>
        Lignes (quantités en unités de base)
      </h3>
      <div style={{ marginBottom: 8 }}>
        <ScanField
          onResolve={addScanned}
          placeholder="Scanner l'article commandé (alias/carton inclus)…"
        />
      </div>
      {lines.map((l, i) => (
        <div
          key={i}
          className="row"
          style={{
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label={i === 0 ? "Produit" : ""}>
              <Select
                value={l.productId}
                onChange={(e) =>
                  setLine(i, { productId: e.target.value, unitCost: "" })
                }
              >
                <option value="">Choisir…</option>
                {(products.data?.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatMoney(p.purchase_price)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={i === 0 ? "Quantité" : ""}>
            <Input
              style={{ width: 90 }}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => setLine(i, { quantity: e.target.value })}
            />
          </Field>
          <div>
            <Field
              label={i === 0 ? "Coût unitaire" : ""}
              hint={i === 0 ? "Vide = coût catalogue" : undefined}
            >
              <Input
                style={{ width: 110 }}
                inputMode="decimal"
                value={l.unitCost}
                placeholder={String(presetCost(l.productId) ?? "")}
                onChange={(e) => setLine(i, { unitCost: e.target.value })}
              />
            </Field>
          </div>
          <Button
            variant="ghost"
            size="sm"
            title="Retirer"
            onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
            disabled={lines.length === 1}
          >
            🗑️
          </Button>
        </div>
      ))}
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setLines((prev) => [
              ...prev,
              { productId: "", variantId: null, quantity: "1", unitCost: "" },
            ])
          }
        >
          ➕ Ajouter une ligne
        </Button>
        <strong>≈ {formatMoney(estimated)}</strong>
      </div>
    </Modal>
  );
}

/* --------------------------- Détail + actions ---------------------------- */
function PoDetailModal({
  detail,
  onClose,
  onChanged,
}: {
  detail: PurchaseOrderDetail;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState("DELIVERED");
  const canReceive =
    detail.status === "SENT" || detail.status === "PARTIALLY_RECEIVED";

  const act = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await post(`/purchase-orders/${detail.id}/${action}`, body);
      await onChanged();
    } catch (e) {
      show(e instanceof Error ? e.message : "Action refusée", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`📋 Commande — ${PO_STATUS[detail.status].label}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Fermer
          </Button>
          {detail.status === "DRAFT" ? (
            <>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => act("cancel")}
              >
                Annuler
              </Button>
              <Button loading={busy} onClick={() => act("send")}>
                📨 Envoyer au fournisseur
              </Button>
            </>
          ) : null}
          {canReceive ? (
            <Button loading={busy} onClick={() => setReceiving(true)}>
              📥 Réceptionner
            </Button>
          ) : null}
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {detail.supplier_name} → {detail.depot_name} · créée le{" "}
        {formatDateTime(detail.created_at)} par {detail.created_by_name ?? "—"}
        {detail.reference ? ` · Réf. ${detail.reference}` : ""}
        {detail.expected_at
          ? ` · prévue le ${formatDate(detail.expected_at)}`
          : ""}
        {detail.sent_at ? ` · envoyée le ${formatDate(detail.sent_at)}` : ""}
        {detail.close_reason
          ? ` · motif de clôture : ${CLOSE_REASONS.find((r) => r.id === detail.close_reason)?.label ?? detail.close_reason}`
          : ""}
      </p>
      <div className="grid kpis" style={{ marginBottom: 10 }}>
        <Kpi
          label="Réceptions rattachées"
          value={String(detail.receipts_count)}
        />
        <Kpi
          label="Valeur réceptionnée"
          value={formatMoney(detail.received_value)}
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th className="num">Commandé</th>
              <th className="num">Reçu</th>
              <th className="num">Reliquat</th>
              <th className="num">Coût unit.</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((it) => (
              <tr key={it.id}>
                <td>
                  {it.product_name}
                  {it.variant_name ? (
                    <span className="muted"> · {it.variant_name}</span>
                  ) : null}
                </td>
                <td className="num">{formatQty(it.quantity)}</td>
                <td className="num">{formatQty(it.received_qty)}</td>
                <td
                  className="num"
                  style={{
                    fontWeight: 700,
                    color: it.remaining_qty > 0 ? "var(--warn)" : "var(--ok)",
                  }}
                >
                  {formatQty(it.remaining_qty)}
                </td>
                <td className="num muted">{formatMoney(it.unit_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.note ? <p className="muted">🗒️ {detail.note}</p> : null}

      {closing ? (
        <div style={{ marginTop: 12 }}>
          <Card className="filters">
            <Field label="Motif de clôture du reliquat" required>
              <Select
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
              >
                {CLOSE_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="row">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setClosing(false)}
              >
                Annuler
              </Button>
              <Button
                size="sm"
                loading={busy}
                onClick={async () => {
                  await act("close", { reason: closeReason });
                  setClosing(false);
                }}
              >
                Confirmer la clôture
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
      {canReceive && !closing ? (
        <div
          className="row"
          style={{ marginTop: 10, justifyContent: "flex-end" }}
        >
          <Button variant="ghost" size="sm" onClick={() => setClosing(true)}>
            🔒 Clôturer avec motif…
          </Button>
        </div>
      ) : null}

      {receiving ? (
        <PoReceiveModal
          detail={detail}
          onClose={() => setReceiving(false)}
          onDone={async () => {
            setReceiving(false);
            await onChanged();
          }}
        />
      ) : null}
    </Modal>
  );
}

/* --------------------------- Réception rattachée -------------------------- */
function PoReceiveModal({
  detail,
  onClose,
  onDone,
}: {
  detail: PurchaseOrderDetail;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const openLines = detail.items.filter((it) => it.remaining_qty > 0);
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(openLines.map((l) => [l.id, String(l.remaining_qty)])),
  );
  const [reason, setReason] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});

  const ready =
    openLines.length > 0 &&
    openLines.every((l) => {
      const v = Number(qty[l.id]);
      return v > 0 && v <= l.remaining_qty + 1e-9;
    });

  const save = async () => {
    setBusy(true);
    try {
      await post<{ receiptId: string; status: string }>(
        `/purchase-orders/${detail.id}/receive`,
        {
          items: openLines.map((l) => ({
            poItemId: l.id,
            quantity: Number(qty[l.id]),
            discrepancyReason: reason[l.id] || null,
            batchNumber: batch[l.id]?.trim() || null,
            expiryDate: expiry[l.id] || null,
          })),
        },
      );
      show("Réception enregistrée — stock et reliquats mis à jour.", "success");
      await onDone();
    } catch (e) {
      show(e instanceof Error ? e.message : "Réception refusée", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="📥 Réception (partielle possible)"
      onClose={() => !busy && onClose()}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button loading={busy} onClick={save} disabled={!ready}>
            Valider la réception
          </Button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Les quantités sont pré-remplies au reliquat : réduisez-en une pour une
        livraison courte (le motif est alors codifiable, « Livraison partielle »
        par défaut). Le lot est obligatoire si le produit est géré par lot.
      </p>
      {openLines.map((l) => (
        <div key={l.id} style={{ marginBottom: 8 }}>
          <Card className="filters">
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              {l.product_name}
              {l.variant_name ? (
                <span className="muted"> · {l.variant_name}</span>
              ) : null}
              <span className="muted" style={{ fontWeight: 400 }}>
                {" "}
                — reliquat {formatQty(l.remaining_qty)} sur{" "}
                {formatQty(l.quantity)}
              </span>
            </div>
            <div
              className="row"
              style={{ flexWrap: "wrap", alignItems: "flex-end" }}
            >
              <Field label="Reçu" required>
                <Input
                  style={{ width: 90 }}
                  inputMode="decimal"
                  value={qty[l.id] ?? ""}
                  onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                />
              </Field>
              <Field label="Motif d'écart">
                <Select
                  value={reason[l.id] ?? ""}
                  onChange={(e) =>
                    setReason({ ...reason, [l.id]: e.target.value })
                  }
                >
                  <option value="">— Aucun / auto —</option>
                  {Object.entries(discrepancyLabel)
                    .filter(([id]) => id !== "NONE")
                    .map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="N° de lot">
                <Input
                  style={{ width: 130 }}
                  value={batch[l.id] ?? ""}
                  onChange={(e) =>
                    setBatch({ ...batch, [l.id]: e.target.value })
                  }
                  placeholder="Si produit loté"
                />
              </Field>
              <Field label="Expiration">
                <Input
                  type="date"
                  value={expiry[l.id] ?? ""}
                  onChange={(e) =>
                    setExpiry({ ...expiry, [l.id]: e.target.value })
                  }
                />
              </Field>
            </div>
          </Card>
        </div>
      ))}
    </Modal>
  );
}

/* ============================ ONGLET RETOURS ============================== */
function ReturnsTab() {
  const { show } = useToast();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<SupplierReturnDetail | null>(null);
  const path = `/purchase-orders/returns?page=${page}&size=20`;
  const q = useQuery<Paged<SupplierReturnListItem>>(`sret:${page}`, path);

  const openDetail = async (id: string) => {
    try {
      setDetail(
        await get<SupplierReturnDetail>(`/purchase-orders/returns/${id}`),
      );
    } catch (e) {
      show(e instanceof Error ? e.message : "Retour introuvable", "error");
    }
  };

  const rows = q.data?.data ?? [];
  return (
    <>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <div className="grid kpis" style={{ flex: 1, minWidth: 240 }}>
          <Kpi label="Retours" value={String(q.data?.total ?? 0)} />
          <Kpi
            label="Valeur (page)"
            value={formatMoney(rows.reduce((a, r) => a + r.total_cost, 0))}
          />
        </div>
        <Button onClick={() => setCreating(true)}>↩️ Nouveau retour</Button>
      </div>

      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("sret:")}
        />
      ) : rows.length === 0 ? (
        <EmptyState emoji="↩️" title="Aucun retour fournisseur" />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Fournisseur</th>
                  <th>Motif</th>
                  <th className="num">Lignes</th>
                  <th className="num">Avoir</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{formatDateTime(r.created_at)}</td>
                    <td style={{ fontWeight: 600 }}>{r.supplier_name}</td>
                    <td>
                      <Badge tone="warn">
                        {RETURN_REASONS.find((x) => x.id === r.reason)?.label ??
                          r.reason}
                      </Badge>
                    </td>
                    <td className="num">{r.line_count}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatMoney(r.total_cost)}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDetail(r.id)}
                      >
                        👁️
                      </Button>
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

      {creating ? (
        <ReturnCreateModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            invalidateQueries("sret:");
            setCreating(false);
          }}
        />
      ) : null}

      {detail ? (
        <Modal
          title="↩️ Retour fournisseur"
          onClose={() => setDetail(null)}
          wide
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {detail.supplier_name} · {formatDateTime(detail.created_at)} par{" "}
            {detail.created_by_name ?? "—"} · dépôt {detail.depot_name} · motif
            :{" "}
            {RETURN_REASONS.find((x) => x.id === detail.reason)?.label ??
              detail.reason}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Lot</th>
                  <th className="num">Quantité</th>
                  <th className="num">Coût réel</th>
                  <th className="num">Avoir</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      {it.product_name}
                      {it.variant_name ? (
                        <span className="muted"> · {it.variant_name}</span>
                      ) : null}
                    </td>
                    <td className="mono muted">{it.batch_number ?? "—"}</td>
                    <td className="num">{formatQty(it.quantity)}</td>
                    <td className="num muted">{formatMoney(it.unit_cost)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatMoney(it.quantity * it.unit_cost)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} style={{ fontWeight: 700 }}>
                    TOTAL AVOIR
                  </td>
                  <td className="num" style={{ fontWeight: 800 }}>
                    {formatMoney(detail.total_cost)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {detail.note ? <p className="muted">🗒️ {detail.note}</p> : null}
        </Modal>
      ) : null}
    </>
  );
}

function ReturnCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [depotId, setDepotId] = useState("");
  const [reason, setReason] = useState("DAMAGED");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<
    Array<{ productId: string; quantity: string; batchId: string }>
  >([{ productId: "", quantity: "1", batchId: "" }]);
  const [batchesByProduct, setBatchesByProduct] = useState<
    Record<string, Batch[]>
  >({});

  const suppliers = useQuery<Supplier[]>("suppliers:list", "/suppliers");
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const products = useQuery<Paged<ProductListItem>>(
    "products:po",
    "/products?size=200&includeArchived=false",
  );
  const effectiveDepot = depotId || (depots.data?.[0]?.id ?? "");

  // Charge les lots disponibles quand un produit est choisi (choix explicite
  // possible ; vide = FEFO large côté serveur).
  const loadBatches = async (productId: string) => {
    if (!productId || batchesByProduct[productId]) return;
    try {
      const p = await get<ProductDetail>(`/products/${productId}`);
      setBatchesByProduct((prev) => ({
        ...prev,
        [productId]: (p.batches ?? []).filter((b) => b.quantity > 0),
      }));
    } catch {
      /* lots indisponibles : FEFO serveur par défaut */
    }
  };

  const ready =
    supplierId !== "" &&
    effectiveDepot !== "" &&
    lines.every((l) => l.productId && Number(l.quantity) > 0);

  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setBusy(true);
    try {
      await post("/purchase-orders/returns", {
        supplierId,
        depotId: effectiveDepot,
        reason,
        note: note.trim() || null,
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          batchId: l.batchId || null,
        })),
      });
      show(
        "Retour fournisseur enregistré (stock sorti au coût du lot).",
        "success",
      );
      onCreated();
    } catch (e) {
      show(e instanceof Error ? e.message : "Retour refusé", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="↩️ Nouveau retour fournisseur"
      onClose={() => !busy && onClose()}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button loading={busy} onClick={save} disabled={!ready}>
            Valider le retour
          </Button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label="Fournisseur" required>
          <Select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choisir…</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dépôt" required>
          <Select
            value={effectiveDepot}
            onChange={(e) => setDepotId(e.target.value)}
          >
            {(depots.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Motif" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {RETURN_REASONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <h3 style={{ margin: "12px 0 6px" }}>Marchandises renvoyées</h3>
      {/* C3 — le scan fixe le produit et charge ses lots ; le facteur du
          conditionnement se matérialise dans la quantité (unités de base). */}
      <div style={{ marginBottom: 8 }}>
        <ScanField
          onResolve={(r: BarcodeLookupResult) => {
            setLines((prev) => {
              const free = prev.findIndex((l) => !l.productId);
              if (free < 0) return prev;
              return prev.map((l, j) =>
                j === free
                  ? {
                      ...l,
                      productId: r.productId,
                      batchId: "",
                      quantity: String(r.unitFactor !== 1 ? r.unitFactor : 1),
                    }
                  : l,
              );
            });
            void loadBatches(r.productId);
          }}
          placeholder="Scanner l'article à renvoyer…"
        />
      </div>
      {lines.map((l, i) => (
        <div
          key={i}
          className="row"
          style={{
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div style={{ flex: 2, minWidth: 190 }}>
            <Field label={i === 0 ? "Produit" : ""}>
              <Select
                value={l.productId}
                onChange={(e) => {
                  setLine(i, { productId: e.target.value, batchId: "" });
                  void loadBatches(e.target.value);
                }}
              >
                <option value="">Choisir…</option>
                {(products.data?.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={i === 0 ? "Quantité (base)" : ""}>
            <Input
              style={{ width: 90 }}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => setLine(i, { quantity: e.target.value })}
            />
          </Field>
          <div style={{ minWidth: 170 }}>
            <Field label={i === 0 ? "Lot (vide = FEFO)" : ""}>
              <Select
                value={l.batchId}
                onChange={(e) => setLine(i, { batchId: e.target.value })}
              >
                <option value="">FEFO auto (périmés inclus)</option>
                {(batchesByProduct[l.productId] ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batch_number} · {formatQty(b.quantity)}
                    {b.expiry_date ? ` · exp ${formatDate(b.expiry_date)}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            variant="ghost"
            size="sm"
            title="Retirer"
            onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
            disabled={lines.length === 1}
          >
            🗑️
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          setLines((prev) => [
            ...prev,
            { productId: "", quantity: "1", batchId: "" },
          ])
        }
      >
        ➕ Ajouter une ligne
      </Button>
      <div style={{ marginTop: 10 }}>
        <Field label="Note">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contexte du retour…"
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ============================== ONGLET OTIF =============================== */
function OtifTab() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 89 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const path = `/purchase-orders/otif?from=${from}&to=${to}`;
  const q = useQuery<OtifRow[]>(`otif:${from}:${to}`, path);
  const rows = q.data ?? [];

  const best = [...rows].sort(
    (a, b) => (b.otif_rate ?? -1) - (a.otif_rate ?? -1),
  )[0];

  return (
    <>
      <div className="grid kpis" style={{ marginBottom: 10 }}>
        <Kpi label="Fournisseurs mesurés" value={String(rows.length)} />
        {best ? (
          <Kpi
            label="Meilleur OTIF"
            value={`${best.supplier_name} · ${best.otif_rate ?? 0} %`}
            tone="ok"
          />
        ) : (
          <Kpi label="Meilleur OTIF" value="—" />
        )}
      </div>
      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label="Du">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="Au">
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
      </Card>
      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("otif:")}
        />
      ) : rows.length === 0 ? (
        <EmptyState emoji="🎯" title="Aucune commande mesurable sur la période">
          Envoyez puis réceptionnez des commandes (onglet Commandes) : le taux
          de service de chaque fournisseur apparaîtra ici.
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fournisseur</th>
                  <th className="num">Commandes</th>
                  <th className="num">Clôturées</th>
                  <th className="num">À temps</th>
                  <th className="num">Complètes</th>
                  <th className="num">OTIF</th>
                  <th className="num">Délai réel moyen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.supplier_id}>
                    <td style={{ fontWeight: 600 }}>{r.supplier_name}</td>
                    <td className="num">{r.orders}</td>
                    <td className="num muted">{r.closed_orders}</td>
                    <td className="num">
                      {r.on_time_rate != null ? `${r.on_time_rate} %` : "—"}
                    </td>
                    <td className="num">
                      {r.in_full_rate != null ? `${r.in_full_rate} %` : "—"}
                    </td>
                    <td className="num">
                      <Badge
                        tone={
                          r.otif_rate == null
                            ? "muted"
                            : r.otif_rate >= 90
                              ? "ok"
                              : r.otif_rate >= 70
                                ? "warn"
                                : "danger"
                        }
                      >
                        {r.otif_rate != null ? `${r.otif_rate} %` : "—"}
                      </Badge>
                    </td>
                    <td className="num muted">
                      {r.avg_lead_time_days != null
                        ? `${r.avg_lead_time_days} j`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
