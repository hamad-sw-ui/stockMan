/** Création / édition d'un produit : prix, code-barres, seuil, unité de vente,
 *  variantes (création) et stock initial sur un dépôt. */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "../../components/ui";
import { ApiError, patch, post } from "../../lib/http";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { Category, Depot, ProductDetail, Unit } from "../../lib/types";
import { detectBarcodeSymbology } from "../../lib/barcode";

interface VariantForm {
  name: string;
  sku: string;
  barcode: string;
  additionalPrice: string;
}

/** Badge live de symbologie (EAN-13 ✓ / contrôle attendu…) — aide à la saisie. */
function SymbologyBadge({ value }: { value: string }) {
  const b = detectBarcodeSymbology(value);
  if (!value.trim() || !b.label) return null;
  return (
    <span
      role="status"
      style={{
        display: "inline-block",
        marginTop: 4,
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: b.valid ? "#ecfdf5" : "#fef2f2",
        color: b.valid ? "#047857" : "#b91c1c",
        border: `1px solid ${b.valid ? "#a7f3d0" : "#fecaca"}`,
      }}
    >
      {b.label}
    </span>
  );
}

export default function ProductFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { show } = useToast();

  const existing = useQuery<ProductDetail>(
    isEdit ? `product:${id}` : "product:none",
    isEdit ? `/products/${id}` : null,
  );
  const categories = useQuery<Category[]>("categories:list", "/categories");
  const units = useQuery<Unit[]>("units:list", "/units");
  const depots = useQuery<Depot[]>("depots:list", "/depots");

  const [f, setF] = useState({
    name: "",
    description: "",
    categoryId: "",
    barcode: "",
    purchasePrice: "0",
    sellingPrice: "0",
    minStockLevel: "0",
    unitId: "",
    hasVariants: false,
    trackBatch: false,
    requiresSerial: false,
    isWeighed: false,
    taxRate: "19.25",
    wholesalePrice: "",
    wholesaleMinQty: "0",
    priceChangeReason: "",
  });
  const [variants, setVariants] = useState<VariantForm[]>([]);
  const [initial, setInitial] = useState({
    depotId: "",
    quantity: "0",
    batchNumber: "",
    expiryDate: "",
  });
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  /** Conflit d'unicité (409 BARCODE_TAKEN) affiché sous le champ avec lien. */
  const [barcodeConflict, setBarcodeConflict] = useState<{
    message: string;
    productId: string | null;
  } | null>(null);

  /** C2 — tire un EAN-13 interne côté serveur et l'applique au produit. */
  const generateCode = async () => {
    if (!id) return;
    setGenerating(true);
    try {
      const r = await post<{ code: string; is_primary: boolean }>(
        "/products/barcodes/generate",
        { productId: id },
      );
      setF((s) => ({ ...s, barcode: r.code }));
      setBarcodeConflict(null);
      invalidateQueries(`product:${id}`);
      show(`Code interne généré et appliqué : ${r.code}`, "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "Génération impossible", "error");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (isEdit && existing.data) {
      const p = existing.data;
      setF({
        name: p.name,
        description: p.description ?? "",
        categoryId: p.category_id ?? "",
        barcode: p.barcode ?? "",
        purchasePrice: String(p.purchase_price ?? 0),
        sellingPrice: String(p.selling_price ?? 0),
        taxRate: String(p.tax_rate ?? 19.25),
        minStockLevel: String(p.min_stock_level ?? 0),
        unitId: p.unit_id ?? "",
        hasVariants: p.has_variants,
        trackBatch: p.track_batch ?? false,
        requiresSerial: p.requires_serial ?? false,
        isWeighed: p.is_weighed ?? false,
        wholesalePrice:
          p.wholesale_price != null ? String(p.wholesale_price) : "",
        wholesaleMinQty: String(p.wholesale_min_qty ?? 0),
        priceChangeReason: "",
      });
    }
  }, [isEdit, existing.data]);

  // Dépôt par défaut pour le stock initial
  useEffect(() => {
    if (!initial.depotId && depots.data?.length) {
      setInitial((s) => ({
        ...s,
        depotId:
          depots.data!.find((d) => d.is_active)?.id ?? depots.data![0]!.id,
      }));
    }
  }, [depots.data, initial.depotId]);

  const num = (s: string) => {
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  const submit = async () => {
    if (!f.name.trim()) {
      show("Le nom est obligatoire.", "error");
      return;
    }
    if (
      f.hasVariants &&
      !isEdit &&
      variants.filter((v) => v.name.trim()).length === 0
    ) {
      show(
        "Déclarez au moins une variante ou désactivez « Produit à variantes ».",
        "error",
      );
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        // E8 — le motif n'est versé à l'historique que si un prix a bougé.
        const priceMoved = existing.data
          ? num(f.sellingPrice) !== Number(existing.data.selling_price) ||
            (f.wholesalePrice === "" ? null : num(f.wholesalePrice)) !==
              (existing.data.wholesale_price ?? null)
          : false;
        await patch(`/products/${id}`, {
          name: f.name.trim(),
          description: f.description || null,
          categoryId: f.categoryId || null,
          barcode: f.barcode || null,
          purchasePrice: num(f.purchasePrice),
          sellingPrice: num(f.sellingPrice),
          minStockLevel: num(f.minStockLevel),
          taxRate: num(f.taxRate),
          unitId: f.unitId || null,
          hasVariants: f.hasVariants,
          trackBatch: f.trackBatch,
          requiresSerial: f.requiresSerial,
          isWeighed: f.isWeighed,
          wholesalePrice:
            f.wholesalePrice === "" ? null : num(f.wholesalePrice),
          wholesaleMinQty: num(f.wholesaleMinQty),
          priceChangeReason:
            priceMoved && f.priceChangeReason.trim()
              ? f.priceChangeReason.trim()
              : null,
        });
        show("Produit mis à jour.", "success");
        invalidateQueries("products:");
        invalidateQueries(`product:${id}`);
        navigate(`/admin/produits/${id}`);
      } else {
        const created = await post<{ id: string }>("/products", {
          name: f.name.trim(),
          description: f.description || null,
          categoryId: f.categoryId || null,
          barcode: f.barcode || null,
          purchasePrice: num(f.purchasePrice),
          sellingPrice: num(f.sellingPrice),
          minStockLevel: num(f.minStockLevel),
          taxRate: num(f.taxRate),
          unitId: f.unitId || null,
          hasVariants: f.hasVariants,
          trackBatch: f.trackBatch,
          requiresSerial: f.requiresSerial,
          isWeighed: f.isWeighed,
          wholesalePrice:
            f.wholesalePrice === "" ? null : num(f.wholesalePrice),
          wholesaleMinQty: num(f.wholesaleMinQty),
          variants: f.hasVariants
            ? variants
                .filter((v) => v.name.trim())
                .map((v) => ({
                  name: v.name.trim(),
                  sku: v.sku || null,
                  barcode: v.barcode || null,
                  additionalPrice: num(v.additionalPrice),
                }))
            : [],
          initialStock:
            num(initial.quantity) > 0 && initial.depotId
              ? {
                  depotId: initial.depotId,
                  quantity: num(initial.quantity),
                  batchNumber: initial.batchNumber || undefined,
                  expiryDate: initial.expiryDate || null,
                }
              : null,
        });
        show("Produit créé.", "success");
        invalidateQueries("products:");
        navigate(`/admin/produits/${created.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "BARCODE_TAKEN") {
        const d = (e.details ?? {}) as { productId?: string | null };
        setBarcodeConflict({
          message: e.message,
          productId: d.productId ?? null,
        });
      }
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && existing.loading)
    return (
      <div className="wrap">
        <Spinner label="Chargement du produit…" />
      </div>
    );

  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <PageHeader
        title={isEdit ? `Modifier « ${f.name} »` : "Nouveau produit"}
        actions={
          <Link
            className="btn btn-outline btn-sm"
            to={isEdit ? `/admin/produits/${id}` : "/admin/produits"}
          >
            ← Annuler
          </Link>
        }
      />

      <Card title="Informations">
        <Field label="Nom du produit" required>
          <Input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="Ex. Savon Dove 100 g"
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            placeholder="Détails, conditionnement…"
          />
        </Field>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Field label="Catégorie">
            <Select
              value={f.categoryId}
              onChange={(e) => setF({ ...f, categoryId: e.target.value })}
            >
              <option value="">— Sans catégorie —</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Code-barres"
            hint="Scannable en caisse avec une douchette."
          >
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <Input
                  value={f.barcode}
                  onChange={(e) => {
                    setF({ ...f, barcode: e.target.value });
                    setBarcodeConflict(null);
                  }}
                  placeholder="6130000000000"
                />
              </div>
              {isEdit && !f.barcode.trim() ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={generateCode}
                  disabled={generating}
                  title="Générer un code-barres interne (EAN-13 magasin)"
                >
                  {generating ? "…" : "🎲 Générer"}
                </Button>
              ) : null}
            </div>
            <SymbologyBadge value={f.barcode} />
            {barcodeConflict ? (
              <p
                role="alert"
                style={{ margin: "4px 0 0", color: "#b91c1c", fontSize: 13 }}
              >
                {barcodeConflict.message}{" "}
                {barcodeConflict.productId ? (
                  <Link to={`/admin/produits/${barcodeConflict.productId}`}>
                    Voir le produit détenteur →
                  </Link>
                ) : null}
              </p>
            ) : null}
          </Field>
          <Field
            label="Unité de vente"
            hint="L’unité par défaut à la caisse (ex. Pièce, Kg)."
          >
            <Select
              value={f.unitId}
              onChange={(e) => setF({ ...f, unitId: e.target.value })}
            >
              <option value="">— Pièce (défaut) —</option>
              {(units.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.symbol}
                  {u.base_value !== 1 ? ` ×${u.base_value}` : ""})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Prix & alertes">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Field
            label="Prix d’achat (FCFA)"
            hint="Alimente le calcul de marge."
          >
            <Input
              inputMode="decimal"
              value={f.purchasePrice}
              onChange={(e) => setF({ ...f, purchasePrice: e.target.value })}
            />
          </Field>
          <Field label="Prix de vente TTC (FCFA)" required>
            <Input
              inputMode="decimal"
              value={f.sellingPrice}
              onChange={(e) => setF({ ...f, sellingPrice: e.target.value })}
            />
          </Field>
          <Field
            label="TVA (%)"
            hint="19,25 taux normal · 0 produit exonéré (les prix sont TTC : la facture ventile HT/TVA automatiquement)."
          >
            <Select
              value={f.taxRate}
              onChange={(e) => setF({ ...f, taxRate: e.target.value })}
            >
              <option value="19.25">19,25 % (taux normal)</option>
              <option value="0">0 % (exonéré)</option>
            </Select>
          </Field>
          <Field
            label="Seuil d’alerte stock"
            hint="Alerte dès que le stock total descend sous ce seuil (surchargeable par dépôt depuis la fiche produit)."
          >
            <Input
              inputMode="decimal"
              value={f.minStockLevel}
              onChange={(e) => setF({ ...f, minStockLevel: e.target.value })}
            />
          </Field>
          <Field
            label="Prix de gros TTC (FCFA)"
            hint="Grande distribution / demi-gros : laisser vide pour désactiver le canal gros."
          >
            <Input
              inputMode="decimal"
              placeholder="— désactivé —"
              value={f.wholesalePrice}
              onChange={(e) => setF({ ...f, wholesalePrice: e.target.value })}
            />
          </Field>
          <Field
            label="Seuil prix de gros (qté, unité de base)"
            hint="Le prix de gros s'applique aux clients « canal gros » dès cette quantité."
          >
            <Input
              inputMode="decimal"
              value={f.wholesaleMinQty}
              onChange={(e) => setF({ ...f, wholesaleMinQty: e.target.value })}
            />
          </Field>
          {isEdit &&
          existing.data &&
          (num(f.sellingPrice) !== Number(existing.data.selling_price) ||
            (f.wholesalePrice === "" ? null : num(f.wholesalePrice)) !==
              (existing.data.wholesale_price ?? null)) ? (
            <Field
              label="Motif du changement de prix"
              hint="Versé à l'historique horodaté des prix (traçabilité « pourquoi »)."
            >
              <Input
                placeholder="Ex. : hausse fournisseur, fin de série…"
                value={f.priceChangeReason}
                onChange={(e) =>
                  setF({ ...f, priceChangeReason: e.target.value })
                }
              />
            </Field>
          ) : null}
        </div>
        {num(f.sellingPrice) > 0 && num(f.purchasePrice) > 0 ? (
          <p className="muted">
            Marge :{" "}
            <strong>{num(f.sellingPrice) - num(f.purchasePrice)} FCFA</strong> (
            {Math.round(
              (100 * (num(f.sellingPrice) - num(f.purchasePrice))) /
                num(f.sellingPrice),
            )}{" "}
            % du prix de vente)
          </p>
        ) : null}
      </Card>

      <Card title="Variantes">
        <label className="row" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={f.hasVariants}
            onChange={(e) => setF({ ...f, hasVariants: e.target.checked })}
          />
          Ce produit existe en plusieurs variantes (taille, couleur, format…)
        </label>
        <label className="row" style={{ gap: 8, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={f.trackBatch}
            onChange={(e) => setF({ ...f, trackBatch: e.target.checked })}
          />
          Suivi par lot obligatoire (pharmacie, alimentaire…) — numéro de lot
          exigé à chaque réception, vente FEFO tracée, rappel de lot possible
        </label>
        <label className="row" style={{ gap: 8, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={f.requiresSerial}
            onChange={(e) => setF({ ...f, requiresSerial: e.target.checked })}
          />
          Produit sérialisé (téléphonie, électroménager…) — chaque unité est
          identifiée par un numéro de série/IMEI unique : saisi à la réception,
          vendu au numéro près (garantie, vol, SAV)
        </label>
        <label className="row" style={{ gap: 8, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={f.isWeighed}
            onChange={(e) => setF({ ...f, isWeighed: e.target.checked })}
          />
          Article à pesée (boucherie, primeur…) — vendu via les étiquettes de la
          balance : le code-barres ci-dessus est alors le code article à 7
          chiffres « préfixe + article » (ex. 2600123) et la caisse décode
          automatiquement prix ou poids embarqués (mode réglé dans Paramètres)
        </label>
        {f.hasVariants ? (
          isEdit ? (
            <p className="muted">
              Gérez les variantes depuis l’onglet « Variantes » de la fiche
              produit.
            </p>
          ) : (
            <div className="grid" style={{ marginTop: 10 }}>
              {variants.map((v, i) => (
                <div
                  className="row"
                  key={i}
                  style={{ flexWrap: "wrap", alignItems: "flex-end" }}
                >
                  <Field label="Nom" required>
                    <Input
                      value={v.name}
                      onChange={(e) =>
                        setVariants(
                          variants.map((x, j) =>
                            j === i ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Ex. Rouge 500 ml"
                    />
                  </Field>
                  <Field label="SKU">
                    <Input
                      value={v.sku}
                      onChange={(e) =>
                        setVariants(
                          variants.map((x, j) =>
                            j === i ? { ...x, sku: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Code-barres">
                    <Input
                      value={v.barcode}
                      onChange={(e) =>
                        setVariants(
                          variants.map((x, j) =>
                            j === i ? { ...x, barcode: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <SymbologyBadge value={v.barcode} />
                  </Field>
                  <Field label="Supplément (FCFA)">
                    <Input
                      inputMode="decimal"
                      value={v.additionalPrice}
                      onChange={(e) =>
                        setVariants(
                          variants.map((x, j) =>
                            j === i
                              ? { ...x, additionalPrice: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setVariants(variants.filter((_, j) => j !== i))
                    }
                  >
                    🗑️
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setVariants([
                    ...variants,
                    { name: "", sku: "", barcode: "", additionalPrice: "0" },
                  ])
                }
              >
                ➕ Ajouter une variante
              </Button>
            </div>
          )
        ) : null}
      </Card>

      {!isEdit ? (
        <Card title="Stock initial (optionnel)">
          <p className="muted" style={{ marginTop: 0 }}>
            Enregistre immédiatement une entrée de stock sur un dépôt (mouvement
            « Stock initial »).
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Dépôt">
              <Select
                value={initial.depotId}
                onChange={(e) =>
                  setInitial({ ...initial, depotId: e.target.value })
                }
              >
                {(depots.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantité">
              <Input
                inputMode="decimal"
                value={initial.quantity}
                onChange={(e) =>
                  setInitial({ ...initial, quantity: e.target.value })
                }
              />
            </Field>
            <Field label="N° de lot">
              <Input
                value={initial.batchNumber}
                onChange={(e) =>
                  setInitial({ ...initial, batchNumber: e.target.value })
                }
              />
            </Field>
            <Field label="Péremption">
              <Input
                type="date"
                value={initial.expiryDate}
                onChange={(e) =>
                  setInitial({ ...initial, expiryDate: e.target.value })
                }
              />
            </Field>
          </div>
        </Card>
      ) : null}

      <div className="row" style={{ position: "sticky", bottom: 12 }}>
        <Button
          size="lg"
          block
          loading={saving}
          onClick={submit}
          disabled={!f.name.trim()}
        >
          {isEdit ? "💾 Enregistrer les modifications" : "✅ Créer le produit"}
        </Button>
      </div>
    </div>
  );
}
