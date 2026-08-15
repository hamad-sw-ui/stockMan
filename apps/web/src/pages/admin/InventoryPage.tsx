/** Inventaire physique professionnel (E5) :
 *  - Campagnes à cycle complet (brouillon → comptage → revue → validation
 *    par un NON-compteur), théorique et CUMP figés au lancement, comptage
 *    aveugle optionnel, gel des mouvements optionnel ;
 *  - ajustement rapide unitaire (motif codifié + texte) ;
 *  - échéancier d'inventaire tournant ABC. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
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

/** Tonalités de badge par statut (les libellés passent par i18n :
 *  clés « pages.inventory.status.* » — FR = source historique). */
const CAMPAIGN_TONES: Record<
  CampaignStatus,
  "muted" | "info" | "warn" | "ok" | "danger"
> = {
  DRAFT: "muted",
  COUNTING: "warn",
  REVIEW: "info",
  CLOSED: "ok",
  CANCELLED: "danger",
};

/** Motifs codifiés d'écart (ids stables API, libellés via i18n). */
const COUNT_REASON_IDS = [
  "MISCOUNT",
  "BREAKAGE",
  "THEFT",
  "EXPIRY",
  "SUPPLIER_ERROR",
  "DATA_ERROR",
  "OTHER",
] as const;

/** Libellé d'un motif codifié, avec repli sur l'id brut si inconnu. */
const countReasonLabel = (t: (k: string) => string, id: string): string =>
  (COUNT_REASON_IDS as readonly string[]).includes(id)
    ? t(`pages.inventory.reasons.${id}`)
    : id;

export default function InventoryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"campagnes" | "ajustement" | "abc">(
    "campagnes",
  );
  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.inventory.title")}
        sub={t("pages.inventory.sub")}
      />
      <div className="chips" style={{ marginBottom: 12 }}>
        {(
          [
            ["campagnes", t("pages.inventory.tabCampaigns")],
            ["ajustement", t("pages.inventory.tabQuickAdjust")],
            ["abc", t("pages.inventory.tabAbc")],
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
  const { t } = useTranslation();
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
      show(
        e instanceof Error ? e.message : t("pages.inventory.detailError"),
        "error",
      );
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
          <Kpi
            label={t("pages.inventory.kpiCampaigns")}
            value={String(q.data?.total ?? 0)}
          />
        </div>
        <Button onClick={() => setCreating(true)}>
          {t("pages.inventory.newCampaign")}
        </Button>
      </div>

      <Card className="filters">
        <Field label={t("common.status")}>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("common.all")}</option>
            <option value="DRAFT">{t("pages.inventory.filterDraft")}</option>
            <option value="COUNTING">
              {t("pages.inventory.filterCounting")}
            </option>
            <option value="REVIEW">{t("pages.inventory.filterReview")}</option>
            <option value="CLOSED">{t("pages.inventory.filterClosed")}</option>
            <option value="CANCELLED">
              {t("pages.inventory.filterCancelled")}
            </option>
          </Select>
        </Field>
      </Card>

      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("inv-camp:")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📋"
          title={t("pages.inventory.emptyCampaigns")}
          action={
            <Button onClick={() => setCreating(true)}>
              {t("pages.inventory.launchFirst")}
            </Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.inventory.colCreated")}</th>
                  <th>{t("fields.depot")}</th>
                  <th>{t("pages.inventory.colScope")}</th>
                  <th>{t("pages.inventory.colOptions")}</th>
                  <th className="num">{t("pages.inventory.colCounted")}</th>
                  <th>{t("common.status")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{formatDate(r.created_at)}</td>
                    <td style={{ fontWeight: 600 }}>{r.depot_name}</td>
                    <td className="muted">
                      {t(`pages.inventory.scope.${r.scope}`)}
                    </td>
                    <td>
                      {r.blind ? (
                        <Badge tone="info">
                          {t("pages.inventory.badgeBlind")}
                        </Badge>
                      ) : null}{" "}
                      {r.freeze_stock ? (
                        <Badge tone="warn">
                          {t("pages.inventory.badgeFrozen")}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="num">
                      {r.line_count != null
                        ? `${r.counted ?? 0} / ${r.line_count}`
                        : "—"}
                    </td>
                    <td>
                      <Badge tone={CAMPAIGN_TONES[r.status]}>
                        {t(`pages.inventory.status.${r.status}`)}
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
  const { t } = useTranslation();
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
      show(t("pages.inventory.createdToast"), "success");
      onCreated(c.id);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.inventory.createError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("pages.inventory.createTitle")}
      onClose={() => !busy && onClose()}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={save} disabled={!ready}>
            {t("pages.inventory.createDraft")}
          </Button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: "wrap" }}>
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
        <Field label={t("pages.inventory.colScope")} required>
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value as CampaignScope)}
          >
            <option value="ALL">{t("pages.inventory.scope.ALL")}</option>
            <option value="ABC_A">{t("pages.inventory.optionAbcA")}</option>
            <option value="ABC_B">{t("pages.inventory.scope.ABC_B")}</option>
            <option value="ABC_C">{t("pages.inventory.scope.ABC_C")}</option>
            <option value="SELECTION">
              {t("pages.inventory.optionSelection")}
            </option>
          </Select>
        </Field>
      </div>

      {scope === "SELECTION" ? (
        <Field
          label={t("pages.inventory.productsPicked", {
            count: productIds.length,
          })}
          required
        >
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
            👁️‍🗨️ <strong>{t("pages.inventory.blindTitle")}</strong>
            <span
              className="muted"
              style={{ display: "block", fontSize: "0.8rem" }}
            >
              {t("pages.inventory.blindBody")}
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
            🧊 <strong>{t("pages.inventory.freezeTitle")}</strong>
            <span
              className="muted"
              style={{ display: "block", fontSize: "0.8rem" }}
            >
              {t("pages.inventory.freezeBody")}
            </span>
          </span>
        </label>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label={t("pages.inventory.noteField")}>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("pages.inventory.notePlaceholder")}
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
  const { t } = useTranslation();
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
      show(
        e instanceof Error ? e.message : t("pages.inventory.actionRefused"),
        "error",
      );
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
      show(t("pages.inventory.nothingToSave"), "info");
      return;
    }
    setBusy(true);
    try {
      await put(`/inventory-campaigns/${detail.id}/counts`, { lines });
      show(
        t("pages.inventory.countsSaved", { count: lines.length }),
        "success",
      );
      setCounts({});
      setReasons({});
      await onChanged();
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.inventory.countRefused"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const dirtyCount = Object.values(counts).filter((v) => v !== "").length;
  const showTheoretical = !detail.blind_masked;

  return (
    <Modal
      title={t("pages.inventory.detailTitle", {
        status: t(`pages.inventory.status.${detail.status}`),
      })}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.close")}
          </Button>
          {detail.status === "DRAFT" ? (
            <Button loading={busy} onClick={() => act("start")}>
              {t("pages.inventory.startCounting")}
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
                {t("pages.inventory.saveCounts")}{" "}
                {dirtyCount > 0 ? `(${dirtyCount})` : ""}
              </Button>
              <Button loading={busy} onClick={() => act("review")}>
                {t("pages.inventory.reviewButton")}
              </Button>
            </>
          ) : null}
          {detail.status === "REVIEW" ? (
            <Button loading={busy} onClick={() => act("validate")}>
              {t("pages.inventory.validateButton")}
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
              {t("pages.inventory.abandonButton")}
            </Button>
          ) : null}
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {detail.depot_name} · {t(`pages.inventory.scope.${detail.scope}`)} ·{" "}
        {t("pages.inventory.createdBy", {
          date: formatDateTime(detail.created_at),
          name: detail.created_by_name ?? "—",
        })}
        {detail.started_at
          ? t("pages.inventory.startedSuffix", {
              date: formatDateTime(detail.started_at),
            })
          : ""}
        {detail.validated_by_name
          ? t("pages.inventory.validatedSuffix", {
              name: detail.validated_by_name,
            })
          : ""}
      </p>
      <div
        className="row"
        style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }}
      >
        {detail.blind ? (
          <Badge tone="info">{t("pages.inventory.badgeBlindFull")}</Badge>
        ) : null}
        {detail.freeze_stock ? (
          <Badge tone="warn">{t("pages.inventory.badgeFrozenFull")}</Badge>
        ) : null}
        {detail.blind_masked ? (
          <Badge tone="warn">{t("pages.inventory.badgeMasked")}</Badge>
        ) : null}
      </div>

      <div className="grid kpis" style={{ marginBottom: 10 }}>
        <Kpi
          label={t("pages.receipts.colLines")}
          value={`${detail.totals.counted} / ${detail.totals.lines}`}
        />
        <Kpi
          label={t("pages.inventory.kpiDiscrepancies")}
          value={String(detail.totals.discrepancies)}
          tone={detail.totals.discrepancies > 0 ? "warn" : "ok"}
        />
        <Kpi
          label={t("pages.inventory.kpiUpValue")}
          value={formatMoney(detail.totals.valueUp)}
          tone={detail.totals.valueUp > 0 ? "warn" : "ok"}
        />
        <Kpi
          label={t("pages.inventory.kpiDownValue")}
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
                t("pages.inventory.notInScope", { name: r.productName }),
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
          placeholder={t("pages.inventory.scanPlaceholder")}
        />
      ) : null}
      <div className="table-wrap" style={{ maxHeight: 420, overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>{t("fields.product")}</th>
              <th className="num">{t("pages.inventory.colTheoretical")}</th>
              <th className="num">{t("pages.inventory.colCountedCell")}</th>
              {showTheoretical ? (
                <th className="num">{t("pages.inventory.colVariance")}</th>
              ) : null}
              {showTheoretical ? (
                <th className="num">{t("pages.inventory.colValue")}</th>
              ) : null}
              <th>{t("fields.reason")}</th>
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
                        aria-label={t("pages.inventory.countedAria", {
                          name: it.product_name,
                        })}
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
                        aria-label={t("pages.inventory.reasonAria", {
                          name: it.product_name,
                        })}
                      >
                        <option value="">
                          {liveVariance != null && Math.abs(liveVariance) > 1e-9
                            ? t("pages.inventory.motifRequired")
                            : "—"}
                        </option>
                        {COUNT_REASON_IDS.map((id) => (
                          <option key={id} value={id}>
                            {countReasonLabel(t, id)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="muted">
                        {it.reason ? countReasonLabel(t, it.reason) : "—"}
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
          {t("pages.inventory.countingHint")}
        </p>
      ) : null}
      {detail.note ? <p className="muted">🗒️ {detail.note}</p> : null}
    </Modal>
  );
}

/* ========================= ONGLET AJUSTEMENT RAPIDE ======================= */
function QuickAdjustTab() {
  const { t } = useTranslation();
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
      show(e instanceof Error ? e.message : t("common.loadingError"), "error");
    } finally {
      setLoadingList(false);
    }
  };

  const qty = (r: ProductListItem) => (depotId ? r.depot_qty : r.total_qty);

  const submit = async () => {
    if (!selected) return;
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n)) {
      show(t("pages.inventory.qtyInvalid"), "error");
      return;
    }
    if (reason.trim().length < 3) {
      show(t("pages.inventory.reasonTooShort"), "error");
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
        t("pages.inventory.adjustDone", {
          name: selected.name,
          previous: res.previous,
          next: res.next,
          delta: `${res.delta >= 0 ? "+" : ""}${res.delta}`,
        }),
        "success",
      );
      setSelected(null);
      setValue("");
      setReason("");
      void load();
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.inventory.adjustError"),
        "error",
      );
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
          <Field label={t("pages.inventory.depotField")}>
            <Select
              value={depotId}
              onChange={(e) => setDepotId(e.target.value)}
            >
              <option value="">{t("pages.inventory.allDepotsGlobal")}</option>
              {(depots.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fields.product")}>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("pages.receipts.searchPlaceholder")}
            />
          </Field>
          <Button onClick={load} loading={loadingList}>
            {t("pages.inventory.loadSheet")}
          </Button>
        </div>
      </Card>

      {selected ? (
        <Card title={t("pages.inventory.adjustTitle", { name: selected.name })}>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("pages.inventory.typeField")} required>
              <Select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                <option value="ADJUSTMENT">
                  {t("pages.inventory.typeAdjustment")}
                </option>
                <option value="DAMAGE">
                  {t("pages.inventory.typeDamage")}
                </option>
                <option value="EXPIRED">
                  {t("pages.inventory.typeExpired")}
                </option>
              </Select>
            </Field>
            <Field label={t("pages.inventory.modeField")}>
              <Select
                value={mode}
                onChange={(e) => setMode(e.target.value as "count" | "delta")}
              >
                <option value="count">{t("pages.inventory.modeCount")}</option>
                <option value="delta">{t("pages.inventory.modeDelta")}</option>
              </Select>
            </Field>
            <Field
              label={
                mode === "count"
                  ? t("pages.inventory.valueCount")
                  : t("pages.inventory.valueDelta")
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
              label={t("pages.inventory.stockTheoretical", {
                scope: depotId
                  ? t("pages.inventory.scopeDepot")
                  : t("pages.inventory.scopeGlobal"),
              })}
            >
              <div style={{ padding: "10px 0", fontWeight: 800 }}>
                {formatQty(qty(selected))} {selected.unit_symbol ?? ""}
              </div>
            </Field>
          </div>
          <Field
            label={t("pages.inventory.reasonCodeField")}
            required
            hint={t("pages.inventory.reasonCodeHint")}
          >
            <Select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            >
              {COUNT_REASON_IDS.map((id) => (
                <option key={id} value={id}>
                  {countReasonLabel(t, id)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("pages.inventory.reasonDetailField")} required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("pages.inventory.reasonDetailPlaceholder")}
            />
          </Field>
          <div className="row">
            <Button loading={busy} onClick={submit}>
              {t("pages.inventory.submitAdjust")}
            </Button>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              {t("common.close")}
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
                  <th>{t("fields.product")}</th>
                  <th className="num">
                    {t("pages.inventory.stockCol", {
                      scope: depotId
                        ? t("pages.inventory.scopeDepot")
                        : t("pages.inventory.scopeGlobal"),
                    })}
                  </th>
                  <th>{t("common.status")}</th>
                  <th aria-label={t("pages.inventory.ariaAdjust")} />
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
                        {t("pages.inventory.adjustButton")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : !loadingList ? (
        <EmptyState emoji="🔧" title={t("pages.inventory.emptySheet")}>
          {t("pages.inventory.emptySheetBody")}
        </EmptyState>
      ) : null}
    </>
  );
}

/* ============================ ONGLET TOURNANT ABC ========================= */
function AbcTab() {
  const { t } = useTranslation();
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
      show(t("pages.inventory.noDepot"), "error");
      return;
    }
    setBusy(true);
    try {
      const c = await post<{ id: string }>("/inventory-campaigns", {
        depotId: depot,
        scope,
      });
      await post(`/inventory-campaigns/${c.id}/start`, {});
      show(t("pages.inventory.campaignLaunched", { scope }), "success");
      invalidateQueries("inv-abc:");
      invalidateQueries("inv-camp:");
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.inventory.launchError"),
        "error",
      );
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
          <Field label={t("pages.inventory.depotNext")}>
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
        <Spinner label={t("common.loading")} />
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
              title={`${r.scope === "ABC_A" ? "🥇" : r.scope === "ABC_B" ? "🥈" : "🥉"} ${t("pages.inventory.classTitle", { label: r.class_label })}`}
              actions={
                <Badge tone={r.overdue ? "danger" : "ok"}>
                  {r.overdue
                    ? t("pages.inventory.overdue")
                    : t("pages.inventory.upToDate")}
                </Badge>
              }
            >
              <p className="muted" style={{ marginTop: 0 }}>
                {t("pages.inventory.abcSchedule", {
                  count: r.product_count,
                  days: r.frequency_days,
                })}
              </p>
              <p>
                {t("pages.inventory.lastCountPrefix")}{" "}
                {r.last_count_at
                  ? formatDate(r.last_count_at)
                  : t("pages.inventory.never")}
                {r.due_at ? (
                  <>
                    {t("pages.inventory.nextPrefix")}
                    <strong>{formatDate(r.due_at)}</strong>
                  </>
                ) : null}
              </p>
              <Button
                variant="outline"
                size="sm"
                loading={busy}
                onClick={() => launch(r.scope)}
              >
                {t("pages.inventory.launchButton", { scope: r.scope })}
              </Button>
            </Card>
          ))}
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>
        {t("pages.inventory.abcHint")}
      </p>
    </>
  );
}
