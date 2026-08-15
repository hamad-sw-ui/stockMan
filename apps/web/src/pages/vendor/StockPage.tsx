/** Stock du dépôt (vendeur) : consultation des niveaux disponibles à la vente,
 *  recherche rapide, indication des seuils. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  Spinner,
} from "../../components/ui";
import { formatQty, stockStatusLabel } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useAuth } from "../../store/auth";

interface DepotStockRow {
  id: string;
  name: string;
  barcode: string | null;
  selling_price: number;
  /** Seuil d'alerte effectif (surcharge du dépôt si définie, sinon catalogue). */
  min_stock_level: number;
  /** Emplacement de rayonnage dans le dépôt (facilite le picking). */
  bin_location: string | null;
  unit_symbol: string | null;
  quantity: number;
  /** Stock réservé (commandes clients confirmées non livrées) — E8. */
  reserved_qty?: number;
}

export default function StockPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const depotId = user?.depotId;
  const path = depotId
    ? `/depots/${depotId}/stock${search ? `?search=${encodeURIComponent(search)}` : ""}`
    : null;
  const q = useQuery<DepotStockRow[]>(`depot-stock:${path ?? "none"}`, path);

  if (!depotId) {
    return (
      <div className="wrap">
        <PageHeader title={t("pages.stock.titleNoDepot")} />
        <EmptyState emoji="🏬" title={t("pages.stock.noDepot")}>
          {t("pages.stock.noDepotBody")}
        </EmptyState>
      </div>
    );
  }

  const low = (q.data ?? []).filter(
    (r) => r.quantity > 0 && r.quantity <= r.min_stock_level,
  ).length;
  const out = (q.data ?? []).filter((r) => r.quantity <= 0).length;

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.stock.title")}
        sub={
          q.data
            ? t("pages.stock.subStats", { total: q.data.length, low, out })
            : t("pages.stock.subDefault")
        }
      />
      <Card className="filters">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("pages.stock.searchPlaceholder")}
          autoFocus
        />
      </Card>
      {q.loading ? (
        <Spinner label={t("pages.stock.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("depot-stock:")}
        />
      ) : !q.data?.length ? (
        <EmptyState emoji="📦" title={t("pages.stock.empty")}>
          {search
            ? t("pages.stock.emptySearch")
            : t("pages.stock.emptyNoStock")}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.stock.colProduct")}</th>
                  <th className="num">{t("pages.stock.colAvailable")}</th>
                  <th>{t("pages.stock.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      {r.barcode ? (
                        <code className="muted" style={{ fontSize: "0.78rem" }}>
                          {r.barcode}
                        </code>
                      ) : null}
                      {r.bin_location ? (
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          📍 {r.bin_location}
                        </div>
                      ) : null}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatQty(
                        Math.max(r.quantity - (r.reserved_qty ?? 0), 0),
                      )}{" "}
                      {r.unit_symbol ?? ""}
                      {(r.reserved_qty ?? 0) > 0 ? (
                        <div
                          className="muted"
                          style={{ fontSize: "0.78rem", fontWeight: 400 }}
                          title={t("pages.stock.reservedTitle")}
                        >
                          {t("pages.stock.reservedLine", {
                            qty: formatQty(r.reserved_qty!),
                          })}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {r.quantity <= 0 ? (
                        <Badge tone="danger">{stockStatusLabel("out")}</Badge>
                      ) : r.quantity <= r.min_stock_level ? (
                        <Badge tone="warn">{stockStatusLabel("low")}</Badge>
                      ) : (
                        <Badge tone="ok">{t("pages.stock.statusOk")}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 10 }}>
        {t("pages.stock.footerNote")}
      </p>
    </div>
  );
}
