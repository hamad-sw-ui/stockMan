/** Verrou POS (E6) : lorsque le tenant exige une session de caisse
 *  (« cash_session_required ») et qu'aucune caisse n'est ouverte sur le
 *  dépôt, la vente serait refusée par le serveur — on bloque donc l'écran
 *  avec le formulaire d'ouverture. Hors-ligne, le contrôle reste côté
 *  serveur à la synchronisation. */
import { useQuery } from "../lib/query";
import { Card } from "./ui";
import { OpenSessionForm } from "../pages/vendor/CashSessionPage";
import type { CashSessionCurrent } from "../lib/types";

export function CashSessionGate() {
  const q = useQuery<CashSessionCurrent>(
    "cash:current",
    "/cash-sessions/current",
  );
  // Erreur réseau (hors-ligne) : on laisse la caisse hors-ligne fonctionner,
  // le serveur appliquera la règle à la synchronisation.
  if (q.error || !q.data) return null;
  if (!q.data.required || q.data.session) return null;

  return (
    <div className="modal-backdrop" style={{ zIndex: 60 }}>
      <Card title="🔒 Ouvrez la caisse pour commencer">
        <p className="muted">
          La direction exige une session de caisse ouverte : vos ventes seront
          refusées tant que la caisse n'est pas ouverte (fond de départ compté).
        </p>
        <OpenSessionForm onOpened={() => undefined} />
      </Card>
    </div>
  );
}
