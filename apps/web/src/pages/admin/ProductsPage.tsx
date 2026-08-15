/** Catalogue produits : recherche serveur, filtres (catégorie, dépôt, statut),
 *  pagination, export ET import CSV, archivage (soft-delete). */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
      show(e instanceof Error ? e.message : "Export impossible", "error");
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
      show("Fichier trop lourd (280 Ko max, soit 500 lignes).", "error");
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
          `Import terminé : ${result.created} créés, ${result.updated} mis à jour.`,
          "success",
        );
      else
        show(
          `${result.created + result.updated}/${result.total} lignes importées, ${result.errors.length} erreur(s).`,
          "error",
        );
    } catch (e) {
      show(e instanceof Error ? e.message : "Import impossible", "error");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title="Produits"
        sub={
          products.data
            ? `${products.data.total} référence(s)`
            : "Catalogue et niveaux de stock"
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              ⬇️ Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              loading={importing}
              disabled={importing}
            >
              ⬆️ Import CSV
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
              ➕ Nouveau produit
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
            placeholder="Nom, code-barres ou catégorie…"
            autoFocus
          />
          <div style={{ maxWidth: 320 }}>
            <ScanField
              label="Aller à la fiche au scan"
              placeholder="Code produit ou alias…"
              onResolve={(r) => navigate(`/admin/produits/${r.productId}`)}
            />
          </div>
          <Select
            value={categoryId}
            onChange={(e) => setParam("categoryId", e.target.value)}
            style={{ width: "auto" }}
            aria-label="Filtrer par catégorie"
          >
            <option value="">Toutes catégories</option>
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
            aria-label="Filtrer par dépôt"
          >
            <option value="">Tous dépôts</option>
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
            aria-label="Filtrer par statut"
          >
            <option value="">Actifs</option>
            <option value="low">Stock bas</option>
            <option value="out">Rupture</option>
            <option value="archived">Archivés</option>
          </Select>
        </div>
      </Card>

      {products.loading ? (
        <Spinner label="Chargement du catalogue…" />
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
              ? "Aucun produit ne correspond aux filtres"
              : "Votre catalogue est vide"
          }
          action={
            <Link className="btn btn-primary" to="/admin/produits/nouveau">
              ➕ Créer le premier produit
            </Link>
          }
        >
          {q || categoryId || status
            ? "Essayez d’élargir la recherche."
            : "Ajoutez vos produits pour commencer à vendre."}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap table-cards">
            <table>
              <thead>
                <tr>
                  <th aria-label="Sélection étiquettes" style={{ width: 30 }} />
                  <th>Produit</th>
                  <th>Catégorie</th>
                  <th className="num">Prix vente</th>
                  <th className="num">
                    Stock
                    {depotId
                      ? ` (${(depots.data ?? []).find((d) => d.id === depotId)?.name ?? "dépôt"})`
                      : " total"}
                  </th>
                  <th>Statut</th>
                  <th className="num">Seuil</th>
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
                        aria-label={`Étiquette : sélectionner ${p.name}`}
                        disabled={!p.barcode}
                        title={
                          p.barcode
                            ? "Ajouter à la file d'étiquettes"
                            : "Sans code-barres : non étiquetable"
                        }
                      />
                    </td>
                    <td data-label="Produit">
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {p.barcode ? <code>{p.barcode}</code> : null}
                        {p.variant_count > 0
                          ? ` · ${p.variant_count} variante(s)`
                          : ""}
                        {p.unit_symbol ? ` · vendu en ${p.unit_symbol}` : ""}
                        {p.archived_at ? " · archivé" : ""}
                      </div>
                    </td>
                    <td className="muted" data-label="Catégorie">
                      {p.category_name ?? "—"}
                    </td>
                    <td className="num" data-label="Prix vente">
                      {formatMoney(p.selling_price)}
                    </td>
                    <td
                      className="num"
                      style={{ fontWeight: 700 }}
                      data-label="Stock"
                    >
                      {formatQty(depotId ? p.depot_qty : p.total_qty)}{" "}
                      {p.unit_symbol ?? ""}
                    </td>
                    <td data-label="Statut">
                      {p.archived_at ? (
                        <Badge>Archivé</Badge>
                      ) : (
                        <Badge tone={tone(p.stock_status)}>
                          {stockStatusLabel(p.stock_status)}
                        </Badge>
                      )}
                    </td>
                    <td className="num muted" data-label="Seuil">
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
            🏷 {labelPick.size} produit(s) dans la file d'étiquettes
          </span>
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLabelPick(new Set())}
            >
              Vider
            </Button>
            <Button size="sm" onClick={() => setLabelsOpen(true)}>
              Imprimer les étiquettes
            </Button>
          </div>
        </div>
      ) : null}
      {labelsOpen ? (
        <LabelsPrintModal
          title="Étiquettes — sélection produits"
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
          title="Résultat de l’import CSV"
          onClose={() => setReport(null)}
          wide
        >
          <p>
            <strong>{report.created}</strong> produit(s) créé(s),{" "}
            <strong>{report.updated}</strong> mis à jour sur{" "}
            <strong>{report.total}</strong> ligne(s).
          </p>
          {report.errors.length > 0 ? (
            <>
              <p className="muted">
                {report.errors.length} ligne(s) non importée(s) :
              </p>
              <div
                className="table-wrap"
                style={{ maxHeight: 300, overflow: "auto" }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Ligne</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.map((e) => (
                      <tr key={e.ligne}>
                        <td className="num" data-label="Ligne">
                          {e.ligne}
                        </td>
                        <td data-label="Motif">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="muted">
              Aucune erreur : tout le catalogue a été importé.
            </p>
          )}
          <hr
            style={{
              margin: "1rem 0",
              border: "none",
              borderTop: "1px solid var(--border)",
            }}
          />
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            <strong>Format attendu</strong> — séparateur « ; », première ligne
            d’en-tête :<br />
            <code>
              Nom;Catégorie;Code-barres;Prix achat;Prix vente;Unité;Seuil alerte
            </code>
            <br />
            Un produit existant (même code-barres, ou même nom) est mis à jour ;
            la catégorie est créée si besoin. Les quantités ne sont pas
            importées : le stock entre par les réceptions.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
