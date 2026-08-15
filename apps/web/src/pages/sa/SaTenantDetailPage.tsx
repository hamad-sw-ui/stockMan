/** Console éditeur — détail tenant : utilisateurs, dépôts, licences, stats et
 *  actions de support (impersonation journalisée, suspension, reset gérant). */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  ErrorState,
  Field,
  Input,
  Kpi,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Tabs,
} from "../../components/ui";
import { patch, post, setAccessToken } from "../../lib/http";
import { formatDate, formatMoney, formatQty } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { LicenseRow, Plan } from "../../lib/types";

/** Libellé i18n d'un statut de licence, repli sur le code brut si inconnu. */
function licStatusLabel(t: (k: string) => string, code: string): string {
  const key = `licenseStatus.${code}`;
  const v = t(key);
  return v === key ? code : v;
}

interface TenantDetail {
  id: string;
  name: string;
  subdomain: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    is_active: boolean;
    created_at: string;
  }>;
  depots: Array<{
    id: string;
    name: string;
    address: string | null;
    is_active: boolean;
  }>;
  licenses: Array<LicenseRow & { plan_name: string }>;
  stats: { revenue: number; sales_count: number };
}

export default function SaTenantDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { show } = useToast();
  const q = useQuery<TenantDetail>(
    `sa-tenant:${id}`,
    id ? `/tenants/${id}` : null,
  );
  const plans = useQuery<Plan[]>("plans:list", "/licenses/plans");
  const [tab, setTab] = useState("synthese");

  const [confirm, setConfirm] = useState<
    "suspend" | "activate" | "reset" | "impersonate" | null
  >(null);
  const [licForm, setLicForm] = useState<{
    planCode: string;
    startDate: string;
    months: string;
  } | null>(null);
  const [tempPw, setTempPw] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    subdomain: "",
  });

  const refresh = () => invalidateQueries(`sa-tenant:${id}`);

  const doConfirm = async () => {
    if (!confirm || !id) return;
    setBusy(true);
    try {
      if (confirm === "impersonate") {
        const res = await post<{ accessToken: string }>(
          `/tenants/${id}/impersonate`,
        );
        sessionStorage.setItem("stockman.impersonating", "1");
        setAccessToken(res.accessToken);
        window.location.href = "/admin";
        return;
      }
      if (confirm === "reset") {
        const res = await post<{ temporaryPassword: string }>(
          `/tenants/${id}/reset-admin-password`,
        );
        setTempPw(res.temporaryPassword);
      } else {
        await post(`/tenants/${id}/status`, {
          isActive: confirm === "activate",
        });
        show(
          confirm === "activate"
            ? t("pages.sa.tenantDetail.activatedToast")
            : t("pages.sa.tenantDetail.suspendedToast"),
          "success",
        );
        refresh();
        invalidateQueries("sa-tenants:");
      }
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.sa.tenantDetail.actionError"),
        "error",
      );
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const saveLicense = async () => {
    if (!licForm || !id) return;
    setBusy(true);
    try {
      await post("/licenses", {
        tenantId: id,
        planCode: licForm.planCode,
        startDate: licForm.startDate,
        months: Number(licForm.months) || 1,
      });
      show(t("pages.sa.tenantDetail.licenseCreated"), "success");
      setLicForm(null);
      refresh();
      invalidateQueries("licenses:");
    } catch (e) {
      show(
        e instanceof Error
          ? e.message
          : t("pages.sa.tenantDetail.licenseError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await patch(`/tenants/${id}`, {
        name: editForm.name || undefined,
        phone: editForm.phone || null,
        subdomain: editForm.subdomain || null,
      });
      show(t("pages.sa.tenantDetail.updatedToast"), "success");
      setEditOpen(false);
      refresh();
      invalidateQueries("sa-tenants:");
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.sa.tenantDetail.updateError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  if (q.loading)
    return (
      <div className="wrap">
        <Spinner label={t("pages.sa.tenantDetail.loading")} />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="wrap">
        <ErrorState error={q.error} onRetry={refresh} />
      </div>
    );

  const tenant = q.data;
  const activeLic = tenant.licenses[0] ?? null;

  return (
    <div className="wrap">
      <PageHeader
        title={
          <>
            🏢 {tenant.name}{" "}
            <Badge tone={tenant.is_active ? "ok" : "danger"}>
              {tenant.is_active ? t("common.active") : t("common.suspended")}
            </Badge>
          </>
        }
        sub={`${t("pages.sa.tenantDetail.createdPrefix", { date: formatDate(tenant.created_at) })}${tenant.subdomain ? ` · ${tenant.subdomain}` : ""}${tenant.phone ? ` · ${tenant.phone}` : ""}`}
        actions={
          <>
            <Link className="btn btn-outline btn-sm" to="/sa/tenants">
              {t("pages.sa.tenantDetail.backToTenants")}
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditForm({
                  name: tenant.name,
                  phone: tenant.phone ?? "",
                  subdomain: tenant.subdomain ?? "",
                });
                setEditOpen(true);
              }}
            >
              {t("pages.sa.tenantDetail.editButton")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirm("impersonate")}
            >
              {t("pages.sa.tenantDetail.impersonateButton")}
            </Button>
            {tenant.is_active ? (
              <Button
                variant="danger-soft"
                size="sm"
                onClick={() => setConfirm("suspend")}
              >
                {t("pages.sa.tenantDetail.suspendButton")}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirm("activate")}
              >
                {t("pages.sa.tenantDetail.activateButton")}
              </Button>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi
          label={t("pages.sa.tenants.colRevenue")}
          value={formatMoney(tenant.stats.revenue)}
        />
        <Kpi
          label={t("pages.cashSessions.kpiSalesCount")}
          value={formatQty(tenant.stats.sales_count)}
        />
        <Kpi
          label={t("pages.subscription.kpiUsers")}
          value={formatQty(tenant.users.length)}
        />
        <Kpi
          label={t("pages.sa.tenantDetail.kpiLicense")}
          value={activeLic ? `${activeLic.plan_code}` : "—"}
          sub={
            activeLic
              ? t("pages.sa.tenantDetail.licenseSub", {
                  date: formatDate(activeLic.end_date),
                  status: licStatusLabel(t, activeLic.status),
                })
              : t("pages.sa.tenantDetail.licenseNone")
          }
          tone={activeLic?.status === "EXPIRED" ? "danger" : undefined}
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "synthese", label: t("pages.sa.tenantDetail.tabUsers") },
          {
            id: "licences",
            label: t("pages.sa.tenantDetail.tabLicenses", {
              count: tenant.licenses.length,
            }),
          },
        ]}
      />

      {tab === "synthese" ? (
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          }}
        >
          <Card title={t("pages.subscription.kpiUsers")} pad={false}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("fields.name")}</th>
                    <th>{t("fields.email")}</th>
                    <th>{t("pages.sa.tenantDetail.colRole")}</th>
                    <th>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tenant.users.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.name}</td>
                      <td className="muted">{u.email}</td>
                      <td>
                        <Badge tone={u.role === "ADMIN" ? "info" : undefined}>
                          {u.role}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={u.is_active ? "ok" : "danger"}>
                          {u.is_active
                            ? t("common.active")
                            : t("common.deactivated")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 12 }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirm("reset")}
              >
                {t("pages.sa.tenantDetail.resetAdminButton")}
              </Button>
            </div>
          </Card>
          <Card title={t("pages.sa.tenants.colDepots")} pad={false}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("fields.name")}</th>
                    <th>{t("fields.address")}</th>
                    <th>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tenant.depots.map((d) => (
                    <tr key={d.id}>
                      <td style={{ fontWeight: 600 }}>{d.name}</td>
                      <td className="muted">{d.address ?? "—"}</td>
                      <td>
                        <Badge tone={d.is_active ? "ok" : "danger"}>
                          {d.is_active
                            ? t("common.active")
                            : t("common.inactive")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : (
        <Card
          title={t("pages.sa.tenantDetail.historyTitle")}
          actions={
            <Button
              size="sm"
              onClick={() =>
                setLicForm({
                  planCode:
                    plans.data?.find((p) => p.code !== "TRIAL")?.code ??
                    "BASIC",
                  startDate: new Date().toISOString().slice(0, 10),
                  months: "1",
                })
              }
            >
              {t("pages.sa.tenantDetail.newLicenseButton")}
            </Button>
          }
          pad={false}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.sa.common.plan")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("pages.subscription.rowStart")}</th>
                  <th>{t("pages.sa.tenantDetail.colEnd")}</th>
                  <th className="num">{t("pages.subscription.rowQuotas")}</th>
                  <th>{t("fields.notes")}</th>
                </tr>
              </thead>
              <tbody>
                {tenant.licenses.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.plan_name}</td>
                    <td>
                      <Badge
                        tone={
                          l.status === "ACTIVE"
                            ? "ok"
                            : l.status === "TRIAL"
                              ? "info"
                              : "danger"
                        }
                      >
                        {licStatusLabel(t, l.status)}
                      </Badge>
                    </td>
                    <td className="muted">{formatDate(l.start_date)}</td>
                    <td className="muted">{formatDate(l.end_date)}</td>
                    <td className="num muted">
                      {t("pages.sa.licenses.quotasShort", {
                        users: l.max_users,
                        depots: l.max_depots,
                      })}
                    </td>
                    <td className="muted">{l.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {confirm ? (
        <ConfirmModal
          title={t(`pages.sa.tenantDetail.confirmTitle.${confirm}`)}
          danger={confirm === "suspend"}
          confirmLabel={t(`pages.sa.tenantDetail.confirmLabel.${confirm}`)}
          message={
            confirm === "suspend" ? (
              <Trans
                i18nKey="pages.sa.tenantDetail.confirmBody.suspend"
                values={{ name: tenant.name }}
                components={{ b: <strong /> }}
              />
            ) : confirm === "activate" ? (
              <Trans
                i18nKey="pages.sa.tenantDetail.confirmBody.activate"
                values={{ name: tenant.name }}
                components={{ b: <strong /> }}
              />
            ) : confirm === "reset" ? (
              <Trans
                i18nKey="pages.sa.tenantDetail.confirmBody.reset"
                values={{ name: tenant.name }}
                components={{ b: <strong /> }}
              />
            ) : (
              <Trans
                i18nKey="pages.sa.tenantDetail.confirmBody.impersonate"
                values={{ name: tenant.name }}
                components={{ b: <strong /> }}
              />
            )
          }
          onConfirm={doConfirm}
          onClose={() => setConfirm(null)}
          loading={busy}
        />
      ) : null}

      {tempPw ? (
        <Modal
          title={t("pages.sa.tenantDetail.tempPwTitle")}
          onClose={() => setTempPw(null)}
          footer={
            <Button onClick={() => setTempPw(null)}>
              {t("pages.sa.tenantDetail.sharedShortButton")}
            </Button>
          }
        >
          <p>{t("pages.sa.tenantDetail.tempPwNote")}</p>
          <div
            className="card center"
            style={{
              background: "var(--surface-2)",
              fontSize: "1.3rem",
              fontWeight: 800,
            }}
          >
            <code>{tempPw}</code>
          </div>
        </Modal>
      ) : null}

      {licForm ? (
        <Modal
          title={t("pages.sa.tenantDetail.newLicenseTitle")}
          onClose={() => !busy && setLicForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setLicForm(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button loading={busy} onClick={saveLicense}>
                {t("common.create")}
              </Button>
            </>
          }
        >
          <Field label={t("pages.sa.common.plan")} required>
            <Select
              value={licForm.planCode}
              onChange={(e) =>
                setLicForm({ ...licForm, planCode: e.target.value })
              }
            >
              {(plans.data ?? []).map((p) => (
                <option key={p.code} value={p.code}>
                  {t("pages.sa.tenantDetail.planOption", {
                    name: p.name,
                    price: formatMoney(p.monthly_price),
                    users: p.max_users,
                    depots: p.max_depots,
                  })}
                </option>
              ))}
            </Select>
          </Field>
          <div className="row">
            <Field label={t("pages.sa.tenantDetail.startField")} required>
              <Input
                type="date"
                value={licForm.startDate}
                onChange={(e) =>
                  setLicForm({ ...licForm, startDate: e.target.value })
                }
              />
            </Field>
            <Field label={t("pages.sa.licenses.durationField")} required>
              <Input
                inputMode="numeric"
                value={licForm.months}
                onChange={(e) =>
                  setLicForm({ ...licForm, months: e.target.value })
                }
              />
            </Field>
          </div>
        </Modal>
      ) : null}

      {editOpen ? (
        <Modal
          title={t("pages.sa.tenantDetail.editTitle")}
          onClose={() => !busy && setEditOpen(false)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                loading={busy}
                onClick={saveEdit}
                disabled={editForm.name.trim().length < 2}
              >
                {t("common.save")}
              </Button>
            </>
          }
        >
          <Field label={t("fields.name")} required>
            <Input
              value={editForm.name}
              onChange={(e) =>
                setEditForm({ ...editForm, name: e.target.value })
              }
            />
          </Field>
          <div className="row">
            <Field label={t("pages.sa.tenantDetail.subdomainField")}>
              <Input
                value={editForm.subdomain}
                onChange={(e) =>
                  setEditForm({ ...editForm, subdomain: e.target.value })
                }
              />
            </Field>
            <Field label={t("fields.phone")}>
              <Input
                value={editForm.phone}
                onChange={(e) =>
                  setEditForm({ ...editForm, phone: e.target.value })
                }
              />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
