/** Console éditeur — configurations système : clés techniques (fournisseurs
 *  SMS/WhatsApp, intégrations) avec valeurs secrètes masquées en lecture. */
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
  Select,
  Spinner,
} from "../../components/ui";
import { put } from "../../lib/http";
import { formatDateTime } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";

interface ConfigRow {
  key: string;
  value: string;
  group: "API" | "SYSTEM" | "SECURITY";
  description: string | null;
  is_secret: boolean;
  masked: boolean;
  updated_at: string;
}

export default function SaConfigsPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const q = useQuery<ConfigRow[]>("configs:list", "/configs");
  const [form, setForm] = useState<{
    key: string;
    value: string;
    group: "API" | "SYSTEM" | "SECURITY";
    description: string;
    isSecret: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await put("/configs", {
        key: form.key,
        value: form.value,
        group: form.group,
        description: form.description || null,
        isSecret: form.isSecret,
      });
      show(t("pages.sa.configs.saved"), "success");
      invalidateQueries("configs:");
      setForm(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.settings.saveError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.sa.configs.title")}
        sub={t("pages.sa.configs.sub")}
        actions={
          <Button
            onClick={() =>
              setForm({
                key: "",
                value: "",
                group: "API",
                description: "",
                isSecret: true,
              })
            }
          >
            {t("pages.sa.configs.newButton")}
          </Button>
        }
      />
      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("configs:")}
        />
      ) : !q.data?.length ? (
        <EmptyState
          emoji="🔐"
          title={t("pages.sa.configs.empty")}
          action={
            <Button
              onClick={() =>
                setForm({
                  key: "",
                  value: "",
                  group: "API",
                  description: "",
                  isSecret: true,
                })
              }
            >
              {t("pages.sa.configs.createFirst")}
            </Button>
          }
        >
          <Trans
            i18nKey="pages.sa.configs.emptyBody"
            components={{ code: <code /> }}
          />
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("pages.sa.configs.colKey")}</th>
                  <th>{t("pages.sa.configs.colValue")}</th>
                  <th>{t("pages.sa.configs.colGroup")}</th>
                  <th>{t("pages.sa.configs.colSecret")}</th>
                  <th>{t("pages.sa.configs.colUpdated")}</th>
                  <th aria-label={t("common.edit")} />
                </tr>
              </thead>
              <tbody>
                {q.data.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <code style={{ fontWeight: 700 }}>{c.key}</code>
                      {c.description ? (
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {c.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="mono muted">
                      {c.masked ? c.value : <code>{c.value.slice(0, 40)}</code>}
                    </td>
                    <td>
                      <Badge tone="info">{c.group}</Badge>
                    </td>
                    <td>
                      {c.is_secret ? (
                        <Badge tone="warn">
                          {t("pages.sa.configs.secretMasked")}
                        </Badge>
                      ) : (
                        <Badge>{t("pages.sa.configs.secretReadable")}</Badge>
                      )}
                    </td>
                    <td className="muted">{formatDateTime(c.updated_at)}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setForm({
                            key: c.key,
                            value: "",
                            group: c.group,
                            description: c.description ?? "",
                            isSecret: c.is_secret,
                          })
                        }
                      >
                        ✏️
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 10 }}>
        {t("pages.sa.configs.reenterNote")}
      </p>

      {form ? (
        <Modal
          title={
            q.data?.some((c) => c.key === form.key)
              ? t("pages.sa.configs.modalEditTitle", { key: form.key })
              : t("pages.sa.configs.modalNewTitle")
          }
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
                onClick={save}
                disabled={form.key.trim().length < 2 || form.value.length === 0}
              >
                {t("common.save")}
              </Button>
            </>
          }
        >
          <Field
            label={t("pages.sa.configs.keyField")}
            required
            hint={t("pages.sa.configs.keyHint")}
          >
            <Input
              value={form.key}
              onChange={(e) =>
                setForm({ ...form, key: e.target.value.toLowerCase() })
              }
              disabled={q.data?.some((c) => c.key === form.key)}
            />
          </Field>
          <Field
            label={t("pages.sa.configs.valueField")}
            required
            hint={form.isSecret ? t("pages.sa.configs.valueHint") : undefined}
          >
            <Input
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              type={form.isSecret ? "password" : "text"}
              autoComplete="off"
            />
          </Field>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("pages.sa.configs.groupField")}>
              <Select
                value={form.group}
                onChange={(e) =>
                  setForm({
                    ...form,
                    group: e.target.value as "API" | "SYSTEM" | "SECURITY",
                  })
                }
              >
                <option value="API">{t("pages.sa.configs.groupApi")}</option>
                <option value="SYSTEM">
                  {t("pages.sa.configs.groupSystem")}
                </option>
                <option value="SECURITY">
                  {t("pages.sa.configs.groupSecurity")}
                </option>
              </Select>
            </Field>
            <Field label={t("fields.description")}>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </Field>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={form.isSecret}
              onChange={(e) => setForm({ ...form, isSecret: e.target.checked })}
            />{" "}
            {t("pages.sa.configs.secretCheckbox")}
          </label>
        </Modal>
      ) : null}
    </div>
  );
}
