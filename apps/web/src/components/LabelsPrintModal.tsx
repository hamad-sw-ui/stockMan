/**
 * LabelsPrintModal — « Imprimer les étiquettes » (phase C4, docs/06).
 *
 * Partagée par le détail d'une réception (quantités = quantités reçues,
 * modifiables) et la multi-sélection de la liste produits.
 * Options : gabarit (A4 grille / 50×30 / 38×25), prix TTC, enseigne, dépôt.
 * Export ZPL (.zpl) pour imprimantes thermiques sur les petits gabarits.
 *
 * Impression : la zone d'étiquettes est rendue PAR PORTAIL sur <body> —
 * la feuille de style d'impression masque .app-shell en display:none,
 * les étiquettes doivent donc vivre hors de l'arbre du shell.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { BarcodeSvg } from "./Barcode";
import { Button, Modal } from "./ui";
import { formatMoney } from "../lib/format";
import {
  expandLabels,
  LABEL_TEMPLATES,
  labelSymbology,
  labelTemplateLabel,
  templateById,
  type LabelLine,
  type LabelTemplateId,
} from "../lib/labels";
import { buildZpl, downloadZpl } from "../lib/zpl";
import { useToast } from "../store/toast";

const PREVIEW_MAX = 12;

function LabelCellContent({
  name,
  code,
  price,
  shop,
  depot,
  barHeight,
}: {
  name: string;
  code: string;
  price: string | null;
  shop: string | null;
  depot: string | null;
  barHeight: number;
}) {
  return (
    <>
      {shop ? <div className="l-shop">{shop}</div> : null}
      <div className="l-name">{name}</div>
      <BarcodeSvg
        value={code}
        height={barHeight}
        format={labelSymbology(code) === "EAN13" ? "ean13" : "code39"}
      />
      {price ? <div className="l-price">{price}</div> : null}
      {depot ? <div className="l-depot">{depot}</div> : null}
    </>
  );
}

export function LabelsPrintModal({
  lines,
  shopName,
  depotName = null,
  title,
  onClose,
}: {
  lines: LabelLine[];
  shopName: string | null;
  depotName?: string | null;
  title?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { show } = useToast();
  const [qtys, setQtys] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.key, l.qty])),
  );
  const [showPrice, setShowPrice] = useState(true);
  const [showShop, setShowShop] = useState(false);
  const [showDepot, setShowDepot] = useState(false);
  const [template, setTemplate] = useState<LabelTemplateId>("a4-grid");
  const tpl = templateById(template);

  const expanded = useMemo(
    () => expandLabels(lines.map((l) => ({ ...l, qty: qtys[l.key] ?? l.qty }))),
    [lines, qtys],
  );
  const skipped = lines.filter(
    (l) => !l.code && Math.round(qtys[l.key] ?? l.qty) > 0,
  );
  const shop = showShop && shopName ? shopName : null;
  const depot = showDepot && depotName ? depotName : null;
  const priceOf = (p: number | null) =>
    showPrice && p != null ? formatMoney(p) : null;
  const barHeight = template === "38x25" ? 20 : 26;

  const doZpl = () => {
    downloadZpl(
      buildZpl(
        expanded.map((e) => ({
          name: e.name,
          code: e.code!,
          priceText: priceOf(e.price),
        })),
        { template: template === "a4-grid" ? "50x30" : template, shop },
      ),
    );
    show(t("labelsPrint.zplToast"), "success");
  };

  return (
    <Modal title={title ?? t("labelsPrint.title")} onClose={onClose} wide>
      {/* Lignes et quantités */}
      <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 10 }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("fields.product")}</th>
              <th>{t("fields.barcode")}</th>
              <th style={{ width: 110 }}>{t("fields.quantity")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>{l.name}</td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {l.code ?? (
                    <span className="muted">{t("labelsPrint.none")}</span>
                  )}
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    style={{ width: 90 }}
                    value={qtys[l.key] ?? l.qty}
                    onChange={(e) =>
                      setQtys((q) => ({
                        ...q,
                        [l.key]: Number(e.target.value),
                      }))
                    }
                    aria-label={t("labelsPrint.qtyAria", { name: l.name })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {skipped.length > 0 ? (
        <p role="note" style={{ color: "#b45309", fontSize: 13 }}>
          {t("labelsPrint.skippedWarning", {
            count: skipped.length,
            names: skipped.map((s) => s.name).join(", "),
          })}
        </p>
      ) : null}

      {/* Options */}
      <div
        className="row"
        style={{ gap: 14, flexWrap: "wrap", marginBottom: 10 }}
      >
        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend className="muted" style={{ fontSize: 12 }}>
            {t("labelsPrint.templateLegend")}
          </legend>
          <div className="row" style={{ gap: 10 }}>
            {LABEL_TEMPLATES.map((tmpl) => (
              <label key={tmpl.id} className="row" style={{ gap: 4 }}>
                <input
                  type="radio"
                  name="label-tpl"
                  checked={template === tmpl.id}
                  onChange={() => setTemplate(tmpl.id)}
                />
                {/* Gabarits : libellés constants FR en repli (helper i18n). */}
                {labelTemplateLabel(tmpl)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            checked={showPrice}
            onChange={(e) => setShowPrice(e.target.checked)}
          />
          {t("labelsPrint.showPrice")}
        </label>
        {shopName ? (
          <label className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={showShop}
              onChange={(e) => setShowShop(e.target.checked)}
            />
            {t("labelsPrint.showShop")}
          </label>
        ) : null}
        {depotName ? (
          <label className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={showDepot}
              onChange={(e) => setShowDepot(e.target.checked)}
            />
            {t("fields.depot")}
          </label>
        ) : null}
      </div>

      {/* Aperçu écran (12 premières) */}
      <p className="muted" style={{ fontSize: 12, margin: "0 0 6px" }}>
        {t("labelsPrint.preview", { count: expanded.length })}
        {expanded.length > PREVIEW_MAX
          ? t("labelsPrint.previewTruncated", { max: PREVIEW_MAX })
          : ""}
        .
      </p>
      <div className="labels-preview">
        {expanded.slice(0, PREVIEW_MAX).map((e) => (
          <div className="label-cell" key={e.key}>
            <LabelCellContent
              name={e.name}
              code={e.code!}
              price={priceOf(e.price)}
              shop={shop}
              depot={depot}
              barHeight={barHeight}
            />
          </div>
        ))}
        {expanded.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {t("labelsPrint.emptyPreview")}
          </p>
        ) : null}
      </div>

      <div
        className="row"
        style={{ justifyContent: "flex-end", gap: 8, marginTop: 14 }}
      >
        <Button variant="outline" onClick={onClose}>
          {t("common.close")}
        </Button>
        {tpl.zpl ? (
          <Button
            variant="outline"
            onClick={doZpl}
            disabled={expanded.length === 0}
          >
            {t("labelsPrint.downloadZpl")}
          </Button>
        ) : null}
        <Button onClick={() => window.print()} disabled={expanded.length === 0}>
          {t("labelsPrint.printCount", { count: expanded.length })}
        </Button>
      </div>

      {/* Zone d'impression — portail <body> : .app-shell est masqué en
          display:none @media print, cette zone doit en être disjointe. */}
      {createPortal(
        <div className={`labels-print tpl-${template}`} aria-hidden>
          {expanded.map((e) => (
            <div className="label-cell" key={e.key}>
              <LabelCellContent
                name={e.name}
                code={e.code!}
                price={priceOf(e.price)}
                shop={shop}
                depot={depot}
                barHeight={barHeight}
              />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Modal>
  );
}
