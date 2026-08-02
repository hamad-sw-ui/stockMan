/** Ajustements & inventaire : correction de stock avec motif obligatoire,
 *  chaque écart est un mouvement tracé + une entrée au journal d'audit. */
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Kpi,
  PageHeader,
  Select,
  Spinner,
} from "../../components/ui";
import { get, post } from "../../lib/http";
import { formatMoney, formatQty, stockStatusLabel } from "../../lib/format";
import { useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { Depot, Paged, ProductListItem } from "../../lib/types";

export default function InventoryPage() {
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
      const body =
        mode === "count"
          ? {
              productId: selected.id,
              depotId: depotId || undefined,
              type,
              newQuantity: Math.max(0, n),
              reason: reason.trim(),
            }
          : {
              productId: selected.id,
              depotId: depotId || undefined,
              type,
              delta: n,
              reason: reason.trim(),
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
    <div className="wrap">
      <PageHeader
        title="Inventaire & ajustements"
        sub="Corrections de stock exceptionnelles — chaque écart est justifié et tracé"
      />

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
            <Field label="Type d’écart" required>
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
          <Field label="Motif détaillé" required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex. Inventaire physique du 02/08, casse pendant la livraison…"
            />
          </Field>
          <div className="row">
            <Button
              loading={busy}
              onClick={submit}
              disabled={!value || reason.trim().length < 3}
            >
              Valider l’ajustement
            </Button>
            <Button
              variant="outline"
              onClick={() => setSelected(null)}
              disabled={busy}
            >
              Annuler
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
                    Stock {depotId ? "(dépôt)" : "global"}
                  </th>
                  <th>Statut</th>
                  <th className="num">Valeur</th>
                  <th aria-label="Ajuster" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatQty(qty(r))} {r.unit_symbol ?? ""}
                    </td>
                    <td>
                      <Badge
                        tone={
                          depotId
                            ? qty(r) <= 0
                              ? "danger"
                              : qty(r) <= r.min_stock_level
                                ? "warn"
                                : "ok"
                            : r.stock_status === "out"
                              ? "danger"
                              : r.stock_status === "low"
                                ? "warn"
                                : "ok"
                        }
                      >
                        {depotId
                          ? qty(r) <= 0
                            ? "Rupture"
                            : qty(r) <= r.min_stock_level
                              ? "Bas"
                              : "OK"
                          : stockStatusLabel(r.stock_status)}
                      </Badge>
                    </td>
                    <td className="num muted">
                      {formatMoney(qty(r) * r.purchase_price)}
                    </td>
                    <td>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelected(r);
                          setValue(String(qty(r)));
                        }}
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
        <EmptyState emoji="🧮" title="Chargez la feuille de comptage">
          Choisissez un dépôt, recherchez un produit puis « Charger la feuille
          de comptage ».
        </EmptyState>
      ) : (
        <Spinner label="Chargement…" />
      )}

      {rows.length > 0 ? (
        <div className="kpi-grid" style={{ marginTop: 12 }}>
          <Kpi label="Références listées" value={formatQty(rows.length)} />
          <Kpi
            label="Valeur du stock affiché"
            value={formatMoney(
              rows.reduce((a, r) => a + qty(r) * r.purchase_price, 0),
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
