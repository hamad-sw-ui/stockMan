/** Réceptions fournisseurs : enregistrement des entrées de stock (transaction
 *  atomique) avec lots et péremptions, liste paginée et détail.
 *  C3 — ajout de lignes AU SCAN (alias et cartons ×N résolus) ; C7 — grille
 *  IMEI par ligne pour les produits sérialisés (scan Code 128 ou saisie). */
import { Fragment, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
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
import type {
  Depot,
  Paged,
  ProductListItem,
  ReceiptRow,
  Supplier,
  Unit,
} from "../../lib/types";
import { ScanField } from "../../components/ScanField";
import {
  CameraScanner,
  cameraScanSupported,
} from "../../components/CameraScanner";
import { LabelsPrintModal } from "../../components/LabelsPrintModal";
import { useAuth } from "../../store/auth";
import type { LabelLine } from "../../lib/labels";
import type { BarcodeLookupResult } from "../../lib/scanLookup";

interface LineForm {
  productId: string;
  productName: string;
  quantity: string;
  unitId: string;
  unitCost: string;
  batchNumber: string;
  expiryDate: string;
  variantId: string | null;
  variantName: string | null;
  /** C7 — produit sérialisé : un numéro (IMEI) par unité reçue. */
  requiresSerial: boolean;
  serials: string[];
}

export default function ReceiptsPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const { user } = useAuth();
  const tenantName = user?.tenant.name ?? null;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const path = `/stock/receipts?page=${page}&size=20`;
  const q = useQuery<Paged<ReceiptRow>>(`receipts:${path}`, path);
  const rows = (q.data?.data ?? []).filter(
    (r) =>
      !search ||
      (r.reference ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (r.supplier_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      r.depot_name.toLowerCase().includes(search.toLowerCase()),
  );
  const suppliers = useQuery<Supplier[]>("suppliers:list", "/suppliers");
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const units = useQuery<Unit[]>("units:list", "/units");

  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [depotId, setDepotId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineForm[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductListItem[]>([]);
  const [busy, setBusy] = useState(false);
  // Import CSV du stock initial (prise d'inventaire d'ouverture — E8).
  const [impOpen, setImpOpen] = useState(false);
  const [impDepotId, setImpDepotId] = useState("");
  const [impReference, setImpReference] = useState("");
  const [impCsv, setImpCsv] = useState("");
  const [impBusy, setImpBusy] = useState(false);
  const [impResult, setImpResult] = useState<{
    receiptId: string | null;
    imported: number;
    errors: Array<{ ligne: number; message: string }>;
  } | null>(null);
  const [detail, setDetail] = useState<
    | (ReceiptRow & {
        items: Array<{
          id: string;
          product_name: string;
          variant_name: string | null;
          batch_number: string | null;
          base_qty: number;
          unit_cost: number;
          // C4 — impression d'étiquettes depuis la réception
          product_barcode: string | null;
          variant_barcode: string | null;
          selling_price: number;
        }>;
      })
    | null
  >(null);
  // C4 — modale « Imprimer les étiquettes de cette réception ».
  const [labelsOpen, setLabelsOpen] = useState(false);

  const reset = () => {
    setSupplierId("");
    setDepotId((depots.data ?? []).find((d) => d.is_active)?.id ?? "");
    setReference("");
    setNote("");
    setLines([]);
    setProductQuery("");
    setProductResults([]);
  };

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

  const addProduct = (p: ProductListItem) => {
    if (!lines.some((l) => l.productId === p.id && !l.variantId)) {
      setLines([
        ...lines,
        {
          productId: p.id,
          productName: p.name,
          quantity: "1",
          unitId: "",
          unitCost: String(p.purchase_price || 0),
          batchNumber: "",
          expiryDate: "",
          variantId: null,
          variantName: null,
          requiresSerial: p.requires_serial ?? false,
          serials: [],
        },
      ]);
    }
    setProductQuery("");
    setProductResults([]);
  };

  /** C3 — ligne ajoutée au scan : alias/conditionnement/variante résolus,
   *  quantité pré-remplie au facteur du conditionnement scanné. */
  const addScanned = (r: BarcodeLookupResult) => {
    const key = (l: LineForm) =>
      l.productId === r.productId && (l.variantId ?? null) === r.variantId;
    if (!lines.some(key)) {
      const serialized = r.requiresSerial;
      setLines([
        ...lines,
        {
          productId: r.productId,
          productName: r.productName,
          quantity: "1",
          // Sérialisé : unité de base imposée par l'API (un numéro par unité).
          unitId: !serialized && r.unitFactor !== 1 ? (r.unitId ?? "") : "",
          unitCost: String(r.purchasePrice || 0),
          batchNumber: "",
          expiryDate: "",
          variantId: r.variantId,
          variantName: r.variantName,
          requiresSerial: serialized,
          serials: [],
        },
      ]);
      if (r.unitId && r.unitFactor !== 1 && !serialized)
        show(
          t("pages.receipts.scannedPackaging", {
            symbol: r.unitSymbol,
            factor: r.unitFactor,
          }),
          "info",
        );
      if (serialized) show(t("pages.receipts.serializedInfo"), "info");
    } else {
      show(t("pages.receipts.duplicateLine"), "info");
    }
  };

  const totalCost = lines.reduce(
    (a, l) =>
      a +
      (Number(l.quantity.replace(",", ".")) || 0) *
        (Number(l.unitCost.replace(",", ".")) || 0),
    0,
  );

  const submit = async () => {
    const items = lines
      .map((l) => ({
        productId: l.productId,
        variantId: l.variantId ?? undefined,
        quantity: Number(l.quantity.replace(",", ".")) || 0,
        unitId: l.unitId || undefined,
        unitCost: Number(l.unitCost.replace(",", ".")) || 0,
        batchNumber: l.batchNumber || undefined,
        expiryDate: l.expiryDate || null,
        serials: l.requiresSerial ? l.serials : undefined,
      }))
      .filter((l) => l.quantity > 0);
    if (items.length === 0) {
      show(t("pages.receipts.noLines"), "error");
      return;
    }
    if (serialMismatch) {
      const expected = Math.round(
        Number(serialMismatch.quantity.replace(",", ".")) || 0,
      );
      show(
        t("pages.receipts.serialMismatch", {
          name: serialMismatch.productName,
          expected,
          count: serialMismatch.serials.length,
        }),
        "error",
      );
      return;
    }
    setBusy(true);
    try {
      await post("/stock/receipts", {
        depotId: depotId || undefined,
        supplierId: supplierId || null,
        reference: reference || null,
        note: note || null,
        items,
      });
      show(t("pages.receipts.saved"), "success");
      invalidateQueries("receipts:");
      invalidateQueries("products:");
      setOpen(false);
      reset();
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.receipts.saveError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      setDetail(await get(`/stock/receipts/${id}`));
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.receipts.detailError"),
        "error",
      );
    }
  };

  const openImport = () => {
    setImpDepotId((depots.data ?? []).find((d) => d.is_active)?.id ?? "");
    setImpReference("");
    setImpCsv("");
    setImpResult(null);
    setImpOpen(true);
  };

  const readImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImpCsv(await file.text());
      setImpResult(null);
    } catch {
      show(t("pages.receipts.readError"), "error");
    }
  };

  const submitImport = async () => {
    if (!impCsv.trim()) {
      show(t("pages.receipts.noCsv"), "error");
      return;
    }
    setImpBusy(true);
    try {
      const res = await post<{
        receiptId: string | null;
        imported: number;
        errors: Array<{ ligne: number; message: string }>;
      }>("/stock/import", {
        depotId: impDepotId || undefined,
        reference: impReference || null,
        csv: impCsv,
      });
      setImpResult(res);
      invalidateQueries("receipts:");
      invalidateQueries("products:");
      show(
        res.errors.length === 0
          ? t("pages.receipts.importOk", { count: res.imported })
          : t("pages.receipts.importPartial", {
              done: res.imported,
              errors: res.errors.length,
            }),
        res.errors.length === 0 ? "success" : "info",
      );
    } catch (e) {
      show(e instanceof Error ? e.message : t("csv.importError"), "error");
    } finally {
      setImpBusy(false);
    }
  };

  const setLine = (i: number, k: keyof LineForm, v: string) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const setLineSerials = (i: number, serials: string[]) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, serials } : l)));

  /** Cohérence IMEI avant envoi : autant de numéros que d'unités reçues. */
  const serialMismatch = lines.find(
    (l) =>
      l.requiresSerial &&
      l.serials.length !==
        Math.round(Number(l.quantity.replace(",", ".")) || 0),
  );

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.receipts.title")}
        sub={t("pages.receipts.sub")}
        actions={
          <>
            <Button variant="outline" onClick={openImport}>
              {t("pages.receipts.importButton")}
            </Button>
            <Button
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              {t("pages.receipts.newReceipt")}
            </Button>
          </>
        }
      />

      {q.data?.data.length ? (
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("pages.receipts.searchPlaceholder")}
        />
      ) : null}
      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("receipts:")}
        />
      ) : !q.data?.data.length ? (
        <EmptyState
          emoji="📥"
          title={t("pages.receipts.empty")}
          action={
            <Button
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              {t("pages.receipts.firstReceipt")}
            </Button>
          }
        >
          {t("pages.receipts.emptyBody")}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("fields.reference")}</th>
                  <th>{t("fields.supplier")}</th>
                  <th>{t("fields.depot")}</th>
                  <th className="num">{t("pages.receipts.colLines")}</th>
                  <th className="num">{t("common.amount")}</th>
                  <th>{t("pages.movements.by")}</th>
                  <th aria-label={t("pages.receipts.ariaDetail")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td
                      className="muted"
                      style={{ whiteSpace: "nowrap" }}
                      data-label={t("common.date")}
                    >
                      {formatDateTime(r.created_at)}
                    </td>
                    <td className="mono" data-label={t("fields.reference")}>
                      {r.reference ?? "—"}
                    </td>
                    <td data-label={t("fields.supplier")}>
                      {r.supplier_name ?? "—"}
                    </td>
                    <td className="muted" data-label={t("fields.depot")}>
                      {r.depot_name}
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
                      data-label={t("common.amount")}
                    >
                      {formatMoney(r.total_cost)}
                    </td>
                    <td className="muted" data-label={t("pages.movements.by")}>
                      {r.received_by_name ?? "—"}
                    </td>
                    <td data-label="" className="col-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDetail(r.id)}
                      >
                        {t("pages.receipts.detailButton")}
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

      {open ? (
        <Modal
          title={t("pages.receipts.modalTitle")}
          onClose={() => !busy && setOpen(false)}
          wide
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                loading={busy}
                onClick={submit}
                disabled={lines.length === 0}
              >
                {t("pages.receipts.validate", {
                  total: formatMoney(totalCost),
                })}
              </Button>
            </>
          }
        >
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("fields.supplier")}>
              <Select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">{t("pages.receipts.noSupplier")}</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("pages.receipts.depotField")} required>
              <Select
                value={depotId}
                onChange={(e) => setDepotId(e.target.value)}
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
            <Field label={t("pages.receipts.referenceField")}>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <Field label={t("fields.notes")}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          <h3 style={{ margin: "10px 0" }}>
            {t("pages.receipts.productsReceived")}
          </h3>
          <Field label={t("pages.receipts.scanField")}>
            <ScanField
              onResolve={addScanned}
              placeholder={t("pages.receipts.scanPlaceholder")}
            />
          </Field>
          <Field label={t("pages.receipts.searchField")}>
            <Input
              value={productQuery}
              onChange={(e) => searchProducts(e.target.value)}
              placeholder={t("pages.receipts.searchPlaceholder")}
            />
          </Field>
          {productResults.length > 0 ? (
            <div
              className="pos-hits"
              style={{ position: "static", maxHeight: 180 }}
            >
              {productResults.map((p) => (
                <button key={p.id} type="button" onClick={() => addProduct(p)}>
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {t("pages.receipts.purchasePrefix", {
                      price: formatMoney(p.purchase_price),
                    })}
                  </span>
                </button>
              ))}
            </div>
          ) : productQuery.length >= 2 ? (
            <p className="muted">{t("pages.receipts.noProducts")}</p>
          ) : null}

          {lines.length > 0 ? (
            <div className="table-wrap table-cards">
              <table>
                <thead>
                  <tr>
                    <th>{t("fields.product")}</th>
                    <th className="num">{t("pages.productDetail.colQty")}</th>
                    <th>{t("pages.receipts.colUnit")}</th>
                    <th className="num">{t("pages.receipts.colUnitCost")}</th>
                    <th>{t("pages.productDetail.colBatchNo")}</th>
                    <th>{t("pages.productForm.expiry")}</th>
                    <th aria-label={t("pages.receipts.ariaRemove")} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <Fragment key={`${l.productId}:${l.variantId ?? ""}`}>
                      <tr>
                        <td
                          style={{ fontWeight: 600 }}
                          data-label={t("fields.product")}
                        >
                          {l.productName}
                          {l.variantName ? (
                            <span className="muted"> · {l.variantName}</span>
                          ) : null}
                          {l.requiresSerial ? (
                            <span
                              title={t("pages.receipts.serializedTitle")}
                              style={{
                                marginLeft: 6,
                                fontSize: 11,
                                color: "#b45309",
                              }}
                            >
                              {t("pages.receipts.serializedBadge")}
                            </span>
                          ) : null}
                        </td>
                        <td
                          style={{ maxWidth: 90 }}
                          data-label={t("pages.productDetail.colQty")}
                        >
                          <Input
                            inputMode="decimal"
                            value={l.quantity}
                            onChange={(e) =>
                              setLine(i, "quantity", e.target.value)
                            }
                          />
                        </td>
                        <td
                          style={{ maxWidth: 110 }}
                          data-label={t("pages.receipts.colUnit")}
                        >
                          <Select
                            value={l.unitId}
                            onChange={(e) =>
                              setLine(i, "unitId", e.target.value)
                            }
                            disabled={l.requiresSerial}
                          >
                            <option value="">
                              {t("pages.receipts.baseUnitOption")}
                            </option>
                            {(units.data ?? []).map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.symbol}
                                {u.base_value !== 1
                                  ? t("pages.productForm.unitFactor", {
                                      value: u.base_value,
                                    })
                                  : ""}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td
                          style={{ maxWidth: 110 }}
                          data-label={t("pages.receipts.colUnitCost")}
                        >
                          <Input
                            inputMode="decimal"
                            value={l.unitCost}
                            onChange={(e) =>
                              setLine(i, "unitCost", e.target.value)
                            }
                          />
                        </td>
                        <td
                          style={{ maxWidth: 110 }}
                          data-label={t("pages.productDetail.colBatchNo")}
                        >
                          <Input
                            value={l.batchNumber}
                            onChange={(e) =>
                              setLine(i, "batchNumber", e.target.value)
                            }
                          />
                        </td>
                        <td data-label={t("pages.productForm.expiry")}>
                          <Input
                            type="date"
                            value={l.expiryDate}
                            onChange={(e) =>
                              setLine(i, "expiryDate", e.target.value)
                            }
                          />
                        </td>
                        <td data-label="" className="col-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setLines(lines.filter((_, j) => j !== i))
                            }
                          >
                            🗑️
                          </Button>
                        </td>
                      </tr>
                      {l.requiresSerial ? (
                        <tr className="check-stray">
                          <td
                            colSpan={7}
                            style={{ background: "#fffbeb" }}
                            data-label={t("pages.receipts.serialsLabel")}
                          >
                            <SerialLineEditor
                              serials={l.serials}
                              expected={Math.round(
                                Number(l.quantity.replace(",", ".")) || 0,
                              )}
                              onChange={(next) => setLineSerials(i, next)}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              {t("pages.receipts.linesEmpty")}{" "}
              <strong>{formatMoney(totalCost)}</strong>
            </p>
          )}
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
            {t("pages.receipts.costNote")}
          </p>
        </Modal>
      ) : null}

      {impOpen ? (
        <Modal
          title={t("pages.receipts.importTitle")}
          onClose={() => !impBusy && setImpOpen(false)}
          wide
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setImpOpen(false)}
                disabled={impBusy}
              >
                {t("common.close")}
              </Button>
              <Button
                loading={impBusy}
                onClick={submitImport}
                disabled={!impCsv.trim() || impResult?.imported != null}
              >
                {t("pages.receipts.importLaunch")}
              </Button>
            </>
          }
        >
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("pages.receipts.depotField")} required>
              <Select
                value={impDepotId}
                onChange={(e) => setImpDepotId(e.target.value)}
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
            <Field label={t("pages.receipts.importReferenceField")}>
              <Input
                value={impReference}
                onChange={(e) => setImpReference(e.target.value)}
                placeholder={t("pages.receipts.importReferencePlaceholder")}
              />
            </Field>
            <Field label={t("pages.receipts.importFileField")}>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void readImportFile(e.target.files?.[0])}
              />
            </Field>
          </div>
          <Field
            label={t("pages.receipts.importContentField")}
            hint={t("pages.receipts.importCsvHint")}
            required
          >
            <textarea
              className="input"
              rows={8}
              style={{ fontFamily: "monospace", width: "100%" }}
              value={impCsv}
              onChange={(e) => {
                setImpCsv(e.target.value);
                setImpResult(null);
              }}
              placeholder={
                "Produit;Quantité;Coût;Lot;Expiration\n6100000000011;48;200;LOT-A;2027-06-30"
              }
            />
          </Field>
          {impResult ? (
            <div
              style={{
                border: "1px solid var(--line, #e2e8f0)",
                borderRadius: 8,
                padding: 12,
                marginTop: 10,
              }}
            >
              <p style={{ marginTop: 0 }}>
                <strong>{impResult.imported}</strong>{" "}
                {t("pages.receipts.importedRowsSuffix")}
                {impResult.receiptId ? (
                  <Trans
                    i18nKey="pages.receipts.importReceiptTrail"
                    components={{
                      btn: (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setImpOpen(false);
                            void openDetail(impResult.receiptId!);
                          }}
                        />
                      ),
                    }}
                  />
                ) : (
                  "."
                )}
              </p>
              {impResult.errors.length > 0 ? (
                <>
                  <p style={{ fontWeight: 700 }}>
                    {t("pages.receipts.rejectedCount", {
                      count: impResult.errors.length,
                    })}
                  </p>
                  <div className="table-wrap" style={{ maxHeight: 220 }}>
                    <table>
                      <thead>
                        <tr>
                          <th className="num">{t("pages.products.colLine")}</th>
                          <th>{t("pages.receipts.rejectReason")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {impResult.errors.map((er, i) => (
                          <tr key={i}>
                            <td
                              className="num"
                              data-label={t("pages.products.colLine")}
                            >
                              {er.ligne}
                            </td>
                            <td data-label={t("pages.receipts.rejectReason")}>
                              {er.message}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted" style={{ fontSize: "0.85rem" }}>
                    {t("pages.receipts.fixAndRetry")}
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
            <Trans
              i18nKey="pages.receipts.importNote"
              components={{ b: <strong /> }}
            />
          </p>
        </Modal>
      ) : null}

      {detail ? (
        <Modal
          title={t("pages.receipts.detailTitle", {
            reference: detail.reference ?? "",
            date: formatDate(detail.created_at),
          })}
          onClose={() => setDetail(null)}
          wide
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {detail.supplier_name ?? t("pages.receipts.supplierFallback")} ·{" "}
            {detail.depot_name} ·{" "}
            {t("pages.receipts.enteredBy", {
              name: detail.received_by_name ?? "—",
            })}
          </p>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.product")}</th>
                  <th>{t("pages.receipts.colLot")}</th>
                  <th className="num">{t("pages.receipts.colBaseQty")}</th>
                  <th className="num">{t("pages.receipts.colUnitCost")}</th>
                  <th className="num">{t("pages.receipts.colSubtotal")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((i) => (
                  <tr key={i.id}>
                    <td data-label={t("fields.product")}>
                      {i.product_name}
                      {i.variant_name ? (
                        <span className="muted"> · {i.variant_name}</span>
                      ) : null}
                    </td>
                    <td
                      className="mono muted"
                      data-label={t("pages.receipts.colLot")}
                    >
                      {i.batch_number ?? "—"}
                    </td>
                    <td
                      className="num"
                      data-label={t("pages.receipts.colBaseQty")}
                    >
                      {formatQty(i.base_qty)}
                    </td>
                    <td
                      className="num"
                      data-label={t("pages.receipts.colUnitCost")}
                    >
                      {formatMoney(i.unit_cost)}
                    </td>
                    <td
                      className="num"
                      style={{ fontWeight: 700 }}
                      data-label={t("pages.receipts.colSubtotal")}
                    >
                      {formatMoney(i.base_qty * i.unit_cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ textAlign: "right", fontWeight: 800 }}>
            {t("pages.receipts.totalLine", {
              total: formatMoney(detail.total_cost),
            })}
          </p>
          {/* C4 — un clic : les étiquettes de ce qui vient d'être reçu */}
          <div
            className="row"
            style={{ justifyContent: "flex-end", marginTop: 10 }}
          >
            <Button variant="outline" onClick={() => setLabelsOpen(true)}>
              {t("pages.receipts.receiptLabels")}
            </Button>
          </div>
        </Modal>
      ) : null}
      {detail && labelsOpen ? (
        <LabelsPrintModal
          title={t("pages.receipts.labelsModalTitle", {
            reference: detail.reference ?? "",
          })}
          lines={detail.items.map((i): LabelLine => ({
            key: i.id,
            name: `${i.product_name}${i.variant_name ? ` · ${i.variant_name}` : ""}`,
            code: i.variant_barcode ?? i.product_barcode,
            price: i.selling_price,
            qty: Math.max(0, Math.round(i.base_qty)),
          }))}
          shopName={tenantName}
          depotName={detail.depot_name}
          onClose={() => setLabelsOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * C7 — Grille IMEI / numéros de série d'une ligne de réception (fix : l'API
 * exigeait les numéros des produits sérialisés mais aucun écran ne permettait
 * de les saisir — la réception des téléphones était BLOQUÉE côté UI).
 * Saisie clavier/douchette (Entrée) ou caméra (Code 128) ; anti-doublon
 * local, compteur « saisis / attendus » piloté par la quantité de la ligne.
 */
function SerialLineEditor({
  serials,
  expected,
  onChange,
}: {
  serials: string[];
  expected: number;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [cam, setCam] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addSerial = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    if (s.length > 100) {
      setError(t("pages.receipts.serialTooLong"));
      return;
    }
    if (serials.some((x) => x.toLowerCase() === s.toLowerCase())) {
      setError(t("pages.receipts.serialDuplicate", { serial: s }));
      return;
    }
    setError(null);
    setDraft("");
    onChange([...serials, s]);
  };

  const ok = serials.length === expected && expected > 0;
  return (
    <div>
      <div className="row" style={{ gap: 6, alignItems: "center" }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addSerial(draft);
            }
          }}
          placeholder={t("pages.receipts.serialPlaceholder")}
          aria-label={t("pages.receipts.serialAria")}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => addSerial(draft)}
          disabled={!draft.trim()}
        >
          {t("pages.productDetail.addVariant")}
        </Button>
        {cameraScanSupported() ? (
          <Button variant="outline" size="sm" onClick={() => setCam((c) => !c)}>
            📷
          </Button>
        ) : null}
        <span
          role="status"
          aria-live="polite"
          style={{
            fontWeight: 700,
            fontSize: 13,
            color: ok ? "#047857" : "#b45309",
            whiteSpace: "nowrap",
          }}
        >
          {t("pages.receipts.serialCounter", {
            count: serials.length,
            expected,
          })}
        </span>
      </div>
      {error ? (
        <p
          role="alert"
          style={{ margin: "4px 0 0", fontSize: 12, color: "#b91c1c" }}
        >
          {error}
        </p>
      ) : null}
      {!ok ? (
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
          {t("pages.receipts.serialHint")}
        </p>
      ) : null}
      {serials.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginTop: 6,
          }}
        >
          {serials.map((s) => (
            <span
              key={s}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                background: "#fff",
                border: "1px solid #fcd34d",
                borderRadius: 999,
                fontSize: 12,
                fontFamily: "monospace",
              }}
            >
              {s}
              <button
                type="button"
                aria-label={t("pages.receipts.serialRemove", { serial: s })}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "#b91c1c",
                  fontWeight: 700,
                }}
                onClick={() => onChange(serials.filter((x) => x !== s))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {cam ? (
        <CameraScanner
          onDetect={(code) => {
            setCam(false);
            addSerial(code);
          }}
          onClose={() => setCam(false)}
        />
      ) : null}
    </div>
  );
}
