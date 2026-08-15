/** Réinitialisation du mot de passe via jeton (lien email).
 *  I1 : textes via i18n (clés « auth.reset.* ») + sélecteur de langue. */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError, post } from "../../lib/http";
import { Button, Card, Field, Input } from "../../components/ui";
import { LanguageSwitcher, usePageTitle } from "../../components/Shell";

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  usePageTitle(t("auth.reset.pageTitle"));
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
      setError(t("auth.reset.pwRule"));
      return;
    }
    if (pw !== confirm) {
      setError(t("auth.reset.mismatch"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await post("/auth/reset-password", { token, newPassword: pw });
      navigate("/login?reinitialise=1", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.reset.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 10,
          }}
        >
          <LanguageSwitcher />
        </div>
        <div className="auth-brand">
          <span className="logo-dot">📦</span>
          <div>
            <h1>StockMan</h1>
            <small>{t("auth.reset.tagline")}</small>
          </div>
        </div>
        <Card>
          {!token ? (
            <p role="alert">
              {t("auth.reset.incomplete")}{" "}
              <Link to="/mot-de-passe-oublie">{t("auth.reset.restart")}</Link>.
            </p>
          ) : (
            <form onSubmit={(e) => void submit(e)}>
              <Field label={t("auth.reset.newPassword")} required>
                <Input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
              </Field>
              <Field label={t("auth.reset.confirm")} required>
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
                {t("auth.reset.submit")}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
