/** Fiche produit : aperçu (stock par dépôt), variantes, lots (FEFO) et
 *  journal des mouvements, avec CRUD complet et archivage/restauration. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, Input, Kpi, Modal, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { del, patch, post } from '../../lib/http';
import { formatDate, formatDateTime, formatMoney, formatQty, movementTypeLabel } from '../../lib/format';
import { invalidateQueries, useQuery } from '../../lib/query';
import { useToast } from '../../store/toast';
import type { Batch, Depot, ProductDetail, Supplier, Variant } from '../../lib/types';

export default function ProductDetailPage() {
  const { id } = useParams();
  const { show } = useToast();
  const [tab, setTab] = useState('apercu');
  const q = useQuery<ProductDetail>(`product:${id}`, id ? `/products/${id}` : null);
  const depots = useQuery<Depot[]>('depots:list', '/depots');
  const suppliers = useQuery<Supplier[]>('suppliers:list', '/suppliers');

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);

  // CRUD variante
  const [variantForm, setVariantForm] = useState<{ id?: string; name: string; sku: string; barcode: string; additionalPrice: string } | null>(null);
  const [variantDelete, setVariantDelete] = useState<Variant | null>(null);

  // CRUD lot
  const [batchForm, setBatchForm] = useState<{ id?: string; depotId: string; batchNumber: string; quantity: string; expiryDate: string; supplierId: string } | null>(null);

  const refresh = () => invalidateQueries(`product:${id}`);

  const toggleArchive = async () => {
    setBusy(true);
    try {
      const action = q.data?.archived_at ? 'restore' : 'archive';
      const res = await post<{ message: string }>(`/products/${id}/${action}`);
      show(res.message, 'success');
      invalidateQueries('products:');
      refresh();
      setConfirmArchive(false);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Action impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveVariant = async () => {
    if (!variantForm) return;
    setBusy(true);
    try {
      const body = { name: variantForm.name, sku: variantForm.sku || null, barcode: variantForm.barcode || null, additionalPrice: Number(variantForm.additionalPrice.replace(',', '.')) || 0 };
      if (variantForm.id) await patch(`/products/variants/${variantForm.id}`, body);
      else await post(`/products/${id}/variants`, body);
      show(variantForm.id ? 'Variante mise à jour.' : 'Variante ajoutée.', 'success');
      setVariantForm(null);
      refresh();
      invalidateQueries('products:');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Enregistrement impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDeleteVariant = async () => {
    if (!variantDelete) return;
    setBusy(true);
    try {
      await del(`/products/variants/${variantDelete.id}`);
      show('Variante supprimée.', 'success');
      setVariantDelete(null);
      refresh();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Suppression impossible', 'error');
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
          quantity: Number(batchForm.quantity.replace(',', '.')) || 0,
          expiryDate: batchForm.expiryDate || null,
          supplierId: batchForm.supplierId || null,
        });
      } else {
        await post(`/products/${id}/batches`, {
          depotId: batchForm.depotId,
          batchNumber: batchForm.batchNumber,
          quantity: Number(batchForm.quantity.replace(',', '.')) || 0,
          expiryDate: batchForm.expiryDate || null,
          supplierId: batchForm.supplierId || null,
        });
      }
      show(batchForm.id ? 'Lot mis à jour.' : 'Lot créé.', 'success');
      setBatchForm(null);
      refresh();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Enregistrement impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (q.loading) return <div className="wrap"><Spinner label="Chargement de la fiche…" /></div>;
  if (q.error || !q.data) return <div className="wrap"><ErrorState error={q.error} onRetry={refresh} /></div>;

  const p = q.data;
  const archived = !!p.archived_at;
  const totalQty = p.levels.filter((l) => !l.variant_id).reduce((a, l) => a + l.quantity, 0) || p.total_qty;
  const margin = p.selling_price - p.purchase_price;

  return (
    <div className="wrap">
      <PageHeader
        title={
          <span>
            {p.name} {archived ? <Badge>Archivé</Badge> : <Badge tone={p.stock_status === 'ok' ? 'ok' : p.stock_status === 'low' ? 'warn' : 'danger'}>{p.stock_status === 'ok' ? 'En stock' : p.stock_status === 'low' ? 'Stock bas' : 'Rupture'}</Badge>}
          </span>
        }
        sub={[p.category_name, p.barcode ? `EAN ${p.barcode}` : null].filter(Boolean).join(' · ') || 'Produit'}
        actions={
          <>
            <Link className="btn btn-outline btn-sm" to={`/admin/produits/${p.id}/modifier`}>✏️ Modifier</Link>
            {archived ? (
              <Button variant="outline" size="sm" onClick={toggleArchive} loading={busy}>♻️ Restaurer</Button>
            ) : (
              <Button variant="danger-soft" size="sm" onClick={() => setConfirmArchive(true)}>🗄️ Archiver</Button>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi label="Prix de vente" value={formatMoney(p.selling_price)} />
        <Kpi label="Prix d’achat" value={formatMoney(p.purchase_price)} sub={margin > 0 ? `marge ${formatMoney(margin)}` : undefined} />
        <Kpi label="Stock total" value={`${formatQty(totalQty)} ${p.unit_symbol ?? ''}`} />
        <Kpi label="Seuil d’alerte" value={formatQty(p.min_stock_level)} tone={totalQty <= p.min_stock_level ? 'warn' : undefined} />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'apercu', label: '🏬 Stock par dépôt' },
          { id: 'variantes', label: `🎨 Variantes (${p.variants.length})` },
          { id: 'lots', label: `📦 Lots (${p.batches.length})` },
          { id: 'mouvements', label: '↔️ Mouvements' },
        ]}
      />

      {tab === 'apercu' ? (
        <Card pad={false}>
          {p.levels.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState emoji="🏬" title="Aucun stock enregistré" action={<Link className="btn btn-primary btn-sm" to="/admin/receptions">📥 Faire une réception</Link>}>
                Créez une réception fournisseur ou un stock initial pour alimenter ce produit.
              </EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Dépôt</th><th>Variante</th><th className="num">Quantité</th></tr></thead>
                <tbody>
                  {p.levels.map((l, i) => (
                    <tr key={i}>
                      <td>{l.depot_name}</td>
                      <td className="muted">{l.variant_name ?? '—'}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{formatQty(l.quantity)} {p.unit_symbol ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'variantes' ? (
        <Card title="Variantes" actions={<Button size="sm" onClick={() => setVariantForm({ name: '', sku: '', barcode: '', additionalPrice: '0' })}>➕ Ajouter</Button>} pad={false}>
          {p.variants.length === 0 ? (
            <div style={{ padding: 18 }}><EmptyState emoji="🎨" title="Aucune variante">Ajoutez des variantes (taille, couleur, format) pour vendre au détail.</EmptyState></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nom</th><th>SKU</th><th>Code-barres</th><th className="num">Supplément</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {p.variants.map((v) => (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600 }}>{v.name}</td>
                      <td className="muted">{v.sku ?? '—'}</td>
                      <td className="muted">{v.barcode ? <code>{v.barcode}</code> : '—'}</td>
                      <td className="num">{v.additional_price ? `+${formatMoney(v.additional_price)}` : '—'}</td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          <Button variant="ghost" size="sm" onClick={() => setVariantForm({ id: v.id, name: v.name, sku: v.sku ?? '', barcode: v.barcode ?? '', additionalPrice: String(v.additional_price ?? 0) })}>✏️</Button>
                          <Button variant="ghost" size="sm" onClick={() => setVariantDelete(v)}>🗑️</Button>
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

      {tab === 'lots' ? (
        <Card
          title="Lots (gestion FEFO : les ventes piochent les lots qui expirent en premier)"
          actions={<Button size="sm" onClick={() => setBatchForm({ depotId: depots.data?.[0]?.id ?? '', batchNumber: '', quantity: '0', expiryDate: '', supplierId: '' })}>➕ Nouveau lot</Button>}
          pad={false}
        >
          {p.batches.length === 0 ? (
            <div style={{ padding: 18 }}><EmptyState emoji="📦" title="Aucun lot">Les lots se créent à la réception fournisseur ou manuellement ici.</EmptyState></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>N° lot</th><th>Dépôt</th><th>Fournisseur</th><th className="num">Quantité</th><th>Péremption</th><th>Reçu le</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {p.batches.map((b: Batch) => (
                    <tr key={b.id}>
                      <td className="mono" style={{ fontWeight: 600 }}>{b.batch_number}</td>
                      <td className="muted">{b.depot_name ?? '—'}</td>
                      <td className="muted">{b.supplier_name ?? '—'}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{formatQty(b.quantity)}</td>
                      <td>
                        {b.expiry_date ? (
                          new Date(b.expiry_date).getTime() < Date.now() ? <Badge tone="danger">Expiré {formatDate(b.expiry_date)}</Badge> : formatDate(b.expiry_date)
                        ) : '—'}
                      </td>
                      <td className="muted">{formatDate(b.received_date)}</td>
                      <td>
                        <Button variant="ghost" size="sm" onClick={() => setBatchForm({ id: b.id, depotId: b.depot_id, batchNumber: b.batch_number, quantity: String(b.quantity), expiryDate: b.expiry_date?.slice(0, 10) ?? '', supplierId: b.supplier_id ?? '' })}>✏️</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'mouvements' ? (
        <Card title="20 derniers mouvements" pad={false}>
          {p.recentMovements.length === 0 ? (
            <div style={{ padding: 18 }}><EmptyState emoji="↔️" title="Aucun mouvement" /></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Type</th><th className="num">Quantité</th><th className="num">Avant → Après</th><th>Dépôt</th><th>Par</th><th>Motif</th></tr></thead>
                <tbody>
                  {p.recentMovements.map((m) => (
                    <tr key={m.id}>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(m.created_at)}</td>
                      <td><Badge tone={m.type === 'OUT' || m.type === 'DAMAGE' || m.type === 'EXPIRED' ? 'danger' : m.type === 'IN' || m.type === 'RETURN' ? 'ok' : 'info'}>{movementTypeLabel(m.type)}</Badge></td>
                      <td className="num">{formatQty(m.quantity)}</td>
                      <td className="num muted">{m.previous_stock != null && m.new_stock != null ? `${formatQty(m.previous_stock)} → ${formatQty(m.new_stock)}` : '—'}</td>
                      <td className="muted">{m.depot_name}</td>
                      <td className="muted">{m.user_name ?? '—'}</td>
                      <td className="muted">{m.reason ?? '—'}</td>
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
          message={<>« {p.name} » ne sera plus vendable ni visible dans le catalogue actif. <strong>L’historique des ventes est conservé</strong> et la restauration est possible à tout moment.</>}
          confirmLabel="Archiver"
          onConfirm={toggleArchive}
          onClose={() => setConfirmArchive(false)}
          loading={busy}
        />
      ) : null}

      {variantForm ? (
        <Modal title={variantForm.id ? 'Modifier la variante' : 'Nouvelle variante'} onClose={() => !busy && setVariantForm(null)}
          footer={<>
            <Button variant="outline" onClick={() => setVariantForm(null)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={saveVariant} disabled={!variantForm.name.trim()}>Enregistrer</Button>
          </>}>
          <Field label="Nom" required><Input value={variantForm.name} onChange={(e) => setVariantForm({ ...variantForm, name: e.target.value })} placeholder="Ex. Rouge 500 ml" /></Field>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Field label="SKU"><Input value={variantForm.sku} onChange={(e) => setVariantForm({ ...variantForm, sku: e.target.value })} /></Field>
            <Field label="Code-barres"><Input value={variantForm.barcode} onChange={(e) => setVariantForm({ ...variantForm, barcode: e.target.value })} /></Field>
            <Field label="Supplément prix (FCFA)"><Input inputMode="decimal" value={variantForm.additionalPrice} onChange={(e) => setVariantForm({ ...variantForm, additionalPrice: e.target.value })} /></Field>
          </div>
        </Modal>
      ) : null}

      {variantDelete ? (
        <ConfirmModal
          title="Supprimer la variante"
          message={<>Supprimer « {variantDelete.name} » ? Impossible si du stock ou des ventes y sont liés.</>}
          confirmLabel="Supprimer"
          onConfirm={doDeleteVariant}
          onClose={() => setVariantDelete(null)}
          loading={busy}
        />
      ) : null}

      {batchForm ? (
        <Modal title={batchForm.id ? 'Modifier le lot' : 'Nouveau lot'} onClose={() => !busy && setBatchForm(null)}
          footer={<>
            <Button variant="outline" onClick={() => setBatchForm(null)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={saveBatch} disabled={!batchForm.batchNumber.trim() || (!batchForm.id && !batchForm.depotId)}>Enregistrer</Button>
          </>}>
          {!batchForm.id ? (
            <Field label="Dépôt" required>
              <Select value={batchForm.depotId} onChange={(e) => setBatchForm({ ...batchForm, depotId: e.target.value })}>
                {(depots.data ?? []).filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
          ) : null}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Field label="N° de lot" required><Input value={batchForm.batchNumber} onChange={(e) => setBatchForm({ ...batchForm, batchNumber: e.target.value })} /></Field>
            <Field label="Quantité"><Input inputMode="decimal" value={batchForm.quantity} onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })} /></Field>
            <Field label="Péremption"><Input type="date" value={batchForm.expiryDate} onChange={(e) => setBatchForm({ ...batchForm, expiryDate: e.target.value })} /></Field>
            <Field label="Fournisseur">
              <Select value={batchForm.supplierId} onChange={(e) => setBatchForm({ ...batchForm, supplierId: e.target.value })}>
                <option value="">—</option>
                {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem' }}>💡 Les réceptions fournisseurs créent et alimentent les lots automatiquement ; cet écran sert aux corrections.</p>
        </Modal>
      ) : null}
    </div>
  );
}
