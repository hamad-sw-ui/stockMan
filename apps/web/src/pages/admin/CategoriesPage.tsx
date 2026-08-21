/** Catégories : CRUD simple avec blocage de suppression si utilisée. */
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
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
  Spinner,
} from "../../components/ui";
import { del, patch, post } from "../../lib/http";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { Category } from "../../lib/types";

export default function CategoriesPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const q = useQuery<Category[]>("categories:list", "/categories");
  const [form, setForm] = useState<{
    id?: string;
    name: string;
    description: string;
    sortOrder: string;
  } | null>(null);
  const [toDelete, setToDelete] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const rows = (q.data ?? []).filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.description ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description || null,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (form.id) await patch(`/categories/${form.id}`, body);
      else await post("/categories", body);
      show(
        form.id ? t("pages.categories.updated") : t("pages.categories.created"),
        "success",
      );
      invalidateQueries("categories:");
      setForm(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.categories.saveError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await del(`/categories/${toDelete.id}`);
      show(t("pages.categories.deleted"), "success");
      invalidateQueries("categories:");
      setToDelete(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.categories.deleteError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 860 }}>
      <PageHeader
        title={t("pages.categories.title")}
        sub={t("pages.categories.sub")}
        actions={
          <Button
            onClick={() =>
              setForm({ name: "", description: "", sortOrder: "0" })
            }
          >
            {t("pages.categories.new")}
          </Button>
        }
      />
      {q.data?.length ? (
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("pages.categories.searchPlaceholder")}
        />
      ) : null}
      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("categories:")}
        />
      ) : !q.data?.length ? (
        <EmptyState
          emoji="🏷️"
          title={t("pages.categories.empty")}
          action={
            <Button
              onClick={() =>
                setForm({ name: "", description: "", sortOrder: "0" })
              }
            >
              {t("pages.categories.createFirst")}
            </Button>
          }
        >
          {t("pages.categories.emptyBody")}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.name")}</th>
                  <th>{t("fields.description")}</th>
                  <th className="num">{t("pages.categories.colOrder")}</th>
                  <th className="num">{t("pages.categories.colProducts")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700 }}>{c.name}</td>
                    <td className="muted">{c.description ?? "—"}</td>
                    <td className="num muted">{c.sort_order}</td>
                    <td className="num">{c.product_count ?? 0}</td>
                    <td>
                      <div
                        className="row"
                        style={{ gap: 4, flexWrap: "nowrap" }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setForm({
                              id: c.id,
                              name: c.name,
                              description: c.description ?? "",
                              sortOrder: String(c.sort_order),
                            })
                          }
                        >
                          ✏️
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setToDelete(c)}
                        >
                          🗑️
                        </Button>
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
          title={
            form.id
              ? t("pages.categories.edit")
              : t("pages.categories.newModal")
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
                disabled={!form.name.trim()}
              >
                {t("common.save")}
              </Button>
            </>
          }
        >
          <Field label={t("fields.name")} required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label={t("fields.description")}>
            <Input
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>
          <Field
            label={t("pages.categories.sortOrder")}
            hint={t("pages.categories.sortOrderHint")}
          >
            <Input
              inputMode="numeric"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            />
          </Field>
        </Modal>
      ) : null}

      {toDelete ? (
        <ConfirmModal
          title={t("pages.categories.deleteTitle")}
          message={
            <>
              {t("pages.categories.deleteAsk", { name: toDelete.name })}{" "}
              {(toDelete.product_count ?? 0) > 0 ? (
                <Trans
                  i18nKey="pages.categories.deleteBlocked"
                  values={{ count: toDelete.product_count }}
                  components={{ b: <strong /> }}
                />
              ) : (
                t("pages.categories.deleteOk")
              )}
            </>
          }
          confirmLabel={t("common.delete")}
          onConfirm={doDelete}
          onClose={() => setToDelete(null)}
          loading={busy}
        />
      ) : null}
    </div>
  );
}
