/** Paramètres du tenant : profil entreprise (logo, couleur, devise, fuseau),
 *  alertes SMS/WhatsApp et sécurité du compte courant (mot de passe, PIN). */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Tabs,
} from "../../components/ui";
import { LanguageSwitcher } from "../../components/Shell";
import { download, patch, post, put } from "../../lib/http";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useAuth } from "../../store/auth";
import { useToast } from "../../store/toast";
import type {
  NotificationSettings,
  TenantConfigRow,
  TenantCurrent,
} from "../../lib/types";

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
    niu: "",
    rccm: "",
    address: "",
    invoiceFooter: "",
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
        niu: q.data.niu ?? "",
        rccm: q.data.rccm ?? "",
        address: q.data.address ?? "",
        invoiceFooter: q.data.invoice_footer ?? "",
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
        niu: form.niu || null,
        rccm: form.rccm || null,
        address: form.address || null,
        invoiceFooter: form.invoiceFooter || null,
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
    <>
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

          {/* Mentions légales obligatoires (facturation Cameroun, E7) */}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field
              label="NIU (n° contribuable)"
              hint="Numéro d'identifiant unique — DGI."
            >
              <Input
                value={form.niu}
                onChange={(e) => setForm({ ...form, niu: e.target.value })}
                placeholder="M0624XXXXXXXXX"
              />
            </Field>
            <Field label="RCCM">
              <Input
                value={form.rccm}
                onChange={(e) => setForm({ ...form, rccm: e.target.value })}
                placeholder="RC/YAO/2024/B/0000"
              />
            </Field>
            <Field label="Adresse (siège / boutique)">
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Quartier, ville"
              />
            </Field>
          </div>
          <Field
            label="Pied de facture"
            hint="Mention imprimée en bas de chaque facture et reçu."
          >
            <Input
              value={form.invoiceFooter}
              onChange={(e) =>
                setForm({ ...form, invoiceFooter: e.target.value })
              }
              placeholder="Ex. Marchandises ni reprises ni échangées."
            />
          </Field>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Button loading={saving} onClick={save} disabled={!form.name.trim()}>
            Enregistrer
          </Button>
        </div>
      </Card>
      <LanguageCard />
      <CashPrefsCard />
      <WeightedBarcodeCard />
      <BackupRestoreCard />
    </>
  );
}

/* --------------------------- Langue de l'interface (I1) ------------------- */
/** Bascule FR/EN persistée sur l'appareil (même sélecteur que la topbar). */
function LanguageCard() {
  const { t } = useTranslation();
  return (
    <Card title={t("settings.language.title")}>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("settings.language.body")}
      </p>
      <div className="row" style={{ alignItems: "center" }}>
        <LanguageSwitcher />
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {t("settings.language.hint")}
        </span>
      </div>
    </Card>
  );
}

/* ------------------------- Préférences de caisse (E6) --------------------- */
/** Interrupteur « session de caisse obligatoire » : quand actif, vendre ou
 *  encaisser hors session ouverte est refusé par le serveur. */
function CashPrefsCard() {
  const { show } = useToast();
  const q = useQuery<TenantConfigRow[]>("configs:tenant", "/configs/tenant");
  const current =
    q.data?.find((c) => c.key === "cash_session_required")?.value === "true";
  const [value, setValue] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const effective = value ?? current;

  const save = async () => {
    setSaving(true);
    try {
      await put("/configs/tenant", {
        key: "cash_session_required",
        value: effective ? "true" : "false",
      });
      invalidateQueries("configs:tenant");
      invalidateQueries("cash:");
      show(
        effective
          ? "Session de caisse désormais OBLIGATOIRE pour vendre."
          : "Vente hors session de caisse de nouveau autorisée.",
        "success",
      );
    } catch (e) {
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (q.loading && !q.data) return null;
  return (
    <Card title="Caisse — session obligatoire">
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field
          label="Vente et encaissement uniquement en caisse ouverte"
          hint="Recommandé dès qu'un tiroir-caisse physique existe : les écarts sont alors contrôlés à chaque clôture (Z)."
        >
          <Select
            value={effective ? "true" : "false"}
            onChange={(e) => setValue(e.target.value === "true")}
          >
            <option value="false">Non — vendre librement (défaut)</option>
            <option value="true">
              Oui — exiger une session de caisse ouverte
            </option>
          </Select>
        </Field>
        <Button
          size="sm"
          loading={saving}
          onClick={save}
          disabled={value === null || value === current}
        >
          Appliquer
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------- Codes balance (pesée, C5) ----------------------- */
type WeightedMode = "OFF" | "PRICE" | "WEIGHT";
function WeightedBarcodeCard() {
  const { show } = useToast();
  const q = useQuery<TenantConfigRow[]>("configs:tenant", "/configs/tenant");
  const current: WeightedMode =
    (q.data?.find((c) => c.key === "barcode_weighted_mode")
      ?.value as WeightedMode) ?? "OFF";
  const [value, setValue] = useState<WeightedMode | null>(null);
  const [saving, setSaving] = useState(false);
  const effective = value ?? current;

  const save = async () => {
    setSaving(true);
    try {
      await put("/configs/tenant", {
        key: "barcode_weighted_mode",
        value: effective,
      });
      invalidateQueries("configs:tenant");
      show(
        effective === "OFF"
          ? "Étiquettes de balance ignorées à la caisse."
          : effective === "PRICE"
            ? "Caisse : le prix FCFA des étiquettes de balance est désormais décodé."
            : "Caisse : le poids (grammes) des étiquettes de balance est désormais décodé.",
        "success",
      );
    } catch (e) {
      show(
        e instanceof Error ? e.message : "Enregistrement impossible",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (q.loading && !q.data) return null;
  return (
    <Card title="Balance étiqueteuse — codes à pesée (GS1 20-29)">
      <p className="muted" style={{ marginTop: 0 }}>
        Pour les produits cochés « Article à pesée » (code article à 7 chiffres,
        ex. <code>2600123</code>), la caisse décode les étiquettes de la balance
        au scan : quantité ou prix remplis sans saisie.
      </p>
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field
          label="Interprétation du bloc valeur des étiquettes"
          hint="PRICE : la valeur (= prix payé en FCFA) donne la quantité via le prix catalogue. WEIGHT : la valeur est le poids en grammes."
        >
          <Select
            value={effective}
            onChange={(e) => setValue(e.target.value as WeightedMode)}
          >
            <option value="OFF">Ignorées — codes à pesée désactivés</option>
            <option value="PRICE">Prix embarqué (FCFA)</option>
            <option value="WEIGHT">Poids embarqué (grammes)</option>
          </Select>
        </Field>
        <Button
          size="sm"
          loading={saving}
          onClick={save}
          disabled={value === null || value === current}
        >
          Appliquer
        </Button>
      </div>
    </Card>
  );
}

/* -------------------- Sauvegarde & restauration (D1/D2) -------------------- */
interface ImportReport {
  ok: true;
  version: number;
  exportedAt: string;
  tenantName: string | null;
  tables: Record<string, number>;
  totalRows: number;
  ignoredSections: string[];
  remappedUserRefs: number;
  skippedSecretConfigs: number;
}

function BackupRestoreCard() {
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const payloadRef = useRef<unknown>(null);
  const [exporting, setExporting] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preview" | "applying" | "done">(
    "idle",
  );
  const [report, setReport] = useState<ImportReport | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const doExport = async () => {
    setExporting(true);
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      await download("/tenant/export", `stockman-export-${stamp}.json`);
      show("Sauvegarde complète téléchargée.", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "Export impossible", "error");
    } finally {
      setExporting(false);
    }
  };

  const onFile = async (f: File) => {
    try {
      const parsed: unknown = JSON.parse(await f.text());
      payloadRef.current = parsed;
      const r = await post<{ mode: string; report: ImportReport }>(
        "/tenant/import?mode=preview",
        parsed,
      );
      setReport(r.report);
      setConfirmText("");
      setPhase("preview");
    } catch (e) {
      show(
        e instanceof SyntaxError
          ? "Ce fichier n'est pas un JSON valide : utilisez le fichier produit par « Exporter »."
          : e instanceof Error
            ? e.message
            : "Fichier illisible",
        "error",
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const applyReplace = async () => {
    if (confirmText.trim().toUpperCase() !== "RESTAURER") return;
    setPhase("applying");
    try {
      await post("/tenant/import?mode=replace", payloadRef.current);
      setPhase("done");
      show("Données restaurées. Rechargement de l'application…", "success");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setPhase("preview");
      show(e instanceof Error ? e.message : "Restauration impossible", "error");
    }
  };

  return (
    <Card title="Sauvegarde & restauration des données">
      <p className="muted" style={{ marginTop: 0 }}>
        Exportez l'intégralité de vos données (JSON) à tout moment — archive,
        clôture d'exercice, migration. La restauration se fait après un contrôle
        complet du fichier, en une seule opération tout-ou-rien.
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <Button size="sm" loading={exporting} onClick={doExport}>
          ⬇️ Exporter toutes mes données
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          ⬆️ Restaurer depuis une sauvegarde…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 0 }}>
        ℹ️ Une sauvegarde serveur globale complète ce fichier (voir runbook :
        script <code>scripts/backup.sh</code>, rétention 14 jours).
      </p>

      {phase !== "idle" && report ? (
        <Modal
          title="Restauration — contrôle du fichier"
          onClose={() => phase !== "applying" && setPhase("idle")}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setPhase("idle")}
                disabled={phase === "applying"}
              >
                Annuler
              </Button>
              <Button
                variant="danger"
                loading={phase === "applying"}
                disabled={confirmText.trim().toUpperCase() !== "RESTAURER"}
                onClick={applyReplace}
              >
                ⚠️ Remplacer toutes mes données
              </Button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            Fichier du <strong>{report.exportedAt.slice(0, 10)}</strong>
            {report.tenantName ? (
              <>
                {" "}
                — boutique <strong>« {report.tenantName} »</strong>
              </>
            ) : null}{" "}
            : <strong>{report.totalRows}</strong> lignes réparties ainsi :
          </p>
          <div
            style={{
              maxHeight: 200,
              overflowY: "auto",
              fontSize: "0.85rem",
              border: "1px solid var(--line, #e2e8f0)",
              borderRadius: 8,
              padding: 8,
              marginBottom: 10,
            }}
          >
            {Object.entries(report.tables).map(([t, n]) => (
              <div key={t} className="row-between" style={{ padding: "2px 0" }}>
                <span className="muted">{t}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          {report.ignoredSections.length > 0 ? (
            <p className="muted" style={{ fontSize: "0.82rem" }}>
              ⚠️ Sections ignorées (inconnues de cette version) :{" "}
              {report.ignoredSections.join(", ")}.
            </p>
          ) : null}
          {report.remappedUserRefs > 0 ? (
            <p className="muted" style={{ fontSize: "0.82rem" }}>
              ⚠️ {report.remappedUserRefs} référence(s) à des comptes
              utilisateurs absents seront rattachées à votre compte.
            </p>
          ) : null}
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            🔐 Vos clés SMS/WhatsApp actuelles sont préservées (les secrets ne
            voyagent jamais dans le fichier).
          </p>
          <p style={{ color: "var(--danger)", fontWeight: 600 }}>
            Toutes vos données actuelles seront remplacées par celles du
            fichier. Tapez « RESTAURER » pour autoriser :
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="RESTAURER"
            aria-label="Confirmation de restauration"
          />
        </Modal>
      ) : null}
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
