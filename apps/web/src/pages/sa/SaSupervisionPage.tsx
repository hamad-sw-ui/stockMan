/** Console éditeur — supervision : santé des notifications (7 j), derniers
 *  échecs d'envoi et audit des actions éditeur (support/impersonations). */
import { Badge, Card, ErrorState, PageHeader, Spinner, Tabs } from '../../components/ui';
import { useState } from 'react';
import { formatDateTime, notificationTypeLabel } from '../../lib/format';
import { invalidateQueries, useQuery } from '../../lib/query';
import type { AuditRow } from '../../lib/types';

interface Supervision {
  byStatus: Array<{ status: string; channel: string; n: number }>;
  lastFailures: Array<{ created_at: string; tenant: string; type: string; channel: string; message: string; provider_response: string | null }>;
}

const statusTone = (s: string): 'ok' | 'danger' | 'warn' => (s === 'SENT' ? 'ok' : s === 'FAILED' ? 'danger' : 'warn');

export default function SaSupervisionPage() {
  const [tab, setTab] = useState('notifications');
  const notif = useQuery<Supervision>('sa:supervision', '/notifications/supervision');
  const audit = useQuery<AuditRow[]>('sa:audit-supervision', '/audit-logs/supervision');

  const active = tab === 'notifications' ? notif : { loading: audit.loading, error: audit.error };

  return (
    <div className="wrap">
      <PageHeader title="Supervision" sub="Santé de la plateforme et traçabilité des actions éditeur" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'notifications', label: '📡 Notifications (7 j)' },
        { id: 'audit', label: '🛡️ Audit éditeur' },
      ]} />

      {active.loading ? (
        <Spinner label="Chargement…" />
      ) : active.error ? (
        <ErrorState error={active.error} onRetry={() => invalidateQueries('sa:')} />
      ) : tab === 'notifications' && notif.data ? (
        <>
          <Card title="Envois par canal et statut" pad={false}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Canal</th><th>Statut</th><th className="num">Nombre</th></tr></thead>
                <tbody>
                  {notif.data.byStatus.map((r, i) => (
                    <tr key={i}>
                      <td>{r.channel === 'IN_APP' ? 'Dans l’app' : r.channel}</td>
                      <td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                      <td className="num" style={{ fontWeight: 700 }}>{r.n}</td>
                    </tr>
                  ))}
                  {notif.data.byStatus.length === 0 ? (
                    <tr><td colSpan={3} className="muted">Aucun envoi sur les 7 derniers jours.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="20 derniers échecs" pad={false}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Tenant</th><th>Type</th><th>Message</th><th>Réponse fournisseur</th></tr></thead>
                <tbody>
                  {notif.data.lastFailures.map((f, i) => (
                    <tr key={i}>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(f.created_at)}</td>
                      <td>{f.tenant}</td>
                      <td className="muted">{notificationTypeLabel(f.type)}</td>
                      <td style={{ maxWidth: 320 }}>{f.message}</td>
                      <td className="muted" style={{ maxWidth: 220 }}>{f.provider_response ?? '—'}</td>
                    </tr>
                  ))}
                  {notif.data.lastFailures.length === 0 ? (
                    <tr><td colSpan={5} className="muted">Aucun échec récent. 🎉</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : audit.data ? (
        <Card title="50 dernières actions éditeur (toutes journalisées)" pad={false}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Tenant</th><th>Action</th><th>Entité</th><th>Par</th></tr></thead>
              <tbody>
                {audit.data.map((a) => (
                  <tr key={a.id}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.created_at)}</td>
                    <td>{a.tenant_name}</td>
                    <td><Badge tone={a.action === 'IMPERSONATE' ? 'warn' : 'info'}>{a.action}</Badge></td>
                    <td className="muted">{a.entity}</td>
                    <td className="muted">{a.user_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
