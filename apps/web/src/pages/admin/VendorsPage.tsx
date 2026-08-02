/** Gestion de l'équipe : vendeurs et administrateurs du tenant.
 *  Création (mot de passe généré si absent), PIN caisse, activation, réinitialisations. */
import { useState } from "react";
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
      show("Le PIN comporte 4 à 6 chiffres.", "error");
      return;
    }
    try {
      const res = await create.run(form);
      setForm(null);
      invalidateQueries("users:");
      if (res.generatedPassword) {
        setGenerated({
          title: `Compte créé pour ${form.name}`,
          password: res.generatedPassword,
        });
      }
      show("Compte créé.", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "Création impossible", "error");
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
      show("Compte mis à jour.", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "Mise à jour impossible", "error");
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
          title: `Mot de passe réinitialisé pour ${user.name}`,
          password: res.temporaryPassword,
        });
      }
      invalidateQueries("users:");
      show(
        kind === "deactivate"
          ? "Compte désactivé."
          : kind === "activate"
            ? "Compte réactivé."
            : "Mot de passe réinitialisé.",
        "success",
      );
    } catch (e) {
      show(e instanceof Error ? e.message : "Action impossible", "error");
    } finally {
      setConfirm(null);
    }
  };

  const submitPinReset = async () => {
    if (!pinReset) return;
    if (!/^\d{4,6}$/.test(pinValue)) {
      show("Le PIN comporte 4 à 6 chiffres.", "error");
      return;
    }
    try {
      await post(`/users/${pinReset.id}/reset-pin`, { pin: pinValue });
      setPinReset(null);
      setPinValue("");
      invalidateQueries("users:");
      show("PIN mis à jour.", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "Action impossible", "error");
    }
  };

  const depotSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Aucun dépôt —</option>
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
        title="Équipe"
        sub="Comptes vendeurs et administrateurs de votre entreprise"
        actions={
          <Button onClick={() => setForm({ ...emptyForm })}>
            ➕ Nouveau compte
          </Button>
        }
      />

      {users.loading ? (
        <Spinner label="Chargement de l’équipe…" />
      ) : users.error ? (
        <ErrorState
          error={users.error}
          onRetry={() => invalidateQueries("users:")}
        />
      ) : !users.data?.length ? (
        <EmptyState emoji="👥" title="Aucun utilisateur" />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Email</th>
                  <th>Rôle</th>
                  <th>Dépôt</th>
                  <th>Connexion caisse</th>
                  <th>Statut</th>
                  <th>Depuis</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 700 }}>{u.name}</td>
                    <td className="muted">{u.email}</td>
                    <td>
                      <Badge tone={u.role === "ADMIN" ? "info" : undefined}>
                        {u.role === "ADMIN" ? "Admin" : "Vendeur"}
                      </Badge>
                    </td>
                    <td className="muted">{u.depot_name ?? "—"}</td>
                    <td className="muted">
                      {u.has_pin ? "🔑 PIN actif" : "—"}
                    </td>
                    <td>
                      <Badge tone={u.is_active ? "ok" : "danger"}>
                        {u.is_active ? "Actif" : "Désactivé"}
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
                          title="Modifier"
                          onClick={() => setEditing({ ...u })}
                        >
                          ✏️
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Réinitialiser le mot de passe"
                          onClick={() => setConfirm({ kind: "reset", user: u })}
                        >
                          🔐
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Définir le PIN caisse"
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
                            title="Désactiver"
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
                            title="Réactiver"
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
          title="Nouveau compte"
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
                onClick={submitCreate}
                disabled={
                  !form.name ||
                  !form.email ||
                  (form.role === "VENDEUR" && !form.depotId)
                }
              >
                Créer le compte
              </Button>
            </>
          }
        >
          <Field label="Nom complet" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Email de connexion" required>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <div className="row">
            <Field label="Rôle" required>
              <Select
                value={form.role}
                onChange={(e) =>
                  setForm({
                    ...form,
                    role: e.target.value as "ADMIN" | "VENDEUR",
                  })
                }
              >
                <option value="VENDEUR">Vendeur</option>
                <option value="ADMIN">Administrateur</option>
              </Select>
            </Field>
            <Field
              label="Dépôt d’affectation"
              required={form.role === "VENDEUR"}
            >
              {depotSelect(form.depotId, (v) =>
                setForm({ ...form, depotId: v }),
              )}
            </Field>
          </div>
          <div className="row">
            <Field
              label="Mot de passe"
              hint="Vide = généré automatiquement et affiché une fois. 8 caractères minimum, une lettre et un chiffre sinon."
            >
              <Input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="new-password"
              />
            </Field>
            <Field
              label="PIN caisse (4–6 chiffres)"
              hint="Connexion rapide en kiosque."
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
          title={`Modifier — ${editing.name}`}
          onClose={() => !update.loading && setEditing(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setEditing(null)}
                disabled={update.loading}
              >
                Annuler
              </Button>
              <Button loading={update.loading} onClick={submitEdit}>
                Enregistrer
              </Button>
            </>
          }
        >
          <Field label="Nom complet" required>
            <Input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={editing.email}
              onChange={(e) =>
                setEditing({ ...editing, email: e.target.value })
              }
            />
          </Field>
          <div className="row">
            <Field label="Rôle">
              <Select
                value={editing.role}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    role: e.target.value as "ADMIN" | "VENDEUR",
                  })
                }
              >
                <option value="VENDEUR">Vendeur</option>
                <option value="ADMIN">Administrateur</option>
              </Select>
            </Field>
            <Field label="Dépôt">
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
              ? "Désactiver le compte"
              : confirm.kind === "activate"
                ? "Réactiver le compte"
                : "Réinitialiser le mot de passe"
          }
          danger={confirm.kind === "deactivate"}
          confirmLabel={
            confirm.kind === "deactivate"
              ? "Désactiver"
              : confirm.kind === "activate"
                ? "Réactiver"
                : "Réinitialiser"
          }
          message={
            confirm.kind === "reset" ? (
              <>
                Un mot de passe temporaire sera généré pour{" "}
                <strong>{confirm.user.name}</strong> et ses sessions actives
                seront fermées.
              </>
            ) : confirm.kind === "deactivate" ? (
              <>
                Le compte de <strong>{confirm.user.name}</strong> sera désactivé
                et ses sessions fermées. Son historique est conservé.
              </>
            ) : (
              <>
                Le compte de <strong>{confirm.user.name}</strong> redeviendra
                actif.
              </>
            )
          }
          onConfirm={doConfirm}
          onClose={() => setConfirm(null)}
        />
      ) : null}

      {pinReset ? (
        <Modal
          title={`PIN caisse — ${pinReset.name}`}
          onClose={() => setPinReset(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setPinReset(null)}>
                Annuler
              </Button>
              <Button onClick={submitPinReset} disabled={pinValue.length < 4}>
                Enregistrer le PIN
              </Button>
            </>
          }
        >
          <Field
            label="Nouveau PIN (4 à 6 chiffres)"
            required
            hint="Le PIN est unique dans l’entreprise et chiffré : il n’est jamais lisible ensuite."
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
              J’ai noté le mot de passe
            </Button>
          }
        >
          <p className="muted">
            Communiquez ce mot de passe temporaire à l’utilisateur (il ne sera
            plus affiché) :
          </p>
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
            💡 L’utilisateur pourra le changer depuis « Mon compte » après
            connexion.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
