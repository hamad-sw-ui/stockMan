/** Détail d'une vente : lignes, retours partiels, annulation (avoir) réservée
 *  au jour même, ré-impression thermique et partage WhatsApp du reçu. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, ErrorState, Field, Input, Kpi, Modal, PageHeader, Spinner } from '../../components/ui';
import { get, post } from '../../lib/http';
import { formatDateTime, formatMoney, formatQty, paymentMethodLabel } from '../../lib/format';
import { invalidateQueries, useQuery } from '../../lib/query';
import { useToast } from '../../store/toast';
import type { ReceiptData, SaleDetail } from '../../lib/types';

export default function SaleDetailPage() {
  const { id } = useParams();
  const { show } = useToast();
  const q = useQuery<SaleDetail>(`sale:${id}`, id ? `/sales/${id}` : null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [returnMode, setReturnMode] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [returnReason, setReturnReason] = useState('');
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const doVoid = async () => {
    setBusy(true);
    try {
      await post(`/sales/${id}/void`, { reason: voidReason || undefined });
      show('Vente annulée : le stock a été restitué.', 'success');
      setConfirmVoid(false);
      invalidateQueries('sales:');
      invalidateQueries(`sale:${id}`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Annulation impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doReturn = async () => {
    const items = Object.entries(returnQty)
      .map(([saleItemId, v]) => ({ saleItemId, baseQty: Number(v.replace(',', '.')) || 0 }))
      .filter((i) => i.baseQty > 0);
    if (items.length === 0) {
      show('Saisissez au moins une quantité à retourner.', 'error');
      return;
    }
    setBusy(true);
    try {
      await post(`/sales/${id}/returns`, { items, reason: returnReason || undefined });
      show('Retour enregistré : les quantités sont revenues en stock.', 'success');
      setReturnMode(false);
      setReturnQty({});
      setReturnReason('');
      invalidateQueries('sales:');
      invalidateQueries(`sale:${id}`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Retour impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = async () => {
    try {
      const r = await get<ReceiptData>(`/sales/${id}/receipt`);
      setReceipt(r);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Reçu indisponible', 'error');
    }
  };

  if (q.loading) return <div className="wrap"><Spinner label="Chargement de la vente…" /></div>;
  if (q.error || !q.data) return <div className="wrap"><ErrorState error={q.error} onRetry={() => invalidateQueries(`sale:${id}`)} /></div>;

  const s = q.data;
  const voided = s.status === 'VOIDED';
  // L'annulation complète = jour même (règle serveur anti-fraude) ; au-delà :
  const sameDay = new Date(s.created_at).toLocaleDateString('fr-FR') === new Date().toLocaleDateString('fr-FR');
  const waText = receipt ? encodeURIComponent(receipt.text) : '';

  return (
    <div className="wrap" style={{ maxWidth: 960 }}>
      <PageHeader
        title={<>Vente du {formatDateTime(s.created_at)} {voided ? <Badge tone="danger">Annulée</Badge> : <Badge tone="ok">Validée</Badge>}</>}
        sub={`${s.vendor_name} · ${s.depot_name}${s.synced_at ? ' · synchronisée (hors-ligne)' : ''}`}
        actions={
          <>
            <Link className="btn btn-outline btn-sm" to="/admin/ventes">← Ventes</Link>
            <Button variant="outline" size="sm" onClick={openReceipt}>🧾 Reçu</Button>
            {!voided ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setReturnMode(true)}>↩️ Retour partiel</Button>
                {sameDay ? <Button variant="danger-soft" size="sm" onClick={() => setConfirmVoid(true)}>Annuler la vente</Button> : null}
              </>
            ) : null}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi label="Montant total" value={formatMoney(s.total_amount)} tone={voided ? 'danger' : 'ok'} />
        <Kpi label="Paiement" value={paymentMethodLabel(s.payment_method)} sub={s.payment_reference ?? undefined} />
        <Kpi label="Reçu" value={s.amount_received != null ? formatMoney(s.amount_received) : '—'} sub={s.amount_received != null && s.payment_method === 'CASH' ? `monnaie ${formatMoney(Math.max(0, s.amount_received - s.total_amount))}` : undefined} />
        <Kpi label="Lignes" value={formatQty(s.items.length)} />
      </div>

      {!sameDay && !voided ? (
        <p className="banner banner-warn" style={{ borderRadius: 10 }}>
          ℹ️ L’annulation complète n’est possible que le jour même (anti-fraude) ; utilisez un <strong>retour partiel</strong> pour corriger après coup.
        </p>
      ) : null}

      <Card title="Lignes" pad={false}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Produit</th><th className="num">Qté vendue</th><th>Unité</th><th className="num">Prix unitaire</th><th className="num">Total</th></tr></thead>
            <tbody>
              {s.items.map((i) => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 600 }}>{i.product_name}{i.variant_name ? <span className="muted"> · {i.variant_name}</span> : null}</td>
                  <td className="num">{formatQty(i.base_qty)}</td>
                  <td className="muted">{i.unit_symbol ?? '—'}</td>
                  <td className="num">{formatMoney(i.unit_price)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{formatMoney(i.total_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {s.returns.length > 0 ? (
        <Card title={`Retours (${s.returns.length})`} pad={false}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Produit</th><th className="num">Quantité</th><th className="num">Montant</th><th>Par</th><th>Motif</th></tr></thead>
              <tbody>
                {s.returns.flatMap((r) =>
                  r.items.map((i, idx) => (
                    <tr key={`${r.id}-${idx}`}>
                      <td className="muted">{idx === 0 ? formatDateTime(r.created_at) : ''}</td>
                      <td>{i.productName}{i.variantName ? <span className="muted"> · {i.variantName}</span> : null}</td>
                      <td className="num">{formatQty(i.baseQty)}</td>
                      <td className="num" style={{ color: 'var(--danger)', fontWeight: 700 }}>−{formatMoney(i.baseQty * i.unitPrice)}</td>
                      <td className="muted">{idx === 0 ? (r.created_by_name ?? '—') : ''}</td>
                      <td className="muted">{idx === 0 ? (r.reason ?? '—') : ''}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {confirmVoid ? (
        <Modal title="Annuler la vente" onClose={() => !busy && setConfirmVoid(false)}
          footer={<>
            <Button variant="outline" onClick={() => setConfirmVoid(false)} disabled={busy}>Fermer</Button>
            <Button variant="danger" loading={busy} onClick={doVoid}>Confirmer l’annulation</Button>
          </>}>
          <p>La vente passera au statut <strong>annulée</strong> et <strong>le stock sera restitué</strong> au dépôt. L’opération est journalisée.</p>
          <Field label="Motif (optionnel)"><Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Erreur de saisie, client parti…" /></Field>
        </Modal>
      ) : null}

      {returnMode ? (
        <Modal title="Retour partiel" onClose={() => !busy && setReturnMode(false)} wide
          footer={<>
            <Button variant="outline" onClick={() => setReturnMode(false)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={doReturn}>Valider le retour</Button>
          </>}>
          <p className="muted" style={{ marginTop: 0 }}>Saisissez les quantités <strong>en unité de base</strong> à remettre en stock :</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Produit</th><th className="num">Vendu</th><th className="num">À retourner</th></tr></thead>
              <tbody>
                {s.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product_name}{i.variant_name ? <span className="muted"> · {i.variant_name}</span> : null}</td>
                    <td className="num">{formatQty(i.base_qty)}</td>
                    <td style={{ maxWidth: 110 }}>
                      <Input
                        inputMode="decimal"
                        value={returnQty[i.id] ?? ''}
                        onChange={(e) => setReturnQty({ ...returnQty, [i.id]: e.target.value })}
                        placeholder={`max ${i.base_qty}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Field label="Motif"><Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Produit défectueux, erreur client…" /></Field>
        </Modal>
      ) : null}

      {receipt ? (
        <div className="receipt-print">
          <div className="center" style={{ fontWeight: 800 }}>{receipt.tenant.name}</div>
          {receipt.tenant.phone ? <div className="center">{receipt.tenant.phone}</div> : null}
          <div className="sep" />
          {receipt.lines.map((l, i) => (
            <div key={i} className="line"><span>{l.label}</span><span>{formatMoney(l.total)}</span></div>
          ))}
          <div className="tot"><div className="line"><span>TOTAL</span><span>{formatMoney(Number(receipt.sale.total_amount))}</span></div></div>
          <div className="sep" />
          <div className="center">{formatDateTime(receipt.sale.created_at)} · {paymentMethodLabel(receipt.sale.payment_method)} · {receipt.sale.vendor_name}</div>
          <div className="no-print center" style={{ marginTop: 14 }}>
            <Button variant="outline" size="sm" onClick={() => window.print()}>🖨️ Imprimer</Button>{' '}
            <a className="btn btn-outline btn-sm" href={`https://wa.me/?text=${waText}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>{' '}
            <Button variant="ghost" size="sm" onClick={() => setReceipt(null)}>Fermer</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
