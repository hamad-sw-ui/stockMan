/** Fiche produit : aperçu (stock par dépôt), variantes, lots (FEFO),
 *  journal des mouvements, paramètres PAR DÉPÔT (seuil effectif + rayonnage,
 *  E8), historique des prix (E8), numéros de série en stock (E8) —
 *  CRUD complet et archivage/restauration. */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
      show(e instanceof Error ? e.message : "Action impossible", "error");
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
      show(`Code interne généré : ${r.code}`, "success");
      if (variantForm?.id === variantId)
        setVariantForm({ ...variantForm, barcode: r.code });
      refresh();
    } catch (e) {
      show(e instanceof Error ? e.message : "Génération impossible", "error");
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
        variantForm.id ? "Variante mise à jour." : "Variante ajoutée.",
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
      show("Variante supprimée.", "success");
      setVariantDelete(null);
      refresh();
    } catch (e) {
      show(e instanceof Error ? e.message : "Suppression impossible", "error");
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
      show(batchForm.id ? "Lot mis à jour." : "Lot créé.", "success");
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
        <Spinner label="Chargement de la fiche…" />
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
            libelle: `${p.name} (produit)`,
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
              <Badge>Archivé</Badge>
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
                {p.stock_status === "ok"
                  ? "En stock"
                  : p.stock_status === "low"
                    ? "Stock bas"
                    : "Rupture"}
              </Badge>
            )}
          </span>
        }
        sub={
          [p.category_name, p.barcode ? `EAN ${p.barcode}` : null]
            .filter(Boolean)
            .join(" · ") || "Produit"
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
                  ? "Renseignez un code-barres sur la fiche ou une variante pour imprimer des étiquettes"
                  : undefined
              }
            >
              🏷️ Étiquettes
            </Button>
            <Link
              className="btn btn-outline btn-sm"
              to={`/admin/produits/${p.id}/modifier`}
            >
              ✏️ Modifier
            </Link>
            {archived ? (
              <Button
                variant="outline"
                size="sm"
                onClick={toggleArchive}
                loading={busy}
              >
                ♻️ Restaurer
              </Button>
            ) : (
              <Button
                variant="danger-soft"
                size="sm"
                onClick={() => setConfirmArchive(true)}
              >
                🗄️ Archiver
              </Button>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi label="Prix de vente" value={formatMoney(p.selling_price)} />
        <Kpi
          label="Prix d’achat"
          value={formatMoney(p.purchase_price)}
          sub={margin > 0 ? `marge ${formatMoney(margin)}` : undefined}
        />
        <Kpi
          label="CUMP"
          value={formatMoney(p.avg_cost ?? p.purchase_price)}
          sub="coût réel moyen pondéré"
        />
        <Kpi
          label="Stock total"
          value={`${formatQty(totalQty)} ${p.unit_symbol ?? ""}`}
        />
        <Kpi
          label="Seuil d’alerte"
          value={formatQty(p.min_stock_level)}
          tone={totalQty <= p.min_stock_level ? "warn" : undefined}
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "apercu", label: "🏬 Stock par dépôt" },
          { id: "variantes", label: `🎨 Variantes (${p.variants.length})` },
          { id: "lots", label: `📦 Lots (${p.batches.length})` },
          { id: "mouvements", label: "↔️ Mouvements" },
          { id: "depots", label: "⚙️ Par dépôt" },
          { id: "prix", label: "💲 Prix" },
          ...(p.requires_serial
            ? [{ id: "series", label: "🔢 Séries (IMEI)" }]
            : []),
        ]}
      />

      {tab === "apercu" ? (
        <Card pad={false}>
          {p.levels.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState
                emoji="🏬"
                title="Aucun stock enregistré"
                action={
                  <Link
                    className="btn btn-primary btn-sm"
                    to="/admin/receptions"
                  >
                    📥 Faire une réception
                  </Link>
                }
              >
                Créez une réception fournisseur ou un stock initial pour
                alimenter ce produit.
              </EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Dépôt</th>
                    <th>Variante</th>
                    <th className="num">Quantité</th>
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
          title="Variantes"
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
              ➕ Ajouter
            </Button>
          }
          pad={false}
        >
          {p.variants.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState emoji="🎨" title="Aucune variante">
                Ajoutez des variantes (taille, couleur, format) pour vendre au
                détail.
              </EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>SKU</th>
                    <th>Code-barres</th>
                    <th className="num">Supplément</th>
                    <th aria-label="Actions" />
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
                            title="Générer un code-barres interne (EAN-13 magasin)"
                            onClick={() => generateVariantCode(v.id)}
                          >
                            🎲 Générer
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
          title="Lots (gestion FEFO : les ventes piochent les lots qui expirent en premier)"
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
              ➕ Nouveau lot
            </Button>
          }
          pad={false}
        >
          {p.batches.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState emoji="📦" title="Aucun lot">
                Les lots se créent à la réception fournisseur ou manuellement
                ici.
              </EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>N° lot</th>
                    <th>Dépôt</th>
                    <th>Fournisseur</th>
                    <th className="num">Quantité</th>
                    <th>Péremption</th>
                    <th>Reçu le</th>
                    <th aria-label="Actions" />
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
                              Expiré {formatDate(b.expiry_date)}
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
                          title="Traçabilité / rappel de lot"
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
        <Card title="20 derniers mouvements" pad={false}>
          {p.recentMovements.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState emoji="↔️" title="Aucun mouvement" />
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th className="num">Quantité</th>
                    <th className="num">Avant → Après</th>
                    <th>Dépôt</th>
                    <th>Par</th>
                    <th>Motif</th>
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
          title="Archiver le produit"
          message={
            <>
              « {p.name} » ne sera plus vendable ni visible dans le catalogue
              actif. <strong>L’historique des ventes est conservé</strong> et la
              restauration est possible à tout moment.
            </>
          }
          confirmLabel="Archiver"
          onConfirm={toggleArchive}
          onClose={() => setConfirmArchive(false)}
          loading={busy}
        />
      ) : null}

      {variantForm ? (
        <Modal
          title={variantForm.id ? "Modifier la variante" : "Nouvelle variante"}
          onClose={() => !busy && setVariantForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setVariantForm(null)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button
                loading={busy}
                onClick={saveVariant}
                disabled={!variantForm.name.trim()}
              >
                Enregistrer
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
              placeholder="Ex. Rouge 500 ml"
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
            <Field label="Code-barres">
              <Input
                value={variantForm.barcode}
                onChange={(e) =>
                  setVariantForm({ ...variantForm, barcode: e.target.value })
                }
              />
            </Field>
            <Field label="Supplément prix (FCFA)">
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
          title="Supprimer la variante"
          message={
            <>
              Supprimer « {variantDelete.name} » ? Impossible si du stock ou des
              ventes y sont liés.
            </>
          }
          confirmLabel="Supprimer"
          onConfirm={doDeleteVariant}
          onClose={() => setVariantDelete(null)}
          loading={busy}
        />
      ) : null}

      {batchForm ? (
        <Modal
          title={batchForm.id ? "Modifier le lot" : "Nouveau lot"}
          onClose={() => !busy && setBatchForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setBatchForm(null)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button
                loading={busy}
                onClick={saveBatch}
                disabled={
                  !batchForm.batchNumber.trim() ||
                  (!batchForm.id && !batchForm.depotId)
                }
              >
                Enregistrer
              </Button>
            </>
          }
        >
          {!batchForm.id ? (
            <Field label="Dépôt" required>
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
            <Field label="N° de lot" required>
              <Input
                value={batchForm.batchNumber}
                onChange={(e) =>
                  setBatchForm({ ...batchForm, batchNumber: e.target.value })
                }
              />
            </Field>
            <Field label="Quantité">
              <Input
                inputMode="decimal"
                value={batchForm.quantity}
                onChange={(e) =>
                  setBatchForm({ ...batchForm, quantity: e.target.value })
                }
              />
            </Field>
            <Field label="Péremption">
              <Input
                type="date"
                value={batchForm.expiryDate}
                onChange={(e) =>
                  setBatchForm({ ...batchForm, expiryDate: e.target.value })
                }
              />
            </Field>
            <Field label="Fournisseur">
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
            💡 Les réceptions fournisseurs créent et alimentent les lots
            automatiquement ; cet écran sert aux corrections.
          </p>
        </Modal>
      ) : null}

      {trace ? (
        <Modal
          title={`Traçabilité du lot « ${trace.batchNumber} »`}
          onClose={() => setTrace(null)}
          wide
          footer={
            <Button variant="outline" onClick={() => setTrace(null)}>
              Fermer
            </Button>
          }
        >
          {!trace.data ? (
            <Spinner />
          ) : !trace.data.found ? (
            <EmptyState emoji="📦" title="Lot introuvable" />
          ) : (
            <div className="grid" style={{ gap: 12 }}>
              <div>
                <h4 style={{ margin: "4px 0" }}>Reste par dépôt</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Dépôt</th>
                      <th className="num">Quantité</th>
                      <th>Péremption</th>
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
                  Entrées (réceptions fournisseur)
                </h4>
                {trace.data.inflows.length === 0 ? (
                  <p className="muted">Aucune réception rattachée.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Fournisseur</th>
                        <th>Référence</th>
                        <th className="num">Qté</th>
                        <th className="num">Coût</th>
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
                  Sorties (ventes prélevées sur ce lot) — rappel
                </h4>
                {trace.data.outflows.length === 0 ? (
                  <p className="muted">Aucune vente prélevée sur ce lot.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Vente</th>
                        <th>Dépôt</th>
                        <th>Vendeur</th>
                        <th className="num">Qté</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trace.data.outflows.map((o) => (
                        <tr key={o.sale_id}>
                          <td>{formatDateTime(o.created_at)}</td>
                          <td className="mono">
                            #{o.sale_id.slice(0, 8)}
                            {o.status === "VOIDED" ? " (annulée)" : ""}
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
          title="Étiquettes code-barres (A4)"
          onClose={() => setLabelsOpen(false)}
          wide
          footer={
            <>
              <Button variant="outline" onClick={() => setLabelsOpen(false)}>
                Fermer
              </Button>
              <Button onClick={() => window.print()} disabled={!etiquetteOk}>
                🖨️ Imprimer {labelCount} étiquette(s)
              </Button>
            </>
          }
        >
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Code à imprimer">
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
            <Field label="Nombre d'étiquettes">
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
                Aperçu d'une étiquette — {labelCount} exemplaire(s) seront
                imprimés en grille A4 (EAN-13 si le code est un EAN valide, Code
                39 sinon).
              </p>
            </>
          ) : (
            <p className="muted">
              ⚠️ Le code « {cibleEtiquette.code} » contient des caractères non
              imprimables en Code 39 (acceptés : chiffres, lettres sans accent,
              - . espace $ / + %). Corrigez le code-barres de la fiche.
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
      show("Paramètres du dépôt enregistrés.", "success");
      invalidateQueries(`pds:${productId}`);
      invalidateQueries("predictive");
      setEdit(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Seuil d'alerte & rayonnage par dépôt" pad={false}>
      {q.loading ? (
        <div style={{ padding: 18 }}>
          <Spinner label="Chargement…" />
        </div>
      ) : !q.data?.length ? (
        <div style={{ padding: 18 }}>
          <EmptyState emoji="🏬" title="Aucun dépôt" />
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Dépôt</th>
                <th>Seuil d'alerte (surcharge)</th>
                <th>Rayonnage</th>
                <th>Mis à jour</th>
                <th aria-label="Actions" />
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
                      <span className="muted">catalogue</span>
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
                      Modifier
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "10px 14px" }} className="muted">
        Le seuil par dépôt prime sur le seuil catalogue dans les alertes et le
        rapport prédictif cadré sur ce dépôt.
      </div>

      {edit ? (
        <Modal
          title="Paramètres du dépôt"
          onClose={() => !busy && setEdit(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setEdit(null)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button loading={busy} onClick={save}>
                Enregistrer
              </Button>
            </>
          }
        >
          <Field
            label="Seuil d'alerte (ce dépôt)"
            hint="Vide = hériter du seuil catalogue du produit."
          >
            <Input
              inputMode="decimal"
              placeholder="(catalogue)"
              value={edit.minStockLevel}
              onChange={(e) =>
                setEdit({ ...edit, minStockLevel: e.target.value })
              }
            />
          </Field>
          <Field
            label="Rayonnage (bin location)"
            hint="Ex. : A-01-03 (allée A, rayon 01, niveau 03) — facilite le picking et l'inventaire."
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
  const [page, setPage] = useState(1);
  const q = useQuery<Paged<PriceHistoryEntry>>(
    `pricehist:${productId}:${page}`,
    `/pricing/price-history/${productId}?page=${page}&size=15`,
  );
  return (
    <Card title="Historique des changements de prix" pad={false}>
      {q.loading ? (
        <div style={{ padding: 18 }}>
          <Spinner label="Chargement…" />
        </div>
      ) : !q.data?.data.length ? (
        <div style={{ padding: 18 }}>
          <EmptyState emoji="💲" title="Aucun changement de prix historisé">
            Chaque modification du prix de vente (détail) ou du prix de gros est
            consignée avec l'auteur, la date et le motif.
          </EmptyState>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Champ</th>
                <th className="num">Ancien</th>
                <th className="num">Nouveau</th>
                <th>Par</th>
                <th>Motif</th>
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
                      {h.field === "WHOLESALE" ? "Gros" : "Détail"}
                    </Badge>
                  </td>
                  <td className="num muted">
                    {h.old_price != null ? formatMoney(h.old_price) : "—"}
                  </td>
                  <td className="num">
                    {h.new_price != null ? (
                      <strong>{formatMoney(h.new_price)}</strong>
                    ) : (
                      <span className="muted">retiré</span>
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
  const q = useQuery<{ rows: SerialRow[] }>(
    `serials:${productId}`,
    `/serials/product/${productId}`,
  );
  return (
    <Card title="Numéros de série en stock" pad={false}>
      {q.loading ? (
        <div style={{ padding: 18 }}>
          <Spinner label="Chargement…" />
        </div>
      ) : !q.data?.rows.length ? (
        <div style={{ padding: 18 }}>
          <EmptyState emoji="🔢" title="Aucun numéro en stock">
            Les numéros sont enregistrés automatiquement à la réception
            fournisseur (obligatoire pour ce produit sérialisé).
          </EmptyState>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Numéro de série</th>
                <th>Dépôt</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontFamily: "monospace" }}>{s.serial}</td>
                  <td className="muted">{s.depot_name}</td>
                  <td>
                    <Badge tone="ok">En stock</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "10px 14px" }} className="muted">
        Les numéros vendus ne figurent plus ici : utilisez la recherche
        garantie/IMEI (caisse) pour retrouver la vente et la facture d'un
        numéro.
      </div>
    </Card>
  );
}
