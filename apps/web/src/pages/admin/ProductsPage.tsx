/** Catalogue produits : recherche serveur, filtres (catégorie, dépôt, statut),
 *  pagination, export CSV, archivage (soft-delete). */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Select, Spinner } from '../../components/ui';
import { download } from '../../lib/http';
import { formatMoney, formatQty, stockStatusLabel } from '../../lib/format';
import { invalidateQueries, useQuery } from '../../lib/query';
import { useToast } from '../../store/toast';
import type { Category, Depot, Paged, ProductListItem } from '../../lib/types';

const tone = (s: 'ok' | 'low' | 'out'): 'ok' | 'warn' | 'danger' => (s === 'ok' ? 'ok' : s === 'low' ? 'warn' : 'danger');

export default function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [page, setPage] = useState(1);
  const { show } = useToast();
  const navigate = useNavigate();

  const categoryId = params.get('categoryId') ?? '';
  const depotId = params.get('depotId') ?? '';
  const status = params.get('status') ?? '';

  // Recherche débouncée (400 ms)
  const [q, setQ] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setQ(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const qs = new URLSearchParams({ page: String(page), size: '20' });
  if (q) qs.set('search', q);
  if (categoryId) qs.set('categoryId', categoryId);
  if (depotId) qs.set('depotId', depotId);
  if (status) qs.set('status', status);
  const path = `/products?${qs}`;

  const products = useQuery<Paged<ProductListItem>>(`products:${path}`, path);
  const categories = useQuery<Category[]>('categories:list', '/categories');
  const depots = useQuery<Depot[]>('depots:list', '/depots');

  useEffect(() => setPage(1), [q, categoryId, depotId, status]);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const exportCsv = async () => {
    try {
      await download('/products/export/csv', 'catalogue-stockman.csv');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Export impossible', 'error');
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title="Produits"
        sub={products.data ? `${products.data.total} référence(s)` : 'Catalogue et niveaux de stock'}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv}>⬇️ CSV</Button>
            <Link className="btn btn-primary btn-sm" to="/admin/produits/nouveau">➕ Nouveau produit</Link>
          </>
        }
      />

      <Card className="filters">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Nom, code-barres ou catégorie…" autoFocus />
          <Select value={categoryId} onChange={(e) => setParam('categoryId', e.target.value)} style={{ width: 'auto' }} aria-label="Filtrer par catégorie">
            <option value="">Toutes catégories</option>
            {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={depotId} onChange={(e) => setParam('depotId', e.target.value)} style={{ width: 'auto' }} aria-label="Filtrer par dépôt">
            <option value="">Tous dépôts</option>
            {(depots.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setParam('status', e.target.value)} style={{ width: 'auto' }} aria-label="Filtrer par statut">
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
        <ErrorState error={products.error} onRetry={() => invalidateQueries('products:')} />
      ) : !products.data?.data.length ? (
        <EmptyState
          emoji="📦"
          title={q || categoryId || status ? 'Aucun produit ne correspond aux filtres' : 'Votre catalogue est vide'}
          action={<Link className="btn btn-primary" to="/admin/produits/nouveau">➕ Créer le premier produit</Link>}
        >
          {q || categoryId || status ? 'Essayez d’élargir la recherche.' : 'Ajoutez vos produits pour commencer à vendre.'}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Catégorie</th>
                  <th className="num">Prix vente</th>
                  <th className="num">Stock{depotId ? ` (${(depots.data ?? []).find((d) => d.id === depotId)?.name ?? 'dépôt'})` : ' total'}</th>
                  <th>Statut</th>
                  <th className="num">Seuil</th>
                </tr>
              </thead>
              <tbody>
                {products.data.data.map((p) => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/produits/${p.id}`)}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {p.barcode ? <code>{p.barcode}</code> : null}
                        {p.variant_count > 0 ? ` · ${p.variant_count} variante(s)` : ''}
                        {p.unit_symbol ? ` · vendu en ${p.unit_symbol}` : ''}
                        {p.archived_at ? ' · archivé' : ''}
                      </div>
                    </td>
                    <td className="muted">{p.category_name ?? '—'}</td>
                    <td className="num">{formatMoney(p.selling_price)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatQty(depotId ? p.depot_qty : p.total_qty)} {p.unit_symbol ?? ''}
                    </td>
                    <td>
                      {p.archived_at ? <Badge>Archivé</Badge> : <Badge tone={tone(p.stock_status)}>{stockStatusLabel(p.stock_status)}</Badge>}
                    </td>
                    <td className="num muted">{formatQty(p.min_stock_level)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {products.data ? <Pagination page={products.data.page} totalPages={products.data.totalPages} total={products.data.total} onPage={setPage} /> : null}
    </div>
  );
}
