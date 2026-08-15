/** Mot de passe oublié : envoi d'un lien de réinitialisation
 *  (anti-énumération). I1 : textes via i18n (clés « auth.forgot.* »). */
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError, post } from "../../lib/http";
import { Button, Card, Field, Input } from "../../components/ui";
import { LanguageSwitcher, usePageTitle } from "../../components/Shell";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  usePageTitle(t("auth.forgot.pageTitle"));
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
      setError(err instanceof ApiError ? err.message : t("auth.forgot.error"));
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
            <small>{t("auth.forgot.tagline")}</small>
          </div>
        </div>
        <Card>
          {done ? (
            <div>
              <p role="status">{done}</p>
              {devToken ? (
                <p style={{ fontSize: "0.88rem" }}>
                  {t("auth.forgot.devNote")}{" "}
                  <Link
                    to={`/reinitialiser-mot-de-passe?token=${encodeURIComponent(devToken)}`}
                  >
                    {t("auth.forgot.openLink")}
                  </Link>
                </p>
              ) : null}
              <p>
                <Link to="/login">{t("auth.forgot.backToLogin")}</Link>
              </p>
            </div>
          ) : (
            <form onSubmit={(e) => void submit(e)}>
              <Field label={t("auth.forgot.email")} required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("auth.emailPlaceholder")}
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
                {t("auth.forgot.submit")}
              </Button>
              <p style={{ textAlign: "center", marginTop: 12 }}>
                <Link to="/login">{t("auth.forgot.backToLogin")}</Link>
              </p>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
