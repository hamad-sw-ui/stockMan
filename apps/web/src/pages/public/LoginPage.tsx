/** Connexion : mot de passe classique ou PIN caisse (kiosque vendeur).
 *  I1 : textes via i18n (clés « auth.login.* ») + sélecteur de langue. */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, type Role } from "../../store/auth";
import { ApiError } from "../../lib/http";
import { Button, Card, Field, Input, Tabs } from "../../components/ui";
import { LanguageSwitcher, usePageTitle } from "../../components/Shell";

export function homeForRole(role: Role): string {
  return role === "SUPER_ADMIN"
    ? "/sa"
    : role === "ADMIN"
      ? "/admin"
      : "/caisse";
}

export default function LoginPage() {
  const { t } = useTranslation();
  usePageTitle(t("auth.login.pageTitle"));
  const { login, loginWithPin } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      navigate(homeForRole(user.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.login.error"));
    } finally {
      setLoading(false);
    }
  };

  const submitPin = async (code?: string) => {
    const p = code ?? pin;
    if (p.length < 4) return;
    setError(null);
    setLoading(true);
    try {
      const user = await loginWithPin(email.trim(), p);
      navigate(homeForRole(user.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.login.error"));
      setPin("");
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
            <small>{t("auth.login.tagline")}</small>
          </div>
        </div>
        <Card>
          <Tabs
            tabs={[
              { id: "password", label: t("auth.login.tabPassword") },
              { id: "pin", label: t("auth.login.tabPin") },
            ]}
            active={tab}
            onChange={setTab}
          />
          <Field label={t("auth.login.email")} required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              autoComplete="username"
              autoFocus
            />
          </Field>
          {tab === "password" ? (
            <form onSubmit={(e) => void submitPassword(e)}>
              <Field label={t("auth.login.password")} required>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.login.passwordPlaceholder")}
                  autoComplete="current-password"
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
              <Button block size="lg" type="submit" loading={loading}>
                {t("auth.login.submit")}
              </Button>
              <p style={{ textAlign: "center", marginTop: 12 }}>
                <Link to="/mot-de-passe-oublie">{t("auth.login.forgot")}</Link>
              </p>
            </form>
          ) : (
            <div>
              <div className="pin-dots" aria-hidden>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span
                    key={i}
                    className={pin.length > i ? "filled" : ""}
                    style={
                      i > 3
                        ? {
                            opacity:
                              pin.length > 4 || pin.length === 0 ? 0.45 : 1,
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
              <p
                className="muted"
                style={{ textAlign: "center", fontSize: "0.85rem" }}
              >
                {t("auth.login.pinHint")}
              </p>
              {error ? (
                <p
                  role="alert"
                  style={{
                    color: "var(--danger)",
                    fontSize: "0.9rem",
                    textAlign: "center",
                  }}
                >
                  {error}
                </p>
              ) : null}
              <div className="pin-pad">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={loading || pin.length >= 6}
                    onClick={() => {
                      const next = pin + d;
                      setPin(next);
                      if (next.length === 6) void submitPin(next);
                    }}
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPin("")}
                  aria-label={t("auth.login.erase")}
                >
                  ⌫
                </button>
                <button
                  type="button"
                  disabled={loading || pin.length >= 6}
                  onClick={() => {
                    const next = pin + "0";
                    setPin(next);
                    if (next.length === 6) void submitPin(next);
                  }}
                >
                  0
                </button>
                <button
                  type="button"
                  disabled={loading || pin.length < 4}
                  onClick={() => void submitPin()}
                  style={{ background: "var(--primary)", color: "#fff" }}
                  aria-label={t("auth.login.validate")}
                >
                  ✓
                </button>
              </div>
            </div>
          )}
        </Card>
        <p className="auth-foot">
          {t("auth.login.footerNew")}{" "}
          <Link to="/inscription">{t("auth.login.footerRegister")}</Link>
        </p>
      </div>
    </div>
  );
}
