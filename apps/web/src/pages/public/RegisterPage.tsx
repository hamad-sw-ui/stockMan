/** Inscription d'une nouvelle boutique (tenant + gérant + essai 14 j). */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { ApiError } from '../../lib/http';
import { Button, Card, Field, Input } from '../../components/ui';
import { usePageTitle } from '../../components/Shell';

function validatePassword(p: string): string | null {
  if (p.length < 8) return '8 caractères minimum.';
  if (!/[a-zA-Z]/.test(p)) return 'Au moins une lettre requise.';
  if (!/[0-9]/.test(p)) return 'Au moins un chiffre requis.';
  return null;
}

export default function RegisterPage() {
  usePageTitle('Créer ma boutique');
  const { register } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ tenantName: '', userName: '', email: '', phone: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (f.tenantName.trim().length < 2) errs.tenantName = "Nom d'entreprise requis.";
    if (f.userName.trim().length < 2) errs.userName = 'Votre nom est requis.';
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) errs.email = 'Email invalide.';
    const pw = validatePassword(f.password);
    if (pw) errs.password = pw;
    if (f.confirm !== f.password) errs.confirm = 'Les mots de passe ne correspondent pas.';
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
      navigate('/admin?bienvenue=1', { replace: true });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Inscription impossible pour l'instant.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <div className="auth-brand">
          <span className="logo-dot">📦</span>
          <div>
            <h1>StockMan</h1>
            <small>Essai gratuit de 14 jours — sans engagement</small>
          </div>
        </div>
        <Card>
          <h2 style={{ marginBottom: 14 }}>Créer ma boutique</h2>
          <form onSubmit={(e) => void submit(e)}>
            <Field label="Nom de l'entreprise / boutique" required error={errors.tenantName}>
              <Input value={f.tenantName} onChange={set('tenantName')} placeholder="Ex. Dépôt Chez Maman Alice" />
            </Field>
            <div className="form-row">
              <Field label="Votre nom (gérant)" required error={errors.userName}>
                <Input value={f.userName} onChange={set('userName')} placeholder="Ex. Alice Mbarga" />
              </Field>
              <Field label="Téléphone (WhatsApp)" hint="Ex. +237 690 12 34 56">
                <Input value={f.phone} onChange={set('phone')} placeholder="+237…" />
              </Field>
            </div>
            <Field label="Email de connexion" required error={errors.email}>
              <Input type="email" value={f.email} onChange={set('email')} placeholder="vous@entreprise.cm" autoComplete="username" />
            </Field>
            <div className="form-row">
              <Field label="Mot de passe" required error={errors.password} hint="8+ caractères, lettre + chiffre">
                <Input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
              </Field>
              <Field label="Confirmation" required error={errors.confirm}>
                <Input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
              </Field>
            </div>
            {serverError ? (
              <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>
                {serverError}
              </p>
            ) : null}
            <Button block size="lg" type="submit" loading={loading}>
              Démarrer mon essai gratuit
            </Button>
          </form>
        </Card>
        <p className="auth-foot">
          Déjà inscrit ? <Link to="/login">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
