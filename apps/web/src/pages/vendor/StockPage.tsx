/** Stock du dépôt (vendeur) : consultation des niveaux disponibles à la vente,
 *  recherche rapide, indication des seuils. */
import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, PageHeader, SearchInput, Spinner } from '../../components/ui';
import { formatQty } from '../../lib/format';
import { invalidateQueries, useQuery } from '../../lib/query';
import { useAuth } from '../../store/auth';

interface DepotStockRow {
  id: string;
  name: string;
  barcode: string | null;
  selling_price: number;
  min_stock_level: number;
  unit_symbol: string | null;
  quantity: number;
}

export default function StockPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const depotId = user?.depotId;
  const path = depotId ? `/depots/${depotId}/stock${search ? `?search=${encodeURIComponent(search)}` : ''}` : null;
  const q = useQuery<DepotStockRow[]>(`depot-stock:${path ?? 'none'}`, path);

  if (!depotId) {
    return (
      <div className="wrap">
        <PageHeader title="Stock du dépôt" />
        <EmptyState emoji="🏬" title="Aucun dépôt affecté">Demandez à votre gérant de vous affecter à un dépôt pour consulter son stock.</EmptyState>
      </div>
    );
  }

  const low = (q.data ?? []).filter((r) => r.quantity > 0 && r.quantity <= r.min_stock_level).length;
  const out = (q.data ?? []).filter((r) => r.quantity <= 0).length;

  return (
    <div className="wrap">
      <PageHeader title="Stock de mon dépôt" sub={q.data ? `${q.data.length} produit(s) · ${low} en alerte · ${out} en rupture` : 'Niveaux disponibles à la vente'} />
      <Card className="filters">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom ou code-barres…" autoFocus />
      </Card>
      {q.loading ? (
        <Spinner label="Chargement du stock…" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => invalidateQueries('depot-stock:')} />
      ) : !q.data?.length ? (
        <EmptyState emoji="📦" title="Aucun produit trouvé">{search ? 'Essayez une autre recherche.' : 'Le dépôt n’a pas encore de stock.'}</EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Produit</th><th className="num">Disponible</th><th>Statut</th></tr></thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      {r.barcode ? <code className="muted" style={{ fontSize: '0.78rem' }}>{r.barcode}</code> : null}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{formatQty(r.quantity)} {r.unit_symbol ?? ''}</td>
                    <td>
                      {r.quantity <= 0 ? <Badge tone="danger">Rupture</Badge> : r.quantity <= r.min_stock_level ? <Badge tone="warn">Stock bas</Badge> : <Badge tone="ok">OK</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 10 }}>
        ⚠️ Tout écart constaté en rayon doit être signalé au gérant : seul l’administrateur ajuste le stock (chaque correction est tracée dans le journal).
      </p>
    </div>
  );
}
