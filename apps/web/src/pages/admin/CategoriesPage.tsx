/** Catégories : CRUD simple avec blocage de suppression si utilisée. */
import { useState } from 'react';
import { Button, Card, ConfirmModal, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Spinner } from '../../components/ui';
import { del, patch, post } from '../../lib/http';
import { invalidateQueries, useQuery } from '../../lib/query';
import { useToast } from '../../store/toast';
import type { Category } from '../../lib/types';

export default function CategoriesPage() {
  const { show } = useToast();
  const q = useQuery<Category[]>('categories:list', '/categories');
  const [form, setForm] = useState<{ id?: string; name: string; description: string; sortOrder: string } | null>(null);
  const [toDelete, setToDelete] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body = { name: form.name.trim(), description: form.description || null, sortOrder: Number(form.sortOrder) || 0 };
      if (form.id) await patch(`/categories/${form.id}`, body);
      else await post('/categories', body);
      show(form.id ? 'Catégorie mise à jour.' : 'Catégorie créée.', 'success');
      invalidateQueries('categories:');
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
      await del(`/categories/${toDelete.id}`);
      show('Catégorie supprimée.', 'success');
      invalidateQueries('categories:');
      setToDelete(null);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Suppression impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 860 }}>
      <PageHeader title="Catégories" sub="Organisation du catalogue" actions={<Button onClick={() => setForm({ name: '', description: '', sortOrder: '0' })}>➕ Nouvelle catégorie</Button>} />
      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => invalidateQueries('categories:')} />
      ) : !q.data?.length ? (
        <EmptyState emoji="🏷️" title="Aucune catégorie" action={<Button onClick={() => setForm({ name: '', description: '', sortOrder: '0' })}>Créer la première</Button>}>
          Les catégories aident à retrouver les produits en caisse.
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nom</th><th>Description</th><th className="num">Ordre</th><th className="num">Produits</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {q.data.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700 }}>{c.name}</td>
                    <td className="muted">{c.description ?? '—'}</td>
                    <td className="num muted">{c.sort_order}</td>
                    <td className="num">{c.product_count ?? 0}</td>
                    <td>
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <Button variant="ghost" size="sm" onClick={() => setForm({ id: c.id, name: c.name, description: c.description ?? '', sortOrder: String(c.sort_order) })}>✏️</Button>
                        <Button variant="ghost" size="sm" onClick={() => setToDelete(c)}>🗑️</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {form ? (
        <Modal title={form.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'} onClose={() => !busy && setForm(null)}
          footer={<>
            <Button variant="outline" onClick={() => setForm(null)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={save} disabled={!form.name.trim()}>Enregistrer</Button>
          </>}>
          <Field label="Nom" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Ordre d’affichage" hint="Plus petit = affiché en premier en caisse.">
            <Input inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          </Field>
        </Modal>
      ) : null}

      {toDelete ? (
        <ConfirmModal
          title="Supprimer la catégorie"
          message={<>Supprimer « {toDelete.name} » ? {(toDelete.product_count ?? 0) > 0 ? <>Elle contient <strong>{toDelete.product_count} produit(s)</strong> : la suppression sera refusée tant que des produits l’utilisent.</> : 'Aucun produit ne l’utilise.'}</>}
          confirmLabel="Supprimer"
          onConfirm={doDelete}
          onClose={() => setToDelete(null)}
          loading={busy}
        />
      ) : null}
    </div>
  );
}
