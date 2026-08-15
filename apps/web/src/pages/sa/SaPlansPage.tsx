/** Console éditeur — plans tarifaires : quotas utilisateurs/dépôts et prix
 *  mensuel, éditables (les licences existantes gardent leurs quotas figés). */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "../../components/ui";
import { patch, post } from "../../lib/http";
import { formatMoney } from "../../lib/format";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { Plan } from "../../lib/types";

interface PlanForm {
  code: string;
  name: string;
  maxUsers: string;
  maxDepots: string;
  monthlyPrice: string;
}

export default function SaPlansPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const q = useQuery<Plan[]>("plans:list", "/licenses/plans");
  const [form, setForm] = useState<({ editing: boolean } & PlanForm) | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      if (form.editing) {
        await patch(`/licenses/plans/${form.code}`, {
          name: form.name,
          maxUsers: Number(form.maxUsers) || 1,
          maxDepots: Number(form.maxDepots) || 1,
          monthlyPrice: Number(form.monthlyPrice.replace(",", ".")) || 0,
        });
      } else {
        await post("/licenses/plans", {
          code: form.code,
          name: form.name,
          maxUsers: Number(form.maxUsers) || 1,
          maxDepots: Number(form.maxDepots) || 1,
          monthlyPrice: Number(form.monthlyPrice.replace(",", ".")) || 0,
        });
      }
      show(t("pages.sa.plans.saved"), "success");
      invalidateQueries("plans:");
      setForm(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.sa.plans.saveError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title={t("pages.sa.plans.title")}
        sub={t("pages.sa.plans.sub")}
        actions={
          <Button
            onClick={() =>
              setForm({
                editing: false,
                code: "",
                name: "",
                maxUsers: "2",
                maxDepots: "1",
                monthlyPrice: "0",
              })
            }
          >
            {t("pages.sa.plans.newButton")}
          </Button>
        }
      />
      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("plans:")}
        />
      ) : !q.data?.length ? (
        <EmptyState emoji="🧩" title={t("pages.sa.plans.empty")} />
      ) : (
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          }}
        >
          {q.data.map((p) => (
            <Card key={p.code}>
              <div className="row-between">
                <h3 style={{ margin: 0 }}>{p.name}</h3>
                <code className="badge">{p.code}</code>
              </div>
              <div
                className="kpi-value"
                style={{ fontSize: "1.5rem", margin: "8px 0" }}
              >
                {formatMoney(p.monthly_price)}
                <span
                  className="muted"
                  style={{ fontSize: "0.85rem", fontWeight: 400 }}
                >
                  {" "}
                  {t("pages.sa.plans.perMonth")}
                </span>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {t("pages.subscription.quotasValue", {
                  users: p.max_users,
                  depots: p.max_depots,
                })}
              </p>
              <Button
                variant="outline"
                size="sm"
                style={{ marginTop: 10 }}
                onClick={() =>
                  setForm({
                    editing: true,
                    code: p.code,
                    name: p.name,
                    maxUsers: String(p.max_users),
                    maxDepots: String(p.max_depots),
                    monthlyPrice: String(p.monthly_price),
                  })
                }
              >
                {t("pages.sa.plans.editButton")}
              </Button>
            </Card>
          ))}
        </div>
      )}

      {form ? (
        <Modal
          title={
            form.editing
              ? t("pages.sa.plans.modalEditTitle", { name: form.name })
              : t("pages.sa.plans.modalNewTitle")
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
                disabled={
                  form.name.trim().length < 2 ||
                  (!form.editing && !/^[A-Z0-9_]{2,30}$/.test(form.code))
                }
              >
                {t("common.save")}
              </Button>
            </>
          }
        >
          {!form.editing ? (
            <Field
              label={t("pages.sa.plans.codeField")}
              required
              hint={t("pages.sa.plans.codeHint")}
            >
              <Input
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                placeholder="BASIC"
              />
            </Field>
          ) : null}
          <Field label={t("pages.sa.plans.nameField")} required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("pages.sa.plans.namePlaceholder")}
            />
          </Field>
          <div className="row">
            <Field label={t("pages.sa.plans.usersField")} required>
              <Input
                inputMode="numeric"
                value={form.maxUsers}
                onChange={(e) => setForm({ ...form, maxUsers: e.target.value })}
              />
            </Field>
            <Field label={t("pages.sa.plans.depotsField")} required>
              <Input
                inputMode="numeric"
                value={form.maxDepots}
                onChange={(e) =>
                  setForm({ ...form, maxDepots: e.target.value })
                }
              />
            </Field>
            <Field label={t("pages.sa.plans.priceField")} required>
              <Input
                inputMode="decimal"
                value={form.monthlyPrice}
                onChange={(e) =>
                  setForm({ ...form, monthlyPrice: e.target.value })
                }
              />
            </Field>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("pages.sa.plans.immutableNote")}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
