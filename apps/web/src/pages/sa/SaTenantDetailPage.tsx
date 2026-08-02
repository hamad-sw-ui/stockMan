/** Console éditeur — détail tenant : utilisateurs, dépôts, licences, stats et
 *  actions de support (impersonation journalisée, suspension, reset gérant). */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, ConfirmModal, ErrorState, Field, Input, Kpi, Modal, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { patch, post, setAccessToken } from '../../lib/http';
import { formatDate, formatMoney, formatQty } from '../../lib/format';
import { invalidateQueries, useQuery } from '../../lib/query';
import { useToast } from '../../store/toast';
import type { LicenseRow, Plan } from '../../lib/types';

interface TenantDetail {
  id: string;
  name: string;
  subdomain: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  users: Array<{ id: string; name: string; email: string; role: string; is_active: boolean; created_at: string }>;
  depots: Array<{ id: string; name: string; address: string | null; is_active: boolean }>;
  licenses: Array<LicenseRow & { plan_name: string }>;
  stats: { revenue: number; sales_count: number };
}

export default function SaTenantDetailPage() {
  const { id } = useParams();
  const { show } = useToast();
  const q = useQuery<TenantDetail>(`sa-tenant:${id}`, id ? `/tenants/${id}` : null);
  const plans = useQuery<Plan[]>('plans:list', '/licenses/plans');
  const [tab, setTab] = useState('synthese');

  const [confirm, setConfirm] = useState<'suspend' | 'activate' | 'reset' | 'impersonate' | null>(null);
  const [licForm, setLicForm] = useState<{ planCode: string; startDate: string; months: string } | null>(null);
  const [tempPw, setTempPw] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', phone: '', subdomain: '' });

  const refresh = () => invalidateQueries(`sa-tenant:${id}`);

  const doConfirm = async () => {
    if (!confirm || !id) return;
    setBusy(true);
    try {
      if (confirm === 'impersonate') {
        const res = await post<{ accessToken: string }>(`/tenants/${id}/impersonate`);
        sessionStorage.setItem('stockman.impersonating', '1');
        setAccessToken(res.accessToken);
        window.location.href = '/admin';
        return;
      }
      if (confirm === 'reset') {
        const res = await post<{ temporaryPassword: string }>(`/tenants/${id}/reset-admin-password`);
        setTempPw(res.temporaryPassword);
      } else {
        await post(`/tenants/${id}/status`, { isActive: confirm === 'activate' });
        show(confirm === 'activate' ? 'Tenant réactivé.' : 'Tenant suspendu (sessions fermées).', 'success');
        refresh();
        invalidateQueries('sa-tenants:');
      }
    } catch (e) {
      show(e instanceof Error ? e.message : 'Action impossible', 'error');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const saveLicense = async () => {
    if (!licForm || !id) return;
    setBusy(true);
    try {
      await post('/licenses', {
        tenantId: id,
        planCode: licForm.planCode,
        startDate: licForm.startDate,
        months: Number(licForm.months) || 1,
      });
      show('Licence créée.', 'success');
      setLicForm(null);
      refresh();
      invalidateQueries('licenses:');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Création impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await patch(`/tenants/${id}`, {
        name: editForm.name || undefined,
        phone: editForm.phone || null,
        subdomain: editForm.subdomain || null,
      });
      show('Tenant mis à jour.', 'success');
      setEditOpen(false);
      refresh();
      invalidateQueries('sa-tenants:');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Mise à jour impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (q.loading) return <div className="wrap"><Spinner label="Chargement du tenant…" /></div>;
  if (q.error || !q.data) return <div className="wrap"><ErrorState error={q.error} onRetry={refresh} /></div>;

  const t = q.data;
  const activeLic = t.licenses[0] ?? null;

  return (
    <div className="wrap">
      <PageHeader
        title={<>🏢 {t.name} <Badge tone={t.is_active ? 'ok' : 'danger'}>{t.is_active ? 'Actif' : 'Suspendu'}</Badge></>}
        sub={`Créé le ${formatDate(t.created_at)}${t.subdomain ? ` · ${t.subdomain}` : ''}${t.phone ? ` · ${t.phone}` : ''}`}
        actions={
          <>
            <Link className="btn btn-outline btn-sm" to="/sa/tenants">← Tenants</Link>
            <Button variant="outline" size="sm" onClick={() => { setEditForm({ name: t.name, phone: t.phone ?? '', subdomain: t.subdomain ?? '' }); setEditOpen(true); }}>✏️ Modifier</Button>
            <Button variant="outline" size="sm" onClick={() => setConfirm('impersonate')}>🛠️ Se connecter en tant que</Button>
            {t.is_active ? (
              <Button variant="danger-soft" size="sm" onClick={() => setConfirm('suspend')}>⛔ Suspendre</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirm('activate')}>✅ Réactiver</Button>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi label="CA cumulé" value={formatMoney(t.stats.revenue)} />
        <Kpi label="Ventes" value={formatQty(t.stats.sales_count)} />
        <Kpi label="Utilisateurs" value={formatQty(t.users.length)} />
        <Kpi label="Licence courante" value={activeLic ? `${activeLic.plan_code}` : '—'} sub={activeLic ? `fin ${formatDate(activeLic.end_date)} · ${activeLic.status}` : 'aucune'} tone={activeLic?.status === 'EXPIRED' ? 'danger' : undefined} />
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'synthese', label: '👥 Utilisateurs & dépôts' },
        { id: 'licences', label: `📜 Licences (${t.licenses.length})` },
      ]} />

      {tab === 'synthese' ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <Card title="Utilisateurs" pad={false}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th></tr></thead>
                <tbody>
                  {t.users.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.name}</td>
                      <td className="muted">{u.email}</td>
                      <td><Badge tone={u.role === 'ADMIN' ? 'info' : undefined}>{u.role}</Badge></td>
                      <td><Badge tone={u.is_active ? 'ok' : 'danger'}>{u.is_active ? 'Actif' : 'Désactivé'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 12 }}>
              <Button variant="outline" size="sm" onClick={() => setConfirm('reset')}>🔐 Réinitialiser le mot de passe du gérant</Button>
            </div>
          </Card>
          <Card title="Dépôts" pad={false}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nom</th><th>Adresse</th><th>Statut</th></tr></thead>
                <tbody>
                  {t.depots.map((d) => (
                    <tr key={d.id}>
                      <td style={{ fontWeight: 600 }}>{d.name}</td>
                      <td className="muted">{d.address ?? '—'}</td>
                      <td><Badge tone={d.is_active ? 'ok' : 'danger'}>{d.is_active ? 'Actif' : 'Inactif'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : (
        <Card title="Historique des licences" actions={<Button size="sm" onClick={() => setLicForm({ planCode: plans.data?.find((p) => p.code !== 'TRIAL')?.code ?? 'BASIC', startDate: new Date().toISOString().slice(0, 10), months: '1' })}>➕ Nouvelle licence</Button>} pad={false}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Statut</th><th>Début</th><th>Fin</th><th className="num">Quotas</th><th>Notes</th></tr></thead>
              <tbody>
                {t.licenses.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.plan_name}</td>
                    <td><Badge tone={l.status === 'ACTIVE' ? 'ok' : l.status === 'TRIAL' ? 'info' : 'danger'}>{l.status}</Badge></td>
                    <td className="muted">{formatDate(l.start_date)}</td>
                    <td className="muted">{formatDate(l.end_date)}</td>
                    <td className="num muted">{l.max_users} util. · {l.max_depots} dép.</td>
                    <td className="muted">{l.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {confirm ? (
        <ConfirmModal
          title={confirm === 'suspend' ? 'Suspendre le tenant' : confirm === 'activate' ? 'Réactiver le tenant' : confirm === 'reset' ? 'Réinitialiser le mot de passe gérant' : 'Connexion support'}
          danger={confirm === 'suspend'}
          confirmLabel={confirm === 'suspend' ? 'Suspendre' : confirm === 'activate' ? 'Réactiver' : confirm === 'reset' ? 'Réinitialiser' : 'Se connecter en tant que'}
          message={
            confirm === 'suspend'
              ? <>Le tenant <strong>{t.name}</strong> sera suspendu : aucun utilisateur ne pourra plus se connecter et les sessions actives seront fermées. Les données sont conservées.</>
              : confirm === 'activate'
                ? <>Le tenant <strong>{t.name}</strong> redevient actif immédiatement.</>
                : confirm === 'reset'
                  ? <>Un mot de passe temporaire sera généré pour le gérant de <strong>{t.name}</strong> (affiché une fois) et ses sessions seront fermées.</>
                  : <>Vous allez ouvrir une session <strong>en tant que gérant</strong> de {t.name}. Cette session est <strong>journalisée</strong> et affichée comme « support » dans le journal d’audit du tenant.</>
          }
          onConfirm={doConfirm}
          onClose={() => setConfirm(null)}
          loading={busy}
        />
      ) : null}

      {tempPw ? (
        <Modal title="🔐 Mot de passe temporaire" onClose={() => setTempPw(null)} footer={<Button onClick={() => setTempPw(null)}>J’ai transmis</Button>}>
          <p>Transmettez ce mot de passe au gérant (affiché une seule fois) :</p>
          <div className="card center" style={{ background: 'var(--surface-2)', fontSize: '1.3rem', fontWeight: 800 }}><code>{tempPw}</code></div>
        </Modal>
      ) : null}

      {licForm ? (
        <Modal title="Nouvelle licence" onClose={() => !busy && setLicForm(null)}
          footer={<>
            <Button variant="outline" onClick={() => setLicForm(null)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={saveLicense}>Créer</Button>
          </>}>
          <Field label="Plan" required>
            <Select value={licForm.planCode} onChange={(e) => setLicForm({ ...licForm, planCode: e.target.value })}>
              {(plans.data ?? []).map((p) => (
                <option key={p.code} value={p.code}>{p.name} — {formatMoney(p.monthly_price)}/mois · {p.max_users} util. · {p.max_depots} dép.</option>
              ))}
            </Select>
          </Field>
          <div className="row">
            <Field label="Date de début" required><Input type="date" value={licForm.startDate} onChange={(e) => setLicForm({ ...licForm, startDate: e.target.value })} /></Field>
            <Field label="Durée (mois)" required><Input inputMode="numeric" value={licForm.months} onChange={(e) => setLicForm({ ...licForm, months: e.target.value })} /></Field>
          </div>
        </Modal>
      ) : null}

      {editOpen ? (
        <Modal title="Modifier le tenant" onClose={() => !busy && setEditOpen(false)}
          footer={<>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={saveEdit} disabled={editForm.name.trim().length < 2}>Enregistrer</Button>
          </>}>
          <Field label="Nom" required><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></Field>
          <div className="row">
            <Field label="Sous-domaine"><Input value={editForm.subdomain} onChange={(e) => setEditForm({ ...editForm, subdomain: e.target.value })} /></Field>
            <Field label="Téléphone"><Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
