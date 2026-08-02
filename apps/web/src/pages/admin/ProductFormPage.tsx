/** Création / édition d'un produit : prix, code-barres, seuil, unité de vente,
 *  variantes (création) et stock initial sur un dépôt. */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '../../components/ui';
import { patch, post } from '../../lib/http';
import { invalidateQueries, useQuery } from '../../lib/query';
import { useToast } from '../../store/toast';
import type { Category, Depot, ProductDetail, Unit } from '../../lib/types';

interface VariantForm {
  name: string;
  sku: string;
  barcode: string;
  additionalPrice: string;
}

export default function ProductFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { show } = useToast();

  const existing = useQuery<ProductDetail>(isEdit ? `product:${id}` : 'product:none', isEdit ? `/products/${id}` : null);
  const categories = useQuery<Category[]>('categories:list', '/categories');
  const units = useQuery<Unit[]>('units:list', '/units');
  const depots = useQuery<Depot[]>('depots:list', '/depots');

  const [f, setF] = useState({
    name: '',
    description: '',
    categoryId: '',
    barcode: '',
    purchasePrice: '0',
    sellingPrice: '0',
    minStockLevel: '0',
    unitId: '',
    hasVariants: false,
  });
  const [variants, setVariants] = useState<VariantForm[]>([]);
  const [initial, setInitial] = useState({ depotId: '', quantity: '0', batchNumber: '', expiryDate: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEdit && existing.data) {
      const p = existing.data;
      setF({
        name: p.name,
        description: p.description ?? '',
        categoryId: p.category_id ?? '',
        barcode: p.barcode ?? '',
        purchasePrice: String(p.purchase_price ?? 0),
        sellingPrice: String(p.selling_price ?? 0),
        minStockLevel: String(p.min_stock_level ?? 0),
        unitId: p.unit_id ?? '',
        hasVariants: p.has_variants,
      });
    }
  }, [isEdit, existing.data]);

  // Dépôt par défaut pour le stock initial
  useEffect(() => {
    if (!initial.depotId && depots.data?.length) {
      setInitial((s) => ({ ...s, depotId: depots.data!.find((d) => d.is_active)?.id ?? depots.data![0]!.id }));
    }
  }, [depots.data, initial.depotId]);

  const num = (s: string) => {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  const submit = async () => {
    if (!f.name.trim()) {
      show('Le nom est obligatoire.', 'error');
      return;
    }
    if (f.hasVariants && !isEdit && variants.filter((v) => v.name.trim()).length === 0) {
      show('Déclarez au moins une variante ou désactivez « Produit à variantes ».', 'error');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await patch(`/products/${id}`, {
          name: f.name.trim(),
          description: f.description || null,
          categoryId: f.categoryId || null,
          barcode: f.barcode || null,
          purchasePrice: num(f.purchasePrice),
          sellingPrice: num(f.sellingPrice),
          minStockLevel: num(f.minStockLevel),
          unitId: f.unitId || null,
          hasVariants: f.hasVariants,
        });
        show('Produit mis à jour.', 'success');
        invalidateQueries('products:');
        invalidateQueries(`product:${id}`);
        navigate(`/admin/produits/${id}`);
      } else {
        const created = await post<{ id: string }>('/products', {
          name: f.name.trim(),
          description: f.description || null,
          categoryId: f.categoryId || null,
          barcode: f.barcode || null,
          purchasePrice: num(f.purchasePrice),
          sellingPrice: num(f.sellingPrice),
          minStockLevel: num(f.minStockLevel),
          unitId: f.unitId || null,
          hasVariants: f.hasVariants,
          variants: f.hasVariants
            ? variants.filter((v) => v.name.trim()).map((v) => ({
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
        show('Produit créé.', 'success');
        invalidateQueries('products:');
        navigate(`/admin/produits/${created.id}`);
      }
    } catch (e) {
      show(e instanceof Error ? e.message : 'Enregistrement impossible', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && existing.loading) return <div className="wrap"><Spinner label="Chargement du produit…" /></div>;

  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <PageHeader
        title={isEdit ? `Modifier « ${f.name} »` : 'Nouveau produit'}
        actions={<Link className="btn btn-outline btn-sm" to={isEdit ? `/admin/produits/${id}` : '/admin/produits'}>← Annuler</Link>}
      />

      <Card title="Informations">
        <Field label="Nom du produit" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex. Savon Dove 100 g" />
        </Field>
        <Field label="Description">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Détails, conditionnement…" />
        </Field>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label="Catégorie">
            <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
              <option value="">— Sans catégorie —</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Code-barres" hint="Scannable en caisse avec une douchette.">
            <Input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} placeholder="6130000000000" />
          </Field>
          <Field label="Unité de vente" hint="L’unité par défaut à la caisse (ex. Pièce, Kg).">
            <Select value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>
              <option value="">— Pièce (défaut) —</option>
              {(units.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.symbol}{u.base_value !== 1 ? ` ×${u.base_value}` : ''})</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Prix & alertes">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label="Prix d’achat (FCFA)" hint="Alimente le calcul de marge.">
            <Input inputMode="decimal" value={f.purchasePrice} onChange={(e) => setF({ ...f, purchasePrice: e.target.value })} />
          </Field>
          <Field label="Prix de vente (FCFA)" required>
            <Input inputMode="decimal" value={f.sellingPrice} onChange={(e) => setF({ ...f, sellingPrice: e.target.value })} />
          </Field>
          <Field label="Seuil d’alerte stock" hint="Alerte dès que le stock total descend sous ce seuil.">
            <Input inputMode="decimal" value={f.minStockLevel} onChange={(e) => setF({ ...f, minStockLevel: e.target.value })} />
          </Field>
        </div>
        {num(f.sellingPrice) > 0 && num(f.purchasePrice) > 0 ? (
          <p className="muted">
            Marge : <strong>{num(f.sellingPrice) - num(f.purchasePrice)} FCFA</strong> (
            {Math.round((100 * (num(f.sellingPrice) - num(f.purchasePrice))) / num(f.sellingPrice))} % du prix de vente)
          </p>
        ) : null}
      </Card>

      <Card title="Variantes">
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={f.hasVariants} onChange={(e) => setF({ ...f, hasVariants: e.target.checked })} />
          Ce produit existe en plusieurs variantes (taille, couleur, format…)
        </label>
        {f.hasVariants ? (
          isEdit ? (
            <p className="muted">Gérez les variantes depuis l’onglet « Variantes » de la fiche produit.</p>
          ) : (
            <div className="grid" style={{ marginTop: 10 }}>
              {variants.map((v, i) => (
                <div className="row" key={i} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <Field label="Nom" required><Input value={v.name} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Ex. Rouge 500 ml" /></Field>
                  <Field label="SKU"><Input value={v.sku} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))} /></Field>
                  <Field label="Code-barres"><Input value={v.barcode} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, barcode: e.target.value } : x)))} /></Field>
                  <Field label="Supplément (FCFA)"><Input inputMode="decimal" value={v.additionalPrice} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, additionalPrice: e.target.value } : x)))} /></Field>
                  <Button variant="ghost" size="sm" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>🗑️</Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setVariants([...variants, { name: '', sku: '', barcode: '', additionalPrice: '0' }])}>
                ➕ Ajouter une variante
              </Button>
            </div>
          )
        ) : null}
      </Card>

      {!isEdit ? (
        <Card title="Stock initial (optionnel)">
          <p className="muted" style={{ marginTop: 0 }}>Enregistre immédiatement une entrée de stock sur un dépôt (mouvement « Stock initial »).</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Field label="Dépôt">
              <Select value={initial.depotId} onChange={(e) => setInitial({ ...initial, depotId: e.target.value })}>
                {(depots.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Quantité"><Input inputMode="decimal" value={initial.quantity} onChange={(e) => setInitial({ ...initial, quantity: e.target.value })} /></Field>
            <Field label="N° de lot"><Input value={initial.batchNumber} onChange={(e) => setInitial({ ...initial, batchNumber: e.target.value })} /></Field>
            <Field label="Péremption"><Input type="date" value={initial.expiryDate} onChange={(e) => setInitial({ ...initial, expiryDate: e.target.value })} /></Field>
          </div>
        </Card>
      ) : null}

      <div className="row" style={{ position: 'sticky', bottom: 12 }}>
        <Button size="lg" block loading={saving} onClick={submit} disabled={!f.name.trim()}>
          {isEdit ? '💾 Enregistrer les modifications' : '✅ Créer le produit'}
        </Button>
      </div>
    </div>
  );
}
