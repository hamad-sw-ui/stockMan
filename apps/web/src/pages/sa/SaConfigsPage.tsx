/** Console éditeur — configurations système : clés techniques (fournisseurs
 *  SMS/WhatsApp, intégrations) avec valeurs secrètes masquées en lecture. */
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
      show("Configuration enregistrée.", "success");
      invalidateQueries("configs:");
      setForm(null);
    } catch (e) {
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <PageHeader
        title="Configurations système"
        sub="Clés techniques de la plateforme — les secrets ne sont jamais renvoyés en clair"
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
            ➕ Nouvelle clé
          </Button>
        }
      />
      {q.loading ? (
        <Spinner label="Chargement…" />
      ) : q.error ? (
        <ErrorState
          error={q.error}
          onRetry={() => invalidateQueries("configs:")}
        />
      ) : !q.data?.length ? (
        <EmptyState
          emoji="🔐"
          title="Aucune configuration"
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
              Créer la première clé
            </Button>
          }
        >
          Ex. <code>africas_talking.api_key</code>, <code>whatsapp.token</code>…
        </EmptyState>
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Clé</th>
                  <th>Valeur</th>
                  <th>Groupe</th>
                  <th>Secret</th>
                  <th>Modifiée le</th>
                  <th aria-label="Modifier" />
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
                        <Badge tone="warn">🔒 masqué</Badge>
                      ) : (
                        <Badge>lisible</Badge>
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
        ℹ️ La modification d’une clé secrète demande de ressaisir la valeur
        complète : l’ancienne n’est pas lisible.
      </p>

      {form ? (
        <Modal
          title={
            q.data?.some((c) => c.key === form.key)
              ? `Modifier « ${form.key} »`
              : "Nouvelle clé"
          }
          onClose={() => !busy && setForm(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setForm(null)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button
                loading={busy}
                onClick={save}
                disabled={form.key.trim().length < 2 || form.value.length === 0}
              >
                Enregistrer
              </Button>
            </>
          }
        >
          <Field
            label="Clé"
            required
            hint="Minuscules, chiffres, _ et . (ex. africas_talking.api_key)"
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
            label="Valeur"
            required
            hint={
              form.isSecret
                ? "Ressaisissez la valeur complète : elle sera masquée en lecture."
                : undefined
            }
          >
            <Input
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              type={form.isSecret ? "password" : "text"}
              autoComplete="off"
            />
          </Field>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Groupe">
              <Select
                value={form.group}
                onChange={(e) =>
                  setForm({
                    ...form,
                    group: e.target.value as "API" | "SYSTEM" | "SECURITY",
                  })
                }
              >
                <option value="API">API (intégrations)</option>
                <option value="SYSTEM">Système</option>
                <option value="SECURITY">Sécurité</option>
              </Select>
            </Field>
            <Field label="Description">
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
            Valeur secrète (masquée en lecture)
          </label>
        </Modal>
      ) : null}
    </div>
  );
}
