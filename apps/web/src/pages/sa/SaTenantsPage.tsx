/** Console éditeur — tenants : recherche, création (avec compte gérant +
 *  licence d'essai en une transaction), statut et mot de passe temporaire. */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
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

/** Libellé i18n d'un statut de licence, repli sur le code brut si inconnu. */
function licStatusLabel(t: (k: string) => string, code: string): string {
  const key = `licenseStatus.${code}`;
  const v = t(key);
  return v === key ? code : v;
}

export default function SaTenantsPage() {
  const { t } = useTranslation();
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
      show(
        e instanceof Error ? e.message : t("pages.sa.tenants.createError"),
        "error",
      );
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
        title={t("pages.sa.tenants.title")}
        sub={t("pages.sa.tenants.sub")}
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
            {t("pages.sa.tenants.newButton")}
          </Button>
        }
      />

      <Card className="filters">
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder={t("pages.sa.tenants.searchPlaceholder")}
        />
      </Card>

      {tenants.loading ? (
        <Spinner label={t("common.loading")} />
      ) : tenants.error ? (
        <ErrorState
          error={tenants.error}
          onRetry={() => invalidateQueries("sa-tenants:")}
        />
      ) : !tenants.data?.data.length ? (
        <EmptyState
          emoji="🏢"
          title={t("pages.sa.tenants.empty")}
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
              {t("common.addFirst")}
            </Button>
          }
        />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.sa.tenants.colCompany")}</th>
                  <th>{t("pages.sa.tenants.colLicense")}</th>
                  <th>{t("pages.customers.colDueDate")}</th>
                  <th className="num">{t("pages.subscription.kpiUsers")}</th>
                  <th className="num">{t("pages.sa.tenants.colDepots")}</th>
                  <th className="num">{t("pages.sa.tenants.colRevenue")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("pages.sa.tenants.colCreated")}</th>
                </tr>
              </thead>
              <tbody>
                {tenants.data.data.map((row) => (
                  <tr
                    key={row.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/sa/tenants/${row.id}`)}
                  >
                    <td style={{ fontWeight: 700 }}>{row.name}</td>
                    <td>
                      {row.license ? (
                        <Badge tone={licTone(row.license.status)}>
                          {row.license.planCode} ·{" "}
                          {licStatusLabel(t, row.license.status)}
                        </Badge>
                      ) : (
                        <Badge>{t("pages.sa.tenants.noLicense")}</Badge>
                      )}
                    </td>
                    <td className="muted">
                      {row.license?.endDate
                        ? formatDate(row.license.endDate)
                        : "—"}
                    </td>
                    <td className="num">{row.user_count}</td>
                    <td className="num">{row.depot_count}</td>
                    <td className="num">{formatMoney(row.revenue)}</td>
                    <td>
                      <Badge tone={row.is_active ? "ok" : "danger"}>
                        {row.is_active
                          ? t("common.active")
                          : t("common.suspended")}
                      </Badge>
                    </td>
                    <td className="muted">{formatDate(row.created_at)}</td>
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
          title={t("pages.sa.tenants.modalTitle")}
          onClose={() => !create.loading && setForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setForm(null)}
                disabled={create.loading}
              >
                {t("common.cancel")}
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
                {t("pages.sa.tenants.createButton")}
              </Button>
            </>
          }
        >
          <Field label={t("pages.sa.tenants.companyField")} required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("pages.sa.tenants.ownerField")} required>
              <Input
                value={form.adminName}
                onChange={(e) =>
                  setForm({ ...form, adminName: e.target.value })
                }
              />
            </Field>
            <Field label={t("pages.sa.tenants.emailField")} required>
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
            <Field label={t("pages.sa.tenants.planField")}>
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
                    {p.name} (
                    {t("pages.sa.licenses.priceMonthly", {
                      price: formatMoney(p.monthly_price),
                    })}
                    )
                  </option>
                ))}
              </Select>
            </Field>
            {form.planCode === "TRIAL" ? (
              <Field label={t("pages.sa.tenants.trialDaysField")}>
                <Input
                  inputMode="numeric"
                  value={form.trialDays}
                  onChange={(e) =>
                    setForm({ ...form, trialDays: e.target.value })
                  }
                />
              </Field>
            ) : null}
            <Field label={t("fields.phone")}>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("pages.sa.tenants.provisionNote")}
          </p>
        </Modal>
      ) : null}

      {created ? (
        <Modal
          title={t("pages.sa.tenants.createdTitle")}
          onClose={() => setCreated(null)}
          footer={
            <Button onClick={() => setCreated(null)}>
              {t("pages.sa.tenants.sharedButton")}
            </Button>
          }
        >
          <p>{t("pages.sa.tenants.shareNote")}</p>
          <div className="card" style={{ background: "var(--surface-2)" }}>
            <p style={{ margin: 0 }}>
              {t("fields.email")} : <strong>{created.adminEmail}</strong>
            </p>
            <p style={{ margin: "6px 0 0" }}>
              {t("pages.sa.tenants.tempPassword")} :{" "}
              <code style={{ fontWeight: 800, fontSize: "1.1rem" }}>
                {created.temporaryPassword}
              </code>
            </p>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("pages.sa.tenants.changePwNote")}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
