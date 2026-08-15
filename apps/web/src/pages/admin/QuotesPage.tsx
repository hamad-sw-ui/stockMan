/** Devis / proforma (E3) : offre au prix figé serveur, conversion en vente
 *  au prix du devis (jamais repricée), annulation, suivi des brouillons. */
import { useMemo, useState } from "react";
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

const STATUS: Record<
  QuoteListItem["status"],
  { label: string; tone: "info" | "ok" | "muted" }
> = {
  DRAFT: { label: "Brouillon", tone: "info" },
  CONVERTED: { label: "Converti", tone: "ok" },
  CANCELLED: { label: "Annulé", tone: "muted" },
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
      show(e instanceof Error ? e.message : "Devis introuvable", "error");
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await post(`/quotes/${id}/cancel`, {});
      show("Devis annulé.", "success");
      invalidateQueries("quotes:");
      setDetail(null);
    } catch (e) {
      show(e instanceof Error ? e.message : "Annulation impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title="Devis & proforma"
        sub="Offres au prix figé, convertibles en vente sans repricing"
        actions={
          <Button onClick={() => setCreating(true)}>➕ Nouveau devis</Button>
        }
      />

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
              <option value="CONVERTED">Convertis</option>
              <option value="CANCELLED">Annulés</option>
            </Select>
          </Field>
        </div>
      </Card>

      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("quotes:")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📝"
          title={status ? "Aucun devis dans ce statut" : "Aucun devis"}
          action={
            <Button onClick={() => setCreating(true)}>Créer le premier</Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Dépôt</th>
                  <th className="num">Lignes</th>
                  <th className="num">Total</th>
                  <th>Validité</th>
                  <th>Statut</th>
                  <th aria-label="Actions" />
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
                      <td className="muted" data-label="Date">
                        {formatDateTime(r.created_at)}
                      </td>
                      <td data-label="Client">
                        {r.customer_name ?? <span className="muted">—</span>}
                      </td>
                      <td className="muted" data-label="Dépôt">
                        {r.depot_name}
                      </td>
                      <td className="num" data-label="Lignes">
                        {formatQty(r.line_count)}
                      </td>
                      <td
                        className="num"
                        style={{ fontWeight: 700 }}
                        data-label="Total"
                      >
                        {formatMoney(r.total_amount)}
                      </td>
                      <td className="muted" data-label="Validité">
                        {r.valid_until ? formatDate(r.valid_until) : "—"}
                        {expired ? (
                          <>
                            {" "}
                            <Badge tone="danger">Expiré</Badge>
                          </>
                        ) : null}
                      </td>
                      <td data-label="Statut">
                        <Badge tone={STATUS[r.status].tone}>
                          {STATUS[r.status].label}
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
        `Conditionnement « ${r.unitSymbol} » appliqué (×${r.unitFactor}).`,
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
      show("Devis créé (prix figés).", "success");
      onCreated();
    } catch (e) {
      show(e instanceof Error ? e.message : "Création impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="📝 Nouveau devis"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button loading={busy} onClick={save} disabled={!ready}>
            Enregistrer le devis
          </Button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label="Dépôt de facturation" required>
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
        <Field label="Client (optionnel)">
          <Select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">— Sans client —</option>
            {(customers.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Valide jusqu'au">
          <Input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </Field>
      </div>

      <h3 style={{ margin: "12px 0 6px" }}>Lignes</h3>
      <div style={{ marginBottom: 8 }}>
        <ScanField
          onResolve={addScanned}
          placeholder="Scanner un article (alias/carton inclus)…"
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
            <Field label={i === 0 ? "Produit" : ""}>
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
                <option value="">Choisir…</option>
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
                  ↳ variante : {l.variantName}
                </span>
              ) : null}
            </Field>
          </div>
          <Field label={i === 0 ? "Unité" : ""}>
            <Select
              value={l.unitId}
              onChange={(e) => setLine(i, { unitId: e.target.value })}
            >
              <option value="">Catalogue</option>
              {(units.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.symbol}
                  {u.base_value !== 1 ? ` ×${u.base_value}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={i === 0 ? "Qté" : ""}>
            <Input
              style={{ width: 80 }}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => setLine(i, { quantity: e.target.value })}
            />
          </Field>
          <Field label={i === 0 ? "Remise %" : ""}>
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
            title="Retirer la ligne"
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
          ➕ Ajouter une ligne
        </Button>
        <strong>≈ {formatMoney(preview)}</strong>
      </div>

      <div style={{ marginTop: 10 }}>
        <Field label="Note (affichée sur le proforma)">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Conditions, livraison…"
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
      show("Devis converti en vente au prix figé.", "success");
      onConverted();
    } catch (e) {
      show(e instanceof Error ? e.message : "Conversion refusée", "error");
    }
  };

  return (
    <Modal
      title={`📝 Devis — ${STATUS[detail.status].label}`}
      onClose={onClose}
      wide
      footer={
        detail.status === "DRAFT" ? (
          <>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Fermer
            </Button>
            <Button variant="danger" onClick={onCancel} loading={busy}>
              Annuler le devis
            </Button>
            <Button
              onClick={convert}
              disabled={
                creditBlocked || (mode === "DEPOSIT" && !(Number(deposit) > 0))
              }
            >
              💳 Convertir en vente
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        )
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {formatDateTime(detail.created_at)} · {detail.depot_name} · par{" "}
        {detail.created_by_name ?? "—"}
        {detail.customer_name ? ` · Client : ${detail.customer_name}` : ""}
        {detail.valid_until
          ? ` · Valide jusqu'au ${formatDate(detail.valid_until)}`
          : ""}
        {detail.converted_sale_id ? " · Vente liée créée" : ""}
      </p>

      <div className="table-wrap table-cards">
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th className="num">Qté</th>
              <th className="num">PU figé</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((it) => (
              <tr key={it.id}>
                <td data-label="Produit">
                  {it.product_name}
                  {it.variant_name ? (
                    <span className="muted"> · {it.variant_name}</span>
                  ) : null}
                </td>
                <td className="num" data-label="Qté">
                  {formatQty(it.quantity)} {it.unit_symbol ?? ""}
                </td>
                <td className="num" data-label="PU figé">
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
              <td colSpan={3} style={{ fontWeight: 700 }} data-label="Total">
                TOTAL
              </td>
              <td
                className="num"
                style={{ fontWeight: 800, fontSize: "1.05rem" }}
                data-label="Montant"
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
            <h4 style={{ margin: "0 0 8px" }}>Conversion en vente</h4>
            <div
              className="row"
              style={{ flexWrap: "wrap", alignItems: "flex-end" }}
            >
              <Field label="Règlement">
                <Select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="PAID">Comptant intégral</option>
                  <option value="DEPOSIT">Acompte + solde plus tard</option>
                  <option value="CREDIT">100 % à crédit</option>
                </Select>
              </Field>
              <Field label="Mode">
                <Select
                  value={payMethod}
                  onChange={(e) =>
                    setPayMethod(e.target.value as PaymentMethod)
                  }
                >
                  <option value="CASH">💵 Espèces</option>
                  <option value="MTN_MOMO">🟡 MTN MoMo</option>
                  <option value="ORANGE_MONEY">🟠 Orange Money</option>
                </Select>
              </Field>
              {mode === "DEPOSIT" ? (
                <Field label="Acompte">
                  <Input
                    inputMode="decimal"
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                  />
                </Field>
              ) : null}
              {mode !== "PAID" ? (
                <Field label="Échéance">
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
                ⚠️ La vente à crédit exige un client rattaché au devis.
              </p>
            ) : null}
          </Card>
        </div>
      ) : null}
    </Modal>
  );
}
