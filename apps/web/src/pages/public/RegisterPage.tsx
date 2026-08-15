/** Inscription d'une nouvelle boutique (tenant + gérant + essai 14 j).
 *  I1 : textes via i18n (clés « auth.register.* ») + sélecteur de langue. */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../store/auth";
import { ApiError } from "../../lib/http";
import { Button, Card, Field, Input } from "../../components/ui";
import { LanguageSwitcher, usePageTitle } from "../../components/Shell";

/** Règle mot de passe : renvoie la clé i18n du motif de refus (ou null). */
function passwordIssueKey(p: string): string | null {
  if (p.length < 8) return "pwTooShort";
  if (!/[a-zA-Z]/.test(p)) return "pwLetter";
  if (!/[0-9]/.test(p)) return "pwDigit";
  return null;
}

export default function RegisterPage() {
  const { t } = useTranslation();
  usePageTitle(t("auth.register.pageTitle"));
  const { register } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({
    tenantName: "",
    userName: "",
    email: "",
    phone: "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (f.tenantName.trim().length < 2)
      errs.tenantName = t("auth.register.shopNameError");
    if (f.userName.trim().length < 2)
      errs.userName = t("auth.register.ownerNameError");
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim()))
      errs.email = t("auth.register.emailError");
    const pw = passwordIssueKey(f.password);
    if (pw) errs.password = t(`auth.register.${pw}`);
    if (f.confirm !== f.password)
      errs.confirm = t("auth.register.confirmError");
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setServerError(null);
    setLoading(true);
    try {
      await register({
        tenantName: f.tenantName.trim(),
        userName: f.userName.trim(),
        email: f.email.trim(),
        password: f.password,
        phone: f.phone.trim() || undefined,
      });
      navigate("/admin?bienvenue=1", { replace: true });
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : t("auth.register.error"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 480 }}>
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
            <small>{t("auth.register.tagline")}</small>
          </div>
        </div>
        <Card>
          <h2 style={{ marginBottom: 14 }}>{t("auth.register.title")}</h2>
          <form onSubmit={(e) => void submit(e)}>
            <Field
              label={t("auth.register.shopName")}
              required
              error={errors.tenantName}
            >
              <Input
                value={f.tenantName}
                onChange={set("tenantName")}
                placeholder={t("auth.register.shopNamePlaceholder")}
              />
            </Field>
            <div className="form-row">
              <Field
                label={t("auth.register.ownerName")}
                required
                error={errors.userName}
              >
                <Input
                  value={f.userName}
                  onChange={set("userName")}
                  placeholder={t("auth.register.ownerNamePlaceholder")}
                />
              </Field>
              <Field
                label={t("auth.register.phone")}
                hint={t("auth.register.phoneHint")}
              >
                <Input
                  value={f.phone}
                  onChange={set("phone")}
                  placeholder={t("auth.register.phonePlaceholder")}
                />
              </Field>
            </div>
            <Field
              label={t("auth.register.email")}
              required
              error={errors.email}
            >
              <Input
                type="email"
                value={f.email}
                onChange={set("email")}
                placeholder={t("auth.emailPlaceholder")}
                autoComplete="username"
              />
            </Field>
            <div className="form-row">
              <Field
                label={t("auth.register.password")}
                required
                error={errors.password}
                hint={t("auth.register.passwordHint")}
              >
                <Input
                  type="password"
                  value={f.password}
                  onChange={set("password")}
                  autoComplete="new-password"
                />
              </Field>
              <Field
                label={t("auth.register.confirm")}
                required
                error={errors.confirm}
              >
                <Input
                  type="password"
                  value={f.confirm}
                  onChange={set("confirm")}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            {serverError ? (
              <p
                role="alert"
                style={{ color: "var(--danger)", fontSize: "0.9rem" }}
              >
                {serverError}
              </p>
            ) : null}
            <Button block size="lg" type="submit" loading={loading}>
              {t("auth.register.submit")}
            </Button>
          </form>
        </Card>
        <p className="auth-foot">
          {t("auth.register.footerHas")}{" "}
          <Link to="/login">{t("auth.register.footerLogin")}</Link>
        </p>
      </div>
    </div>
  );
}
