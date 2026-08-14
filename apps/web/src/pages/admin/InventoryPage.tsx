/** Inventaire physique professionnel (E5) :
 *  - Campagnes à cycle complet (brouillon → comptage → revue → validation
 *    par un NON-compteur), théorique et CUMP figés au lancement, comptage
 *    aveugle optionnel, gel des mouvements optionnel ;
 *  - ajustement rapide unitaire (motif codifié + texte) ;
 *  - échéancier d'inventaire tournant ABC. */
import { useState } from "react";
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
import { get, post, put } from "../../lib/http";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatQty,
  stockStatusLabel,
} from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import { ScanField } from "../../components/ScanField";
import type { BarcodeLookupResult } from "../../lib/scanLookup";
import type {
  AbcScheduleRow,
  CampaignDetail,
  CampaignListItem,
  CampaignScope,
  CampaignStatus,
  Depot,
  Paged,
  ProductListItem,
} from "../../lib/types";

const CAMPAIGN_STATUS: Record<
  CampaignStatus,
  { label: string; tone: "muted" | "info" | "warn" | "ok" | "danger" }
> = {
  DRAFT: { label: "Brouillon", tone: "muted" },
  COUNTING: { label: "Comptage en cours", tone: "warn" },
  REVIEW: { label: "En revue", tone: "info" },
  CLOSED: { label: "Clôturée", tone: "ok" },
  CANCELLED: { label: "Annulée", tone: "danger" },
};

const SCOPE_LABEL: Record<CampaignScope, string> = {
  ALL: "Catalogue entier",
  SELECTION: "Sélection de produits",
  ABC_A: "Tournant — classe A",
  ABC_B: "Tournant — classe B",
  ABC_C: "Tournant — classe C",
};

/** Motifs codifiés d'écart (partagés campagnes + ajustement rapide). */
const COUNT_REASONS: Array<{ id: string; label: string }> = [
  { id: "MISCOUNT", label: "Erreur de comptage antérieure" },
  { id: "BREAKAGE", label: "Casse / détérioration" },
  { id: "THEFT", label: "Vol / disparition" },
  { id: "EXPIRY", label: "Péremption" },
  { id: "SUPPLIER_ERROR", label: "Erreur fournisseur (sous-livraison)" },
  { id: "DATA_ERROR", label: "Erreur de saisie informatique" },
  { id: "OTHER", label: "Autre" },
];

export default function InventoryPage() {
  const [tab, setTab] = useState<"campagnes" | "ajustement" | "abc">(
    "campagnes",
  );
  return (
    <div className="wrap">
      <PageHeader
        title="Inventaire physique"
        sub="Campagnes de comptage contrôlées, ajustements justifiés et tournant ABC"
      />
      <div className="chips" style={{ marginBottom: 12 }}>
        {(
          [
            ["campagnes", "📋 Campagnes"],
            ["ajustement", "🔧 Ajustement rapide"],
            ["abc", "🗓️ Tournant ABC"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`chip ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "campagnes" ? <CampaignsTab /> : null}
      {tab === "ajustement" ? <QuickAdjustTab /> : null}
      {tab === "abc" ? <AbcTab /> : null}
    </div>
  );
}

/* ============================ ONGLET CAMPAGNES ============================ */
function CampaignsTab() {
  const { show } = useToast();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);

  const qs = new URLSearchParams({ page: String(page), size: "20" });
  if (status) qs.set("status", status);
  const path = `/inventory-campaigns?${qs}`;
  const q = useQuery<Paged<CampaignListItem>>(
    `inv-camp:${status}:${page}`,
    path,
  );

  const openDetail = async (id: string) => {
    try {
      setDetail(await get<CampaignDetail>(`/inventory-campaigns/${id}`));
    } catch (e) {
      show(e instanceof Error ? e.message : "Campagne introuvable", "error");
    }
  };
  const refresh = async (id: string) => {
    invalidateQueries("inv-camp:");
    try {
      setDetail(await get<CampaignDetail>(`/inventory-campaigns/${id}`));
    } catch {
      setDetail(null);
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
          <Kpi label="Campagnes" value={String(q.data?.total ?? 0)} />
        </div>
        <Button onClick={() => setCreating(true)}>➕ Nouvelle campagne</Button>
      </div>

      <Card className="filters">
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
            <option value="COUNTING">Comptages en cours</option>
            <option value="REVIEW">En revue</option>
            <option value="CLOSED">Clôturées</option>
            <option value="CANCELLED">Annulées</option>
          </Select>
        </Field>
      </Card>

      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("inv-camp:")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📋"
          title="Aucune campagne"
          action={
            <Button onClick={() => setCreating(true)}>
              Lancer la première
            </Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Créée le</th>
                  <th>Dépôt</th>
                  <th>Périmètre</th>
                  <th>Options</th>
                  <th className="num">Comptées</th>
                  <th>Statut</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{formatDate(r.created_at)}</td>
                    <td style={{ fontWeight: 600 }}>{r.depot_name}</td>
                    <td className="muted">{SCOPE_LABEL[r.scope]}</td>
                    <td>
                      {r.blind ? <Badge tone="info">Aveugle</Badge> : null}{" "}
                      {r.freeze_stock ? <Badge tone="warn">Gelée</Badge> : null}
                    </td>
                    <td className="num">
                      {r.line_count != null
                        ? `${r.counted ?? 0} / ${r.line_count}`
                        : "—"}
                    </td>
                    <td>
                      <Badge tone={CAMPAIGN_STATUS[r.status].tone}>
                        {CAMPAIGN_STATUS[r.status].label}
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
        <CampaignCreateModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            invalidateQueries("inv-camp:");
            setCreating(false);
            void openDetail(id);
          }}
        />
      ) : null}

      {detail ? (
        <CampaignDetailModal
          detail={detail}
          onClose={() => setDetail(null)}
          onChanged={() => refresh(detail.id)}
        />
      ) : null}
    </>
  );
}

/* --------------------------- Création campagne --------------------------- */
function CampaignCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [depotId, setDepotId] = useState("");
  const [scope, setScope] = useState<CampaignScope>("ALL");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [blind, setBlind] = useState(false);
  const [freezeStock, setFreezeStock] = useState(false);
  const [note, setNote] = useState("");

  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const products = useQuery<Paged<ProductListItem>>(
    "products:po",
    "/products?size=200&includeArchived=false",
  );
  const effectiveDepot = depotId || (depots.data?.[0]?.id ?? "");
  const ready =
    effectiveDepot !== "" && (scope !== "SELECTION" || productIds.length > 0);

  const save = async () => {
    setBusy(true);
    try {
      const c = await post<{ id: string }>("/inventory-campaigns", {
        depotId: effectiveDepot,
        scope,
        productIds: scope === "SELECTION" ? productIds : undefined,
        blind,
        freezeStock,
        note: note.trim() || null,
      });
      show(
        "Campagne créée (brouillon) — lancez le comptage quand l'équipe est prête.",
        "success",
      );
      onCreated(c.id);
    } catch (e) {
      show(e instanceof Error ? e.message : "Création impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="📋 Nouvelle campagne d'inventaire"
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
        <Field label="Périmètre" required>
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value as CampaignScope)}
          >
            <option value="ALL">Catalogue entier</option>
            <option value="ABC_A">Tournant — classe A (top 80 %)</option>
            <option value="ABC_B">Tournant — classe B</option>
            <option value="ABC_C">Tournant — classe C</option>
            <option value="SELECTION">Sélection manuelle</option>
          </Select>
        </Field>
      </div>

      {scope === "SELECTION" ? (
        <Field label={`Produits retenus (${productIds.length})`} required>
          <div
            style={{
              maxHeight: 180,
              overflow: "auto",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: 8,
            }}
          >
            {(products.data?.data ?? []).map((p) => (
              <label
                key={p.id}
                className="row"
                style={{ gap: 6, padding: "3px 0", cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={productIds.includes(p.id)}
                  onChange={(e) =>
                    setProductIds((prev) =>
                      e.target.checked
                        ? [...prev, p.id]
                        : prev.filter((x) => x !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        </Field>
      ) : null}

      <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
        <label className="row" style={{ gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={blind}
            onChange={(e) => setBlind(e.target.checked)}
          />
          <span>
            👁️‍🗨️ <strong>Comptage aveugle</strong>
            <span
              className="muted"
              style={{ display: "block", fontSize: "0.8rem" }}
            >
              Le stock théorique est masqué aux compteurs jusqu'à la revue.
            </span>
          </span>
        </label>
        <label className="row" style={{ gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={freezeStock}
            onChange={(e) => setFreezeStock(e.target.checked)}
          />
          <span>
            🧊 <strong>Geler les mouvements du dépôt</strong>
            <span
              className="muted"
              style={{ display: "block", fontSize: "0.8rem" }}
            >
              Ventes, réceptions et transferts bloqués pendant le comptage.
            </span>
          </span>
        </label>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Note interne">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contexte, consignes…"
          />
        </Field>
      </div>
    </Modal>
  );
}

/* --------------------------- Détail campagne ----------------------------- */
function CampaignDetailModal({
  detail,
  onClose,
  onChanged,
}: {
  detail: CampaignDetail;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const counting = detail.status === "COUNTING";

  const act = async (action: string, body?: Record<string, unknown>) => {
    setBusy(true);
    try {
      await post(`/inventory-campaigns/${detail.id}/${action}`, body ?? {});
      await onChanged();
    } catch (e) {
      show(e instanceof Error ? e.message : "Action refusée", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveCount = async () => {
    // N'envoie que les lignes modifiées (ou nouvellement saisies)
    const lines = detail.items
      .map((it) => {
        const raw = counts[it.product_id];
        if (raw === undefined || raw === "") return null;
        return {
          productId: it.product_id,
          countedQty: Number(raw.replace(",", ".")),
          reason: reasons[it.product_id] || null,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l != null);
    if (lines.length === 0) {
      show("Aucune saisie à enregistrer.", "info");
      return;
    }
    setBusy(true);
    try {
      await put(`/inventory-campaigns/${detail.id}/counts`, { lines });
      show(`${lines.length} ligne(s) de comptage enregistrée(s).`, "success");
      setCounts({});
      setReasons({});
      await onChanged();
    } catch (e) {
      show(e instanceof Error ? e.message : "Saisie refusée", "error");
    } finally {
      setBusy(false);
    }
  };

  const dirtyCount = Object.values(counts).filter((v) => v !== "").length;
  const showTheoretical = !detail.blind_masked;

  return (
    <Modal
      title={`📋 Campagne — ${CAMPAIGN_STATUS[detail.status].label}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Fermer
          </Button>
          {detail.status === "DRAFT" ? (
            <Button loading={busy} onClick={() => act("start")}>
              ▶️ Lancer le comptage
            </Button>
          ) : null}
          {counting ? (
            <>
              <Button
                variant="outline"
                loading={busy}
                disabled={dirtyCount === 0}
                onClick={saveCount}
              >
                💾 Enregistrer {dirtyCount > 0 ? `(${dirtyCount})` : ""}
              </Button>
              <Button loading={busy} onClick={() => act("review")}>
                🔍 Passer en revue
              </Button>
            </>
          ) : null}
          {detail.status === "REVIEW" ? (
            <Button loading={busy} onClick={() => act("validate")}>
              ✅ Valider (non-compteur)
            </Button>
          ) : null}
          {detail.status === "DRAFT" ||
          counting ||
          detail.status === "REVIEW" ? (
            <Button
              variant="danger"
              loading={busy}
              onClick={() => act("cancel")}
            >
              Abandonner
            </Button>
          ) : null}
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {detail.depot_name} · {SCOPE_LABEL[detail.scope]} · créée le{" "}
        {formatDateTime(detail.created_at)} par {detail.created_by_name ?? "—"}
        {detail.started_at
          ? ` · lancée le ${formatDateTime(detail.started_at)}`
          : ""}
        {detail.validated_by_name
          ? ` · validée par ${detail.validated_by_name}`
          : ""}
      </p>
      <div
        className="row"
        style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }}
      >
        {detail.blind ? <Badge tone="info">Comptage aveugle</Badge> : null}
        {detail.freeze_stock ? (
          <Badge tone="warn">Mouvements gelés</Badge>
        ) : null}
        {detail.blind_masked ? (
          <Badge tone="warn">Théorique masqué jusqu'à la revue</Badge>
        ) : null}
      </div>

      <div className="grid kpis" style={{ marginBottom: 10 }}>
        <Kpi
          label="Lignes"
          value={`${detail.totals.counted} / ${detail.totals.lines}`}
        />
        <Kpi
          label="Écarts"
          value={String(detail.totals.discrepancies)}
          tone={detail.totals.discrepancies > 0 ? "warn" : "ok"}
        />
        <Kpi
          label="Surstock (CUMP)"
          value={formatMoney(detail.totals.valueUp)}
          tone={detail.totals.valueUp > 0 ? "warn" : "ok"}
        />
        <Kpi
          label="Manquant (CUMP)"
          value={formatMoney(detail.totals.valueDown)}
          tone={detail.totals.valueDown > 0 ? "danger" : "ok"}
        />
      </div>

      {counting ? (
        /* C3 — comptage au scan : chaque code lu CUMULE la quantité comptée
           de la ligne (×facteur du conditionnement scanné). */
        <ScanField
          onResolve={(r: BarcodeLookupResult) => {
            const item = detail.items.find(
              (it) => it.product_id === r.productId,
            );
            if (!item) {
              show(
                `« ${r.productName} » n'est pas dans le périmètre de cette campagne.`,
                "error",
              );
              return;
            }
            const bump = r.unitFactor !== 1 ? r.unitFactor : 1;
            const rawCur = counts[item.product_id];
            const cur =
              rawCur !== undefined
                ? Number(rawCur.replace(",", ".")) || 0
                : (item.counted_qty ?? 0);
            setCounts({ ...counts, [item.product_id]: String(cur + bump) });
          }}
          placeholder="Scannez les articles comptés (cumul automatique)…"
        />
      ) : null}
      <div className="table-wrap" style={{ maxHeight: 420, overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th className="num">Théorique</th>
              <th className="num">Compté</th>
              {showTheoretical ? <th className="num">Écart</th> : null}
              {showTheoretical ? <th className="num">Valeur</th> : null}
              <th>Motif</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((it) => {
              const pending = counts[it.product_id];
              const countedStr =
                pending !== undefined
                  ? pending
                  : it.counted_qty != null
                    ? String(it.counted_qty)
                    : "";
              const counted =
                countedStr === "" ? null : Number(countedStr.replace(",", "."));
              const liveVariance =
                counted != null && it.theoretical_qty != null
                  ? Math.round((counted - it.theoretical_qty) * 100) / 100
                  : (it.variance_qty ?? null);
              return (
                <tr key={it.product_id}>
                  <td style={{ fontWeight: 600 }}>{it.product_name}</td>
                  <td className="num">
                    {it.theoretical_qty != null
                      ? formatQty(it.theoretical_qty)
                      : "❓"}
                  </td>
                  <td className="num">
                    {counting ? (
                      <Input
                        style={{ width: 90, padding: "4px 6px" }}
                        inputMode="decimal"
                        value={countedStr}
                        onChange={(e) =>
                          setCounts({
                            ...counts,
                            [it.product_id]: e.target.value,
                          })
                        }
                        aria-label={`Compté ${it.product_name}`}
                      />
                    ) : it.counted_qty != null ? (
                      formatQty(it.counted_qty)
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  {showTheoretical ? (
                    <td
                      className="num"
                      style={{
                        fontWeight: 700,
                        color:
                          liveVariance == null
                            ? undefined
                            : liveVariance > 0
                              ? "var(--ok)"
                              : liveVariance < 0
                                ? "var(--danger)"
                                : undefined,
                      }}
                    >
                      {liveVariance != null
                        ? `${liveVariance > 0 ? "+" : ""}${formatQty(liveVariance)}`
                        : "—"}
                    </td>
                  ) : null}
                  {showTheoretical ? (
                    <td className="num muted">
                      {it.variance_value != null
                        ? formatMoney(it.variance_value)
                        : "—"}
                    </td>
                  ) : null}
                  <td>
                    {counting || detail.status === "REVIEW" ? (
                      <Select
                        value={reasons[it.product_id] ?? it.reason ?? ""}
                        disabled={!counting}
                        onChange={(e) =>
                          setReasons({
                            ...reasons,
                            [it.product_id]: e.target.value,
                          })
                        }
                        aria-label={`Motif ${it.product_name}`}
                      >
                        <option value="">
                          {liveVariance != null && Math.abs(liveVariance) > 1e-9
                            ? "— motif REQUIS —"
                            : "—"}
                        </option>
                        {COUNT_REASONS.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="muted">
                        {it.reason
                          ? (COUNT_REASONS.find((r) => r.id === it.reason)
                              ?.label ?? it.reason)
                          : "—"}
                        {it.applied ? " ✓" : ""}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {counting ? (
        <p className="hint" style={{ marginTop: 8 }}>
          💡 « Enregistrer » consolide les saisies (reprentable à tout moment) ;
          « Passer en revue » exige un comptage complet et un motif codifié sur
          chaque écart. La validation finale doit être faite par un autre
          utilisateur que le compteur.
        </p>
      ) : null}
      {detail.note ? <p className="muted">🗒️ {detail.note}</p> : null}
    </Modal>
  );
}

/* ========================= ONGLET AJUSTEMENT RAPIDE ======================= */
function QuickAdjustTab() {
  const { show } = useToast();
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const [depotId, setDepotId] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ProductListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  const [selected, setSelected] = useState<ProductListItem | null>(null);
  const [type, setType] = useState<"ADJUSTMENT" | "DAMAGE" | "EXPIRED">(
    "ADJUSTMENT",
  );
  const [mode, setMode] = useState<"count" | "delta">("count");
  const [value, setValue] = useState("");
  const [reasonCode, setReasonCode] = useState("MISCOUNT");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoadingList(true);
    try {
      const p = new URLSearchParams({ size: "50" });
      if (search) p.set("search", search);
      if (depotId) p.set("depotId", depotId);
      const res = await get<Paged<ProductListItem>>(`/products?${p}`);
      setRows(res.data.filter((r) => !r.archived_at));
    } catch (e) {
      show(e instanceof Error ? e.message : "Chargement impossible", "error");
    } finally {
      setLoadingList(false);
    }
  };

  const qty = (r: ProductListItem) => (depotId ? r.depot_qty : r.total_qty);

  const submit = async () => {
    if (!selected) return;
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n)) {
      show("Quantité invalide.", "error");
      return;
    }
    if (reason.trim().length < 3) {
      show("Un motif détaillé est obligatoire (min. 3 caractères).", "error");
      return;
    }
    setBusy(true);
    try {
      const body = {
        productId: selected.id,
        depotId: depotId || undefined,
        type,
        reasonCode: reasonCode || undefined,
        reason: reason.trim(),
        ...(mode === "count" ? { newQuantity: Math.max(0, n) } : { delta: n }),
      };
      const res = await post<{ previous: number; next: number; delta: number }>(
        "/stock/adjust",
        body,
      );
      show(
        `Stock de « ${selected.name} » : ${res.previous} → ${res.next} (${res.delta >= 0 ? "+" : ""}${res.delta}).`,
        "success",
      );
      setSelected(null);
      setValue("");
      setReason("");
      void load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Ajustement impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label="Dépôt (recommandé)">
            <Select
              value={depotId}
              onChange={(e) => setDepotId(e.target.value)}
            >
              <option value="">Tous dépôts (stock global)</option>
              {(depots.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Produit">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nom ou code-barres…"
            />
          </Field>
          <Button onClick={load} loading={loadingList}>
            Charger la feuille de comptage
          </Button>
        </div>
      </Card>

      {selected ? (
        <Card title={`Ajuster — ${selected.name}`}>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Type d'écart" required>
              <Select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                <option value="ADJUSTMENT">
                  Inventaire (écart de comptage)
                </option>
                <option value="DAMAGE">Casse / détérioration</option>
                <option value="EXPIRED">
                  Péremption (purge des lots expirés)
                </option>
              </Select>
            </Field>
            <Field label="Mode de saisie">
              <Select
                value={mode}
                onChange={(e) => setMode(e.target.value as "count" | "delta")}
              >
                <option value="count">Quantité comptée (valeur absolue)</option>
                <option value="delta">Écart (+/−)</option>
              </Select>
            </Field>
            <Field
              label={
                mode === "count"
                  ? "Quantité réellement comptée"
                  : "Écart (− pour une perte)"
              }
              required
            >
              <Input
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            </Field>
            <Field
              label={`Stock théorique ${depotId ? "(dépôt)" : "(global)"}`}
            >
              <div style={{ padding: "10px 0", fontWeight: 800 }}>
                {formatQty(qty(selected))} {selected.unit_symbol ?? ""}
              </div>
            </Field>
          </div>
          <Field
            label="Motif codifié"
            required
            hint="Code d'analyse des écarts (statistiques)"
          >
            <Select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            >
              {COUNT_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Motif détaillé" required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex. Inventaire physique du 02/08, casse pendant la livraison…"
            />
          </Field>
          <div className="row">
            <Button loading={busy} onClick={submit}>
              ✅ Valider l'ajustement
            </Button>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Fermer
            </Button>
          </div>
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th className="num">
                    Stock {depotId ? "(dépôt)" : "(global)"}
                  </th>
                  <th>Statut</th>
                  <th aria-label="Ajuster" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td className="num">{formatQty(qty(r))}</td>
                    <td>
                      <Badge
                        tone={
                          r.stock_status === "out"
                            ? "danger"
                            : r.stock_status === "low"
                              ? "warn"
                              : "ok"
                        }
                      >
                        {stockStatusLabel(r.stock_status)}
                      </Badge>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelected(r)}
                      >
                        Ajuster
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : !loadingList ? (
        <EmptyState emoji="🔧" title="Chargez la feuille de comptage">
          Choisissez un dépôt (recommandé) et lancez la recherche : chaque
          ajustement sera tracé avec son motif codifié et son détail.
        </EmptyState>
      ) : null}
    </>
  );
}

/* ============================ ONGLET TOURNANT ABC ========================= */
function AbcTab() {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const [depotId, setDepotId] = useState("");
  const q = useQuery<AbcScheduleRow[]>(
    "inv-abc:",
    "/inventory-campaigns/abc-schedule",
  );

  const launch = async (scope: AbcScheduleRow["scope"]) => {
    const depot = depotId || depots.data?.[0]?.id;
    if (!depot) {
      show("Aucun dépôt disponible.", "error");
      return;
    }
    setBusy(true);
    try {
      const c = await post<{ id: string }>("/inventory-campaigns", {
        depotId: depot,
        scope,
      });
      await post(`/inventory-campaigns/${c.id}/start`, {});
      show(
        `Campagne ${scope} lancée — feuille de comptage prête (onglet Campagnes).`,
        "success",
      );
      invalidateQueries("inv-abc:");
      invalidateQueries("inv-camp:");
    } catch (e) {
      show(e instanceof Error ? e.message : "Lancement impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  const rows = q.data ?? [];
  return (
    <>
      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label="Dépôt pour la prochaine campagne">
            <Select
              value={depotId}
              onChange={(e) => setDepotId(e.target.value)}
            >
              {(depots.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("inv-abc:")}
        />
      ) : (
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {rows.map((r) => (
            <Card
              key={r.scope}
              title={`${r.scope === "ABC_A" ? "🥇" : r.scope === "ABC_B" ? "🥈" : "🥉"} Classe ${r.class_label}`}
              actions={
                <Badge tone={r.overdue ? "danger" : "ok"}>
                  {r.overdue ? "À faire" : "À jour"}
                </Badge>
              }
            >
              <p className="muted" style={{ marginTop: 0 }}>
                {r.product_count} produit(s) · fréquence : tous les{" "}
                {r.frequency_days} jours
              </p>
              <p>
                Dernier comptage :{" "}
                {r.last_count_at ? formatDate(r.last_count_at) : "jamais"}
                {r.due_at ? (
                  <>
                    {" "}
                    · prochain : <strong>{formatDate(r.due_at)}</strong>
                  </>
                ) : null}
              </p>
              <Button
                variant="outline"
                size="sm"
                loading={busy}
                onClick={() => launch(r.scope)}
              >
                ▶️ Lancer {r.scope}
              </Button>
            </Card>
          ))}
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>
        🗓️ Inventaire tournant : la classe A (80 % du volume vendu sur 90 j) se
        compte chaque mois, B chaque trimestre, C une fois par an — les écarts
        se concentrent là où la valeur circule.
      </p>
    </>
  );
}
