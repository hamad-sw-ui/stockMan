/** Dépôts & transferts : CRUD des emplacements, vue stock par dépôt et
 *  transferts inter-dépôts (création, réception, annulation).
 *  C3 — création ET réception au scan (alias/cartons résolus, facteur
 *  matérialisé dans la quantité — les lignes de transfert sont en unités de
 *  base, sans unité portée). */
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
  SearchInput,
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
  TransitRow,
  VendorRow,
} from "../../lib/types";
import { ScanField } from "../../components/ScanField";
import type { BarcodeLookupResult } from "../../lib/scanLookup";

/* ------------------------------- Onglet Dépôts ------------------------------ */
function DepotsTab() {
  const { t } = useTranslation();
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
  const [search, setSearch] = useState("");
  const depots = (q.data ?? []).filter(
    (d) =>
      !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      (d.address ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (d.phone ?? "").includes(search),
  );

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
      show(
        form.id ? t("pages.depots.updated") : t("pages.depots.created"),
        "success",
      );
      invalidateQueries("depots:");
      setForm(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.depots.saveError"),
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
      show(
        e instanceof Error ? e.message : t("pages.depots.stockError"),
        "error",
      );
    }
  };

  return (
    <>
      {q.data?.length ? (
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("pages.depots.searchPlaceholder")}
        />
      ) : null}
      {q.loading ? (
        <Spinner label={t("common.loading")} />
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
          {depots.map((d) => (
            <Card key={d.id}>
              <div className="row-between">
                <h3 style={{ margin: 0 }}>🏬 {d.name}</h3>
                <Badge tone={d.is_active ? "ok" : "danger"}>
                  {d.is_active ? t("common.active") : t("common.inactive")}
                </Badge>
              </div>
              <p className="muted" style={{ fontSize: "0.88rem" }}>
                {d.address ?? "—"}
                <br />
                {[
                  d.phone,
                  d.owner_name
                    ? t("pages.depots.ownerPrefix", { name: d.owner_name })
                    : null,
                  t("pages.depots.usersCount", { count: d.user_count ?? 0 }),
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
                  {t("pages.depots.stockButton")}
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
                  {t("pages.productDetail.editButton")}
                </Button>
              </div>
            </Card>
          ))}
          <Card>
            <div className="empty" style={{ padding: 18 }}>
              <span className="emoji" aria-hidden>
                ➕
              </span>
              <h3>{t("pages.depots.newDepotTitle")}</h3>
              <p>{t("pages.depots.newDepotBody")}</p>
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
                {t("common.create")}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {form ? (
        <Modal
          title={
            form.id ? t("pages.depots.editTitle") : t("pages.depots.newTitle")
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
            <Field label={t("fields.address")}>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Field label={t("fields.phone")}>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t("pages.depots.ownerField")}>
            <Select
              value={form.ownerId}
              onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
            >
              <option value="">{t("pages.depots.noOwner")}</option>
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
              {t("pages.depots.activeLabel")}
            </label>
          ) : null}
        </Modal>
      ) : null}

      {stockView ? (
        <Modal
          title={t("pages.depots.stockTitle", { name: stockView.depot.name })}
          onClose={() => setStockView(null)}
          wide
        >
          {stockView.rows.length === 0 ? (
            <EmptyState emoji="📦" title={t("pages.depots.stockEmpty")} />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table>
                <thead>
                  <tr>
                    <th>{t("fields.product")}</th>
                    <th className="num">{t("fields.quantity")}</th>
                    <th className="num">{t("pages.products.colThreshold")}</th>
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
  const { t } = useTranslation();
  const { show } = useToast();
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const q = useQuery<Paged<TransferRow>>(
    "transfers:list",
    "/stock/transfers?size=50",
  );
  // E8 — stock EN TRANSIT : reliquats des transferts ouverts, valorisés.
  const transit = useQuery<{
    data: TransitRow[];
    total: number;
    totalValue: number;
  }>("transit:list", "/stock/transit");
  const [form, setForm] = useState<{
    fromDepotId: string;
    toDepotId: string;
    note: string;
    items: Array<{
      productId: string;
      variantId: string | null;
      productName: string;
      quantity: string;
    }>;
  } | null>(null);
  // E8 — réception PARTIELLE par ligne (écarts DAMAGE/LOSS avec motif).
  const [receive, setReceive] = useState<TransferRow | null>(null);
  const [cancel, setCancel] = useState<TransferRow | null>(null);
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
        variantId: i.variantId ?? undefined,
        quantity: Number(i.quantity.replace(",", ".")),
      }));
    if (items.length === 0) {
      show(t("pages.receipts.noLines"), "error");
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
      show(t("pages.depots.transferCreated"), "success");
      invalidateQueries("transfers:");
      invalidateQueries("transit:");
      setForm(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.depots.createError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!cancel) return;
    setBusy(true);
    try {
      await post(`/stock/transfers/${cancel.id}/cancel`);
      show(t("pages.depots.transferCancelled"), "success");
      invalidateQueries("transfers:");
      invalidateQueries("transit:");
      setCancel(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.productDetail.actionError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (s: string) =>
    s === "PENDING" ? (
      <Badge tone="warn">{t("pages.depots.stPending")}</Badge>
    ) : s === "PARTIALLY_RECEIVED" ? (
      <Badge tone="info">{t("pages.depots.stPartial")}</Badge>
    ) : s === "RECEIVED" ? (
      <Badge tone="ok">{t("pages.depots.stReceived")}</Badge>
    ) : (
      <Badge>{t("pages.depots.stCancelled")}</Badge>
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
              items: [],
            })
          }
          disabled={(depots.data ?? []).filter((d) => d.is_active).length < 2}
        >
          {t("pages.depots.newTransfer")}
        </Button>
        {(depots.data ?? []).filter((d) => d.is_active).length < 2 ? (
          <span className="muted">{t("pages.depots.needTwoDepots")}</span>
        ) : null}
      </div>

      {/* E8 — stock EN TRANSIT : reliquats des transferts ouverts (valeur). */}
      {transit.data && transit.data.data.length > 0 ? (
        <Card
          title={t("pages.depots.transitTitle", {
            count: transit.data.total,
            value: formatQty(transit.data.totalValue),
          })}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.product")}</th>
                  <th>{t("pages.depots.colFrom")}</th>
                  <th>{t("pages.depots.colTo")}</th>
                  <th>{t("pages.depots.colShipped")}</th>
                  <th>{t("pages.depots.colReceived")}</th>
                  <th>{t("pages.depots.colLost")}</th>
                  <th>{t("pages.depots.colInTransit")}</th>
                </tr>
              </thead>
              <tbody>
                {transit.data.data.map((r) => (
                  <tr key={r.itemId}>
                    <td>
                      {r.product}
                      {r.variantName ? (
                        <span className="muted"> ({r.variantName})</span>
                      ) : null}
                    </td>
                    <td className="muted">{r.fromDepot}</td>
                    <td className="muted">{r.toDepot}</td>
                    <td>{formatQty(r.shipped)}</td>
                    <td>{formatQty(r.received)}</td>
                    <td>
                      {r.lost > 0 ? (
                        <Badge tone="danger">
                          {formatQty(r.lost)}{" "}
                          {r.discrepancyReason === "DAMAGE"
                            ? t("pages.depots.lostDamage")
                            : t("pages.depots.lostLoss")}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <strong>{formatQty(r.inTransit)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : !q.data?.data.length ? (
        <EmptyState emoji="🔄" title={t("pages.depots.noTransfers")} />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("pages.depots.colFrom")}</th>
                  <th>{t("pages.depots.colTo")}</th>
                  <th>{t("fields.notes")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("pages.movements.by")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((tr) => (
                  <tr key={tr.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(tr.created_at)}
                    </td>
                    <td>{tr.from_depot_name}</td>
                    <td>{tr.to_depot_name}</td>
                    <td className="muted">{tr.note ?? "—"}</td>
                    <td>{statusBadge(tr.status)}</td>
                    <td className="muted">{tr.created_by_name ?? "—"}</td>
                    <td>
                      {tr.status === "PENDING" ||
                      tr.status === "PARTIALLY_RECEIVED" ? (
                        <div
                          className="row"
                          style={{ gap: 4, flexWrap: "nowrap" }}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setReceive(tr)}
                          >
                            {t("pages.depots.receiveButton")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCancel(tr)}
                          >
                            {t("common.cancel")}
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
          title={t("pages.depots.createTitle")}
          onClose={() => !busy && setForm(null)}
          wide
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
                onClick={create}
                disabled={
                  !form.fromDepotId ||
                  !form.toDepotId ||
                  form.fromDepotId === form.toDepotId
                }
              >
                {t("pages.depots.createSubmit")}
              </Button>
            </>
          }
        >
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("pages.depots.sourceField")} required>
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
            <Field label={t("pages.depots.destField")} required>
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
            <Field label={t("fields.notes")}>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Field>
          </div>
          {form.fromDepotId === form.toDepotId ? (
            <p style={{ color: "var(--danger)" }}>
              {t("pages.depots.sameDepotError")}
            </p>
          ) : null}

          <h3 style={{ margin: "10px 0" }}>{t("pages.receipts.colLines")}</h3>
          <Field label={t("pages.receipts.scanField")}>
            <ScanField
              onResolve={(r: BarcodeLookupResult) => {
                if (
                  !form.items.some(
                    (i) =>
                      i.productId === r.productId &&
                      (i.variantId ?? null) === r.variantId,
                  )
                ) {
                  setForm({
                    ...form,
                    items: [
                      ...form.items,
                      {
                        productId: r.productId,
                        variantId: r.variantId,
                        productName:
                          r.productName +
                          (r.variantName ? ` · ${r.variantName}` : ""),
                        // Lignes en unités de base : le facteur du carton
                        // scanné est matérialisé dans la quantité (×12).
                        quantity: String(r.unitFactor !== 1 ? r.unitFactor : 1),
                      },
                    ],
                  });
                  if (r.unitFactor !== 1)
                    show(
                      t("pages.depots.scanPackaging", {
                        symbol: r.unitSymbol,
                        factor: r.unitFactor,
                      }),
                      "info",
                    );
                } else {
                  show(t("pages.depots.duplicateLine"), "info");
                }
              }}
              placeholder={t("pages.receipts.scanPlaceholder")}
            />
          </Field>
          <Field label={t("pages.receipts.searchField")}>
            <Input
              value={productQuery}
              onChange={(e) => searchProducts(e.target.value)}
              placeholder={t("pages.depots.searchProductPlaceholder")}
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
                    if (
                      !form.items.some(
                        (i) => i.productId === p.id && !i.variantId,
                      )
                    )
                      setForm({
                        ...form,
                        items: [
                          ...form.items,
                          {
                            productId: p.id,
                            variantId: null,
                            productName: p.name,
                            quantity: "1",
                          },
                        ],
                      });
                    setProductQuery("");
                    setProductResults([]);
                  }}
                >
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {t("pages.depots.stockGlobal", {
                      qty: formatQty(p.total_qty),
                    })}
                  </span>
                </button>
              ))}
            </div>
          ) : productQuery.length >= 2 ? (
            <p className="muted">{t("pages.receipts.noProducts")}</p>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.product")}</th>
                  <th className="num">{t("fields.quantity")}</th>
                  <th aria-label={t("pages.receipts.ariaRemove")} />
                </tr>
              </thead>
              <tbody>
                {form.items
                  .filter((i) => i.productId)
                  .map((i, idx) => (
                    <tr key={`${i.productId}:${i.variantId ?? ""}`}>
                      <td>{i.productName}</td>
                      <td className="num" style={{ maxWidth: 100 }}>
                        <Input
                          inputMode="decimal"
                          value={i.quantity}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              items: form.items.map((x) =>
                                x.productId === i.productId &&
                                (x.variantId ?? null) === (i.variantId ?? null)
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
            {t("pages.depots.transferNote")}
          </p>
        </Modal>
      ) : null}

      {cancel ? (
        <ConfirmModal
          title={t("pages.depots.cancelTitle")}
          danger
          confirmLabel={t("pages.depots.cancelConfirm")}
          message={
            <Trans
              i18nKey="pages.depots.cancelBody"
              values={{ depot: cancel.from_depot_name }}
              components={{ b: <strong /> }}
            />
          }
          onConfirm={doCancel}
          onClose={() => setCancel(null)}
          loading={busy}
        />
      ) : null}

      {receive ? (
        <ReceiveModal
          transfer={receive}
          onClose={() => setReceive(null)}
          onDone={(status) => {
            show(
              status === "RECEIVED"
                ? t("pages.depots.receiveDoneFull")
                : t("pages.depots.receiveDonePartial"),
              "success",
            );
            invalidateQueries("transfers:");
            invalidateQueries("transit:");
            setReceive(null);
          }}
        />
      ) : null}
    </>
  );
}

/* --------------------- Réception partielle d'un transfert (E8) ------------- */
/**
 * Ligne par ligne : quantité REÇUE au dépôt destination, quantité PERDUE avec
 * motif codifié (DAMAGE casse / LOSS perte — valorisée au coût des lots), le
 * reliquat restant éventuel reste en transit (statut PARTIALLY_RECEIVED).
 */
function ReceiveModal({
  transfer,
  onClose,
  onDone,
}: {
  transfer: TransferRow;
  onClose: () => void;
  onDone: (status: string) => void;
}) {
  const { t } = useTranslation();
  const { show } = useToast();
  const transit = useQuery<{
    data: TransitRow[];
    total: number;
    totalValue: number;
  }>("transit:list", "/stock/transit");
  const lines = (transit.data?.data ?? []).filter(
    (r) => r.transferId === transfer.id && r.inTransit > 1e-9,
  );
  const key = transfer.id;
  const [rows, setRows] = useState<
    Record<
      string,
      { recv: string; lost: string; reason: "DAMAGE" | "LOSS" | "" }
    >
  >({});
  const [busy, setBusy] = useState(false);

  // Pré-remplissage : tout le reliquat reçu par défaut (réception complète
  // en un clic — le cas partiel est l'exception).
  useEffect(() => {
    if (!transit.data) return;
    setRows((cur) => {
      const next = { ...cur };
      for (const l of lines) {
        if (!(l.itemId in next)) {
          next[l.itemId] = { recv: String(l.inTransit), lost: "0", reason: "" };
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transit.data, key]);

  const num = (s: string) => {
    const n = Number((s || "0").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };

  const submit = async () => {
    const items: Array<{
      transferItemId: string;
      receivedQty: number;
      lostQty: number;
      discrepancyReason?: "DAMAGE" | "LOSS" | null;
    }> = [];
    for (const l of lines) {
      const r = rows[l.itemId] ?? {
        recv: String(l.inTransit),
        lost: "0",
        reason: "",
      };
      const recv = num(r.recv);
      const lost = num(r.lost);
      if (Number.isNaN(recv) || Number.isNaN(lost)) {
        show(t("pages.depots.qtyUnreadable", { name: l.product }), "error");
        return;
      }
      if (recv + lost > l.inTransit + 1e-9) {
        show(
          t("pages.depots.exceedsRemaining", {
            name: l.product,
            sum: recv + lost,
            remaining: l.inTransit,
          }),
          "error",
        );
        return;
      }
      if (lost > 0 && !r.reason) {
        show(t("pages.depots.reasonRequired", { name: l.product }), "error");
        return;
      }
      items.push({
        transferItemId: l.itemId,
        receivedQty: recv,
        lostQty: lost,
        discrepancyReason: lost > 0 ? (r.reason as "DAMAGE" | "LOSS") : null,
      });
    }
    setBusy(true);
    try {
      const res = await post<{ status: string }>(
        `/stock/transfers/${transfer.id}/receive`,
        { items },
      );
      onDone(res.status);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.depots.receiveError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("pages.depots.receiveTitle", {
        from: transfer.from_depot_name,
        to: transfer.to_depot_name,
      })}
      onClose={() => !busy && onClose()}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={submit} disabled={lines.length === 0}>
            {t("pages.depots.validateReceipt")}
          </Button>
        </>
      }
    >
      {transit.loading ? (
        <Spinner label={t("pages.depots.loadingLines")} />
      ) : lines.length === 0 ? (
        <EmptyState emoji="📦" title={t("pages.depots.noRemaining")}>
          {t("pages.depots.noRemainingBody")}
        </EmptyState>
      ) : (
        <>
          {/* C3 — réception au scan : chaque code scanné incrémente la
              colonne « Reçu » de la ligne correspondante (plafonné au
              reliquat ; le facteur du conditionnement est appliqué). */}
          <Field label={t("pages.depots.scanReceived")}>
            <ScanField
              onResolve={(r: BarcodeLookupResult) => {
                const line = lines.find((l) =>
                  r.variantId
                    ? l.productId === r.productId &&
                      l.variantName === r.variantName
                    : l.productId === r.productId,
                );
                if (!line) {
                  show(
                    t("pages.depots.notInTransfer", { name: r.productName }),
                    "error",
                  );
                  return;
                }
                const cur = rows[line.itemId] ?? {
                  recv: String(line.inTransit),
                  lost: "0",
                  reason: "" as const,
                };
                const bump = r.unitFactor !== 1 ? r.unitFactor : 1;
                const recv = Math.min(
                  line.inTransit,
                  (Number(cur.recv.replace(",", ".")) || 0) + bump,
                );
                setRows({
                  ...rows,
                  [line.itemId]: { ...cur, recv: String(recv) },
                });
              }}
              placeholder={t("pages.depots.scanReceivedPlaceholder")}
            />
          </Field>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.product")}</th>
                  <th>{t("pages.depots.colRemaining")}</th>
                  <th>{t("pages.depots.colReceivedOk")}</th>
                  <th>{t("pages.depots.colLostWarn")}</th>
                  <th>{t("fields.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const r = rows[l.itemId] ?? {
                    recv: String(l.inTransit),
                    lost: "0",
                    reason: "" as const,
                  };
                  const set = (patch: Partial<typeof r>) =>
                    setRows({ ...rows, [l.itemId]: { ...r, ...patch } });
                  return (
                    <tr key={l.itemId}>
                      <td>
                        {l.product}
                        {l.variantName ? (
                          <span className="muted"> ({l.variantName})</span>
                        ) : null}
                      </td>
                      <td>
                        <strong>{formatQty(l.inTransit)}</strong>
                      </td>
                      <td style={{ width: 110 }}>
                        <Input
                          inputMode="decimal"
                          value={r.recv}
                          onChange={(e) => set({ recv: e.target.value })}
                        />
                      </td>
                      <td style={{ width: 110 }}>
                        <Input
                          inputMode="decimal"
                          value={r.lost}
                          onChange={(e) => set({ lost: e.target.value })}
                        />
                      </td>
                      <td style={{ width: 150 }}>
                        {num(r.lost) > 0 ? (
                          <Select
                            value={r.reason}
                            onChange={(e) =>
                              set({
                                reason: e.target.value as
                                  "DAMAGE" | "LOSS" | "",
                              })
                            }
                          >
                            <option value="">
                              {t("pages.depots.reasonNeeded")}
                            </option>
                            <option value="DAMAGE">
                              {t("pages.depots.damageOption")}
                            </option>
                            <option value="LOSS">
                              {t("pages.depots.lossOption")}
                            </option>
                          </Select>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("pages.depots.lossNote")}
          </p>
        </>
      )}
    </Modal>
  );
}

export default function DepotsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("depots");
  return (
    <div className="wrap">
      <PageHeader title={t("pages.depots.title")} sub={t("pages.depots.sub")} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "depots", label: t("pages.depots.tabDepots") },
          { id: "transferts", label: t("pages.depots.tabTransfers") },
        ]}
      />
      {tab === "depots" ? <DepotsTab /> : <TransfersTab />}
    </div>
  );
}
