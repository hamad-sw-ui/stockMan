/** File de synchronisation hors-ligne : ventes mises en attente pendant les
 *  coupures réseau, statuts locaux, rejeu manuel et purge des échecs. */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, PageHeader } from '../../components/ui';
import { formatMoney } from '../../lib/format';
import { listOutbox, retryEntry, type OutboxEntry } from '../../lib/offline/outbox';
import { syncOutbox } from '../../lib/offline/sync';
import { useOnlineStatus } from '../../components/Shell';
import { useToast } from '../../store/toast';

const statusBadge = (s: OutboxEntry['status']) =>
  s === 'QUEUED' ? <Badge tone="info">En file</Badge> : s === 'SYNCING' ? <Badge>Synchronisation…</Badge> : <Badge tone="danger">Échec</Badge>;

export default function SyncQueuePage() {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const online = useOnlineStatus();
  const { show } = useToast();

  const load = useCallback(async () => {
    setEntries(await listOutbox());
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  const syncNow = async () => {
    if (!online) {
      show('Toujours hors-ligne : la synchronisation reprendra automatiquement au retour du réseau.', 'info');
      return;
    }
    setBusy(true);
    try {
      const r = await syncOutbox();
      show(
        r.synced > 0
          ? `${r.synced} vente(s) synchronisée(s) — jamais de doublon grâce à l’identifiant unique.`
          : r.remaining === 0
            ? 'File vide, rien à synchroniser.'
            : 'Aucune vente ne passe pour l’instant (vérifiez le réseau).',
        r.synced > 0 ? 'success' : 'info',
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id: string) => {
    await retryEntry(id);
    await load();
    void syncNow();
  };

  const failed = entries.filter((e) => e.status === 'FAILED');

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <PageHeader
        title="Synchro hors-ligne"
        sub={`${online ? '🟢 En ligne' : '🔴 Hors ligne'} · ${entries.length} vente(s) en attente d’envoi`}
        actions={<Button onClick={syncNow} loading={busy} disabled={entries.length === 0}>🔄 Synchroniser maintenant</Button>}
      />

      {entries.length === 0 ? (
        <EmptyState emoji="✨" title="File vide">
          Les ventes passées pendant une coupure réseau s’affichent ici puis disparaissent une fois synchronisées.
        </EmptyState>
      ) : (
        <>
          {failed.length > 0 ? (
            <p className="banner banner-warn" style={{ borderRadius: 10 }}>
              ⚠️ {failed.length} vente(s) en échec (refus du serveur, ex. stock insuffisant depuis). Vérifiez avec le gérant puis relancez.
            </p>
          ) : null}
          <Card pad={false}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Ticket</th><th>Date locale</th><th className="num">Montant</th><th>Statut</th><th>Essais</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.clientSaleId}>
                      <td>{e.label ?? <code className="muted">{e.clientSaleId.slice(0, 8)}…</code>}</td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(e.createdAt).toLocaleString('fr-FR')}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{e.total != null ? formatMoney(e.total) : '—'}</td>
                      <td>{statusBadge(e.status)}</td>
                      <td className="num muted">{e.attempts}</td>
                      <td>
                        {e.status === 'FAILED' ? (
                          <Button variant="outline" size="sm" onClick={() => retry(e.clientSaleId)}>Réessayer</Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {failed.map((e) => (
            <p key={`err-${e.clientSaleId}`} className="muted" style={{ fontSize: '0.82rem' }}>
              ✖️ {e.label ?? e.clientSaleId.slice(0, 8)} : {e.lastError}
            </p>
          ))}
        </>
      )}

      <Card>
        <h3 style={{ marginTop: 0 }}>Comment ça marche ?</h3>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }} className="muted">
          <li>En coupure réseau, chaque vente est conservée localement avec un identifiant unique.</li>
          <li>Au retour du réseau, l’envoi est automatique (et rejoué sans doublon possible côté serveur).</li>
          <li>Le serveur reste l’autorité finale : prix et disponibilité du stock sont revérifiés à la synchro.</li>
        </ul>
      </Card>
    </div>
  );
}
