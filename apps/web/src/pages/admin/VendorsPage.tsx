/** Gestion de l'équipe : vendeurs et administrateurs du tenant.
 *  Création (mot de passe généré si absent), PIN caisse, activation, réinitialisations. */
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Spinner,
} from "../../components/ui";
import { patch, post } from "../../lib/http";
import { formatDate } from "../../lib/format";
import { invalidateQueries, useMutation, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { Depot, VendorRow } from "../../lib/types";

interface UserForm {
  name: string;
  email: string;
  role: "ADMIN" | "VENDEUR";
  password: string;
  pin: string;
  depotId: string;
}

const emptyForm: UserForm = {
  name: "",
  email: "",
  role: "VENDEUR",
  password: "",
  pin: "",
  depotId: "",
};

export default function VendorsPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const users = useQuery<VendorRow[]>(
    "users:list",
    "/users?includeInactive=true",
  );
  const depots = useQuery<Depot[]>("depots:list", "/depots");
  const [form, setForm] = useState<UserForm | null>(null);
  const [editing, setEditing] = useState<VendorRow | null>(null);
  const [generated, setGenerated] = useState<{
    title: string;
    password: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: "deactivate" | "activate" | "reset";
    user: VendorRow;
  } | null>(null);
  const [pinReset, setPinReset] = useState<VendorRow | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [search, setSearch] = useState("");

  const rows = (users.data ?? []).filter(
    (u) =>
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.depot_name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const create = useMutation((f: UserForm) =>
    post<{ generatedPassword?: string }>("/users", {
      name: f.name,
      email: f.email,
      role: f.role,
      password: f.password || undefined,
      pin: f.pin || undefined,
      depotId: f.depotId || undefined,
    }),
  );
  const update = useMutation(
    (v: {
      id: string;
      name: string;
      email: string;
      role: string;
      depotId: string | null;
    }) =>
      patch(`/users/${v.id}`, {
        name: v.name,
        email: v.email,
        role: v.role,
        depotId: v.depotId,
      }),
    { invalidate: ["users:"] },
  );

  const busy = create.loading || update.loading;

  const submitCreate = async () => {
    if (!form) return;
    if (form.pin && !/^\d{4,6}$/.test(form.pin)) {
      show(t("pages.vendors.pinInvalid"), "error");
      return;
    }
    try {
      const res = await create.run(form);
      setForm(null);
      invalidateQueries("users:");
      if (res.generatedPassword) {
        setGenerated({
          title: t("pages.vendors.generatedCreatedTitle", { name: form.name }),
          password: res.generatedPassword,
        });
      }
      show(t("pages.vendors.createdToast"), "success");
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.vendors.createError"),
        "error",
      );
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      await update.run({
        id: editing.id,
        name: editing.name,
        email: editing.email,
        role: editing.role,
        depotId: editing.depot_id,
      });
      setEditing(null);
      show(t("pages.vendors.updatedToast"), "success");
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.vendors.updateError"),
        "error",
      );
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    const { kind, user } = confirm;
    try {
      if (kind === "deactivate") await post(`/users/${user.id}/deactivate`);
      else if (kind === "activate") await post(`/users/${user.id}/activate`);
      else {
        const res = await post<{ temporaryPassword: string }>(
          `/users/${user.id}/reset-password`,
        );
        setGenerated({
          title: t("pages.vendors.generatedResetTitle", { name: user.name }),
          password: res.temporaryPassword,
        });
      }
      invalidateQueries("users:");
      show(
        kind === "deactivate"
          ? t("pages.vendors.deactivatedToast")
          : kind === "activate"
            ? t("pages.vendors.reactivatedToast")
            : t("pages.vendors.resetToast"),
        "success",
      );
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.vendors.actionError"),
        "error",
      );
    } finally {
      setConfirm(null);
    }
  };

  const submitPinReset = async () => {
    if (!pinReset) return;
    if (!/^\d{4,6}$/.test(pinValue)) {
      show(t("pages.vendors.pinInvalid"), "error");
      return;
    }
    try {
      await post(`/users/${pinReset.id}/reset-pin`, { pin: pinValue });
      setPinReset(null);
      setPinValue("");
      invalidateQueries("users:");
      show(t("pages.vendors.pinUpdatedToast"), "success");
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.vendors.actionError"),
        "error",
      );
    }
  };

  const depotSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("pages.vendors.noDepot")}</option>
      {(depots.data ?? [])
        .filter((d) => d.is_active)
        .map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
    </Select>
  );

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.vendors.title")}
        sub={t("pages.vendors.sub")}
        actions={
          <Button onClick={() => setForm({ ...emptyForm })}>
            {t("pages.vendors.newAccount")}
          </Button>
        }
      />

      {users.data?.length ? (
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("pages.vendors.searchPlaceholder")}
        />
      ) : null}
      {users.loading ? (
        <Spinner label={t("pages.vendors.loading")} />
      ) : users.error ? (
        <ErrorState
          error={users.error}
          onRetry={() => invalidateQueries("users:")}
        />
      ) : !users.data?.length ? (
        <EmptyState emoji="👥" title={t("pages.vendors.empty")} />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.name")}</th>
                  <th>{t("fields.email")}</th>
                  <th>{t("pages.vendors.colRole")}</th>
                  <th>{t("fields.depot")}</th>
                  <th>{t("pages.vendors.colPosPin")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("pages.vendors.colSince")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 700 }}>{u.name}</td>
                    <td className="muted">{u.email}</td>
                    <td>
                      <Badge tone={u.role === "ADMIN" ? "info" : undefined}>
                        {t(
                          u.role === "ADMIN"
                            ? "pages.vendors.roleAdmin"
                            : "pages.vendors.roleVendor",
                        )}
                      </Badge>
                    </td>
                    <td className="muted">{u.depot_name ?? "—"}</td>
                    <td className="muted">
                      {u.has_pin ? t("pages.vendors.pinActive") : "—"}
                    </td>
                    <td>
                      <Badge tone={u.is_active ? "ok" : "danger"}>
                        {u.is_active
                          ? t("common.active")
                          : t("pages.vendors.statusDeactivated")}
                      </Badge>
                    </td>
                    <td className="muted">{formatDate(u.created_at)}</td>
                    <td>
                      <div
                        className="row"
                        style={{ gap: 4, flexWrap: "nowrap" }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t("common.edit")}
                          onClick={() => setEditing({ ...u })}
                        >
                          ✏️
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t("pages.vendors.resetPwTitle")}
                          onClick={() => setConfirm({ kind: "reset", user: u })}
                        >
                          🔐
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t("pages.vendors.setPinTitle")}
                          onClick={() => {
                            setPinReset(u);
                            setPinValue("");
                          }}
                        >
                          🔢
                        </Button>
                        {u.is_active ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t("pages.vendors.deactivateTitle")}
                            onClick={() =>
                              setConfirm({ kind: "deactivate", user: u })
                            }
                          >
                            ⛔
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t("pages.vendors.reactivateTitle")}
                            onClick={() =>
                              setConfirm({ kind: "activate", user: u })
                            }
                          >
                            ✅
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {form ? (
        <Modal
          title={t("pages.vendors.createTitle")}
          onClose={() => !busy && setForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setForm(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                loading={busy}
                onClick={submitCreate}
                disabled={
                  !form.name ||
                  !form.email ||
                  (form.role === "VENDEUR" && !form.depotId)
                }
              >
                {t("pages.vendors.createButton")}
              </Button>
            </>
          }
        >
          <Field label={t("pages.vendors.fullNameField")} required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label={t("pages.vendors.emailLoginField")} required>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <div className="row">
            <Field label={t("pages.vendors.roleField")} required>
              <Select
                value={form.role}
                onChange={(e) =>
                  setForm({
                    ...form,
                    role: e.target.value as "ADMIN" | "VENDEUR",
                  })
                }
              >
                <option value="VENDEUR">{t("pages.vendors.roleVendor")}</option>
                <option value="ADMIN">
                  {t("pages.vendors.roleAdminOption")}
                </option>
              </Select>
            </Field>
            <Field
              label={t("pages.vendors.depotAssignField")}
              required={form.role === "VENDEUR"}
            >
              {depotSelect(form.depotId, (v) =>
                setForm({ ...form, depotId: v }),
              )}
            </Field>
          </div>
          <div className="row">
            <Field
              label={t("fields.password")}
              hint={t("pages.vendors.passwordHint")}
            >
              <Input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="new-password"
              />
            </Field>
            <Field
              label={t("pages.vendors.pinField")}
              hint={t("pages.vendors.pinHint")}
            >
              <Input
                inputMode="numeric"
                value={form.pin}
                onChange={(e) =>
                  setForm({
                    ...form,
                    pin: e.target.value.replace(/\D/g, "").slice(0, 6),
                  })
                }
              />
            </Field>
          </div>
        </Modal>
      ) : null}

      {editing ? (
        <Modal
          title={t("pages.vendors.editTitle", { name: editing.name })}
          onClose={() => !update.loading && setEditing(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setEditing(null)}
                disabled={update.loading}
              >
                {t("common.cancel")}
              </Button>
              <Button loading={update.loading} onClick={submitEdit}>
                {t("common.save")}
              </Button>
            </>
          }
        >
          <Field label={t("pages.vendors.fullNameField")} required>
            <Input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </Field>
          <Field label={t("fields.email")}>
            <Input
              type="email"
              value={editing.email}
              onChange={(e) =>
                setEditing({ ...editing, email: e.target.value })
              }
            />
          </Field>
          <div className="row">
            <Field label={t("pages.vendors.roleField")}>
              <Select
                value={editing.role}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    role: e.target.value as "ADMIN" | "VENDEUR",
                  })
                }
              >
                <option value="VENDEUR">{t("pages.vendors.roleVendor")}</option>
                <option value="ADMIN">
                  {t("pages.vendors.roleAdminOption")}
                </option>
              </Select>
            </Field>
            <Field label={t("fields.depot")}>
              {depotSelect(editing.depot_id ?? "", (v) =>
                setEditing({ ...editing, depot_id: v || null }),
              )}
            </Field>
          </div>
        </Modal>
      ) : null}

      {confirm ? (
        <ConfirmModal
          title={
            confirm.kind === "deactivate"
              ? t("pages.vendors.deactivateModalTitle")
              : confirm.kind === "activate"
                ? t("pages.vendors.reactivateModalTitle")
                : t("pages.vendors.resetModalTitle")
          }
          danger={confirm.kind === "deactivate"}
          confirmLabel={
            confirm.kind === "deactivate"
              ? t("pages.vendors.confirmDeactivate")
              : confirm.kind === "activate"
                ? t("pages.vendors.confirmReactivate")
                : t("pages.vendors.confirmReset")
          }
          message={
            confirm.kind === "reset" ? (
              <Trans
                i18nKey="pages.vendors.resetBody"
                values={{ name: confirm.user.name }}
                components={{ b: <strong /> }}
              />
            ) : confirm.kind === "deactivate" ? (
              <Trans
                i18nKey="pages.vendors.deactivateBody"
                values={{ name: confirm.user.name }}
                components={{ b: <strong /> }}
              />
            ) : (
              <Trans
                i18nKey="pages.vendors.reactivateBody"
                values={{ name: confirm.user.name }}
                components={{ b: <strong /> }}
              />
            )
          }
          onConfirm={doConfirm}
          onClose={() => setConfirm(null)}
        />
      ) : null}

      {pinReset ? (
        <Modal
          title={t("pages.vendors.pinModalTitle", { name: pinReset.name })}
          onClose={() => setPinReset(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setPinReset(null)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={submitPinReset} disabled={pinValue.length < 4}>
                {t("pages.vendors.pinSave")}
              </Button>
            </>
          }
        >
          <Field
            label={t("pages.vendors.pinNewField")}
            required
            hint={t("pages.vendors.pinNewHint")}
          >
            <Input
              inputMode="numeric"
              value={pinValue}
              onChange={(e) =>
                setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              autoFocus
            />
          </Field>
        </Modal>
      ) : null}

      {generated ? (
        <Modal
          title={generated.title}
          onClose={() => setGenerated(null)}
          footer={
            <Button onClick={() => setGenerated(null)}>
              {t("pages.vendors.generatedClose")}
            </Button>
          }
        >
          <p className="muted">{t("pages.vendors.generatedBody")}</p>
          <div
            className="card"
            style={{
              background: "var(--surface-2)",
              textAlign: "center",
              fontSize: "1.3rem",
              fontWeight: 800,
              letterSpacing: "0.08em",
            }}
          >
            <code>{generated.password}</code>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("pages.vendors.generatedHint")}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
