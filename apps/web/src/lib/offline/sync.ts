/** Moteur de (re)synchronisation de la file hors-ligne.
 *  - FIFO stricte ;
 *  - succès → sortie de file (le serveur déduplique via clientSaleId : rejouer
 *    ne crée jamais de doublon) ;
 *  - erreur réseau → conservée QUEUED (réessai plus tard) ;
 *  - erreur métier 4xx → FAILED + message (action utilisateur requise).
 */
import { ApiError, post } from '../http';
import { listOutbox, markFailed, markSyncing, removeEntry, type OutboxEntry } from './outbox';

export interface SyncReport {
  synced: number;
  failed: number;
  remaining: number;
}

let running: Promise<SyncReport> | null = null;
const listeners = new Set<(r: SyncReport) => void>();

export function onSyncComplete(l: (r: SyncReport) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

async function pushOne(entry: OutboxEntry): Promise<'ok' | 'retry' | 'failed'> {
  try {
    await markSyncing(entry.clientSaleId);
    await post('/sales', entry.payload, { skipAuthRetry: false });
    await removeEntry(entry.clientSaleId);
    return 'ok';
  } catch (err) {
    if (err instanceof ApiError && err.status > 0 && err.status < 500 && err.status !== 401) {
      // Erreur métier (stock insuffisant, licence…) : pas de réémission automatique
      await markFailed(entry.clientSaleId, `${err.code} — ${err.message}`);
      return 'failed';
    }
    // Réseau ou 5xx : QUEUED (le markSyncing a seulement incrémenté attempts)
    const e = { ...(await listOutbox()).find((x) => x.clientSaleId === entry.clientSaleId) } as OutboxEntry | undefined;
    if (e && e.status === 'SYNCING') {
      await markFailed(entry.clientSaleId, 'EN_ATTENTE_RESEAU');
      const again = (await listOutbox()).find((x) => x.clientSaleId === entry.clientSaleId);
      if (again) {
        // repasse en QUEUED pour le prochain cycle
        const { retryEntry } = await import('./outbox');
        await retryEntry(entry.clientSaleId);
      }
    }
    return 'retry';
  }
}

export function syncOutbox(): Promise<SyncReport> {
  running ??= (async () => {
    let synced = 0;
    let failed = 0;
    const queue = await listOutbox();
    for (const entry of queue) {
      if (entry.status === 'SYNCING') continue;
      const result = await pushOne(entry);
      if (result === 'ok') synced += 1;
      else if (result === 'failed') failed += 1;
      else break; // réseau coupé : on s'arrête là, FIFO préservée
    }
    const remaining = (await listOutbox()).length;
    const report: SyncReport = { synced, failed, remaining };
    listeners.forEach((l) => l(report));
    return report;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Branche les déclencheurs automatiques (à appeler une fois au boot). */
export function installAutoSync(): () => void {
  const onOnline = () => void syncOutbox();
  const onVisible = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) void syncOutbox();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(() => {
    if (navigator.onLine) void syncOutbox();
  }, 30_000);
  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}
