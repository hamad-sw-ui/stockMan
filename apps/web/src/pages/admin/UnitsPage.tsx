/** Unités de vente et conversions : unité de base (Pièce) et unités dérivées
 *  (Carton ×12, Kg…) utilisées à la caisse avec déduction automatique. */
import { useState } from 'react';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Spinner } from '../../components/ui';
import { del, patch, post } from '../../lib/http';
import { invalidateQueries, useQuery } from '../../lib/query';
import { useToast } from '../../store/toast';
import type { Unit } from '../../lib/types';

export default function UnitsPage() {
  const { show } = useToast();
  const q = useQuery<Unit[]>('units:list', '/units');
  const [form, setForm] = useState<{ id?: string; name: string; symbol: string; baseValue: string; isBase: boolean } | null>(null);
  const [toDelete, setToDelete] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form) return;
    const baseValue = Number(form.baseValue.replace(',', '.'));
    if (!(baseValue > 0)) {
      show('Le facteur de conversion doit être positif.', 'error');
      return;
    }
    setBusy(true);
    try {
      const body = { name: form.name.trim(), symbol: form.symbol.trim(), baseValue, isBase: form.isBase };
      if (form.id) await patch(`/units/${form.id}`, body);
      else await post('/units', body);
      show(form.id ? 'Unité mise à jour.' : 'Unité créée.', 'success');
      invalidateQueries('units:');
      setForm(null);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Enregistrement impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await del(`/units/${toDelete.id}`);
      show('Unité supprimée.', 'success');
      invalidateQueries('units:');
      setToDelete(null);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Suppression impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 860 }}>
      <PageHeader
        title="Unités & conversions"
        sub="Vendez à la pièce ou au carton : 1 Carton = 12 Pièces par exemple — la caisse convertit automatiquement."
        actions={<Button onClick={() => setForm({ name: '', symbol: '', baseValue: '1', isBase: false })}>➕ Nouvelle unité</Button>}
      />
      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => invalidateQueries('units:')} />
      ) : !q.data?.length ? (
        <EmptyState emoji="📏" title="Aucune unité" action={<Button onClick={() => setForm({ name: 'Pièce', symbol: 'Pce', baseValue: '1', isBase: true })}>Créer « Pièce »</Button>}>
          Commencez par l’unité de base (Pièce, facteur 1), puis ajoutez les unités dérivées.
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nom</th><th>Symbole</th><th className="num">Facteur</th><th>Rôle</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {q.data.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 700 }}>{u.name}</td>
                    <td className="muted">{u.symbol}</td>
                    <td className="num">×{u.base_value}</td>
                    <td>{u.is_base ? <Badge tone="info">Unité de base</Badge> : <Badge>Dérivée</Badge>}</td>
                    <td>
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <Button variant="ghost" size="sm" onClick={() => setForm({ id: u.id, name: u.name, symbol: u.symbol, baseValue: String(u.base_value), isBase: u.is_base })}>✏️</Button>
                        <Button variant="ghost" size="sm" onClick={() => setToDelete(u)}>🗑️</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 10 }}>
        ⚠️ Une unité ayant servi des ventes voit son facteur verrouillé pour protéger l’historique.
      </p>

      {form ? (
        <Modal title={form.id ? 'Modifier l’unité' : 'Nouvelle unité'} onClose={() => !busy && setForm(null)}
          footer={<>
            <Button variant="outline" onClick={() => setForm(null)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={save} disabled={!form.name.trim() || !form.symbol.trim()}>Enregistrer</Button>
          </>}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Field label="Nom" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Carton" /></Field>
            <Field label="Symbole" required><Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="Ctn" /></Field>
            <Field label="Facteur de conversion" hint="1 Carton = 12 unités de base → facteur 12.">
              <Input inputMode="decimal" value={form.baseValue} onChange={(e) => setForm({ ...form, baseValue: e.target.value })} />
            </Field>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={form.isBase} onChange={(e) => setForm({ ...form, isBase: e.target.checked })} /> Unité de base (facteur 1)
          </label>
        </Modal>
      ) : null}

      {toDelete ? (
        <ConfirmModal
          title="Supprimer l’unité"
          message={<>Supprimer « {toDelete.name} » ? Refusé si des produits l’utilisent.</>}
          confirmLabel="Supprimer"
          onConfirm={doDelete}
          onClose={() => setToDelete(null)}
          loading={busy}
        />
      ) : null}
    </div>
  );
}
