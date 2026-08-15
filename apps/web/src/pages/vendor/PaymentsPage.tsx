/** Mes paiements (vendeur) : mes ventes du jour et de la période avec le
 *  détail par mode de paiement, ré-impression et partage des reçus. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Kpi,
  PageHeader,
  Pagination,
  Spinner,
} from "../../components/ui";
import { get } from "../../lib/http";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  paymentMethodLabel,
} from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { Paged, ReceiptData, SaleListItem } from "../../lib/types";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function PaymentsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState(iso(new Date()));
  const [to, setTo] = useState(iso(new Date()));
  const path = `/sales?mine=true&from=${from}&to=${to}&page=${page}&size=25`;
  const q = useQuery<Paged<SaleListItem>>(`sales:${path}`, path);
  const { show } = useToast();
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const openReceipt = async (id: string) => {
    try {
      setReceipt(await get<ReceiptData>(`/sales/${id}/receipt`));
      setTimeout(() => window.print(), 120);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.payments.receiptError"),
        "error",
      );
    }
  };

  const waShare = (r: ReceiptData) => {
    const text = encodeURIComponent(r.text);
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
  };

  const rows = q.data?.data ?? [];
  const valid = rows.filter((s) => s.status === "COMPLETED");
  const total = valid.reduce((a, s) => a + s.total_amount, 0);
  const byMethod = ["CASH", "MTN_MOMO", "ORANGE_MONEY"].map((m) => ({
    m,
    amount: valid
      .filter((s) => s.payment_method === m)
      .reduce((a, s) => a + s.total_amount, 0),
  }));

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.payments.title")}
        sub={
          from === to
            ? t("common.dayOf", { date: formatDate(`${from}T00:00:00`) })
            : t("pages.payments.rangeSub", { from, to })
        }
        actions={
          <div className="row">
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              aria-label={t("common.from")}
            />
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              aria-label={t("common.to")}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => invalidateQueries("sales:")}
            >
              {t("pages.payments.refresh")}
            </Button>
          </div>
        }
      />

      <div className="kpi-grid">
        <Kpi
          label={t("pages.payments.kpiTotal")}
          value={formatMoney(total)}
          tone="ok"
        />
        {byMethod.map((b) => (
          <Kpi
            key={b.m}
            label={paymentMethodLabel(b.m)}
            value={formatMoney(b.amount)}
          />
        ))}
      </div>

      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : rows.length === 0 ? (
        <EmptyState emoji="💳" title={t("pages.payments.empty")}>
          {t("pages.payments.emptyBody")}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.payments.colTime")}</th>
                  <th className="num">{t("pages.receipts.colLines")}</th>
                  <th className="num">{t("common.amount")}</th>
                  <th>{t("fields.payment")}</th>
                  <th>{t("common.status")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(s.created_at)}
                    </td>
                    <td className="num">{s.line_count}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatMoney(s.total_amount)}
                    </td>
                    <td>
                      {paymentMethodLabel(s.payment_method)}
                      {s.payment_reference ? (
                        <span className="muted"> · {s.payment_reference}</span>
                      ) : null}
                    </td>
                    <td>
                      {s.status === "VOIDED" ? (
                        <Badge tone="danger">
                          {t("pages.payments.badgeVoided")}
                        </Badge>
                      ) : (
                        <Badge tone="ok">
                          {t("pages.payments.badgeValid")}
                        </Badge>
                      )}
                      {s.synced_at ? (
                        <Badge tone="info">
                          {t("pages.payments.badgeSynced")}
                        </Badge>
                      ) : null}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openReceipt(s.id)}
                      >
                        {t("pages.payments.receiptButton")}
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

      {receipt ? (
        /* Reçu imprimé — hors champ i18n v1 : ticket FR légal
           (TOTAL / Paiement / remerciement). */
        <div className="receipt-print" aria-hidden={false}>
          <div className="center" style={{ fontWeight: 800, fontSize: "1rem" }}>
            {receipt.tenant.name}
          </div>
          {receipt.tenant.phone ? (
            <div className="center">{receipt.tenant.phone}</div>
          ) : null}
          <div className="sep" />
          {receipt.lines.map((l, i) => (
            <div key={i} className="line">
              <span>{l.label}</span>
              <span>{formatMoney(l.total)}</span>
            </div>
          ))}
          <div className="tot">
            <div className="line">
              <span>TOTAL</span>
              <span>{formatMoney(Number(receipt.sale.total_amount))}</span>
            </div>
            <div className="line">
              <span>Paiement</span>
              <span>{paymentMethodLabel(receipt.sale.payment_method)}</span>
            </div>
          </div>
          <div className="sep" />
          <div className="center">
            {formatDateTime(receipt.sale.created_at)} ·{" "}
            {receipt.sale.vendor_name}
            <br />
            Merci de votre visite !
          </div>
          <div className="no-print center" style={{ marginTop: 14 }}>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              🖨️ {t("common.print")}
            </Button>{" "}
            <Button
              variant="outline"
              size="sm"
              onClick={() => waShare(receipt)}
            >
              💬 WhatsApp
            </Button>{" "}
            <Button variant="ghost" size="sm" onClick={() => setReceipt(null)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
