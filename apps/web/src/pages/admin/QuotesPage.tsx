/** Devis / proforma (E3) : offre au prix figé serveur, conversion en vente
 *  au prix du devis (jamais repricée), annulation, suivi des brouillons. */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
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
  Customer,
  Depot,
  Paged,
  PaymentMethod,
  ProductListItem,
  QuoteDetail,
  QuoteListItem,
  Unit,
} from "../../lib/types";

/** Tonalités de badge par statut ; les libellés passent par i18n
 *  (« pages.quotes.status.* » — FR = source historique). */
const STATUS_TONES: Record<QuoteListItem["status"], "info" | "ok" | "muted"> = {
  DRAFT: "info",
  CONVERTED: "ok",
  CANCELLED: "muted",
};

interface LineDraft {
  productId: string;
  /** C3 — variante résolue au scan (libellé conservé pour l'affichage). */
  variantId?: string | null;
  variantName?: string | null;
  unitId: string;
  quantity: string;
  discountPct: string;
}

export default function QuotesPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const params = new URLSearchParams({ page: String(page), size: "25" });
  if (status) params.set("status", status);
  const path = `/quotes?${params}`;
  const q = useQuery<Paged<QuoteListItem>>(`quotes:${path}`, path);
  const rows = q.data?.data ?? [];

  const openDetail = async (id: string) => {
    try {
      setDetail(await get<QuoteDetail>(`/quotes/${id}`));
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.quotes.detailError"),
        "error",
      );
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await post(`/quotes/${id}/cancel`, {});
      show(t("pages.quotes.cancelToast"), "success");
      invalidateQueries("quotes:");
      setDetail(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.quotes.cancelError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.quotes.title")}
        sub={t("pages.quotes.sub")}
        actions={
          <Button onClick={() => setCreating(true)}>
            {t("pages.quotes.newQuote")}
          </Button>
        }
      />

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
              <option value="DRAFT">{t("pages.quotes.filterDraft")}</option>
              <option value="CONVERTED">
                {t("pages.quotes.filterConverted")}
              </option>
              <option value="CANCELLED">
                {t("pages.quotes.filterCancelled")}
              </option>
            </Select>
          </Field>
        </div>
      </Card>

      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("quotes:")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📝"
          title={
            status ? t("pages.quotes.emptyFiltered") : t("pages.quotes.empty")
          }
          action={
            <Button onClick={() => setCreating(true)}>
              {t("pages.quotes.createFirst")}
            </Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("fields.customer")}</th>
                  <th>{t("fields.depot")}</th>
                  <th className="num">{t("pages.receipts.colLines")}</th>
                  <th className="num">{t("common.total")}</th>
                  <th>{t("pages.quotes.colValidity")}</th>
                  <th>{t("common.status")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const expired =
                    r.status === "DRAFT" &&
                    r.valid_until != null &&
                    r.valid_until.slice(0, 10) <
                      new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={r.id}>
                      <td className="muted" data-label={t("common.date")}>
                        {formatDateTime(r.created_at)}
                      </td>
                      <td data-label={t("fields.customer")}>
                        {r.customer_name ?? <span className="muted">—</span>}
                      </td>
                      <td className="muted" data-label={t("fields.depot")}>
                        {r.depot_name}
                      </td>
                      <td
                        className="num"
                        data-label={t("pages.receipts.colLines")}
                      >
                        {formatQty(r.line_count)}
                      </td>
                      <td
                        className="num"
                        style={{ fontWeight: 700 }}
                        data-label={t("common.total")}
                      >
                        {formatMoney(r.total_amount)}
                      </td>
                      <td
                        className="muted"
                        data-label={t("pages.quotes.colValidity")}
                      >
                        {r.valid_until ? formatDate(r.valid_until) : "—"}
                        {expired ? (
                          <>
                            {" "}
                            <Badge tone="danger">
                              {t("pages.quotes.badgeExpired")}
                            </Badge>
                          </>
                        ) : null}
                      </td>
                      <td data-label={t("common.status")}>
                        <Badge tone={STATUS_TONES[r.status]}>
                          {t(`pages.quotes.status.${r.status}`)}
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
        <QuoteCreateModal
          onClose={() => !busy && setCreating(false)}
          onCreated={() => {
            invalidateQueries("quotes:");
            setCreating(false);
          }}
        />
      ) : null}

      {detail ? (
        <QuoteDetailModal
          detail={detail}
          busy={busy}
          onClose={() => setDetail(null)}
          onCancel={() => cancel(detail.id)}
          onConverted={() => {
            invalidateQueries("quotes:");
            setDetail(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* =============================== Création ================================= */
function QuoteCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [depotId, setDepotId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [note, setNote] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    {
      productId: "",
      variantId: null,
      variantName: null,
      unitId: "",
      quantity: "1",
      discountPct: "",
    },
  ]);

  /** C3 — ligne alimentée au scan (alias/carton/variante résolus). */
  const addScanned = (r: BarcodeLookupResult) => {
    setLines((prev) => {
      const draft: LineDraft = {
        productId: r.productId,
        variantId: r.variantId,
        variantName: r.variantName,
        unitId: r.unitId ?? "",
        quantity: "1",
        discountPct: "",
      };
      const free = prev.findIndex((l) => !l.productId);
      if (free >= 0) return prev.map((l, j) => (j === free ? draft : l));
      return [...prev, draft];
    });
    if (r.unitFactor !== 1)
      show(
        t("pages.quotes.scanPackaging", {
          symbol: r.unitSymbol,
          factor: r.unitFactor,
        }),
        "info",
      );
  };

  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const customers = useQuery<Paged<Customer>>(
    "customers:all",
    "/customers?size=200",
  );
  const products = useQuery<Paged<ProductListItem>>(
    "products:short",
    "/products?size=200&activeOnly=true",
  );
  const units = useQuery<Unit[]>("units:list", "/units");

  const effectiveDepot = depotId || (depots.data?.[0]?.id ?? "");
  const ready =
    effectiveDepot !== "" &&
    lines.length > 0 &&
    lines.every((l) => l.productId && Number(l.quantity) > 0);

  const preview = useMemo(() => {
    // Estimation indicative — le serveur reste l'autorité du prix figé.
    let total = 0;
    for (const l of lines) {
      const p = products.data?.data.find((x) => x.id === l.productId);
      if (!p) continue;
      const u = units.data?.find((x) => x.id === l.unitId);
      const factor = u ? u.base_value / (p.unit_base_value ?? 1) : 1;
      const disc = Math.min(Math.max(Number(l.discountPct) || 0, 0), 100);
      total +=
        (Number(l.quantity) || 0) * p.selling_price * factor * (1 - disc / 100);
    }
    return Math.round(total * 100) / 100;
  }, [lines, products.data, units.data]);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setBusy(true);
    try {
      await post("/quotes", {
        depotId: effectiveDepot,
        customerId: customerId || null,
        note: note.trim() || null,
        validUntil: validUntil || null,
        items: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId || null,
          unitId: l.unitId || null,
          quantity: Number(l.quantity),
          discountPct: Number(l.discountPct) || 0,
        })),
      });
      show(t("pages.quotes.createdToast"), "success");
      onCreated();
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.quotes.createError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("pages.quotes.createTitle")}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={save} disabled={!ready}>
            {t("pages.quotes.createSubmit")}
          </Button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label={t("pages.quotes.depotField")} required>
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
        <Field label={t("pages.quotes.customerField")}>
          <Select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">{t("pages.quotes.noCustomer")}</option>
            {(customers.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("pages.quotes.validUntilField")}>
          <Input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </Field>
      </div>

      <h3 style={{ margin: "12px 0 6px" }}>{t("pages.receipts.colLines")}</h3>
      <div style={{ marginBottom: 8 }}>
        <ScanField
          onResolve={addScanned}
          placeholder={t("pages.quotes.scanPlaceholder")}
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
          <div style={{ flex: 2, minWidth: 180 }}>
            <Field label={i === 0 ? t("fields.product") : ""}>
              <Select
                value={l.productId}
                onChange={(e) =>
                  setLine(i, {
                    productId: e.target.value,
                    variantId: null,
                    variantName: null,
                  })
                }
              >
                <option value="">{t("common.choose")}</option>
                {(products.data?.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatMoney(p.selling_price)}
                  </option>
                ))}
              </Select>
              {l.variantName ? (
                <span
                  className="muted"
                  style={{ fontSize: 12, marginTop: 2, display: "block" }}
                >
                  {t("pages.quotes.variantInfo", { name: l.variantName })}
                </span>
              ) : null}
            </Field>
          </div>
          <Field label={i === 0 ? t("pages.quotes.colUnit") : ""}>
            <Select
              value={l.unitId}
              onChange={(e) => setLine(i, { unitId: e.target.value })}
            >
              <option value="">{t("pages.quotes.defaultUnit")}</option>
              {(units.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.symbol}
                  {u.base_value !== 1 ? ` ×${u.base_value}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={i === 0 ? t("pages.quotes.colQty") : ""}>
            <Input
              style={{ width: 80 }}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => setLine(i, { quantity: e.target.value })}
            />
          </Field>
          <Field label={i === 0 ? t("pages.quotes.colDiscountPct") : ""}>
            <Input
              style={{ width: 70 }}
              inputMode="decimal"
              value={l.discountPct}
              onChange={(e) => setLine(i, { discountPct: e.target.value })}
            />
          </Field>
          <Button
            variant="ghost"
            size="sm"
            title={t("pages.quotes.removeLineTitle")}
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
              { productId: "", unitId: "", quantity: "1", discountPct: "" },
            ])
          }
        >
          {t("pages.quotes.addLine")}
        </Button>
        <strong>≈ {formatMoney(preview)}</strong>
      </div>

      <div style={{ marginTop: 10 }}>
        <Field label={t("pages.quotes.noteField")}>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("pages.quotes.notePlaceholder")}
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ================================ Détail ================================== */
function QuoteDetailModal({
  detail,
  busy,
  onClose,
  onCancel,
  onConverted,
}: {
  detail: QuoteDetail;
  busy: boolean;
  onClose: () => void;
  onCancel: () => void;
  onConverted: () => void;
}) {
  const { t } = useTranslation();
  const { show } = useToast();
  const [mode, setMode] = useState<"PAID" | "DEPOSIT" | "CREDIT">("PAID");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("CASH");
  const [deposit, setDeposit] = useState("");
  const [dueDate, setDueDate] = useState("");
  const creditBlocked = mode !== "PAID" && !detail.customer_id;

  const convert = async () => {
    if (creditBlocked) return;
    try {
      const body: Record<string, unknown> = {
        paymentMethod: payMethod,
        clientSaleId:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : undefined,
      };
      if (mode === "CREDIT") {
        body.payments = [];
        if (dueDate) body.dueDate = dueDate;
      } else if (mode === "DEPOSIT") {
        body.payments = [{ method: payMethod, amount: Number(deposit) }];
        if (dueDate) body.dueDate = dueDate;
      }
      await post(`/quotes/${detail.id}/convert`, body);
      show(t("pages.quotes.convertToast"), "success");
      onConverted();
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.quotes.convertError"),
        "error",
      );
    }
  };

  return (
    <Modal
      title={t("pages.quotes.detailTitle", {
        status: t(`pages.quotes.status.${detail.status}`),
      })}
      onClose={onClose}
      wide
      footer={
        detail.status === "DRAFT" ? (
          <>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {t("common.close")}
            </Button>
            <Button variant="danger" onClick={onCancel} loading={busy}>
              {t("pages.quotes.cancelButton")}
            </Button>
            <Button
              onClick={convert}
              disabled={
                creditBlocked || (mode === "DEPOSIT" && !(Number(deposit) > 0))
              }
            >
              {t("pages.quotes.convertButton")}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        )
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {formatDateTime(detail.created_at)} · {detail.depot_name} ·{" "}
        {t("pages.quotes.byName", { name: detail.created_by_name ?? "—" })}
        {detail.customer_name
          ? t("pages.quotes.customerSuffix", { name: detail.customer_name })
          : ""}
        {detail.valid_until
          ? t("pages.quotes.validSuffix", {
              date: formatDate(detail.valid_until),
            })
          : ""}
        {detail.converted_sale_id ? t("pages.quotes.linkedSaleSuffix") : ""}
      </p>

      <div className="table-wrap table-cards">
        <table>
          <thead>
            <tr>
              <th>{t("fields.product")}</th>
              <th className="num">{t("pages.quotes.colQty")}</th>
              <th className="num">{t("pages.quotes.colFrozenUnitPrice")}</th>
              <th className="num">{t("common.total")}</th>
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
                <td className="num" data-label={t("pages.quotes.colQty")}>
                  {formatQty(it.quantity)} {it.unit_symbol ?? ""}
                </td>
                <td
                  className="num"
                  data-label={t("pages.quotes.colFrozenUnitPrice")}
                >
                  {formatMoney(it.unit_price)}
                </td>
                <td
                  className="num"
                  style={{ fontWeight: 700 }}
                  data-label="Total"
                >
                  {formatMoney(it.total_price)}
                </td>
              </tr>
            ))}
            <tr>
              <td
                colSpan={3}
                style={{ fontWeight: 700 }}
                data-label={t("common.total")}
              >
                TOTAL
              </td>
              <td
                className="num"
                style={{ fontWeight: 800, fontSize: "1.05rem" }}
                data-label={t("common.amount")}
              >
                {formatMoney(detail.total_amount)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {detail.note ? <p className="muted">🗒️ {detail.note}</p> : null}

      {detail.status === "DRAFT" ? (
        <div style={{ marginTop: 12 }}>
          <Card className="filters">
            <h4 style={{ margin: "0 0 8px" }}>
              {t("pages.quotes.convertTitle")}
            </h4>
            <div
              className="row"
              style={{ flexWrap: "wrap", alignItems: "flex-end" }}
            >
              <Field label={t("pages.quotes.paymentField")}>
                <Select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="PAID">{t("pages.quotes.modePaid")}</option>
                  <option value="DEPOSIT">
                    {t("pages.quotes.modeDeposit")}
                  </option>
                  <option value="CREDIT">{t("pages.quotes.modeCredit")}</option>
                </Select>
              </Field>
              <Field label={t("pages.customers.colMode")}>
                <Select
                  value={payMethod}
                  onChange={(e) =>
                    setPayMethod(e.target.value as PaymentMethod)
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
              {mode === "DEPOSIT" ? (
                <Field label={t("pages.quotes.depositField")}>
                  <Input
                    inputMode="decimal"
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                  />
                </Field>
              ) : null}
              {mode !== "PAID" ? (
                <Field label={t("pages.customers.colDueDate")}>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </Field>
              ) : null}
            </div>
            {creditBlocked ? (
              <p
                style={{
                  color: "var(--danger)",
                  fontWeight: 600,
                  margin: "4px 0 0",
                }}
              >
                {t("pages.quotes.creditBlockedWarning")}
              </p>
            ) : null}
          </Card>
        </div>
      ) : null}
    </Modal>
  );
}
