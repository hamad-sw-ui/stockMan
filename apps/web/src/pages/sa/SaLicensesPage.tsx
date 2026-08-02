/** Console éditeur — licences : liste globale filtrable par statut,
 *  renouvellement en N mois (prolongation depuis la fin courante). */
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui';
import { post } from '../../lib/http';
import { formatDate, formatMoney } from '../../lib/format';
import { invalidateQueries, useQuery } from '../../lib/query';
import { useToast } from '../../store/toast';
import type { LicenseRow } from '../../lib/types';

const tone = (s: string): 'ok' | 'info' | 'danger' => (s === 'ACTIVE' ? 'ok' : s === 'TRIAL' ? 'info' : 'danger');
const label = (s: string) => (s === 'ACTIVE' ? 'Active' : s === 'TRIAL' ? 'Essai' : s === 'SUSPENDED' ? 'Suspendue' : 'Expirée');

export default function SaLicensesPage() {
  const { show } = useToast();
  const [status, setStatus] = useState('');
  const path = `/licenses${status ? `?status=${status}` : ''}`;
  const q = useQuery<LicenseRow[]>(`licenses:${path}`, path);
  const [renew, setRenew] = useState<LicenseRow | null>(null);
  const [months, setMonths] = useState('1');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const doRenew = async () => {
    if (!renew) return;
    setBusy(true);
    try {
      await post(`/licenses/${renew.id}/renew`, { months: Number(months) || 1, notes: notes || null });
      show('Licence prolongée.', 'success');
      invalidateQueries('licenses:');
      invalidateQueries('sa-');
      setRenew(null);
      setNotes('');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Renouvellement impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title="Licences"
        sub="Toutes les licences clients, triées par échéance"
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="Filtrer par statut">
            <option value="">Tous statuts</option>
            <option value="TRIAL">Essais</option>
            <option value="ACTIVE">Actives</option>
            <option value="EXPIRED">Expirées</option>
            <option value="SUSPENDED">Suspendues</option>
          </Select>
        }
      />

      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => invalidateQueries('licenses:')} />
      ) : !q.data?.length ? (
        <EmptyState emoji="📜" title="Aucune licence" />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tenant</th><th>Plan</th><th>Statut</th><th>Début</th><th>Échéance</th><th className="num">Quotas</th><th className="num">Tarif</th><th aria-label="Renouveler" /></tr></thead>
              <tbody>
                {q.data.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 700 }}>{l.tenant_name}</td>
                    <td>{l.plan_name} <span className="muted">({l.plan_code})</span></td>
                    <td><Badge tone={tone(l.status)}>{label(l.status)}</Badge></td>
                    <td className="muted">{formatDate(l.start_date)}</td>
                    <td style={{ fontWeight: 700 }}>{formatDate(l.end_date)}</td>
                    <td className="num muted">{l.max_users} util. · {l.max_depots} dép.</td>
                    <td className="num">{l.monthly_price != null ? `${formatMoney(l.monthly_price)}/mois` : '—'}</td>
                    <td>
                      <Button variant="outline" size="sm" onClick={() => { setRenew(l); setMonths('1'); }}>🔁 Renouveler</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {renew ? (
        <Modal title={`Renouveler — ${renew.tenant_name}`} onClose={() => !busy && setRenew(null)}
          footer={<>
            <Button variant="outline" onClick={() => setRenew(null)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={doRenew}>Prolonger</Button>
          </>}>
          <p className="muted" style={{ marginTop: 0 }}>
            Échéance actuelle : <strong>{formatDate(renew.end_date)}</strong> — la prolongation part de cette date (ou d’aujourd’hui si dépassée).
          </p>
          <div className="row">
            <Field label="Durée (mois)" required>
              <Input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
            <Field label="Note (paiement reçu…)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex. MoMo reçu le 02/08, réf …" />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
