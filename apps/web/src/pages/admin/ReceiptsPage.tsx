/** Réceptions fournisseurs : enregistrement des entrées de stock (transaction
 *  atomique) avec lots et péremptions, liste paginée et détail. */
import { useState } from "react";
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

interface LineForm {
  productId: string;
  productName: string;
  quantity: string;
  unitId: string;
  unitCost: string;
  batchNumber: string;
  expiryDate: string;
}

export default function ReceiptsPage() {
  const { show } = useToast();
  const [page, setPage] = useState(1);
  const path = `/stock/receipts?page=${page}&size=20`;
  const q = useQuery<Paged<ReceiptRow>>(`receipts:${path}`, path);
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
  const [detail, setDetail] = useState<
    | (ReceiptRow & {
        items: Array<{
          id: string;
          product_name: string;
          variant_name: string | null;
          batch_number: string | null;
          base_qty: number;
          unit_cost: number;
        }>;
      })
    | null
  >(null);

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
    if (!lines.some((l) => l.productId === p.id)) {
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
        },
      ]);
    }
    setProductQuery("");
    setProductResults([]);
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
        quantity: Number(l.quantity.replace(",", ".")) || 0,
        unitId: l.unitId || undefined,
        unitCost: Number(l.unitCost.replace(",", ".")) || 0,
        batchNumber: l.batchNumber || undefined,
        expiryDate: l.expiryDate || null,
      }))
      .filter((l) => l.quantity > 0);
    if (items.length === 0) {
      show("Ajoutez au moins une ligne avec une quantité.", "error");
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
      show("Réception enregistrée : stock et lots mis à jour.", "success");
      invalidateQueries("receipts:");
      invalidateQueries("products:");
      setOpen(false);
      reset();
    } catch (e) {
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
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
      show(e instanceof Error ? e.message : "Détail indisponible", "error");
    }
  };

  const setLine = (i: number, k: keyof LineForm, v: string) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <div className="wrap">
      <PageHeader
        title="Réceptions fournisseurs"
        sub="Entrées de stock avec lots et dates de péremption"
        actions={
          <Button
            onClick={() => {
              reset();
              setOpen(true);
            }}
          >
            📥 Nouvelle réception
          </Button>
        }
      />

      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("receipts:")}
        />
      ) : !q.data?.data.length ? (
        <EmptyState
          emoji="📥"
          title="Aucune réception"
          action={
            <Button
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              Enregistrer la première livraison
            </Button>
          }
        >
          Chaque réception met à jour le stock, les lots et le coût d’achat
          catalogue.
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Référence</th>
                  <th>Fournisseur</th>
                  <th>Dépôt</th>
                  <th className="num">Lignes</th>
                  <th className="num">Montant</th>
                  <th>Par</th>
                  <th aria-label="Détail" />
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((r) => (
                  <tr key={r.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(r.created_at)}
                    </td>
                    <td className="mono">{r.reference ?? "—"}</td>
                    <td>{r.supplier_name ?? "—"}</td>
                    <td className="muted">{r.depot_name}</td>
                    <td className="num">{r.line_count}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatMoney(r.total_cost)}
                    </td>
                    <td className="muted">{r.received_by_name ?? "—"}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDetail(r.id)}
                      >
                        Détail
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
          title="📥 Nouvelle réception fournisseur"
          onClose={() => !busy && setOpen(false)}
          wide
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button
                loading={busy}
                onClick={submit}
                disabled={lines.length === 0}
              >
                Valider la réception ({formatMoney(totalCost)})
              </Button>
            </>
          }
        >
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Fournisseur">
              <Select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">— Non précisé —</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Dépôt de réception" required>
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
            <Field label="Référence BL/facture">
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <Field label="Note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          <h3 style={{ margin: "10px 0" }}>Produits reçus</h3>
          <Field label="Ajouter un produit">
            <Input
              value={productQuery}
              onChange={(e) => searchProducts(e.target.value)}
              placeholder="Nom ou code-barres…"
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
                    achat {formatMoney(p.purchase_price)}
                  </span>
                </button>
              ))}
            </div>
          ) : productQuery.length >= 2 ? (
            <p className="muted">Aucun produit trouvé.</p>
          ) : null}

          {lines.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th className="num">Qté</th>
                    <th>Unité</th>
                    <th className="num">Coût unitaire</th>
                    <th>N° lot</th>
                    <th>Péremption</th>
                    <th aria-label="Retirer" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.productId}>
                      <td style={{ fontWeight: 600 }}>{l.productName}</td>
                      <td style={{ maxWidth: 90 }}>
                        <Input
                          inputMode="decimal"
                          value={l.quantity}
                          onChange={(e) =>
                            setLine(i, "quantity", e.target.value)
                          }
                        />
                      </td>
                      <td style={{ maxWidth: 110 }}>
                        <Select
                          value={l.unitId}
                          onChange={(e) => setLine(i, "unitId", e.target.value)}
                        >
                          <option value="">Produit</option>
                          {(units.data ?? []).map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.symbol}
                              {u.base_value !== 1 ? ` ×${u.base_value}` : ""}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td style={{ maxWidth: 110 }}>
                        <Input
                          inputMode="decimal"
                          value={l.unitCost}
                          onChange={(e) =>
                            setLine(i, "unitCost", e.target.value)
                          }
                        />
                      </td>
                      <td style={{ maxWidth: 110 }}>
                        <Input
                          value={l.batchNumber}
                          onChange={(e) =>
                            setLine(i, "batchNumber", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <Input
                          type="date"
                          value={l.expiryDate}
                          onChange={(e) =>
                            setLine(i, "expiryDate", e.target.value)
                          }
                        />
                      </td>
                      <td>
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
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              Recherchez un produit pour composer la livraison. Coût total :{" "}
              <strong>{formatMoney(totalCost)}</strong>
            </p>
          )}
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
            💡 Le coût d’achat saisi met à jour le coût catalogue (calcul des
            marges). Un lot est créé/mis à jour dès qu’un N° de lot ou une
            péremption est renseigné.
          </p>
        </Modal>
      ) : null}

      {detail ? (
        <Modal
          title={`Réception ${detail.reference ?? ""} — ${formatDate(detail.created_at)}`}
          onClose={() => setDetail(null)}
          wide
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {detail.supplier_name ?? "Fournisseur non précisé"} ·{" "}
            {detail.depot_name} · saisie par {detail.received_by_name ?? "—"}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Lot</th>
                  <th className="num">Quantité (base)</th>
                  <th className="num">Coût unitaire</th>
                  <th className="num">Sous-total</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.product_name}
                      {i.variant_name ? (
                        <span className="muted"> · {i.variant_name}</span>
                      ) : null}
                    </td>
                    <td className="mono muted">{i.batch_number ?? "—"}</td>
                    <td className="num">{formatQty(i.base_qty)}</td>
                    <td className="num">{formatMoney(i.unit_cost)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatMoney(i.base_qty * i.unit_cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ textAlign: "right", fontWeight: 800 }}>
            Total : {formatMoney(detail.total_cost)}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
