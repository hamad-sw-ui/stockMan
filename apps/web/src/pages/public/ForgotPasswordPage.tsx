/** Mot de passe oublié : envoi d'un lien de réinitialisation (anti-énumération). */
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, post } from "../../lib/http";
import { Button, Card, Field, Input } from "../../components/ui";
import { usePageTitle } from "../../components/Shell";

export default function ForgotPasswordPage() {
  usePageTitle("Mot de passe oublié");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await post<{ message: string; devToken?: string }>(
        "/auth/forgot-password",
        { email: email.trim() },
      );
      setDone(r.message);
      setDevToken(r.devToken ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Service indisponible.");
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
            <small>Réinitialisation du mot de passe</small>
          </div>
        </div>
        <Card>
          {done ? (
            <div>
              <p role="status">{done}</p>
              {devToken ? (
                <p style={{ fontSize: "0.88rem" }}>
                  (Environnement de développement){" "}
                  <Link
                    to={`/reinitialiser-mot-de-passe?token=${encodeURIComponent(devToken)}`}
                  >
                    Ouvrir le lien de réinitialisation
                  </Link>
                </p>
              ) : null}
              <p>
                <Link to="/login">← Retour à la connexion</Link>
              </p>
            </div>
          ) : (
            <form onSubmit={(e) => void submit(e)}>
              <Field label="Email du compte" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@entreprise.cm"
                  autoFocus
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
                Envoyer le lien
              </Button>
              <p style={{ textAlign: "center", marginTop: 12 }}>
                <Link to="/login">← Retour à la connexion</Link>
              </p>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
