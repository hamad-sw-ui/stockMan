/** Unités de vente et conversions : unité de base (Pièce) et unités dérivées
 *  (Carton ×12, Kg…) utilisées à la caisse avec déduction automatique. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  Spinner,
} from "../../components/ui";
import { del, patch, post } from "../../lib/http";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useToast } from "../../store/toast";
import type { Unit } from "../../lib/types";

export default function UnitsPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const q = useQuery<Unit[]>("units:list", "/units");
  const [form, setForm] = useState<{
    id?: string;
    name: string;
    symbol: string;
    baseValue: string;
    isBase: boolean;
  } | null>(null);
  const [toDelete, setToDelete] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const rows = (q.data ?? []).filter(
    (u) =>
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.symbol.toLowerCase().includes(search.toLowerCase()),
  );

  const save = async () => {
    if (!form) return;
    const baseValue = Number(form.baseValue.replace(",", "."));
    if (!(baseValue > 0)) {
      show(t("pages.units.factorError"), "error");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        symbol: form.symbol.trim(),
        baseValue,
        isBase: form.isBase,
      };
      if (form.id) await patch(`/units/${form.id}`, body);
      else await post("/units", body);
      show(
        form.id ? t("pages.units.updated") : t("pages.units.created"),
        "success",
      );
      invalidateQueries("units:");
      setForm(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.units.saveError"),
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
      await del(`/units/${toDelete.id}`);
      show(t("pages.units.deleted"), "success");
      invalidateQueries("units:");
      setToDelete(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.units.deleteError"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 860 }}>
      <PageHeader
        title={t("pages.units.title")}
        sub={t("pages.units.sub")}
        actions={
          <Button
            onClick={() =>
              setForm({ name: "", symbol: "", baseValue: "1", isBase: false })
            }
          >
            {t("pages.units.new")}
          </Button>
        }
      />
      {q.data?.length ? (
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("pages.units.searchPlaceholder")}
        />
      ) : null}
      {q.loading ? (
        <Spinner label={t("common.loading")} />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("units:")}
        />
      ) : !q.data?.length ? (
        <EmptyState
          emoji="📏"
          title={t("pages.units.empty")}
          action={
            <Button
              onClick={() =>
                setForm({
                  name: "Pièce",
                  symbol: "Pce",
                  baseValue: "1",
                  isBase: true,
                })
              }
            >
              {t("pages.units.createPiece")}
            </Button>
          }
        >
          {t("pages.units.emptyBody")}
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("fields.name")}</th>
                  <th>{t("pages.units.colSymbol")}</th>
                  <th className="num">{t("pages.units.colFactor")}</th>
                  <th>{t("pages.units.colRole")}</th>
                  <th aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 700 }}>{u.name}</td>
                    <td className="muted">{u.symbol}</td>
                    <td className="num">×{u.base_value}</td>
                    <td>
                      {u.is_base ? (
                        <Badge tone="info">{t("pages.units.badgeBase")}</Badge>
                      ) : (
                        <Badge>{t("pages.units.badgeDerived")}</Badge>
                      )}
                    </td>
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
                              id: u.id,
                              name: u.name,
                              symbol: u.symbol,
                              baseValue: String(u.base_value),
                              isBase: u.is_base,
                            })
                          }
                        >
                          ✏️
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setToDelete(u)}
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
      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 10 }}>
        {t("pages.units.lockNote")}
      </p>

      {form ? (
        <Modal
          title={form.id ? t("pages.units.edit") : t("pages.units.newModal")}
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
                disabled={!form.name.trim() || !form.symbol.trim()}
              >
                {t("common.save")}
              </Button>
            </>
          }
        >
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("fields.name")} required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("pages.units.namePlaceholder")}
              />
            </Field>
            <Field label={t("pages.units.colSymbol")} required>
              <Input
                value={form.symbol}
                onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                placeholder={t("pages.units.symbolPlaceholder")}
              />
            </Field>
            <Field
              label={t("pages.units.factorLabel")}
              hint={t("pages.units.factorHint")}
            >
              <Input
                inputMode="decimal"
                value={form.baseValue}
                onChange={(e) =>
                  setForm({ ...form, baseValue: e.target.value })
                }
              />
            </Field>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={form.isBase}
              onChange={(e) => setForm({ ...form, isBase: e.target.checked })}
            />{" "}
            {t("pages.units.baseCheckbox")}
          </label>
        </Modal>
      ) : null}

      {toDelete ? (
        <ConfirmModal
          title={t("pages.units.deleteTitle")}
          message={<>{t("pages.units.deleteAsk", { name: toDelete.name })}</>}
          confirmLabel={t("common.delete")}
          onConfirm={doDelete}
          onClose={() => setToDelete(null)}
          loading={busy}
        />
      ) : null}
    </div>
  );
}
