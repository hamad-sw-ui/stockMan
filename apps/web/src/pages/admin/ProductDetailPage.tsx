/** Fiche produit : aperçu (stock par dépôt), variantes, lots (FEFO),
 *  journal des mouvements, paramètres PAR DÉPÔT (seuil effectif + rayonnage,
 *  E8), historique des prix (E8), numéros de série en stock (E8) —
 *  CRUD complet et archivage/restauration. */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  Kpi,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Tabs,
} from "../../components/ui";
import { BarcodeSvg } from "../../components/Barcode";
import { canEncodeCode39 } from "../../lib/barcode";
import { del, get, patch, post, put } from "../../lib/http";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatQty,
  movementTypeLabel,
  stockStatusLabel,
} from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type {
  Batch,
  Depot,
  DepotSettingRow,
  Paged,
  PriceHistoryEntry,
  ProductDetail,
  SerialRow,
  Supplier,
  Variant,
} from "../../lib/types";

export default function ProductDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { show } = useToast();
  const [tab, setTab] = useState("apercu");
  const q = useQuery<ProductDetail>(
    `product:${id}`,
    id ? `/products/${id}` : null,
  );
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const suppliers = useQuery<Supplier[]>("suppliers:list", "/suppliers");

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);

  // Étiquettes code-barres (impression A4 locale, Code 39 ou EAN-13 sans dépendance)
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelCount, setLabelCount] = useState(24);
  const [labelVariant, setLabelVariant] = useState(""); // '' = produit, sinon id variante

  // CRUD variante
  const [variantForm, setVariantForm] = useState<{
    id?: string;
    name: string;
    sku: string;
    barcode: string;
    additionalPrice: string;
  } | null>(null);
  const [variantDelete, setVariantDelete] = useState<Variant | null>(null);

  // CRUD lot
  const [batchForm, setBatchForm] = useState<{
    id?: string;
    depotId: string;
    batchNumber: string;
    quantity: string;
    expiryDate: string;
    supplierId: string;
  } | null>(null);

  // Traçabilité / rappel de lot (E2)
  interface BatchTrace {
    found: boolean;
    batchNumber: string;
    batches: Array<{
      id: string;
      depot_name: string | null;
      quantity: number;
      expiry_date: string | null;
      unit_cost?: number;
    }>;
    inflows: Array<{
      created_at: string;
      reference: string | null;
      supplier: string | null;
      depot: string | null;
      qty: number;
      unit_cost: number;
    }>;
    outflows: Array<{
      sale_id: string;
      status: string;
      created_at: string;
      depot: string | null;
      vendor: string | null;
      qty: number;
      unit_price: number;
    }>;
    otherMovements: Array<{
      type: string;
      quantity: number;
      created_at: string;
      depot: string | null;
    }>;
  }
  const [trace, setTrace] = useState<{
    batchNumber: string;
    data?: BatchTrace;
  } | null>(null);

  const loadTrace = async (batchNumber: string) => {
    setTrace({ batchNumber });
    try {
      const data = await get<BatchTrace>(
        `/reports/batch-trace?productId=${id}&batchNumber=${encodeURIComponent(batchNumber)}`,
      );
      setTrace({ batchNumber, data });
    } catch {
      setTrace(null);
    }
  };

  const refresh = () => invalidateQueries(`product:${id}`);

  const toggleArchive = async () => {
    setBusy(true);
    try {
      const action = q.data?.archived_at ? "restore" : "archive";
      const res = await post<{ message: string }>(`/products/${id}/${action}`);
      show(res.message, "success");
      invalidateQueries("products:");
      refresh();
      setConfirmArchive(false);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.productDetail.actionError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  /** C2 — génère un EAN-13 interne pour la variante (devient son principal). */
  const generateVariantCode = async (variantId: string) => {
    setBusy(true);
    try {
      const r = await post<{ code: string }>("/products/barcodes/generate", {
        productId: id,
        variantId,
      });
      show(t("pages.productDetail.generated", { code: r.code }), "success");
      if (variantForm?.id === variantId)
        setVariantForm({ ...variantForm, barcode: r.code });
      refresh();
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.productForm.generateError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveVariant = async () => {
    if (!variantForm) return;
    setBusy(true);
    try {
      const body = {
        name: variantForm.name,
        sku: variantForm.sku || null,
        barcode: variantForm.barcode || null,
        additionalPrice:
          Number(variantForm.additionalPrice.replace(",", ".")) || 0,
      };
      if (variantForm.id)
        await patch(`/products/variants/${variantForm.id}`, body);
      else await post(`/products/${id}/variants`, body);
      show(
        variantForm.id
          ? t("pages.productDetail.variantUpdated")
          : t("pages.productDetail.variantCreated"),
        "success",
      );
      setVariantForm(null);
      refresh();
      invalidateQueries("products:");
    } catch (e) {
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const doDeleteVariant = async () => {
    if (!variantDelete) return;
    setBusy(true);
    try {
      await del(`/products/variants/${variantDelete.id}`);
      show(t("pages.productDetail.variantDeleted"), "success");
      setVariantDelete(null);
      refresh();
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.productDetail.deleteError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveBatch = async () => {
    if (!batchForm) return;
    setBusy(true);
    try {
      if (batchForm.id) {
        await patch(`/products/batches/${batchForm.id}`, {
          batchNumber: batchForm.batchNumber,
          quantity: Number(batchForm.quantity.replace(",", ".")) || 0,
          expiryDate: batchForm.expiryDate || null,
          supplierId: batchForm.supplierId || null,
        });
      } else {
        await post(`/products/${id}/batches`, {
          depotId: batchForm.depotId,
          batchNumber: batchForm.batchNumber,
          quantity: Number(batchForm.quantity.replace(",", ".")) || 0,
          expiryDate: batchForm.expiryDate || null,
          supplierId: batchForm.supplierId || null,
        });
      }
      show(
        batchForm.id
          ? t("pages.productDetail.batchUpdated")
          : t("pages.productDetail.batchCreated"),
        "success",
      );
      setBatchForm(null);
      refresh();
    } catch (e) {
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  if (q.loading)
    return (
      <div className="wrap">
        <Spinner label={t("pages.productDetail.loading")} />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="wrap">
        <ErrorState error={q.error} onRetry={refresh} />
      </div>
    );

  const p = q.data;
  const archived = !!p.archived_at;
  const totalQty =
    p.levels.filter((l) => !l.variant_id).reduce((a, l) => a + l.quantity, 0) ||
    p.total_qty;
  const margin = p.selling_price - p.purchase_price;

  // Cibles d'étiquettes encodables : le produit puis ses variantes à code-barres
  const encodables = [
    ...(p.barcode
      ? [
          {
            id: "",
            libelle: `${p.name}${t("pages.productDetail.productSuffix")}`,
            code: p.barcode,
            nom: p.name,
            prix: p.selling_price,
          },
        ]
      : []),
    ...p.variants
      .filter((v) => v.barcode)
      .map((v) => ({
        id: v.id,
        libelle: v.name,
        code: v.barcode!,
        nom: `${p.name} — ${v.name}`,
        prix: p.selling_price + (v.additional_price || 0),
      })),
  ];
  const cibleEtiquette =
    encodables.find((x) => x.id === labelVariant) ?? encodables[0] ?? null;
  const etiquetteOk = cibleEtiquette
    ? canEncodeCode39(cibleEtiquette.code)
    : false;

  return (
    <div className="wrap">
      <PageHeader
        title={
          <span>
            {p.name}{" "}
            {archived ? (
              <Badge>{t("pages.productDetail.archivedBadge")}</Badge>
            ) : (
              <Badge
                tone={
                  p.stock_status === "ok"
                    ? "ok"
                    : p.stock_status === "low"
                      ? "warn"
                      : "danger"
                }
              >
                {stockStatusLabel(p.stock_status)}
              </Badge>
            )}
          </span>
        }
        sub={
          [
            p.category_name,
            p.barcode
              ? t("pages.productDetail.eanCode", { code: p.barcode })
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || t("fields.product")
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLabelVariant("");
                setLabelsOpen(true);
              }}
              disabled={!p.barcode && !p.variants.some((v) => v.barcode)}
              title={
                !p.barcode && !p.variants.some((v) => v.barcode)
                  ? t("pages.productDetail.labelsDisabledHint")
                  : undefined
              }
            >
              {t("pages.productDetail.labelsButton")}
            </Button>
            <Link
              className="btn btn-outline btn-sm"
              to={`/admin/produits/${p.id}/modifier`}
            >
              {t("pages.productDetail.editButton")}
            </Link>
            {archived ? (
              <Button
                variant="outline"
                size="sm"
                onClick={toggleArchive}
                loading={busy}
              >
                {t("pages.productDetail.restoreButton")}
              </Button>
            ) : (
              <Button
                variant="danger-soft"
                size="sm"
                onClick={() => setConfirmArchive(true)}
              >
                {t("pages.productDetail.archiveButton")}
              </Button>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi
          label={t("pages.productDetail.kpiSelling")}
          value={formatMoney(p.selling_price)}
        />
        <Kpi
          label={t("pages.productDetail.kpiPurchase")}
          value={formatMoney(p.purchase_price)}
          sub={
            margin > 0
              ? t("pages.productDetail.kpiMargin", {
                  amount: formatMoney(margin),
                })
              : undefined
          }
        />
        <Kpi
          label="CUMP"
          value={formatMoney(p.avg_cost ?? p.purchase_price)}
          sub={t("pages.productDetail.kpiCumpSub")}
        />
        <Kpi
          label={t("pages.productDetail.kpiStock")}
          value={`${formatQty(totalQty)} ${p.unit_symbol ?? ""}`}
        />
        <Kpi
          label={t("pages.productDetail.kpiThreshold")}
          value={formatQty(p.min_stock_level)}
          tone={totalQty <= p.min_stock_level ? "warn" : undefined}
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "apercu", label: t("pages.productDetail.tabStock") },
          {
            id: "variantes",
            label: t("pages.productDetail.tabVariants", {
              count: p.variants.length,
            }),
          },
          {
            id: "lots",
            label: t("pages.productDetail.tabBatches", {
              count: p.batches.length,
            }),
          },
          { id: "mouvements", label: t("pages.productDetail.tabMovements") },
          { id: "depots", label: t("pages.productDetail.tabDepots") },
          { id: "prix", label: t("pages.productDetail.tabPrices") },
          ...(p.requires_serial
            ? [{ id: "series", label: t("pages.productDetail.tabSerials") }]
            : []),
        ]}
      />

      {tab === "apercu" ? (
        <Card pad={false}>
          {p.levels.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState
                emoji="🏬"
                title={t("pages.productDetail.emptyStock")}
                action={
                  <Link
                    className="btn btn-primary btn-sm"
                    to="/admin/receptions"
                  >
                    {t("pages.productDetail.makeReceipt")}
                  </Link>
                }
              >
                {t("pages.productDetail.emptyStockBody")}
              </EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("fields.depot")}</th>
                    <th>{t("pages.productDetail.colVariant")}</th>
                    <th className="num">{t("fields.quantity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.levels.map((l, i) => (
                    <tr key={i}>
                      <td>{l.depot_name}</td>
                      <td className="muted">{l.variant_name ?? "—"}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {formatQty(l.quantity)} {p.unit_symbol ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "variantes" ? (
        <Card
          title={t("pages.productDetail.cardVariants")}
          actions={
            <Button
              size="sm"
              onClick={() =>
                setVariantForm({
                  name: "",
                  sku: "",
                  barcode: "",
                  additionalPrice: "0",
                })
              }
            >
              {t("pages.productDetail.addVariant")}
            </Button>
          }
          pad={false}
        >
          {p.variants.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState
                emoji="🎨"
                title={t("pages.productDetail.emptyVariants")}
              >
                {t("pages.productDetail.emptyVariantsBody")}
              </EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("fields.name")}</th>
                    <th>SKU</th>
                    <th>{t("fields.barcode")}</th>
                    <th className="num">
                      {t("pages.productDetail.colSurcharge")}
                    </th>
                    <th aria-label={t("common.actions")} />
                  </tr>
                </thead>
                <tbody>
                  {p.variants.map((v) => (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600 }}>{v.name}</td>
                      <td className="muted">{v.sku ?? "—"}</td>
                      <td className="muted">
                        {v.barcode ? (
                          <code>{v.barcode}</code>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            title={t("pages.productForm.generateTitle")}
                            onClick={() => generateVariantCode(v.id)}
                          >
                            {t("pages.productForm.generate")}
                          </Button>
                        )}
                      </td>
                      <td className="num">
                        {v.additional_price
                          ? `+${formatMoney(v.additional_price)}`
                          : "—"}
                      </td>
                      <td>
                        <div
                          className="row"
                          style={{ gap: 4, flexWrap: "nowrap" }}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setVariantForm({
                                id: v.id,
                                name: v.name,
                                sku: v.sku ?? "",
                                barcode: v.barcode ?? "",
                                additionalPrice: String(
                                  v.additional_price ?? 0,
                                ),
                              })
                            }
                          >
                            ✏️
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setVariantDelete(v)}
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
          )}
        </Card>
      ) : null}

      {tab === "lots" ? (
        <Card
          title={t("pages.productDetail.batchesTitle")}
          actions={
            <Button
              size="sm"
              onClick={() =>
                setBatchForm({
                  depotId: depots.data?.[0]?.id ?? "",
                  batchNumber: "",
                  quantity: "0",
                  expiryDate: "",
                  supplierId: "",
                })
              }
            >
              {t("pages.productDetail.newBatch")}
            </Button>
          }
          pad={false}
        >
          {p.batches.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState
                emoji="📦"
                title={t("pages.productDetail.emptyBatches")}
              >
                {t("pages.productDetail.emptyBatchesBody")}
              </EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("pages.productDetail.colBatchNo")}</th>
                    <th>{t("fields.depot")}</th>
                    <th>{t("fields.supplier")}</th>
                    <th className="num">{t("fields.quantity")}</th>
                    <th>{t("pages.productForm.expiry")}</th>
                    <th>{t("pages.productDetail.colReceived")}</th>
                    <th aria-label={t("common.actions")} />
                  </tr>
                </thead>
                <tbody>
                  {p.batches.map((b: Batch) => (
                    <tr key={b.id}>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {b.batch_number}
                      </td>
                      <td className="muted">{b.depot_name ?? "—"}</td>
                      <td className="muted">{b.supplier_name ?? "—"}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {formatQty(b.quantity)}
                      </td>
                      <td>
                        {b.expiry_date ? (
                          new Date(b.expiry_date).getTime() < Date.now() ? (
                            <Badge tone="danger">
                              {t("pages.productDetail.expiredBadge", {
                                date: formatDate(b.expiry_date),
                              })}
                            </Badge>
                          ) : (
                            formatDate(b.expiry_date)
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="muted">{formatDate(b.received_date)}</td>
                      <td className="row" style={{ gap: 4 }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t("pages.productDetail.traceTitle")}
                          onClick={() => loadTrace(b.batch_number)}
                        >
                          🔎
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setBatchForm({
                              id: b.id,
                              depotId: b.depot_id,
                              batchNumber: b.batch_number,
                              quantity: String(b.quantity),
                              expiryDate: b.expiry_date?.slice(0, 10) ?? "",
                              supplierId: b.supplier_id ?? "",
                            })
                          }
                        >
                          ✏️
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "depots" && id ? <DepotSettingsTab productId={id} /> : null}

      {tab === "prix" && id ? <PriceHistoryTab productId={id} /> : null}

      {tab === "series" && id && p.requires_serial ? (
        <SerialsTab productId={id} />
      ) : null}

      {tab === "mouvements" ? (
        <Card title={t("pages.productDetail.movementsTitle")} pad={false}>
          {p.recentMovements.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState emoji="↔️" title={t("pages.movements.empty")} />
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.date")}</th>
                    <th>{t("fields.type")}</th>
                    <th className="num">{t("fields.quantity")}</th>
                    <th className="num">{t("pages.movements.beforeAfter")}</th>
                    <th>{t("fields.depot")}</th>
                    <th>{t("pages.movements.by")}</th>
                    <th>{t("fields.reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.recentMovements.map((m) => (
                    <tr key={m.id}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>
                        {formatDateTime(m.created_at)}
                      </td>
                      <td>
                        <Badge
                          tone={
                            m.type === "OUT" ||
                            m.type === "DAMAGE" ||
                            m.type === "EXPIRED"
                              ? "danger"
                              : m.type === "IN" || m.type === "RETURN"
                                ? "ok"
                                : "info"
                          }
                        >
                          {movementTypeLabel(m.type)}
                        </Badge>
                      </td>
                      <td className="num">{formatQty(m.quantity)}</td>
                      <td className="num muted">
                        {m.previous_stock != null && m.new_stock != null
                          ? `${formatQty(m.previous_stock)} → ${formatQty(m.new_stock)}`
                          : "—"}
                      </td>
                      <td className="muted">{m.depot_name}</td>
                      <td className="muted">{m.user_name ?? "—"}</td>
                      <td className="muted">{m.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {confirmArchive ? (
        <ConfirmModal
          title={t("pages.productDetail.archiveTitle")}
          message={
            <>
              {t("pages.productDetail.archiveBody", { name: p.name })}{" "}
              <Trans
                i18nKey="pages.productDetail.archiveBodyNote"
                components={{ b: <strong /> }}
              />
            </>
          }
          confirmLabel={t("pages.productDetail.archiveConfirm")}
          onConfirm={toggleArchive}
          onClose={() => setConfirmArchive(false)}
          loading={busy}
        />
      ) : null}

      {variantForm ? (
        <Modal
          title={
            variantForm.id
              ? t("pages.productDetail.variantEdit")
              : t("pages.productDetail.variantNew")
          }
          onClose={() => !busy && setVariantForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setVariantForm(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                loading={busy}
                onClick={saveVariant}
                disabled={!variantForm.name.trim()}
              >
                {t("common.save")}
              </Button>
            </>
          }
        >
          <Field label="Nom" required>
            <Input
              value={variantForm.name}
              onChange={(e) =>
                setVariantForm({ ...variantForm, name: e.target.value })
              }
              placeholder={t("pages.productForm.variantNamePlaceholder")}
            />
          </Field>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="SKU">
              <Input
                value={variantForm.sku}
                onChange={(e) =>
                  setVariantForm({ ...variantForm, sku: e.target.value })
                }
              />
            </Field>
            <Field label={t("fields.barcode")}>
              <Input
                value={variantForm.barcode}
                onChange={(e) =>
                  setVariantForm({ ...variantForm, barcode: e.target.value })
                }
              />
            </Field>
            <Field label={t("pages.productDetail.variantExtraLabel")}>
              <Input
                inputMode="decimal"
                value={variantForm.additionalPrice}
                onChange={(e) =>
                  setVariantForm({
                    ...variantForm,
                    additionalPrice: e.target.value,
                  })
                }
              />
            </Field>
          </div>
        </Modal>
      ) : null}

      {variantDelete ? (
        <ConfirmModal
          title={t("pages.productDetail.variantDeleteTitle")}
          message={
            <>
              {t("pages.productDetail.variantDeleteAsk", {
                name: variantDelete.name,
              })}
            </>
          }
          confirmLabel={t("common.delete")}
          onConfirm={doDeleteVariant}
          onClose={() => setVariantDelete(null)}
          loading={busy}
        />
      ) : null}

      {batchForm ? (
        <Modal
          title={
            batchForm.id
              ? t("pages.productDetail.batchEdit")
              : t("pages.productDetail.batchNew")
          }
          onClose={() => !busy && setBatchForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setBatchForm(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                loading={busy}
                onClick={saveBatch}
                disabled={
                  !batchForm.batchNumber.trim() ||
                  (!batchForm.id && !batchForm.depotId)
                }
              >
                {t("common.save")}
              </Button>
            </>
          }
        >
          {!batchForm.id ? (
            <Field label={t("fields.depot")} required>
              <Select
                value={batchForm.depotId}
                onChange={(e) =>
                  setBatchForm({ ...batchForm, depotId: e.target.value })
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
          ) : null}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("pages.productForm.batchNo")} required>
              <Input
                value={batchForm.batchNumber}
                onChange={(e) =>
                  setBatchForm({ ...batchForm, batchNumber: e.target.value })
                }
              />
            </Field>
            <Field label={t("fields.quantity")}>
              <Input
                inputMode="decimal"
                value={batchForm.quantity}
                onChange={(e) =>
                  setBatchForm({ ...batchForm, quantity: e.target.value })
                }
              />
            </Field>
            <Field label={t("pages.productForm.expiry")}>
              <Input
                type="date"
                value={batchForm.expiryDate}
                onChange={(e) =>
                  setBatchForm({ ...batchForm, expiryDate: e.target.value })
                }
              />
            </Field>
            <Field label={t("fields.supplier")}>
              <Select
                value={batchForm.supplierId}
                onChange={(e) =>
                  setBatchForm({ ...batchForm, supplierId: e.target.value })
                }
              >
                <option value="">—</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("pages.productDetail.batchNote")}
          </p>
        </Modal>
      ) : null}

      {trace ? (
        <Modal
          title={t("pages.productDetail.traceModalTitle", {
            batch: trace.batchNumber,
          })}
          onClose={() => setTrace(null)}
          wide
          footer={
            <Button variant="outline" onClick={() => setTrace(null)}>
              {t("common.close")}
            </Button>
          }
        >
          {!trace.data ? (
            <Spinner />
          ) : !trace.data.found ? (
            <EmptyState
              emoji="📦"
              title={t("pages.productDetail.traceNotFound")}
            />
          ) : (
            <div className="grid" style={{ gap: 12 }}>
              <div>
                <h4 style={{ margin: "4px 0" }}>
                  {t("pages.productDetail.traceRemaining")}
                </h4>
                <table>
                  <thead>
                    <tr>
                      <th>{t("fields.depot")}</th>
                      <th className="num">{t("fields.quantity")}</th>
                      <th>{t("pages.productForm.expiry")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.data.batches.map((b) => (
                      <tr key={b.id}>
                        <td>{b.depot_name ?? "—"}</td>
                        <td className="num" style={{ fontWeight: 700 }}>
                          {formatQty(b.quantity)}
                        </td>
                        <td>
                          {b.expiry_date ? formatDate(b.expiry_date) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h4 style={{ margin: "4px 0" }}>
                  {t("pages.productDetail.traceInflows")}
                </h4>
                {trace.data.inflows.length === 0 ? (
                  <p className="muted">
                    {t("pages.productDetail.traceNoInflows")}
                  </p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>{t("common.date")}</th>
                        <th>{t("fields.supplier")}</th>
                        <th>{t("fields.reference")}</th>
                        <th className="num">
                          {t("pages.productDetail.colQty")}
                        </th>
                        <th className="num">
                          {t("pages.productDetail.colCost")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {trace.data.inflows.map((i, k) => (
                        <tr key={k}>
                          <td>{formatDate(i.created_at)}</td>
                          <td>{i.supplier ?? "—"}</td>
                          <td className="muted">{i.reference ?? "—"}</td>
                          <td className="num">{formatQty(i.qty)}</td>
                          <td className="num">{formatMoney(i.unit_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h4 style={{ margin: "4px 0" }}>
                  {t("pages.productDetail.traceOutflows")}
                </h4>
                {trace.data.outflows.length === 0 ? (
                  <p className="muted">
                    {t("pages.productDetail.traceNoOutflows")}
                  </p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>{t("common.date")}</th>
                        <th>{t("pages.productDetail.colSale")}</th>
                        <th>{t("fields.depot")}</th>
                        <th>{t("fields.vendor")}</th>
                        <th className="num">
                          {t("pages.productDetail.colQty")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {trace.data.outflows.map((o) => (
                        <tr key={o.sale_id}>
                          <td>{formatDateTime(o.created_at)}</td>
                          <td className="mono">
                            #{o.sale_id.slice(0, 8)}
                            {o.status === "VOIDED"
                              ? t("pages.productDetail.voidedSuffix")
                              : ""}
                          </td>
                          <td>{o.depot ?? "—"}</td>
                          <td className="muted">{o.vendor ?? "—"}</td>
                          <td className="num">{formatQty(o.qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </Modal>
      ) : null}

      {labelsOpen && cibleEtiquette ? (
        <Modal
          title={t("pages.productDetail.labelsTitle")}
          onClose={() => setLabelsOpen(false)}
          wide
          footer={
            <>
              <Button variant="outline" onClick={() => setLabelsOpen(false)}>
                {t("common.close")}
              </Button>
              <Button onClick={() => window.print()} disabled={!etiquetteOk}>
                {t("pages.productDetail.printCount", { count: labelCount })}
              </Button>
            </>
          }
        >
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("pages.productDetail.codeToPrint")}>
              <Select
                value={cibleEtiquette.id}
                onChange={(e) => setLabelVariant(e.target.value)}
              >
                {encodables.map((x) => (
                  <option key={x.id || "produit"} value={x.id}>
                    {x.libelle}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("pages.productDetail.labelCount")}>
              <Select
                value={String(labelCount)}
                onChange={(e) => setLabelCount(Number(e.target.value))}
              >
                {[6, 12, 24, 48, 96].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {etiquetteOk ? (
            <>
              <div
                style={{
                  border: "1px dashed var(--border)",
                  borderRadius: "var(--radius)",
                  padding: 12,
                  maxWidth: 300,
                  margin: "12px auto",
                  textAlign: "center",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "0.8rem" }}>
                  {cibleEtiquette.nom}
                </div>
                <BarcodeSvg value={cibleEtiquette.code} height={40} />
                <div style={{ fontWeight: 700 }}>
                  {formatMoney(cibleEtiquette.prix)}
                </div>
              </div>
              <p
                className="muted"
                style={{ textAlign: "center", fontSize: "0.85rem" }}
              >
                {t("pages.productDetail.labelsPreview", {
                  count: labelCount,
                })}
              </p>
            </>
          ) : (
            <p className="muted">
              {t("pages.productDetail.labelsInvalidCode", {
                code: cibleEtiquette.code,
              })}
            </p>
          )}
        </Modal>
      ) : null}

      {/* Feuille d'étiquettes : visible uniquement à l'impression */}
      {labelsOpen && etiquetteOk && cibleEtiquette ? (
        <div className="labels-print" aria-hidden>
          {Array.from({ length: labelCount }).map((_, i) => (
            <div className="label-cell" key={i}>
              <div className="l-name">{cibleEtiquette.nom}</div>
              <BarcodeSvg value={cibleEtiquette.code} height={26} />
              <div className="l-price">{formatMoney(cibleEtiquette.prix)}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ============================= E8 — Onglets métier ========================= */

/** Paramètres PAR DÉPÔT : seuil d'alerte effectif par dépôt (vide = seuil
 *  catalogue) et rayonnage physique (bin location). */
function DepotSettingsTab({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const { show } = useToast();
  const q = useQuery<DepotSettingRow[]>(
    `pds:${productId}`,
    `/products/${productId}/depot-settings`,
  );
  const [edit, setEdit] = useState<{
    depotId: string;
    minStockLevel: string;
    binLocation: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await put(`/products/${productId}/depot-settings`, {
        depotId: edit.depotId,
        minStockLevel:
          edit.minStockLevel.trim() === ""
            ? null
            : Number(edit.minStockLevel.replace(",", ".")),
        binLocation: edit.binLocation.trim() || null,
      });
      show(t("pages.productDetail.depotSaved"), "success");
      invalidateQueries(`pds:${productId}`);
      invalidateQueries("predictive");
      setEdit(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.productDetail.saveError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t("pages.productDetail.depotTabTitle")} pad={false}>
      {q.loading ? (
        <div style={{ padding: 18 }}>
          <Spinner label={t("common.loading")} />
        </div>
      ) : !q.data?.length ? (
        <div style={{ padding: 18 }}>
          <EmptyState emoji="🏬" title={t("pages.productDetail.noDepots")} />
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("fields.depot")}</th>
                <th>{t("pages.productDetail.colThresholdOverride")}</th>
                <th>{t("pages.productDetail.colBin")}</th>
                <th>{t("pages.productDetail.colUpdated")}</th>
                <th aria-label={t("common.actions")} />
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.depot_id}>
                  <td>{r.depot_name}</td>
                  <td>
                    {r.min_stock_level != null ? (
                      <strong>{formatQty(r.min_stock_level)}</strong>
                    ) : (
                      <span className="muted">
                        {t("pages.productDetail.catalogFallback")}
                      </span>
                    )}
                  </td>
                  <td className="muted">{r.bin_location ?? "—"}</td>
                  <td className="muted">
                    {r.updated_at ? formatDateTime(r.updated_at) : "—"}
                  </td>
                  <td>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setEdit({
                          depotId: r.depot_id,
                          minStockLevel:
                            r.min_stock_level != null
                              ? String(r.min_stock_level)
                              : "",
                          binLocation: r.bin_location ?? "",
                        })
                      }
                    >
                      {t("common.edit")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "10px 14px" }} className="muted">
        {t("pages.productDetail.depotNote")}
      </div>

      {edit ? (
        <Modal
          title={t("pages.productDetail.depotModalTitle")}
          onClose={() => !busy && setEdit(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setEdit(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button loading={busy} onClick={save}>
                {t("common.save")}
              </Button>
            </>
          }
        >
          <Field
            label={t("pages.productDetail.thresholdHere")}
            hint={t("pages.productDetail.depotThresholdHint")}
          >
            <Input
              inputMode="decimal"
              placeholder={t("pages.productDetail.depotThresholdPlaceholder")}
              value={edit.minStockLevel}
              onChange={(e) =>
                setEdit({ ...edit, minStockLevel: e.target.value })
              }
            />
          </Field>
          <Field
            label={t("pages.productDetail.binLabel")}
            hint={t("pages.productDetail.binHint")}
          >
            <Input
              maxLength={60}
              value={edit.binLocation}
              onChange={(e) =>
                setEdit({ ...edit, binLocation: e.target.value })
              }
            />
          </Field>
        </Modal>
      ) : null}
    </Card>
  );
}

/** Historique horodaté des changements de prix (détail & gros). */
function PriceHistoryTab({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const q = useQuery<Paged<PriceHistoryEntry>>(
    `pricehist:${productId}:${page}`,
    `/pricing/price-history/${productId}?page=${page}&size=15`,
  );
  return (
    <Card title={t("pages.productDetail.priceHistoryTitle")} pad={false}>
      {q.loading ? (
        <div style={{ padding: 18 }}>
          <Spinner label={t("common.loading")} />
        </div>
      ) : !q.data?.data.length ? (
        <div style={{ padding: 18 }}>
          <EmptyState emoji="💲" title={t("pages.productDetail.priceEmpty")}>
            {t("pages.productDetail.priceEmptyBody")}
          </EmptyState>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("pages.productDetail.colField")}</th>
                <th className="num">{t("pages.productDetail.colOld")}</th>
                <th className="num">{t("pages.productDetail.colNew")}</th>
                <th>{t("pages.movements.by")}</th>
                <th>{t("fields.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((h) => (
                <tr key={h.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>
                    {formatDateTime(h.created_at)}
                  </td>
                  <td>
                    <Badge tone={h.field === "WHOLESALE" ? "info" : "muted"}>
                      {h.field === "WHOLESALE"
                        ? t("pages.productDetail.priceWholesale")
                        : t("pages.productDetail.priceRetail")}
                    </Badge>
                  </td>
                  <td className="num muted">
                    {h.old_price != null ? formatMoney(h.old_price) : "—"}
                  </td>
                  <td className="num">
                    {h.new_price != null ? (
                      <strong>{formatMoney(h.new_price)}</strong>
                    ) : (
                      <span className="muted">
                        {t("pages.productDetail.priceRemoved")}
                      </span>
                    )}
                  </td>
                  <td className="muted">{h.changed_by_name ?? "—"}</td>
                  <td className="muted">{h.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data ? (
        <Pagination
          page={q.data.page}
          totalPages={q.data.totalPages}
          total={q.data.total}
          onPage={setPage}
        />
      ) : null}
    </Card>
  );
}

/** Numéros de série (IMEI) EN STOCK du produit, par dépôt. */
function SerialsTab({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const q = useQuery<{ rows: SerialRow[] }>(
    `serials:${productId}`,
    `/serials/product/${productId}`,
  );
  return (
    <Card title={t("pages.productDetail.serialsTitle")} pad={false}>
      {q.loading ? (
        <div style={{ padding: 18 }}>
          <Spinner label={t("common.loading")} />
        </div>
      ) : !q.data?.rows.length ? (
        <div style={{ padding: 18 }}>
          <EmptyState emoji="🔢" title={t("pages.productDetail.serialsEmpty")}>
            {t("pages.productDetail.serialsEmptyBody")}
          </EmptyState>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("pages.productDetail.colSerial")}</th>
                <th>{t("fields.depot")}</th>
                <th>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontFamily: "monospace" }}>{s.serial}</td>
                  <td className="muted">{s.depot_name}</td>
                  <td>
                    <Badge tone="ok">{stockStatusLabel("ok")}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "10px 14px" }} className="muted">
        {t("pages.productDetail.serialsNote")}
      </div>
    </Card>
  );
}
