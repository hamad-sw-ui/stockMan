/** Catalogue produits : recherche serveur, filtres (catégorie, dépôt, statut),
 *  pagination, export ET import CSV, archivage (soft-delete). */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Spinner,
} from "../../components/ui";
import { download, upload } from "../../lib/http";
import { ScanField } from "../../components/ScanField";
import { LabelsPrintModal } from "../../components/LabelsPrintModal";
import { formatMoney, formatQty, stockStatusLabel } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import { useAuth } from "../../store/auth";
import type { Category, Depot, Paged, ProductListItem } from "../../lib/types";

interface ImportResult {
  created: number;
  updated: number;
  total: number;
  errors: Array<{ ligne: number; message: string }>;
}

const tone = (s: "ok" | "low" | "out"): "ok" | "warn" | "danger" =>
  s === "ok" ? "ok" : s === "low" ? "warn" : "danger";

export default function ProductsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenantName = user?.tenant.name ?? null;
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [page, setPage] = useState(1);
  const { show } = useToast();
  const navigate = useNavigate();

  const categoryId = params.get("categoryId") ?? "";
  const depotId = params.get("depotId") ?? "";
  const status = params.get("status") ?? "";

  // Recherche débouncée (400 ms)
  const [q, setQ] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setQ(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const qs = new URLSearchParams({ page: String(page), size: "20" });
  if (q) qs.set("search", q);
  if (categoryId) qs.set("categoryId", categoryId);
  if (depotId) qs.set("depotId", depotId);
  if (status) qs.set("status", status);
  const path = `/products?${qs}`;

  const products = useQuery<Paged<ProductListItem>>(`products:${path}`, path);
  const categories = useQuery<Category[]>("categories:list", "/categories");
  const depots = useQuery<Depot[]>("depots:list", "/depots");

  useEffect(() => setPage(1), [q, categoryId, depotId, status]);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const exportCsv = async () => {
    try {
      await download("/products/export/csv", "catalogue-stockman.csv");
    } catch (e) {
      show(e instanceof Error ? e.message : t("csv.exportError"), "error");
    }
  };

  // Import CSV : sélection de fichier → envoi brut → compte-rendu détaillé.
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportResult | null>(null);
  // C4 — file d'impression d'étiquettes (multi-sélection du tableau)
  const [labelPick, setLabelPick] = useState<Set<string>>(new Set());
  const [labelsOpen, setLabelsOpen] = useState(false);
  const toggleLabelPick = (id: string) =>
    setLabelPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const importCsv = async (file: File) => {
    if (file.size > 280 * 1024) {
      show(t("pages.products.fileTooBig"), "error");
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const result = await upload<ImportResult>("/products/import", text);
      setReport(result);
      invalidateQueries("products:");
      invalidateQueries("categories:");
      if (result.errors.length === 0)
        show(
          t("csv.successToast", {
            created: result.created,
            updated: result.updated,
          }),
          "success",
        );
      else
        show(
          t("csv.partialToast", {
            done: result.created + result.updated,
            total: result.total,
            errors: result.errors.length,
          }),
          "error",
        );
    } catch (e) {
      show(e instanceof Error ? e.message : t("csv.importError"), "error");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.products.title")}
        sub={
          products.data
            ? t("pages.products.subCount", { total: products.data.total })
            : t("pages.products.subDefault")
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              {t("csv.export")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              loading={importing}
              disabled={importing}
            >
              {t("csv.import")}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importCsv(f);
              }}
            />
            <Link
              className="btn btn-primary btn-sm"
              to="/admin/produits/nouveau"
            >
              {t("pages.products.new")}
            </Link>
          </>
        }
      />

      <Card className="filters">
        {/* C3 — scan direct (alias inclus) : ouvre la fiche du produit résolu. */}
        <div
          className="row filters-row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t("pages.products.searchPlaceholder")}
            autoFocus
          />
          <div style={{ maxWidth: 320 }}>
            <ScanField
              label={t("pages.products.scanLabel")}
              placeholder={t("pages.products.scanPlaceholder")}
              onResolve={(r) => navigate(`/admin/produits/${r.productId}`)}
            />
          </div>
          <Select
            value={categoryId}
            onChange={(e) => setParam("categoryId", e.target.value)}
            style={{ width: "auto" }}
            aria-label={t("pages.products.filterCategory")}
          >
            <option value="">{t("pages.products.allCategories")}</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            value={depotId}
            onChange={(e) => setParam("depotId", e.target.value)}
            style={{ width: "auto" }}
            aria-label={t("pages.products.filterDepot")}
          >
            <option value="">{t("pages.products.allDepots")}</option>
            {(depots.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(e) => setParam("status", e.target.value)}
            style={{ width: "auto" }}
            aria-label={t("pages.products.filterStatus")}
          >
            <option value="">{t("pages.products.statusActive")}</option>
            <option value="low">{stockStatusLabel("low")}</option>
            <option value="out">{stockStatusLabel("out")}</option>
            <option value="archived">
              {t("pages.products.statusArchived")}
            </option>
          </Select>
        </div>
      </Card>

      {products.loading ? (
        <Spinner label={t("pages.products.loading")} />
      ) : products.error ? (
        <ErrorState
          error={products.error}
          onRetry={() => invalidateQueries("products:")}
        />
      ) : !products.data?.data.length ? (
        <EmptyState
          emoji="📦"
          title={
            q || categoryId || status
              ? t("pages.products.emptyFiltered")
              : t("pages.products.empty")
          }
          action={
            <Link className="btn btn-primary" to="/admin/produits/nouveau">
              {t("pages.products.createFirst")}
            </Link>
          }
        >
          {q || categoryId || status
            ? t("pages.products.emptyFilteredBody")
            : t("pages.products.emptyBody")}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th
                    aria-label={t("pages.products.ariaPickLabels")}
                    style={{ width: 30 }}
                  />
                  <th>{t("fields.product")}</th>
                  <th>{t("fields.category")}</th>
                  <th className="num">{t("pages.products.colSellingPrice")}</th>
                  <th className="num">
                    {t("pages.products.colStock")}
                    {depotId
                      ? t("pages.products.stockColDepot", {
                          name:
                            (depots.data ?? []).find((d) => d.id === depotId)
                              ?.name ?? t("pages.products.depotFallback"),
                        })
                      : t("pages.products.stockColSuffixTotal")}
                  </th>
                  <th>{t("common.status")}</th>
                  <th className="num">{t("pages.products.colThreshold")}</th>
                </tr>
              </thead>
              <tbody>
                {products.data.data.map((p) => (
                  <tr
                    key={p.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/admin/produits/${p.id}`)}
                  >
                    <td data-label="" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={labelPick.has(p.id)}
                        onChange={() => toggleLabelPick(p.id)}
                        aria-label={t("pages.products.pickLabelAria", {
                          name: p.name,
                        })}
                        disabled={!p.barcode}
                        title={
                          p.barcode
                            ? t("pages.products.pickTitle")
                            : t("pages.products.notLabelable")
                        }
                      />
                    </td>
                    <td data-label={t("fields.product")}>
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {p.barcode ? <code>{p.barcode}</code> : null}
                        {p.variant_count > 0
                          ? t("pages.products.suffixVariant", {
                              count: p.variant_count,
                            })
                          : ""}
                        {p.unit_symbol
                          ? t("pages.products.soldInUnit", {
                              symbol: p.unit_symbol,
                            })
                          : ""}
                        {p.archived_at
                          ? t("pages.products.archivedSuffix")
                          : ""}
                      </div>
                    </td>
                    <td className="muted" data-label={t("fields.category")}>
                      {p.category_name ?? "—"}
                    </td>
                    <td
                      className="num"
                      data-label={t("pages.products.colSellingPrice")}
                    >
                      {formatMoney(p.selling_price)}
                    </td>
                    <td
                      className="num"
                      style={{ fontWeight: 700 }}
                      data-label={t("pages.products.colStock")}
                    >
                      {formatQty(depotId ? p.depot_qty : p.total_qty)}{" "}
                      {p.unit_symbol ?? ""}
                    </td>
                    <td data-label={t("common.status")}>
                      {p.archived_at ? (
                        <Badge>{t("pages.products.archivedBadge")}</Badge>
                      ) : (
                        <Badge tone={tone(p.stock_status)}>
                          {stockStatusLabel(p.stock_status)}
                        </Badge>
                      )}
                    </td>
                    <td
                      className="num muted"
                      data-label={t("pages.products.colThreshold")}
                    >
                      {formatQty(p.min_stock_level)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {products.data ? (
        <Pagination
          page={products.data.page}
          totalPages={products.data.totalPages}
          total={products.data.total}
          onPage={setPage}
        />
      ) : null}
      {/* C4 — barre flottante « file d'étiquettes » */}
      {labelPick.size > 0 ? (
        <div
          className="row"
          style={{
            position: "sticky",
            bottom: 12,
            justifyContent: "space-between",
            background: "var(--surface)",
            border: "1px solid var(--line, #d7dee6)",
            borderRadius: "var(--radius, 8px)",
            padding: "10px 14px",
            boxShadow: "var(--shadow-m, 0 6px 18px rgba(15,23,42,.12))",
            marginTop: 10,
          }}
        >
          <span style={{ fontWeight: 600 }}>
            {t("pages.products.labelsBar", { count: labelPick.size })}
          </span>
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLabelPick(new Set())}
            >
              {t("pages.products.clearSelection")}
            </Button>
            <Button size="sm" onClick={() => setLabelsOpen(true)}>
              {t("pages.products.printLabels")}
            </Button>
          </div>
        </div>
      ) : null}
      {labelsOpen ? (
        <LabelsPrintModal
          title={t("pages.products.labelsModalTitle")}
          lines={(products.data?.data ?? [])
            .filter((p) => labelPick.has(p.id))
            .map((p) => ({
              key: p.id,
              name: p.name,
              code: p.barcode,
              price: p.selling_price,
              qty: 1,
            }))}
          shopName={tenantName}
          onClose={() => setLabelsOpen(false)}
        />
      ) : null}

      {report ? (
        <Modal
          title={t("pages.products.importTitle")}
          onClose={() => setReport(null)}
          wide
        >
          <p>
            <Trans
              i18nKey="pages.products.importSummary"
              values={{
                created: report.created,
                updated: report.updated,
                total: report.total,
              }}
              components={{ b: <strong /> }}
            />
          </p>
          {report.errors.length > 0 ? (
            <>
              <p className="muted">
                {t("pages.products.importErrorsLine", {
                  count: report.errors.length,
                })}
              </p>
              <div
                className="table-wrap"
                style={{ maxHeight: 300, overflow: "auto" }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>{t("pages.products.colLine")}</th>
                      <th>{t("fields.reason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.map((e) => (
                      <tr key={e.ligne}>
                        <td
                          className="num"
                          data-label={t("pages.products.colLine")}
                        >
                          {e.ligne}
                        </td>
                        <td data-label={t("fields.reason")}>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="muted">{t("pages.products.noImportError")}</p>
          )}
          <hr
            style={{
              margin: "1rem 0",
              border: "none",
              borderTop: "1px solid var(--border)",
            }}
          />
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            <strong>{t("pages.products.importFormatTitle")}</strong>{" "}
            {t("pages.products.importFormatBody")}
            <br />
            {/* Contrat serveur : en-tête CSV littérale, volontairement non traduite. */}
            <code>
              Nom;Catégorie;Code-barres;Prix achat;Prix vente;Unité;Seuil alerte
            </code>
            <br />
            {t("pages.products.importFormatNote")}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
