/** Ma caisse (E6) : ouverture avec fond de caisse, suivi des attendus en
 *  direct par méthode, clôture avec comptage physique et émission du Z
 *  (immuable, écart = compté − attendu). */
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Kpi,
  PageHeader,
  Spinner,
} from "../../components/ui";
import { post } from "../../lib/http";
import { invalidateQueries, useQuery } from "../../lib/query";
import {
  formatDateTime,
  formatMoney,
  paymentMethodLabel,
} from "../../lib/format";
import { useToast } from "../../store/toast";
import type { CashSession, CashSessionCurrent } from "../../lib/types";

const METHODS = ["CASH", "MTN_MOMO", "ORANGE_MONEY"] as const;

/** Formulaire d'ouverture de caisse (fond + note). */
export function OpenSessionForm({
  depotId,
  onOpened,
}: {
  depotId?: string | null;
  onOpened: (s: CashSession) => void;
}) {
  const { show } = useToast();
  const [floatStr, setFloatStr] = useState("0");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const open = async () => {
    const openingFloat = Math.max(0, Math.round(Number(floatStr) || 0));
    setBusy(true);
    try {
      const s = await post<CashSession>(`/cash-sessions`, {
        ...(depotId ? { depotId } : {}),
        openingFloat,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      show("Caisse ouverte — bonne journée !", "success");
      invalidateQueries("cash:");
      onOpened(s);
    } catch (e) {
      show(e instanceof Error ? e.message : "Ouverture impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form" style={{ maxWidth: 380 }}>
      <Field label="Fond de caisse (espèces en tiroir)">
        <Input
          type="number"
          min={0}
          step={100}
          value={floatStr}
          onChange={(e) => setFloatStr(e.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Note (optionnel)">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex. Ouverture du matin"
        />
      </Field>
      <Button onClick={open} loading={busy}>
        Ouvrir la caisse
      </Button>
    </div>
  );
}

export default function CashSessionPage() {
  const { show } = useToast();
  const q = useQuery<CashSessionCurrent>(
    "cash:current",
    "/cash-sessions/current",
  );
  const [closedZ, setClosedZ] = useState<CashSession | null>(null);

  // Comptage physique de clôture
  const [countCash, setCountCash] = useState("");
  const [countMtn, setCountMtn] = useState("");
  const [countOm, setCountOm] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [busy, setBusy] = useState(false);

  const session = q.data?.session ?? null;

  const close = async () => {
    if (!session) return;
    if (countCash === "" || Number(countCash) < 0) {
      show("Comptez les espèces en tiroir avant de clôturer.", "error");
      return;
    }
    setBusy(true);
    try {
      const s = await post<CashSession>(`/cash-sessions/${session.id}/close`, {
        countedCash: Math.round(Number(countCash)),
        ...(countMtn !== ""
          ? { countedMtn: Math.round(Number(countMtn)) }
          : {}),
        ...(countOm !== "" ? { countedOm: Math.round(Number(countOm)) } : {}),
        ...(closeNote.trim() ? { note: closeNote.trim() } : {}),
      });
      setClosedZ(s);
      invalidateQueries("cash:");
      show(
        "Caisse clôturée — le Z est émis et la journée verrouillée.",
        "success",
      );
    } catch (e) {
      show(e instanceof Error ? e.message : "Clôture impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  if (q.loading && !q.data) return <Spinner label="Chargement de la caisse…" />;

  /* ---------------- Z de clôture (après clôture réussie) ---------------- */
  const z = closedZ?.zReport;
  if (closedZ && z) {
    const varianceTone = (v: number | null) =>
      v == null || v === 0 ? "ok" : v < 0 ? "danger" : "warn";
    return (
      <div className="wrap" style={{ maxWidth: 760 }}>
        <PageHeader
          title={`Z de caisse — ${closedZ.businessDate}`}
          sub={`Clôturée par ${z.closedBy} · journée verrouillée`}
          actions={
            <Button variant="ghost" onClick={() => window.print()}>
              🖨️ Imprimer
            </Button>
          }
        />
        <div className="grid kpis">
          <Kpi label="Ventes" value={String(z.sales.count)} />
          <Kpi
            label="Chiffre d'affaires"
            value={formatMoney(z.sales.totalSold)}
          />
          <Kpi label="Encaissé" value={formatMoney(z.sales.totalPaid)} />
          <Kpi
            label="Écart total"
            value={formatMoney(z.varianceTotal)}
            tone={varianceTone(z.varianceTotal)}
          />
        </div>
        <Card title="Contrôle par méthode">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Méthode</th>
                  <th className="num">Encaissements</th>
                  <th className="num">Attendu</th>
                  <th className="num">Compté</th>
                  <th className="num">Écart</th>
                </tr>
              </thead>
              <tbody>
                {METHODS.map((m) => {
                  const line = z.methods[m];
                  return (
                    <tr key={m}>
                      <td>{paymentMethodLabel(m)}</td>
                      <td className="num">{formatMoney(line.payments)}</td>
                      <td className="num">{formatMoney(line.expected)}</td>
                      <td className="num">
                        {line.counted == null ? "—" : formatMoney(line.counted)}
                      </td>
                      <td className="num">
                        {line.variance == null ? (
                          "—"
                        ) : (
                          <Badge tone={varianceTone(line.variance)}>
                            {formatMoney(line.variance)}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Fond d'ouverture : {formatMoney(z.openingFloat)} · Crédit restant
            sur les ventes du jour : {formatMoney(z.sales.creditOutstanding)}.
            Le Z est <strong>définitif</strong> : la journée ne peut pas être
            rouverte.
          </p>
        </Card>
      </div>
    );
  }

  /* ---------------------- Aucune session ouverte ------------------------ */
  if (!session) {
    return (
      <div className="wrap" style={{ maxWidth: 620 }}>
        <PageHeader
          title="Ma caisse"
          sub={
            q.data?.required
              ? "La direction exige une session de caisse ouverte pour vendre."
              : "Aucune session de caisse ouverte sur votre dépôt."
          }
        />
        <Card title="Ouvrir la caisse">
          {q.data?.required ? (
            <p className="muted">
              ⚠️ Sans caisse ouverte, vos ventes seront refusées par le serveur.
            </p>
          ) : null}
          <OpenSessionForm onOpened={() => invalidateQueries("cash:")} />
        </Card>
      </div>
    );
  }

  /* ------------------------ Session ouverte ----------------------------- */
  const expected = session.expected;
  const numOrNull = (s: string) => (s === "" ? null : Math.round(Number(s)));
  const previewVar = (counted: number | null, exp: number) =>
    counted == null ? null : counted - exp;

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <PageHeader
        title="Ma caisse"
        sub={`Ouverte le ${formatDateTime(session.openedAt)} · journée du ${session.businessDate}`}
        actions={<Badge tone="ok">Caisse ouverte</Badge>}
      />

      <div className="grid kpis">
        <Kpi
          label="Fond d'ouverture"
          value={formatMoney(session.openingFloat)}
        />
        <Kpi label="Espèces attendues" value={formatMoney(expected.CASH)} />
        <Kpi label="MTN MoMo attendu" value={formatMoney(expected.MTN_MOMO)} />
        <Kpi
          label="Orange Money attendu"
          value={formatMoney(expected.ORANGE_MONEY)}
        />
      </div>

      <Card title="Clôturer la caisse — comptage physique">
        <p className="muted">
          Comptez le contenu du tiroir et les soldes Mobile Money, puis
          clôturez. L'écart (compté − attendu) est{" "}
          <strong>figé dans le Z</strong> et visible par le gérant ; la journée
          est ensuite verrouillée.
        </p>
        <div className="grid grid-3">
          <Field label="Espèces comptées (obligatoire)">
            <Input
              type="number"
              min={0}
              step={100}
              value={countCash}
              onChange={(e) => setCountCash(e.target.value)}
              placeholder={String(expected.CASH)}
            />
          </Field>
          <Field label="Solde MTN MoMo (optionnel)">
            <Input
              type="number"
              min={0}
              step={100}
              value={countMtn}
              onChange={(e) => setCountMtn(e.target.value)}
              placeholder={String(expected.MTN_MOMO)}
            />
          </Field>
          <Field label="Solde Orange Money (optionnel)">
            <Input
              type="number"
              min={0}
              step={100}
              value={countOm}
              onChange={(e) => setCountOm(e.target.value)}
              placeholder={String(expected.ORANGE_MONEY)}
            />
          </Field>
        </div>
        {/* Aperçu des écarts avant validation */}
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          {METHODS.map((m) => {
            const counted =
              m === "CASH"
                ? numOrNull(countCash)
                : m === "MTN_MOMO"
                  ? numOrNull(countMtn)
                  : numOrNull(countOm);
            const v = previewVar(counted, expected[m]);
            return (
              <span key={m} className="muted">
                {paymentMethodLabel(m)} :{" "}
                {v == null ? (
                  "—"
                ) : (
                  <Badge tone={v === 0 ? "ok" : v < 0 ? "danger" : "warn"}>
                    {v > 0 ? "+" : ""}
                    {formatMoney(v)}
                  </Badge>
                )}
              </span>
            );
          })}
        </div>
        <Field label="Note de clôture (optionnel)">
          <Input
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
            placeholder="Ex. Écart dû à un rendu monnaie"
          />
        </Field>
        <Button variant="danger" onClick={close} loading={busy}>
          Clôturer et émettre le Z
        </Button>
      </Card>

      <EmptyState emoji="ℹ️" title="Une seule session par jour">
        Après clôture, la journée est verrouillée : impossible de rouvrir une
        caisse ou d'annuler une vente de cette journée.
      </EmptyState>
    </div>
  );
}
