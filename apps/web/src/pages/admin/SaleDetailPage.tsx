/** Détail d'une vente : lignes, retours partiels, annulation (avoir) réservée
 *  au jour même, ré-impression thermique et partage WhatsApp du reçu. */
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Kpi,
  Modal,
  PageHeader,
  Spinner,
} from "../../components/ui";
import { get, post } from "../../lib/http";
import {
  formatDateTime,
  formatMoney,
  formatQty,
  paymentMethodLabel,
} from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { ReceiptData, SaleDetail } from "../../lib/types";

export default function SaleDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { show } = useToast();
  const q = useQuery<SaleDetail>(`sale:${id}`, id ? `/sales/${id}` : null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [returnMode, setReturnMode] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [returnReason, setReturnReason] = useState("");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const doVoid = async () => {
    setBusy(true);
    try {
      await post(`/sales/${id}/void`, { reason: voidReason || undefined });
      show(t("pages.saleDetail.voidToast"), "success");
      setConfirmVoid(false);
      invalidateQueries("sales:");
      invalidateQueries(`sale:${id}`);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.saleDetail.voidError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const doReturn = async () => {
    const items = Object.entries(returnQty)
      .map(([saleItemId, v]) => ({
        saleItemId,
        baseQty: Number(v.replace(",", ".")) || 0,
      }))
      .filter((i) => i.baseQty > 0);
    if (items.length === 0) {
      show(t("pages.saleDetail.returnQtyRequired"), "error");
      return;
    }
    setBusy(true);
    try {
      await post(`/sales/${id}/returns`, {
        items,
        reason: returnReason || undefined,
      });
      show(t("pages.saleDetail.returnToast"), "success");
      setReturnMode(false);
      setReturnQty({});
      setReturnReason("");
      invalidateQueries("sales:");
      invalidateQueries(`sale:${id}`);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.saleDetail.returnError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = async () => {
    try {
      const r = await get<ReceiptData>(`/sales/${id}/receipt`);
      setReceipt(r);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.saleDetail.receiptError"),
        "error",
      );
    }
  };

  if (q.loading)
    return (
      <div className="wrap">
        <Spinner label={t("pages.saleDetail.loading")} />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="wrap">
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries(`sale:${id}`)}
        />
      </div>
    );

  const s = q.data;
  const voided = s.status === "VOIDED";
  // L'annulation complète = jour même (règle serveur anti-fraude) ; au-delà :
  const sameDay =
    new Date(s.created_at).toLocaleDateString("fr-FR") ===
    new Date().toLocaleDateString("fr-FR");
  const waText = receipt ? encodeURIComponent(receipt.text) : "";

  return (
    <div className="wrap" style={{ maxWidth: 960 }}>
      <PageHeader
        title={
          <>
            {t("pages.saleDetail.saleOf", {
              date: formatDateTime(s.created_at),
            })}{" "}
            {voided ? (
              <Badge tone="danger">{t("pages.sales.badgeVoided")}</Badge>
            ) : (
              <Badge tone="ok">{t("pages.sales.badgeCompleted")}</Badge>
            )}
          </>
        }
        sub={`${s.vendor_name} · ${s.depot_name}${s.synced_at ? t("pages.saleDetail.syncedSuffix") : ""}`}
        actions={
          <>
            <Link className="btn btn-outline btn-sm" to="/admin/ventes">
              {t("pages.saleDetail.backToSales")}
            </Link>
            <Button variant="outline" size="sm" onClick={openReceipt}>
              {t("pages.saleDetail.receiptButton")}
            </Button>
            {!voided ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReturnMode(true)}
                >
                  {t("pages.saleDetail.returnButton")}
                </Button>
                {sameDay ? (
                  <Button
                    variant="danger-soft"
                    size="sm"
                    onClick={() => setConfirmVoid(true)}
                  >
                    {t("pages.saleDetail.voidTitle")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi
          label={t("pages.saleDetail.kpiTotal")}
          value={formatMoney(s.total_amount)}
          tone={voided ? "danger" : "ok"}
        />
        <Kpi
          label={t("fields.payment")}
          value={paymentMethodLabel(s.payment_method)}
          sub={s.payment_reference ?? undefined}
        />
        <Kpi
          label={t("pages.saleDetail.kpiReceived")}
          value={
            s.amount_received != null ? formatMoney(s.amount_received) : "—"
          }
          sub={
            s.amount_received != null && s.payment_method === "CASH"
              ? t("pages.saleDetail.changeSub", {
                  amount: formatMoney(
                    Math.max(0, s.amount_received - s.total_amount),
                  ),
                })
              : undefined
          }
        />
        <Kpi
          label={t("pages.receipts.colLines")}
          value={formatQty(s.items.length)}
        />
      </div>

      {!sameDay && !voided ? (
        <p className="banner banner-warn" style={{ borderRadius: 10 }}>
          <Trans
            i18nKey="pages.saleDetail.voidBanner"
            components={{ b: <strong /> }}
          />
        </p>
      ) : null}

      <Card title={t("pages.receipts.colLines")} pad={false}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("fields.product")}</th>
                <th className="num">{t("pages.saleDetail.colQtySold")}</th>
                <th>{t("pages.saleDetail.colUnit")}</th>
                <th className="num">{t("fields.unitPrice")}</th>
                <th className="num">{t("common.total")}</th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((i) => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 600 }}>
                    {i.product_name}
                    {i.variant_name ? (
                      <span className="muted"> · {i.variant_name}</span>
                    ) : null}
                  </td>
                  <td className="num">{formatQty(i.base_qty)}</td>
                  <td className="muted">{i.unit_symbol ?? "—"}</td>
                  <td className="num">{formatMoney(i.unit_price)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {formatMoney(i.total_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {s.returns.length > 0 ? (
        <Card
          title={t("pages.saleDetail.returnsTitle", {
            count: s.returns.length,
          })}
          pad={false}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("fields.product")}</th>
                  <th className="num">{t("fields.quantity")}</th>
                  <th className="num">{t("common.amount")}</th>
                  <th>{t("pages.movements.by")}</th>
                  <th>{t("fields.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {s.returns.flatMap((r) =>
                  r.items.map((i, idx) => (
                    <tr key={`${r.id}-${idx}`}>
                      <td className="muted">
                        {idx === 0 ? formatDateTime(r.created_at) : ""}
                      </td>
                      <td>
                        {i.productName}
                        {i.variantName ? (
                          <span className="muted"> · {i.variantName}</span>
                        ) : null}
                      </td>
                      <td className="num">{formatQty(i.baseQty)}</td>
                      <td
                        className="num"
                        style={{ color: "var(--danger)", fontWeight: 700 }}
                      >
                        −{formatMoney(i.baseQty * i.unitPrice)}
                      </td>
                      <td className="muted">
                        {idx === 0 ? (r.created_by_name ?? "—") : ""}
                      </td>
                      <td className="muted">
                        {idx === 0 ? (r.reason ?? "—") : ""}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {confirmVoid ? (
        <Modal
          title={t("pages.saleDetail.voidTitle")}
          onClose={() => !busy && setConfirmVoid(false)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setConfirmVoid(false)}
                disabled={busy}
              >
                {t("common.close")}
              </Button>
              <Button variant="danger" loading={busy} onClick={doVoid}>
                {t("pages.saleDetail.voidConfirm")}
              </Button>
            </>
          }
        >
          <p>
            <Trans
              i18nKey="pages.saleDetail.voidBody"
              components={{ b: <strong /> }}
            />
          </p>
          <Field label={t("pages.saleDetail.reasonOptional")}>
            <Input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder={t("pages.saleDetail.voidReasonPlaceholder")}
            />
          </Field>
        </Modal>
      ) : null}

      {returnMode ? (
        <Modal
          title={t("pages.saleDetail.returnTitle")}
          onClose={() => !busy && setReturnMode(false)}
          wide
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setReturnMode(false)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button loading={busy} onClick={doReturn}>
                {t("pages.saleDetail.returnConfirm")}
              </Button>
            </>
          }
        >
          <p className="muted" style={{ marginTop: 0 }}>
            <Trans
              i18nKey="pages.saleDetail.returnBody"
              components={{ b: <strong /> }}
            />
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.product")}</th>
                  <th className="num">{t("pages.saleDetail.colSold")}</th>
                  <th className="num">{t("pages.saleDetail.colToReturn")}</th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.product_name}
                      {i.variant_name ? (
                        <span className="muted"> · {i.variant_name}</span>
                      ) : null}
                    </td>
                    <td className="num">{formatQty(i.base_qty)}</td>
                    <td style={{ maxWidth: 110 }}>
                      <Input
                        inputMode="decimal"
                        value={returnQty[i.id] ?? ""}
                        onChange={(e) =>
                          setReturnQty({ ...returnQty, [i.id]: e.target.value })
                        }
                        placeholder={t(
                          "pages.saleDetail.returnMaxPlaceholder",
                          {
                            qty: i.base_qty,
                          },
                        )}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Field label={t("fields.reason")}>
            <Input
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder={t("pages.saleDetail.returnReasonPlaceholder")}
            />
          </Field>
        </Modal>
      ) : null}

      {receipt ? (
        /* Reçu imprimé — hors champ i18n v1 : ticket FR légal
           (TOTAL / Paiement / remerciement). */
        <div className="receipt-print">
          <div className="center" style={{ fontWeight: 800 }}>
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
          </div>
          <div className="sep" />
          <div className="center">
            {formatDateTime(receipt.sale.created_at)} ·{" "}
            {paymentMethodLabel(receipt.sale.payment_method)} ·{" "}
            {receipt.sale.vendor_name}
          </div>
          <div className="no-print center" style={{ marginTop: 14 }}>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              🖨️ {t("common.print")}
            </Button>{" "}
            <a
              className="btn btn-outline btn-sm"
              href={`https://wa.me/?text=${waText}`}
              target="_blank"
              rel="noreferrer"
            >
              💬 WhatsApp
            </a>{" "}
            <Button variant="ghost" size="sm" onClick={() => setReceipt(null)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
