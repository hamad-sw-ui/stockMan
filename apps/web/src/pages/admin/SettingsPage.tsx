/** Paramètres du tenant : profil entreprise (logo, couleur, devise, fuseau),
 *  alertes SMS/WhatsApp et sécurité du compte courant (mot de passe, PIN). */
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Tabs,
} from "../../components/ui";
import { patch, post, put } from "../../lib/http";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useAuth } from "../../store/auth";
import { useToast } from "../../store/toast";
import type { NotificationSettings, TenantCurrent } from "../../lib/types";

/* --------------------------------- Entreprise ------------------------------ */
function CompanyTab() {
  const { show } = useToast();
  const { refreshUser } = useAuth();
  const q = useQuery<TenantCurrent>("tenant:current", "/tenants/current");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    primaryColor: "#059669",
    currency: "FCFA",
    timezone: "Africa/Douala",
  });
  const [logo, setLogo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.data) {
      setForm({
        name: q.data.name,
        phone: q.data.phone ?? "",
        primaryColor: q.data.primary_color ?? "#059669",
        currency: q.data.currency ?? "FCFA",
        timezone: q.data.timezone ?? "Africa/Douala",
      });
      setLogo(q.data.logo);
    }
  }, [q.data]);

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 150_000) {
      show("Logo trop lourd : 150 Ko maximum après compression.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Redimensionne à 192 px max (le tenant logo sert d'en-tête de reçu et de sidebar)
        const scale = Math.min(1, 192 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas
          .getContext("2d")!
          .drawImage(img, 0, 0, canvas.width, canvas.height);
        setLogo(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    try {
      await patch("/tenants/current", {
        name: form.name,
        phone: form.phone || null,
        primaryColor: form.primaryColor,
        currency: form.currency,
        timezone: form.timezone,
        logo,
      });
      invalidateQueries("tenant:");
      await refreshUser(); // applique la nouvelle couleur/logo à toute l'UI
      show("Paramètres enregistrés.", "success");
    } catch (e) {
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (q.loading) return <Spinner label="Chargement…" />;
  return (
    <Card title="Profil de l’entreprise">
      <div className="grid">
        <div
          className="row"
          style={{ alignItems: "flex-end", flexWrap: "wrap" }}
        >
          <div
            className="avatar"
            style={{ width: 84, height: 84, fontSize: "2.4rem" }}
          >
            {logo ? <img src={logo} alt="Logo de l’entreprise" /> : "🏪"}
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => pickLogo(e.target.files?.[0])}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              Changer le logo
            </Button>{" "}
            {logo ? (
              <Button variant="ghost" size="sm" onClick={() => setLogo(null)}>
                Retirer
              </Button>
            ) : null}
            <p className="muted" style={{ fontSize: "0.82rem" }}>
              PNG/JPG, redimensionné à 192 px automatiquement.
            </p>
          </div>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Field label="Nom affiché" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Téléphone (reçus & support)">
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+237 6XX XXX XXX"
            />
          </Field>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Field label="Couleur principale (white-label)">
            <input
              type="color"
              value={form.primaryColor}
              onChange={(e) =>
                setForm({ ...form, primaryColor: e.target.value })
              }
              style={{
                width: 64,
                height: 42,
                padding: 2,
                border: "1px solid var(--border)",
                borderRadius: 10,
              }}
              aria-label="Couleur principale"
            />
            <code className="muted">{form.primaryColor}</code>
          </Field>
          <Field label="Devise">
            <Select
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="FCFA">FCFA (XAF)</option>
              <option value="FCFA-BCEAO">FCFA (XOF)</option>
            </Select>
          </Field>
          <Field label="Fuseau horaire">
            <Select
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              <option value="Africa/Douala">Afrique/Douala (UTC+1)</option>
              <option value="Africa/Lagos">Afrique/Lagos (UTC+1)</option>
              <option value="Africa/Abidjan">Afrique/Abidjan (UTC)</option>
            </Select>
          </Field>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Button loading={saving} onClick={save} disabled={!form.name.trim()}>
          Enregistrer
        </Button>
      </div>
    </Card>
  );
}

/* ---------------------------------- Alertes -------------------------------- */
function AlertsTab() {
  const { show } = useToast();
  const q = useQuery<NotificationSettings>(
    "notif:settings",
    "/notifications/settings",
  );
  const [f, setF] = useState({
    alertPhone: "",
    alertWhatsapp: "",
    low: true,
    expiry: true,
    daily: true,
    dailyTime: "20:00",
  });
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{
    channel: "SMS" | "WHATSAPP";
    phone: string;
  }>({ channel: "SMS", phone: "" });
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const d = q.data;
    if (d) {
      setF({
        alertPhone: d.alert_phone ?? "",
        alertWhatsapp: d.alert_whatsapp ?? "",
        low: d.low_stock_enabled,
        expiry: d.expiry_alert_enabled,
        daily: d.daily_report_enabled,
        dailyTime: (d.daily_report_time ?? "20:00").slice(0, 5),
      });
      setTest((t) => ({ ...t, phone: d.alert_phone ?? "" }));
    }
  }, [q.data]);

  const save = async () => {
    setSaving(true);
    try {
      await put("/notifications/settings", {
        alertPhone: f.alertPhone || null,
        alertWhatsapp: f.alertWhatsapp || null,
        lowStockEnabled: f.low,
        expiryAlertEnabled: f.expiry,
        dailyReportEnabled: f.daily,
        dailyReportTime: f.dailyTime,
      });
      invalidateQueries("notif:");
      show("Alertes enregistrées.", "success");
    } catch (e) {
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await post("/notifications/test", {
        channel: test.channel,
        phone: test.phone,
      });
      show(
        "Message de test envoyé (vérifiez le journal des notifications).",
        "success",
      );
    } catch (e) {
      show(e instanceof Error ? e.message : "Envoi impossible", "error");
    } finally {
      setTesting(false);
    }
  };

  if (q.loading) return <Spinner label="Chargement…" />;
  return (
    <>
      <Card title="Destinataires des alertes">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Field
            label="Téléphone SMS (gérant)"
            hint="Format international recommandé : +2376XXXXXXXX"
          >
            <Input
              value={f.alertPhone}
              onChange={(e) => setF({ ...f, alertPhone: e.target.value })}
              placeholder="+237 6XX XXX XXX"
            />
          </Field>
          <Field label="Numéro WhatsApp">
            <Input
              value={f.alertWhatsapp}
              onChange={(e) => setF({ ...f, alertWhatsapp: e.target.value })}
              placeholder="+237 6XX XXX XXX"
            />
          </Field>
        </div>
        <div className="grid">
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={f.low}
              onChange={(e) => setF({ ...f, low: e.target.checked })}
            />{" "}
            Alerte stock bas (quotidienne)
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={f.expiry}
              onChange={(e) => setF({ ...f, expiry: e.target.checked })}
            />{" "}
            Alerte péremptions proches
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={f.daily}
              onChange={(e) => setF({ ...f, daily: e.target.checked })}
            />{" "}
            Rapport de caisse quotidien à
            <input
              type="time"
              value={f.dailyTime}
              onChange={(e) => setF({ ...f, dailyTime: e.target.value })}
              style={{ width: 110 }}
              aria-label="Heure du rapport"
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Button loading={saving} onClick={save}>
            Enregistrer
          </Button>
        </div>
      </Card>
      <Card title="Tester la configuration">
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label="Canal">
            <Select
              value={test.channel}
              onChange={(e) =>
                setTest({
                  ...test,
                  channel: e.target.value as "SMS" | "WHATSAPP",
                })
              }
            >
              <option value="SMS">SMS</option>
              <option value="WHATSAPP">WhatsApp</option>
            </Select>
          </Field>
          <Field label="Numéro de test">
            <Input
              value={test.phone}
              onChange={(e) => setTest({ ...test, phone: e.target.value })}
              placeholder="+237 6XX XXX XXX"
            />
          </Field>
          <Button
            variant="outline"
            loading={testing}
            onClick={sendTest}
            disabled={test.phone.replace(/\D/g, "").length < 8}
          >
            Envoyer un test
          </Button>
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
          En mode « fournisseur simulé » (par défaut en développement), l’envoi
          est journalisé mais aucun SMS réel ne part. Configurez Africa’s
          Talking / WhatsApp côté serveur pour la production.
        </p>
      </Card>
    </>
  );
}

/* -------------------------------- Mon compte ------------------------------- */
function AccountTab() {
  const { user, refreshUser } = useAuth();
  const { show } = useToast();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (pw.next !== pw.confirm) {
      show(
        "La confirmation ne correspond pas au nouveau mot de passe.",
        "error",
      );
      return;
    }
    setSaving(true);
    try {
      await post("/auth/change-password", {
        currentPassword: pw.current,
        newPassword: pw.next,
      });
      await refreshUser();
      setPw({ current: "", next: "", confirm: "" });
      show("Mot de passe modifié.", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "Modification impossible", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={`Mon compte — ${user?.name ?? ""}`}>
      <p className="muted" style={{ marginTop: 0 }}>
        {user?.email} · rôle{" "}
        {user?.role === "ADMIN" ? "Administrateur" : "Vendeur"}
        {user?.license
          ? ` · licence ${user.license.status} (fin ${new Date(user.license.end_date).toLocaleDateString("fr-FR")})`
          : ""}
      </p>
      <Field label="Mot de passe actuel" required>
        <Input
          type="password"
          value={pw.current}
          onChange={(e) => setPw({ ...pw, current: e.target.value })}
          autoComplete="current-password"
        />
      </Field>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field
          label="Nouveau mot de passe"
          required
          hint="8 caractères minimum, une lettre et un chiffre."
        >
          <Input
            type="password"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirmer" required>
          <Input
            type="password"
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            autoComplete="new-password"
          />
        </Field>
      </div>
      <Button
        loading={saving}
        onClick={save}
        disabled={!pw.current || pw.next.length < 8 || pw.next !== pw.confirm}
      >
        Changer le mot de passe
      </Button>
    </Card>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState("entreprise");
  return (
    <div className="wrap">
      <PageHeader
        title="Paramètres"
        sub="Personnalisation de l’entreprise, alertes et sécurité de votre compte"
      />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "entreprise", label: "🏪 Entreprise" },
          { id: "alertes", label: "🔔 Alertes" },
          { id: "compte", label: "🔐 Mon compte" },
        ]}
      />
      {tab === "entreprise" ? (
        <CompanyTab />
      ) : tab === "alertes" ? (
        <AlertsTab />
      ) : (
        <AccountTab />
      )}
    </div>
  );
}
