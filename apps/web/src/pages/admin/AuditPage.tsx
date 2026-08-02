/** Journal d'audit : traçabilité complète des opérations sensibles
 *  (qui, quoi, quand, où) avec inspection avant/après. */
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
} from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import type { AuditRow, Depot, Paged, VendorRow } from "../../lib/types";

const actionTone = (a: string) =>
  a === "DELETE" || a === "ARCHIVE"
    ? "danger"
    : a === "UPDATE" || a === "ADJUST"
      ? "warn"
      : a === "LOGIN"
        ? "info"
        : "ok";

const entityLabel = (e: string) =>
  ({
    product: "Produit",
    category: "Catégorie",
    unit: "Unité",
    depot: "Dépôt",
    supplier: "Fournisseur",
    receipt: "Réception",
    transfer: "Transfert",
    stock: "Stock",
    sale: "Vente",
    user: "Utilisateur",
    tenant: "Entreprise",
    license: "Licence",
    session: "Session",
    config: "Configuration",
  })[e] ?? e;

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const params = new URLSearchParams({ page: String(page), size: "25" });
  if (entity) params.set("entity", entity);
  if (action) params.set("action", action);
  if (userId) params.set("userId", userId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const path = `/audit-logs?${params}`;

  const q = useQuery<Paged<AuditRow>>(`audit:${path}`, path);
  const users = useQuery<VendorRow[]>(
    "users:short",
    "/users?includeInactive=true",
  );
  // Les dépôts serviront si l'on ajoute un filtre dépôt ultérieur
  useQuery<Depot[]>("depots:list", "/depots");

  return (
    <div className="wrap">
      <PageHeader
        title="Journal d’audit"
        sub="Traçabilité des opérations sensibles — immutable et horodaté"
      />

      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label="Entité">
            <Input
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setPage(1);
              }}
              placeholder="product, sale, user…"
            />
          </Field>
          <Field label="Action">
            <Select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Toutes</option>
              {[
                "CREATE",
                "UPDATE",
                "DELETE",
                "ARCHIVE",
                "RESTORE",
                "SALE",
                "VOID",
                "RETURN",
                "RECEIPT",
                "TRANSFER",
                "ADJUST",
                "LOGIN",
                "LICENSE",
                "IMPERSONATE",
              ].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Utilisateur">
            <Select
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEntity("");
              setAction("");
              setUserId("");
              setFrom("");
              setTo("");
              setPage(1);
            }}
          >
            Réinitialiser
          </Button>
        </div>
      </Card>

      {q.loading ? (
        <Spinner label="Chargement du journal…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("audit:")}
        />
      ) : !q.data?.data.length ? (
        <EmptyState emoji="🛡️" title="Aucune entrée">
          Les opérations sensibles seront journalisées ici.
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Entité</th>
                  <th>Par</th>
                  <th>Dépôt</th>
                  <th aria-label="Détail" />
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((r) => (
                  <tr key={r.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(r.created_at)}
                    </td>
                    <td>
                      <Badge tone={actionTone(r.action)}>{r.action}</Badge>
                    </td>
                    <td>
                      {entityLabel(r.entity)}{" "}
                      {r.entity_id ? (
                        <code className="muted" style={{ fontSize: "0.78rem" }}>
                          #{r.entity_id.slice(0, 8)}
                        </code>
                      ) : null}
                    </td>
                    <td>{r.user_full_name ?? r.user_name ?? "—"}</td>
                    <td className="muted">{r.depot_name ?? "—"}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetail(r)}
                      >
                        Détail
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
        <Modal
          title={`${detail.action} — ${entityLabel(detail.entity)}`}
          onClose={() => setDetail(null)}
          wide
        >
          <p className="muted">
            {formatDateTime(detail.created_at)} · par{" "}
            <strong>{detail.user_full_name ?? detail.user_name ?? "—"}</strong>
            {detail.depot_name ? ` · dépôt ${detail.depot_name}` : ""}
          </p>
          {detail.details ? <p>{detail.details}</p> : null}
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            <div>
              <h3 style={{ margin: "4px 0" }}>Avant</h3>
              <pre
                style={{
                  background: "var(--surface-2)",
                  borderRadius: 10,
                  padding: 12,
                  fontSize: "0.78rem",
                  overflow: "auto",
                  maxHeight: 300,
                }}
              >
                {detail.previous_state
                  ? JSON.stringify(detail.previous_state, null, 2)
                  : "—"}
              </pre>
            </div>
            <div>
              <h3 style={{ margin: "4px 0" }}>Après</h3>
              <pre
                style={{
                  background: "var(--surface-2)",
                  borderRadius: 10,
                  padding: 12,
                  fontSize: "0.78rem",
                  overflow: "auto",
                  maxHeight: 300,
                }}
              >
                {detail.new_state
                  ? JSON.stringify(detail.new_state, null, 2)
                  : "—"}
              </pre>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
