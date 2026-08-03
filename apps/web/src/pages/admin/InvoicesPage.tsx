/** Factures & avoirs (E7) : numérotation légale continue par dépôt/série/
 *  année, détail imprimable avec mentions obligatoires (raison sociale, NIU,
 *  RCCM) et ventilation HT/TVA/TTC figée. La facture est immuable — toute
 *  annulation émet un avoir lié. */
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Kpi,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
} from "../../components/ui";
import { formatDateTime, formatMoney } from "../../lib/format";
import { get } from "../../lib/http";
import { useQuery } from "../../lib/query";
import type {
  Depot,
  InvoiceDetail,
  InvoiceListItem,
  Paged,
} from "../../lib/types";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Imprimé de facture (mentions légales + ventilation, immuable). */
function InvoiceModal({
  invoice,
  onClose,
}: {
  invoice: InvoiceDetail;
  onClose: () => void;
}) {
  const t = invoice.tenant;
  const isCredit = invoice.kind === "CREDIT_NOTE";
  return (
    <Modal
      title={`${isCredit ? "AVOIR" : "FACTURE"} ${invoice.number}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => window.print()}>
            🖨️ Imprimer
          </Button>
          <Button onClick={onClose}>Fermer</Button>
        </>
      }
    >
      <div className="receipt-print">
        {/* En-tête légal */}
        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: "1.05rem" }}>{t?.name}</strong>
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            {t?.address ? <div>{t.address}</div> : null}
            {t?.phone ? <div>Tél : {t.phone}</div> : null}
            <div>
              NIU : {t?.niu ?? "—"} · RCCM : {t?.rccm ?? "—"}
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            {invoice.depotName} · {formatDateTime(invoice.issuedAt)} ·{" "}
            {invoice.issuedByName ?? "—"}
            {invoice.customerName ? ` · Client : ${invoice.customerName}` : ""}
            {isCredit && invoice.parentNumber ? (
              <div>
                <Badge tone="warn">
                  Avoir sur facture {invoice.parentNumber}
                </Badge>
              </div>
            ) : null}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Article</th>
                <th className="num">Qté</th>
                <th className="num">PU TTC</th>
                <th className="num">TVA</th>
                <th className="num">HT</th>
                <th className="num">TTC</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    {it.product_name}
                    {it.variant_name ? ` (${it.variant_name})` : ""}
                  </td>
                  <td className="num">
                    {it.quantity} {it.unit_symbol ?? ""}
                  </td>
                  <td className="num">{formatMoney(it.unit_price)}</td>
                  <td className="num">
                    {String(it.tax_rate).replace(".", ",")} %
                  </td>
                  <td className="num">{formatMoney(it.total_ht)}</td>
                  <td className="num">{formatMoney(it.total_ttc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid kpis" style={{ marginTop: 10 }}>
          <Kpi label="Total HT" value={formatMoney(invoice.totalHt)} />
          <Kpi label="TVA" value={formatMoney(invoice.totalVat)} />
          <Kpi label="Total TTC" value={formatMoney(invoice.totalTtc)} />
        </div>
        {t?.invoice_footer ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            {t.invoice_footer}
          </p>
        ) : null}
        {invoice.note ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            {invoice.note}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export default function InvoicesPage() {
  const [depotId, setDepotId] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState(iso(new Date(Date.now() - 13 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);

  const params = new URLSearchParams({ page: String(page), size: "25" });
  if (depotId) params.set("depotId", depotId);
  if (kind) params.set("kind", kind);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const path = `/invoices?${params}`;

  const q = useQuery<Paged<InvoiceListItem>>(`invoices:${path}`, path);
  const depots = useQuery<Depot[]>("depots:list", "/depots");

  const rows = q.data?.data ?? [];
  const totals = rows.reduce(
    (a, r) => {
      const s = r.kind === "CREDIT_NOTE" ? -1 : 1;
      return {
        ht: a.ht + s * r.totalHt,
        vat: a.vat + s * r.totalVat,
        ttc: a.ttc + s * r.totalTtc,
      };
    },
    { ht: 0, vat: 0, ttc: 0 },
  );

  const openDetail = async (id: string) => {
    setDetail(await get<InvoiceDetail>(`/invoices/${id}`));
  };

  return (
    <div className="wrap">
      <PageHeader
        title="Factures & avoirs"
        sub={
          q.data
            ? `${q.data.total} document(s) · net (page) : ${formatMoney(totals.ht)} HT + ${formatMoney(totals.vat)} TVA`
            : "Numérotation légale continue — facture immuable, avoir à l'annulation"
        }
      />

      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label="Du">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Au">
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Dépôt">
            <Select
              value={depotId}
              onChange={(e) => {
                setDepotId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous</option>
              {(depots.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous</option>
              <option value="INVOICE">Factures</option>
              <option value="CREDIT_NOTE">Avoirs</option>
            </Select>
          </Field>
        </div>
      </Card>

      {q.loading && !q.data ? (
        <Spinner label="Chargement des factures…" />
      ) : rows.length === 0 ? (
        <EmptyState emoji="🧾" title="Aucune facture">
          Les factures sont émises automatiquement à chaque vente.
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Numéro</th>
                  <th>Date</th>
                  <th>Dépôt</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th className="num">HT</th>
                  <th className="num">TVA</th>
                  <th className="num">TTC</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <code>{r.number}</code>
                    </td>
                    <td>{formatDateTime(r.issuedAt)}</td>
                    <td>{r.depotName}</td>
                    <td>{r.customerName ?? "Comptant"}</td>
                    <td>
                      {r.kind === "INVOICE" ? (
                        <Badge tone="ok">Facture</Badge>
                      ) : (
                        <Badge tone="warn">Avoir</Badge>
                      )}
                      {r.parentNumber ? (
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          réf. {r.parentNumber}
                        </div>
                      ) : null}
                    </td>
                    <td className="num">{formatMoney(r.totalHt)}</td>
                    <td className="num">{formatMoney(r.totalVat)}</td>
                    <td className="num">{formatMoney(r.totalTtc)}</td>
                    <td className="num">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openDetail(r.id)}
                      >
                        Voir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {q.data ? (
        <Pagination
          page={q.data.page}
          totalPages={q.data.totalPages}
          total={q.data.total}
          onPage={setPage}
        />
      ) : null}

      {detail ? (
        <InvoiceModal invoice={detail} onClose={() => setDetail(null)} />
      ) : null}
    </div>
  );
}
