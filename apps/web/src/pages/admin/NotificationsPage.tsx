/** Centre de notifications : historique des envois + marquage lus.
 *  Les paramètres d'alertes SMS/WhatsApp sont dans Paramètres > Alertes. */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Spinner,
} from "../../components/ui";
import { patch, post } from "../../lib/http";
import { formatDateTime, notificationTypeLabel } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { NotificationRow, Paged } from "../../lib/types";

const statusTone = (s: string): "ok" | "warn" | "danger" | "info" =>
  s === "SENT"
    ? "ok"
    : s === "FAILED"
      ? "danger"
      : s === "READ"
        ? "info"
        : "warn";
const statusLabel = (s: string) =>
  s === "SENT"
    ? "Envoyée"
    : s === "FAILED"
      ? "Échec"
      : s === "READ"
        ? "Lue"
        : "En attente";
const channelLabel = (c: string) => (c === "IN_APP" ? "Dans l’app" : c);

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const path = `/notifications?page=${page}&size=25${status ? `&status=${status}` : ""}`;
  const q = useQuery<Paged<NotificationRow> & { unread: number }>(
    `notifications:${path}`,
    path,
  );
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  const markAll = async () => {
    setBusy(true);
    try {
      await post("/notifications/read-all");
      invalidateQueries("notifications:");
      show("Toutes les notifications sont marquées lues.", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "Erreur", "error");
    } finally {
      setBusy(false);
    }
  };

  const markOne = async (id: string) => {
    try {
      await patch(`/notifications/${id}/read`);
      invalidateQueries("notifications:");
    } catch (e) {
      show(e instanceof Error ? e.message : "Erreur", "error");
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title="Centre de notifications"
        sub="Alertes stock bas, péremptions et rapport quotidien — SMS, WhatsApp et internes"
        actions={
          <>
            {q.data && q.data.unread > 0 ? (
              <Button
                variant="outline"
                size="sm"
                loading={busy}
                onClick={markAll}
              >
                Tout marquer lu ({q.data.unread})
              </Button>
            ) : null}
            <Link className="btn btn-outline btn-sm" to="/admin/parametres">
              ⚙️ Paramètres d’alertes
            </Link>
          </>
        }
      />

      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <select
          className="select"
          style={{ width: "auto" }}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filtrer par statut"
        >
          <option value="">Tous les statuts</option>
          <option value="PENDING">En attente</option>
          <option value="SENT">Envoyées</option>
          <option value="FAILED">Échecs</option>
          <option value="READ">Lues</option>
        </select>
      </div>

      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("notifications:")}
        />
      ) : !q.data?.data.length ? (
        <EmptyState emoji="🔕" title="Aucune notification">
          Les alertes automatiques apparaîtront ici dès qu’un produit passera
          sous son seuil ou qu’un lot approchera de sa péremption.
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Message</th>
                  <th>Type</th>
                  <th>Canal</th>
                  <th>Statut</th>
                  <th>Date</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((n) => (
                  <tr
                    key={n.id}
                    style={
                      n.channel === "IN_APP" && n.status === "SENT"
                        ? { fontWeight: 700 }
                        : undefined
                    }
                  >
                    <td style={{ maxWidth: 420 }}>{n.message}</td>
                    <td className="muted">{notificationTypeLabel(n.type)}</td>
                    <td className="muted">{channelLabel(n.channel)}</td>
                    <td>
                      <Badge tone={statusTone(n.status)}>
                        {statusLabel(n.status)}
                      </Badge>
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(n.created_at)}
                    </td>
                    <td>
                      {n.channel === "IN_APP" && n.status === "SENT" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markOne(n.id)}
                        >
                          Marquer lue
                        </Button>
                      ) : null}
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
    </div>
  );
}
