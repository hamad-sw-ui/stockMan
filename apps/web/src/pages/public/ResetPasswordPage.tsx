/** Réinitialisation du mot de passe via jeton (lien email). */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, post } from "../../lib/http";
import { Button, Card, Field, Input } from "../../components/ui";
import { usePageTitle } from "../../components/Shell";

export default function ResetPasswordPage() {
  usePageTitle("Nouveau mot de passe");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) {
      setError("Mot de passe : 8+ caractères avec lettre et chiffre.");
      return;
    }
    if (pw !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await post("/auth/reset-password", { token, newPassword: pw });
      navigate("/login?reinitialise=1", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Lien invalide ou expiré.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="logo-dot">📦</span>
          <div>
            <h1>StockMan</h1>
            <small>Choisissez un nouveau mot de passe</small>
          </div>
        </div>
        <Card>
          {!token ? (
            <p role="alert">
              Lien incomplet : le jeton est manquant.{" "}
              <Link to="/mot-de-passe-oublie">Recommencer</Link>.
            </p>
          ) : (
            <form onSubmit={(e) => void submit(e)}>
              <Field label="Nouveau mot de passe" required>
                <Input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
              </Field>
              <Field label="Confirmation" required>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              {error ? (
                <p
                  role="alert"
                  style={{ color: "var(--danger)", fontSize: "0.9rem" }}
                >
                  {error}
                </p>
              ) : null}
              <Button block type="submit" loading={loading}>
                Réinitialiser
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
