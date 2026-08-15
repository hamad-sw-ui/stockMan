/** Journal des mouvements de stock : pagination par curseur (« charger plus »),
 *  filtres type/dépôt/utilisateur/période — traçabilité complète IN/OUT/etc. */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "../../components/ui";
import { get } from "../../lib/http";
import { formatDateTime, formatQty, movementTypeLabel } from "../../lib/format";
import { useQuery } from "../../lib/query";
import type { Depot, Movement, VendorRow } from "../../lib/types";

interface MovementQuery {
  type:
    | ""
    | "IN"
    | "OUT"
    | "TRANSFER"
    | "ADJUSTMENT"
    | "SALE"
    | "RETURN"
    | "DAMAGE"
    | "EXPIRED"
    | "VOID";
  depotId: string;
  userId: string;
  from: string;
  to: string;
}

const tone = (t: string): "ok" | "danger" | "warn" | "info" | undefined =>
  t === "IN" || t === "RETURN" || t === "VOID"
    ? "ok"
    : t === "OUT" || t === "DAMAGE" || t === "EXPIRED"
      ? "danger"
      : t === "SALE"
        ? "info"
        : "warn";

export default function MovementsPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState<MovementQuery>({
    type: "",
    depotId: "",
    userId: "",
    from: "",
    to: "",
  });
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const users = useQuery<VendorRow[]>(
    "users:short",
    "/users?includeInactive=true",
  );

  const [rows, setRows] = useState<Movement[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);

  const baseParams = useMemo(() => {
    const p = new URLSearchParams({ size: "50" });
    if (query.type) p.set("type", query.type);
    if (query.depotId) p.set("depotId", query.depotId);
    if (query.userId) p.set("userId", query.userId);
    if (query.from) p.set("from", query.from);
    if (query.to) p.set("to", query.to);
    return p;
  }, [query]);

  const load = async (reset: boolean, cur: string | null = null) => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams(baseParams);
      if (cur) p.set("cursor", cur);
      const res = await get<{ data: Movement[]; nextCursor: string | null }>(
        `/stock/movements?${p}`,
      );
      setRows((prev) => (reset ? res.data : [...prev, ...res.data]));
      setCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.loadingError"));
    } finally {
      setLoading(false);
      setBooted(true);
    }
  };

  // Rechargement à chaque changement de filtre
  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseParams]);

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.movements.title")}
        sub={t("pages.movements.sub")}
      />

      <Card className="filters">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label={t("fields.type")}>
            <Select
              value={query.type}
              onChange={(e) =>
                setQuery({
                  ...query,
                  type: e.target.value
                    ? (e.target.value as MovementQuery["type"] & string)
                    : "",
                })
              }
            >
              <option value="">{t("common.all")}</option>
              {(
                [
                  "IN",
                  "OUT",
                  "SALE",
                  "RETURN",
                  "TRANSFER",
                  "ADJUSTMENT",
                  "DAMAGE",
                  "EXPIRED",
                  "VOID",
                ] as const
              ).map((t) => (
                <option key={t} value={t}>
                  {movementTypeLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fields.depot")}>
            <Select
              value={query.depotId}
              onChange={(e) => setQuery({ ...query, depotId: e.target.value })}
            >
              <option value="">{t("common.all")}</option>
              {(depots.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fields.user")}>
            <Select
              value={query.userId}
              onChange={(e) => setQuery({ ...query, userId: e.target.value })}
            >
              <option value="">{t("common.all")}</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.from")}>
            <Input
              type="date"
              value={query.from}
              onChange={(e) => setQuery({ ...query, from: e.target.value })}
            />
          </Field>
          <Field label={t("common.to")}>
            <Input
              type="date"
              value={query.to}
              onChange={(e) => setQuery({ ...query, to: e.target.value })}
            />
          </Field>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setQuery({ type: "", depotId: "", userId: "", from: "", to: "" })
            }
          >
            {t("common.reset")}
          </Button>
        </div>
      </Card>

      {error ? (
        <ErrorState error={{ message: error }} onRetry={() => load(true)} />
      ) : null}

      {!booted && loading ? (
        <Spinner label={t("pages.movements.loading")} />
      ) : booted && rows.length === 0 ? (
        <EmptyState emoji="↔️" title={t("pages.movements.empty")}>
          {t("pages.movements.emptyBody")}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("fields.type")}</th>
                  <th>{t("fields.product")}</th>
                  <th className="num">{t("fields.quantity")}</th>
                  <th className="num">{t("pages.movements.beforeAfter")}</th>
                  <th>{t("fields.depot")}</th>
                  <th>{t("pages.movements.by")}</th>
                  <th>{t("fields.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(m.created_at)}
                    </td>
                    <td>
                      <Badge tone={tone(m.type)}>
                        {movementTypeLabel(m.type)}
                      </Badge>
                    </td>
                    <td>
                      {m.product_name}
                      {m.variant_name ? (
                        <span className="muted"> · {m.variant_name}</span>
                      ) : null}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatQty(m.quantity)}
                    </td>
                    <td className="num muted">
                      {m.previous_stock != null && m.new_stock != null
                        ? `${formatQty(m.previous_stock)} → ${formatQty(m.new_stock)}`
                        : "—"}
                    </td>
                    <td className="muted">{m.depot_name}</td>
                    <td className="muted">{m.user_name ?? "—"}</td>
                    <td className="muted" style={{ maxWidth: 220 }}>
                      {m.reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {cursor ? (
        <div className="center" style={{ marginTop: 12 }}>
          <Button
            variant="outline"
            loading={loading}
            onClick={() => load(false, cursor)}
          >
            {t("pages.movements.loadMore")}
          </Button>
        </div>
      ) : booted && rows.length > 0 ? (
        <p className="muted center" style={{ marginTop: 10 }}>
          {t("pages.movements.endNote", { count: rows.length })}
        </p>
      ) : null}
    </div>
  );
}
