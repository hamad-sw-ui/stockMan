/** Console éditeur — tenants : recherche, création (avec compte gérant +
 *  licence d'essai en une transaction), statut et mot de passe temporaire. */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
  SearchInput,
  Select,
  Spinner,
} from "../../components/ui";
import { post } from "../../lib/http";
import { formatDate, formatMoney } from "../../lib/format";
import { invalidateQueries, useMutation, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { Paged, Plan, SaTenantRow } from "../../lib/types";

const licTone = (s?: string): "ok" | "info" | "danger" =>
  s === "ACTIVE" ? "ok" : s === "TRIAL" ? "info" : "danger";

export default function SaTenantsPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const path = `/tenants?search=${encodeURIComponent(q)}&page=${page}&size=15`;
  const tenants = useQuery<Paged<SaTenantRow>>(`sa-tenants:${path}`, path);
  const plans = useQuery<Plan[]>("plans:list", "/licenses/plans");

  const [form, setForm] = useState<{
    name: string;
    adminName: string;
    adminEmail: string;
    planCode: string;
    trialDays: string;
    phone: string;
  } | null>(null);
  const [created, setCreated] = useState<{
    adminEmail: string;
    temporaryPassword: string;
  } | null>(null);
  const create = useMutation((f: NonNullable<typeof form>) =>
    post<{ adminEmail: string; temporaryPassword: string }>("/tenants", {
      name: f.name,
      adminName: f.adminName,
      adminEmail: f.adminEmail,
      planCode: f.planCode,
      trialDays: Number(f.trialDays) || 14,
      phone: f.phone || null,
    }),
  );

  const submit = async () => {
    if (!form) return;
    try {
      const res = await create.run(form);
      invalidateQueries("sa-tenants:");
      setForm(null);
      setCreated(res);
    } catch (e) {
      show(e instanceof Error ? e.message : "Création impossible", "error");
    }
  };

  // Debounce recherche
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const onSearch = (v: string) => {
    setSearch(v);
    if (timer) clearTimeout(timer);
    setTimer(
      setTimeout(() => {
        setQ(v);
        setPage(1);
      }, 400),
    );
  };

  return (
    <div className="wrap">
      <PageHeader
        title="Tenants"
        sub="Entreprises clientes de la plateforme"
        actions={
          <Button
            onClick={() =>
              setForm({
                name: "",
                adminName: "",
                adminEmail: "",
                planCode: "TRIAL",
                trialDays: "14",
                phone: "",
              })
            }
          >
            ➕ Nouveau tenant
          </Button>
        }
      />

      <Card className="filters">
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder="Nom d’entreprise ou email utilisateur…"
        />
      </Card>

      {tenants.loading ? (
        <Spinner label="Chargement…" />
      ) : tenants.error ? (
        <ErrorState
          error={tenants.error}
          onRetry={() => invalidateQueries("sa-tenants:")}
        />
      ) : !tenants.data?.data.length ? (
        <EmptyState
          emoji="🏢"
          title="Aucun tenant"
          action={
            <Button
              onClick={() =>
                setForm({
                  name: "",
                  adminName: "",
                  adminEmail: "",
                  planCode: "TRIAL",
                  trialDays: "14",
                  phone: "",
                })
              }
            >
              Créer le premier
            </Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Licence</th>
                  <th>Échéance</th>
                  <th className="num">Utilisateurs</th>
                  <th className="num">Dépôts</th>
                  <th className="num">CA cumulé</th>
                  <th>Statut</th>
                  <th>Créé le</th>
                </tr>
              </thead>
              <tbody>
                {tenants.data.data.map((t) => (
                  <tr
                    key={t.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/sa/tenants/${t.id}`)}
                  >
                    <td style={{ fontWeight: 700 }}>{t.name}</td>
                    <td>
                      {t.license ? (
                        <Badge tone={licTone(t.license.status)}>
                          {t.license.planCode} · {t.license.status}
                        </Badge>
                      ) : (
                        <Badge>Aucune</Badge>
                      )}
                    </td>
                    <td className="muted">
                      {t.license?.endDate ? formatDate(t.license.endDate) : "—"}
                    </td>
                    <td className="num">{t.user_count}</td>
                    <td className="num">{t.depot_count}</td>
                    <td className="num">{formatMoney(t.revenue)}</td>
                    <td>
                      <Badge tone={t.is_active ? "ok" : "danger"}>
                        {t.is_active ? "Actif" : "Suspendu"}
                      </Badge>
                    </td>
                    <td className="muted">{formatDate(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {tenants.data ? (
        <Pagination
          page={tenants.data.page}
          totalPages={tenants.data.totalPages}
          total={tenants.data.total}
          onPage={setPage}
        />
      ) : null}

      {form ? (
        <Modal
          title="Nouveau tenant"
          onClose={() => !create.loading && setForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setForm(null)}
                disabled={create.loading}
              >
                Annuler
              </Button>
              <Button
                loading={create.loading}
                onClick={submit}
                disabled={
                  !form.name.trim() ||
                  !form.adminName.trim() ||
                  !form.adminEmail.includes("@")
                }
              >
                Créer le tenant
              </Button>
            </>
          }
        >
          <Field label="Nom de l’entreprise" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Nom du gérant" required>
              <Input
                value={form.adminName}
                onChange={(e) =>
                  setForm({ ...form, adminName: e.target.value })
                }
              />
            </Field>
            <Field label="Email du gérant" required>
              <Input
                type="email"
                value={form.adminEmail}
                onChange={(e) =>
                  setForm({ ...form, adminEmail: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Formule initiale">
              <Select
                value={form.planCode}
                onChange={(e) => setForm({ ...form, planCode: e.target.value })}
              >
                {(
                  plans.data ?? [
                    {
                      code: "TRIAL",
                      name: "Essai",
                      max_users: 2,
                      max_depots: 1,
                      monthly_price: 0,
                    },
                  ]
                ).map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} ({formatMoney(p.monthly_price)}/mois)
                  </option>
                ))}
              </Select>
            </Field>
            {form.planCode === "TRIAL" ? (
              <Field label="Durée d’essai (jours)">
                <Input
                  inputMode="numeric"
                  value={form.trialDays}
                  onChange={(e) =>
                    setForm({ ...form, trialDays: e.target.value })
                  }
                />
              </Field>
            ) : null}
            <Field label="Téléphone">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            La création provisionne en une transaction : entreprise, licence,
            dépôt « Dépôt Principal », unités par défaut et compte gérant (mot
            de passe temporaire affiché une fois).
          </p>
        </Modal>
      ) : null}

      {created ? (
        <Modal
          title="✅ Tenant créé"
          onClose={() => setCreated(null)}
          footer={
            <Button onClick={() => setCreated(null)}>
              J’ai transmis les accès
            </Button>
          }
        >
          <p>Communiquez ces accès au gérant (affichés une seule fois) :</p>
          <div className="card" style={{ background: "var(--surface-2)" }}>
            <p style={{ margin: 0 }}>
              Email : <strong>{created.adminEmail}</strong>
            </p>
            <p style={{ margin: "6px 0 0" }}>
              Mot de passe temporaire :{" "}
              <code style={{ fontWeight: 800, fontSize: "1.1rem" }}>
                {created.temporaryPassword}
              </code>
            </p>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Le gérant pourra changer son mot de passe après connexion.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
