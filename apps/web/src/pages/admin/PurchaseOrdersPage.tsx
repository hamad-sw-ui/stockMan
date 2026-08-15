/** Approvisionnement (E4) : bons de commande fournisseurs à cycle complet —
 *  brouillon → envoyée → réceptions PARTIELLES avec reliquats et motifs
 *  d'écart codifiés → clôture ; retours fournisseur valorisés au coût réel
 *  du lot ; taux de service OTIF mesuré (prévu vs réel). */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

/** Tonalités de badge par statut ; les libellés passent par i18n
 *  (« pages.purchaseOrders.status.* » — FR = source historique). */
const PO_STATUS_TONES: Record<
  PoStatus,
  "muted" | "info" | "warn" | "ok" | "danger"
> = {
  DRAFT: "muted",
  SENT: "info",
  PARTIALLY_RECEIVED: "warn",
  CLOSED: "ok",
  CANCELLED: "danger",
};

/** Motifs codifiés (ids stables API ; libellés via i18n). */
const RETURN_REASON_IDS = [
  "DAMAGED",
  "EXPIRED",
  "WRONG_PRODUCT",
  "QUALITY",
  "OVERDELIVERY",
  "OTHER",
] as const;

const CLOSE_REASON_IDS = [
  "DELIVERED",
  "SUPPLIER_SHORTAGE",
  "CANCELLED_BY_SUPPLIER",
  "PRICE_DISPUTE",
  "OTHER",
] as const;

const DISCREPANCY_IDS = [
  "NONE",
  "SHORT_DELIVERY",
  "DAMAGED",
  "WRONG_PRODUCT",
  "QUALITY",
  "PRICE_CHANGE",
  "OTHER",
] as const;

/** Fabrique un libelleur i18n : libellé de la clé `<préfixe>.<id>`, avec
 *  repli sur l'id brut si celui-ci est inconnu de la liste. */
const makeCodedLabeler =
  (ids: readonly string[], prefix: string) =>
  (t: (k: string) => string, id: string): string =>
    ids.includes(id) ? t(`${prefix}.${id}`) : id;

const returnReasonLabel = makeCodedLabeler(
  RETURN_REASON_IDS,
  "pages.purchaseOrders.returnReasons",
);
const closeReasonLabel = makeCodedLabeler(
  CLOSE_REASON_IDS,
  "pages.purchaseOrders.closeReasons",
);

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "commandes");

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.purchaseOrders.title")}
        sub={t("pages.purchaseOrders.sub")}
      />
      <div className="chips" style={{ marginBottom: 12 }}>
        {(
          [
            ["commandes", t("pages.purchaseOrders.tabOrders")],
            ["retours", t("pages.purchaseOrders.tabReturns")],
            ["otif", t("pages.purchaseOrders.tabOtif")],
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
  const { t } = useTranslation();
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
      show(
        e instanceof Error ? e.message : t("pages.purchaseOrders.detailError"),
        "error",
      );
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
          <Kpi
            label={t("pages.purchaseOrders.kpiOrders")}
            value={String(q.data?.total ?? 0)}
          />
          <Kpi
            label={t("pages.purchaseOrders.kpiInProgress")}
            value={String(openCount)}
            tone={openCount > 0 ? "warn" : "ok"}
          />
        </div>
        <Button onClick={() => setCreating(true)}>
          {t("pages.purchaseOrders.newOrder")}
        </Button>
      </div>

      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label={t("common.status")}>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("common.all")}</option>
              <option value="DRAFT">
                {t("pages.purchaseOrders.filterDraft")}
              </option>
              <option value="SENT">
                {t("pages.purchaseOrders.filterSent")}
              </option>
              <option value="PARTIALLY_RECEIVED">
                {t("pages.purchaseOrders.filterPartial")}
              </option>
              <option value="CLOSED">
                {t("pages.purchaseOrders.filterClosed")}
              </option>
              <option value="CANCELLED">
                {t("pages.purchaseOrders.filterCancelled")}
              </option>
            </Select>
          </Field>
          <Field label={t("fields.supplier")}>
            <Select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("common.all")}</option>
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
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => invalidateQueries("po:")} />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📋"
          title={t("pages.purchaseOrders.empty")}
          action={
            <Button onClick={() => setCreating(true)}>
              {t("pages.purchaseOrders.createFirst")}
            </Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.purchaseOrders.colCreated")}</th>
                  <th>{t("fields.supplier")}</th>
                  <th>{t("fields.depot")}</th>
                  <th className="num">{t("pages.receipts.colLines")}</th>
                  <th className="num">
                    {t("pages.purchaseOrders.colReceived")}
                  </th>
                  <th>{t("pages.purchaseOrders.colExpected")}</th>
                  <th>{t("common.status")}</th>
                  <th aria-label={t("common.actions")} />
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
                      <td
                        className="muted"
                        data-label={t("pages.purchaseOrders.colCreated")}
                      >
                        {formatDate(r.created_at)}
                      </td>
                      <td
                        style={{ fontWeight: 600 }}
                        data-label={t("fields.supplier")}
                      >
                        {r.supplier_name}
                      </td>
                      <td className="muted" data-label={t("fields.depot")}>
                        {r.depot_name}
                      </td>
                      <td
                        className="num"
                        data-label={t("pages.receipts.colLines")}
                      >
                        {r.line_count ?? 0}
                      </td>
                      <td
                        className="num"
                        data-label={t("pages.purchaseOrders.colReceived")}
                      >
                        {formatQty(r.received_total ?? 0)} /{" "}
                        {formatQty(r.ordered_total ?? 0)}
                      </td>
                      <td
                        className="muted"
                        data-label={t("pages.purchaseOrders.colExpected")}
                      >
                        {r.expected_at ? formatDate(r.expected_at) : "—"}
                        {late ? (
                          <>
                            {" "}
                            <Badge tone="danger">
                              {t("pages.purchaseOrders.badgeLate")}
                            </Badge>
                          </>
                        ) : null}
                      </td>
                      <td data-label={t("common.status")}>
                        <Badge tone={PO_STATUS_TONES[r.status]}>
                          {t(`pages.purchaseOrders.status.${r.status}`)}
                        </Badge>
                      </td>
                      <td data-label="" className="col-actions">
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
  const { t } = useTranslation();
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
        t("pages.purchaseOrders.scanPackaging", {
          symbol: r.unitSymbol,
          factor: r.unitFactor,
        }),
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
      show(t("pages.purchaseOrders.createdToast"), "success");
      onCreated(po.id);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.purchaseOrders.createError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("pages.purchaseOrders.createTitle")}
      onClose={() => !busy && onClose()}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={save} disabled={!ready}>
            {t("pages.purchaseOrders.createDraft")}
          </Button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label={t("fields.supplier")} required>
          <Select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">{t("common.choose")}</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("pages.purchaseOrders.depotField")} required>
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
          label={t("pages.purchaseOrders.expectedField")}
          hint={
            t("pages.purchaseOrders.expectedHint") +
            (supplier
              ? t("pages.purchaseOrders.expectedHintDays", {
                  days: supplier.default_lead_time_days ?? 3,
                })
              : "")
          }
        >
          <Input
            type="date"
            value={expectedAt}
            onChange={(e) => setExpectedAt(e.target.value)}
          />
        </Field>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label={t("pages.purchaseOrders.referenceField")}>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t("pages.purchaseOrders.referencePlaceholder")}
          />
        </Field>
        <Field label={t("pages.purchaseOrders.noteField")}>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("pages.purchaseOrders.notePlaceholder")}
          />
        </Field>
      </div>

      <h3 style={{ margin: "12px 0 6px" }}>
        {t("pages.purchaseOrders.linesTitle")}
      </h3>
      <div style={{ marginBottom: 8 }}>
        <ScanField
          onResolve={addScanned}
          placeholder={t("pages.purchaseOrders.scanPlaceholder")}
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
            <Field label={i === 0 ? t("fields.product") : ""}>
              <Select
                value={l.productId}
                onChange={(e) =>
                  setLine(i, { productId: e.target.value, unitCost: "" })
                }
              >
                <option value="">{t("common.choose")}</option>
                {(products.data?.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatMoney(p.purchase_price)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={i === 0 ? t("fields.quantity") : ""}>
            <Input
              style={{ width: 90 }}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => setLine(i, { quantity: e.target.value })}
            />
          </Field>
          <div>
            <Field
              label={i === 0 ? t("pages.purchaseOrders.colUnitCost") : ""}
              hint={
                i === 0 ? t("pages.purchaseOrders.unitCostHint") : undefined
              }
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
            title={t("pages.purchaseOrders.removeTitle")}
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
          {t("pages.purchaseOrders.addLine")}
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
  const { t } = useTranslation();
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
      show(
        e instanceof Error
          ? e.message
          : t("pages.purchaseOrders.actionRefused"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("pages.purchaseOrders.detailTitle", {
        status: t(`pages.purchaseOrders.status.${detail.status}`),
      })}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.close")}
          </Button>
          {detail.status === "DRAFT" ? (
            <>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => act("cancel")}
              >
                {t("common.cancel")}
              </Button>
              <Button loading={busy} onClick={() => act("send")}>
                {t("pages.purchaseOrders.sendButton")}
              </Button>
            </>
          ) : null}
          {canReceive ? (
            <Button loading={busy} onClick={() => setReceiving(true)}>
              {t("pages.purchaseOrders.receiveButton")}
            </Button>
          ) : null}
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {detail.supplier_name} → {detail.depot_name} ·{" "}
        {t("pages.purchaseOrders.createdBy", {
          date: formatDateTime(detail.created_at),
          name: detail.created_by_name ?? "—",
        })}
        {detail.reference
          ? t("pages.purchaseOrders.refSuffix", { reference: detail.reference })
          : ""}
        {detail.expected_at
          ? t("pages.purchaseOrders.expectedSuffix", {
              date: formatDate(detail.expected_at),
            })
          : ""}
        {detail.sent_at
          ? t("pages.purchaseOrders.sentSuffix", {
              date: formatDate(detail.sent_at),
            })
          : ""}
        {detail.close_reason
          ? t("pages.purchaseOrders.closeSuffix", {
              reason: closeReasonLabel(t, detail.close_reason),
            })
          : ""}
      </p>
      <div className="grid kpis" style={{ marginBottom: 10 }}>
        <Kpi
          label={t("pages.purchaseOrders.kpiReceipts")}
          value={String(detail.receipts_count)}
        />
        <Kpi
          label={t("pages.purchaseOrders.kpiReceivedValue")}
          value={formatMoney(detail.received_value)}
        />
      </div>

      <div className="table-wrap table-cards">
        <table>
          <thead>
            <tr>
              <th>{t("fields.product")}</th>
              <th className="num">{t("pages.purchaseOrders.colOrdered")}</th>
              <th className="num">
                {t("pages.purchaseOrders.colReceivedShort")}
              </th>
              <th className="num">{t("pages.purchaseOrders.colRemaining")}</th>
              <th className="num">
                {t("pages.purchaseOrders.colUnitCostShort")}
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((it) => (
              <tr key={it.id}>
                <td data-label={t("fields.product")}>
                  {it.product_name}
                  {it.variant_name ? (
                    <span className="muted"> · {it.variant_name}</span>
                  ) : null}
                </td>
                <td
                  className="num"
                  data-label={t("pages.purchaseOrders.colOrdered")}
                >
                  {formatQty(it.quantity)}
                </td>
                <td
                  className="num"
                  data-label={t("pages.purchaseOrders.colReceivedShort")}
                >
                  {formatQty(it.received_qty)}
                </td>
                <td
                  className="num"
                  data-label={t("pages.purchaseOrders.colRemaining")}
                  style={{
                    fontWeight: 700,
                    color: it.remaining_qty > 0 ? "var(--warn)" : "var(--ok)",
                  }}
                >
                  {formatQty(it.remaining_qty)}
                </td>
                <td
                  className="num muted"
                  data-label={t("pages.purchaseOrders.colUnitCostShort")}
                >
                  {formatMoney(it.unit_cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.note ? <p className="muted">🗒️ {detail.note}</p> : null}

      {closing ? (
        <div style={{ marginTop: 12 }}>
          <Card className="filters">
            <Field label={t("pages.purchaseOrders.closeReasonField")} required>
              <Select
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
              >
                {CLOSE_REASON_IDS.map((id) => (
                  <option key={id} value={id}>
                    {closeReasonLabel(t, id)}
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
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                loading={busy}
                onClick={async () => {
                  await act("close", { reason: closeReason });
                  setClosing(false);
                }}
              >
                {t("pages.purchaseOrders.closeConfirm")}
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
            {t("pages.purchaseOrders.closeButton")}
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
  const { t } = useTranslation();
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
      show(t("pages.purchaseOrders.receiveToast"), "success");
      await onDone();
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.purchaseOrders.receiveError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("pages.purchaseOrders.receiveTitle")}
      onClose={() => !busy && onClose()}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={save} disabled={!ready}>
            {t("pages.purchaseOrders.receiveSubmit")}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {t("pages.purchaseOrders.receiveIntro")}
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
                {t("pages.purchaseOrders.remainingInfo", {
                  remaining: formatQty(l.remaining_qty),
                  ordered: formatQty(l.quantity),
                })}
              </span>
            </div>
            <div
              className="row"
              style={{ flexWrap: "wrap", alignItems: "flex-end" }}
            >
              <Field
                label={t("pages.purchaseOrders.colReceivedShort")}
                required
              >
                <Input
                  style={{ width: 90 }}
                  inputMode="decimal"
                  value={qty[l.id] ?? ""}
                  onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                />
              </Field>
              <Field label={t("pages.purchaseOrders.discrepancyField")}>
                <Select
                  value={reason[l.id] ?? ""}
                  onChange={(e) =>
                    setReason({ ...reason, [l.id]: e.target.value })
                  }
                >
                  <option value="">
                    {t("pages.purchaseOrders.discrepancyNone")}
                  </option>
                  {DISCREPANCY_IDS.filter((id) => id !== "NONE").map((id) => (
                    <option key={id} value={id}>
                      {t(`pages.purchaseOrders.discrepancy.${id}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("pages.purchaseOrders.batchField")}>
                <Input
                  style={{ width: 130 }}
                  value={batch[l.id] ?? ""}
                  onChange={(e) =>
                    setBatch({ ...batch, [l.id]: e.target.value })
                  }
                  placeholder={t("pages.purchaseOrders.batchPlaceholder")}
                />
              </Field>
              <Field label={t("pages.purchaseOrders.expiryField")}>
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
  const { t } = useTranslation();
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
      show(
        e instanceof Error
          ? e.message
          : t("pages.purchaseOrders.returnDetailError"),
        "error",
      );
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
          <Kpi
            label={t("pages.purchaseOrders.kpiReturns")}
            value={String(q.data?.total ?? 0)}
          />
          <Kpi
            label={t("pages.purchaseOrders.kpiValue")}
            value={formatMoney(rows.reduce((a, r) => a + r.total_cost, 0))}
          />
        </div>
        <Button onClick={() => setCreating(true)}>
          {t("pages.purchaseOrders.newReturn")}
        </Button>
      </div>

      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("sret:")}
        />
      ) : rows.length === 0 ? (
        <EmptyState emoji="↩️" title={t("pages.purchaseOrders.emptyReturns")} />
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("fields.supplier")}</th>
                  <th>{t("fields.reason")}</th>
                  <th className="num">{t("pages.receipts.colLines")}</th>
                  <th className="num">{t("pages.purchaseOrders.colCredit")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted" data-label={t("common.date")}>
                      {formatDateTime(r.created_at)}
                    </td>
                    <td
                      style={{ fontWeight: 600 }}
                      data-label={t("fields.supplier")}
                    >
                      {r.supplier_name}
                    </td>
                    <td data-label={t("fields.reason")}>
                      <Badge tone="warn">
                        {returnReasonLabel(t, r.reason)}
                      </Badge>
                    </td>
                    <td
                      className="num"
                      data-label={t("pages.receipts.colLines")}
                    >
                      {r.line_count}
                    </td>
                    <td
                      className="num"
                      style={{ fontWeight: 700 }}
                      data-label={t("pages.purchaseOrders.colCredit")}
                    >
                      {formatMoney(r.total_cost)}
                    </td>
                    <td data-label="" className="col-actions">
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
          title={t("pages.purchaseOrders.returnDetailTitle")}
          onClose={() => setDetail(null)}
          wide
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {detail.supplier_name} · {formatDateTime(detail.created_at)}{" "}
            {t("pages.purchaseOrders.byName", {
              name: detail.created_by_name ?? "—",
            })}
            {t("pages.purchaseOrders.depotSuffix", {
              depot: detail.depot_name,
            })}
            {t("pages.purchaseOrders.reasonSuffix", {
              reason: returnReasonLabel(t, detail.reason),
            })}
          </p>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.product")}</th>
                  <th>{t("pages.purchaseOrders.colBatch")}</th>
                  <th className="num">{t("fields.quantity")}</th>
                  <th className="num">
                    {t("pages.purchaseOrders.colRealCost")}
                  </th>
                  <th className="num">{t("pages.purchaseOrders.colCredit")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it) => (
                  <tr key={it.id}>
                    <td data-label={t("fields.product")}>
                      {it.product_name}
                      {it.variant_name ? (
                        <span className="muted"> · {it.variant_name}</span>
                      ) : null}
                    </td>
                    <td
                      className="mono muted"
                      data-label={t("pages.purchaseOrders.colBatch")}
                    >
                      {it.batch_number ?? "—"}
                    </td>
                    <td className="num" data-label={t("fields.quantity")}>
                      {formatQty(it.quantity)}
                    </td>
                    <td
                      className="num muted"
                      data-label={t("pages.purchaseOrders.colRealCost")}
                    >
                      {formatMoney(it.unit_cost)}
                    </td>
                    <td
                      className="num"
                      style={{ fontWeight: 700 }}
                      data-label={t("pages.purchaseOrders.colCredit")}
                    >
                      {formatMoney(it.quantity * it.unit_cost)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td
                    colSpan={4}
                    style={{ fontWeight: 700 }}
                    data-label={t("common.total")}
                  >
                    {t("pages.purchaseOrders.totalCredit")}
                  </td>
                  <td
                    className="num"
                    style={{ fontWeight: 800 }}
                    data-label={t("common.amount")}
                  >
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
  const { t } = useTranslation();
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
      show(t("pages.purchaseOrders.returnToast"), "success");
      onCreated();
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.purchaseOrders.returnError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("pages.purchaseOrders.returnCreateTitle")}
      onClose={() => !busy && onClose()}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={save} disabled={!ready}>
            {t("pages.saleDetail.returnConfirm")}
          </Button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label={t("fields.supplier")} required>
          <Select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">{t("common.choose")}</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("fields.depot")} required>
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
        <Field label={t("fields.reason")} required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {RETURN_REASON_IDS.map((id) => (
              <option key={id} value={id}>
                {returnReasonLabel(t, id)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <h3 style={{ margin: "12px 0 6px" }}>
        {t("pages.purchaseOrders.returnLinesTitle")}
      </h3>
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
          placeholder={t("pages.purchaseOrders.returnScanPlaceholder")}
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
            <Field label={i === 0 ? t("fields.product") : ""}>
              <Select
                value={l.productId}
                onChange={(e) => {
                  setLine(i, { productId: e.target.value, batchId: "" });
                  void loadBatches(e.target.value);
                }}
              >
                <option value="">{t("common.choose")}</option>
                {(products.data?.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={i === 0 ? t("pages.purchaseOrders.colQtyBase") : ""}>
            <Input
              style={{ width: 90 }}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => setLine(i, { quantity: e.target.value })}
            />
          </Field>
          <div style={{ minWidth: 170 }}>
            <Field
              label={i === 0 ? t("pages.purchaseOrders.batchFefoField") : ""}
            >
              <Select
                value={l.batchId}
                onChange={(e) => setLine(i, { batchId: e.target.value })}
              >
                <option value="">{t("pages.purchaseOrders.fefoAuto")}</option>
                {(batchesByProduct[l.productId] ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batch_number} · {formatQty(b.quantity)}
                    {b.expiry_date
                      ? t("pages.purchaseOrders.batchExpirySuffix", {
                          date: formatDate(b.expiry_date),
                        })
                      : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            variant="ghost"
            size="sm"
            title={t("pages.purchaseOrders.removeTitle")}
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
        {t("pages.purchaseOrders.addLine")}
      </Button>
      <div style={{ marginTop: 10 }}>
        <Field label={t("pages.purchaseOrders.noteField")}>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("pages.purchaseOrders.returnNotePlaceholder")}
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ============================== ONGLET OTIF =============================== */
function OtifTab() {
  const { t } = useTranslation();
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
        <Kpi
          label={t("pages.purchaseOrders.kpiMeasured")}
          value={String(rows.length)}
        />
        {best ? (
          <Kpi
            label={t("pages.purchaseOrders.kpiBest")}
            value={`${best.supplier_name} · ${best.otif_rate ?? 0} %`}
            tone="ok"
          />
        ) : (
          <Kpi label={t("pages.purchaseOrders.kpiBest")} value="—" />
        )}
      </div>
      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label={t("common.from")}>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t("common.to")}>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
      </Card>
      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("otif:")}
        />
      ) : rows.length === 0 ? (
        <EmptyState emoji="🎯" title={t("pages.purchaseOrders.otifEmpty")}>
          {t("pages.purchaseOrders.otifEmptyBody")}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.supplier")}</th>
                  <th className="num">{t("pages.purchaseOrders.kpiOrders")}</th>
                  <th className="num">{t("pages.purchaseOrders.colClosed")}</th>
                  <th className="num">{t("pages.purchaseOrders.colOnTime")}</th>
                  <th className="num">{t("pages.purchaseOrders.colInFull")}</th>
                  <th className="num">OTIF</th>
                  <th className="num">
                    {t("pages.purchaseOrders.colAvgLead")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.supplier_id}>
                    <td
                      style={{ fontWeight: 600 }}
                      data-label={t("fields.supplier")}
                    >
                      {r.supplier_name}
                    </td>
                    <td
                      className="num"
                      data-label={t("pages.purchaseOrders.kpiOrders")}
                    >
                      {r.orders}
                    </td>
                    <td
                      className="num muted"
                      data-label={t("pages.purchaseOrders.colClosed")}
                    >
                      {r.closed_orders}
                    </td>
                    <td
                      className="num"
                      data-label={t("pages.purchaseOrders.colOnTime")}
                    >
                      {r.on_time_rate != null ? `${r.on_time_rate} %` : "—"}
                    </td>
                    <td
                      className="num"
                      data-label={t("pages.purchaseOrders.colInFull")}
                    >
                      {r.in_full_rate != null ? `${r.in_full_rate} %` : "—"}
                    </td>
                    <td className="num" data-label="OTIF">
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
                    <td
                      className="num muted"
                      data-label={t("pages.purchaseOrders.colAvgLead")}
                    >
                      {r.avg_lead_time_days != null
                        ? t("pages.purchaseOrders.otifDaysShort", {
                            days: r.avg_lead_time_days,
                          })
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
