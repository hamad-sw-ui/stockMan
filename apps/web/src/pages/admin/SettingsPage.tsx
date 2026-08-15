/** Paramètres du tenant : profil entreprise (logo, couleur, devise, fuseau),
 *  alertes SMS/WhatsApp et sécurité du compte courant (mot de passe, PIN). */
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
import { formatDate } from "../../lib/format";
import { download, patch, post, put } from "../../lib/http";
import { invalidateQueries, useQuery } from "../../lib/query";
import { useAuth } from "../../store/auth";
import { useToast } from "../../store/toast";
import type {
  NotificationSettings,
  TenantConfigRow,
  TenantCurrent,
} from "../../lib/types";

/** Libellé i18n d'un statut de licence, repli sur le code brut si inconnu. */
function licenseStatusLabel(t: (k: string) => string, code: string): string {
  const key = `licenseStatus.${code}`;
  const v = t(key);
  return v === key ? code : v;
}

/* --------------------------------- Entreprise ------------------------------ */
function CompanyTab() {
  const { t } = useTranslation();
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
      show(t("pages.settings.company.logoTooHeavy"), "error");
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
      show(t("pages.settings.company.saved"), "success");
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.settings.saveError"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (q.loading) return <Spinner label={t("common.loading")} />;
  return (
    <>
      <Card title={t("pages.settings.company.title")}>
        <div className="grid">
          <div
            className="row"
            style={{ alignItems: "flex-end", flexWrap: "wrap" }}
          >
            <div
              className="avatar"
              style={{ width: 84, height: 84, fontSize: "2.4rem" }}
            >
              {logo ? (
                <img src={logo} alt={t("pages.settings.company.logoAlt")} />
              ) : (
                "🏪"
              )}
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
                {t("pages.settings.company.changeLogo")}
              </Button>{" "}
              {logo ? (
                <Button variant="ghost" size="sm" onClick={() => setLogo(null)}>
                  {t("pages.settings.company.removeLogo")}
                </Button>
              ) : null}
              <p className="muted" style={{ fontSize: "0.82rem" }}>
                {t("pages.settings.company.logoHint")}
              </p>
            </div>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field
              label={t("pages.settings.company.fieldDisplayName")}
              required
            >
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label={t("pages.settings.company.fieldPhone")}>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+237 6XX XXX XXX"
              />
            </Field>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label={t("pages.settings.company.fieldColor")}>
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
                aria-label={t("pages.settings.company.colorAria")}
              />
              <code className="muted">{form.primaryColor}</code>
            </Field>
            <Field label={t("pages.settings.company.fieldCurrency")}>
              <Select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                <option value="FCFA">FCFA (XAF)</option>
                <option value="FCFA-BCEAO">FCFA (XOF)</option>
              </Select>
            </Field>
            <Field label={t("pages.settings.company.fieldTimezone")}>
              <Select
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              >
                <option value="Africa/Douala">
                  {t("pages.settings.company.tzDouala")}
                </option>
                <option value="Africa/Lagos">
                  {t("pages.settings.company.tzLagos")}
                </option>
                <option value="Africa/Abidjan">
                  {t("pages.settings.company.tzAbidjan")}
                </option>
              </Select>
            </Field>
          </div>

          {/* Mentions légales obligatoires (facturation Cameroun, E7) */}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field
              label={t("pages.settings.company.fieldNiu")}
              hint={t("pages.settings.company.niuHint")}
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
            <Field label={t("pages.settings.company.fieldAddress")}>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder={t("pages.settings.company.addressPlaceholder")}
              />
            </Field>
          </div>
          <Field
            label={t("pages.settings.company.fieldInvoiceFooter")}
            hint={t("pages.settings.company.invoiceFooterHint")}
          >
            <Input
              value={form.invoiceFooter}
              onChange={(e) =>
                setForm({ ...form, invoiceFooter: e.target.value })
              }
              placeholder={t("pages.settings.company.footerPlaceholder")}
            />
          </Field>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Button loading={saving} onClick={save} disabled={!form.name.trim()}>
            {t("common.save")}
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
  const { t } = useTranslation();
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
          ? t("pages.settings.cash.toastOn")
          : t("pages.settings.cash.toastOff"),
        "success",
      );
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.settings.saveError"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (q.loading && !q.data) return null;
  return (
    <Card title={t("pages.settings.cash.title")}>
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field
          label={t("pages.settings.cash.fieldLabel")}
          hint={t("pages.settings.cash.hint")}
        >
          <Select
            value={effective ? "true" : "false"}
            onChange={(e) => setValue(e.target.value === "true")}
          >
            <option value="false">{t("pages.settings.cash.optionNo")}</option>
            <option value="true">{t("pages.settings.cash.optionYes")}</option>
          </Select>
        </Field>
        <Button
          size="sm"
          loading={saving}
          onClick={save}
          disabled={value === null || value === current}
        >
          {t("common.apply")}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------- Codes balance (pesée, C5) ----------------------- */
type WeightedMode = "OFF" | "PRICE" | "WEIGHT";
function WeightedBarcodeCard() {
  const { t } = useTranslation();
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
          ? t("pages.settings.weighted.toastOff")
          : effective === "PRICE"
            ? t("pages.settings.weighted.toastPrice")
            : t("pages.settings.weighted.toastWeight"),
        "success",
      );
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.settings.saveError"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (q.loading && !q.data) return null;
  return (
    <Card title={t("pages.settings.weighted.title")}>
      <p className="muted" style={{ marginTop: 0 }}>
        <Trans
          i18nKey="pages.settings.weighted.body"
          components={{ code: <code /> }}
        />
      </p>
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field
          label={t("pages.settings.weighted.fieldLabel")}
          hint={t("pages.settings.weighted.hint")}
        >
          <Select
            value={effective}
            onChange={(e) => setValue(e.target.value as WeightedMode)}
          >
            <option value="OFF">
              {t("pages.settings.weighted.optionOff")}
            </option>
            <option value="PRICE">
              {t("pages.settings.weighted.optionPrice")}
            </option>
            <option value="WEIGHT">
              {t("pages.settings.weighted.optionWeight")}
            </option>
          </Select>
        </Field>
        <Button
          size="sm"
          loading={saving}
          onClick={save}
          disabled={value === null || value === current}
        >
          {t("common.apply")}
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
  const { t } = useTranslation();
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
      show(t("pages.settings.backup.exported"), "success");
    } catch (e) {
      show(e instanceof Error ? e.message : t("csv.exportError"), "error");
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
          ? t("pages.settings.backup.invalidJson")
          : e instanceof Error
            ? e.message
            : t("pages.settings.backup.unreadable"),
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
      show(t("pages.settings.backup.restored"), "success");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setPhase("preview");
      show(
        e instanceof Error
          ? e.message
          : t("pages.settings.backup.restoreError"),
        "error",
      );
    }
  };

  return (
    <Card title={t("pages.settings.backup.title")}>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("pages.settings.backup.body")}
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <Button size="sm" loading={exporting} onClick={doExport}>
          {t("pages.settings.backup.exportButton")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          {t("pages.settings.backup.restoreButton")}
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
        <Trans
          i18nKey="pages.settings.backup.note"
          components={{ code: <code /> }}
        />
      </p>

      {phase !== "idle" && report ? (
        <Modal
          title={t("pages.settings.backup.modalTitle")}
          onClose={() => phase !== "applying" && setPhase("idle")}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setPhase("idle")}
                disabled={phase === "applying"}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                loading={phase === "applying"}
                disabled={confirmText.trim().toUpperCase() !== "RESTAURER"}
                onClick={applyReplace}
              >
                {t("pages.settings.backup.replaceButton")}
              </Button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            {report.tenantName ? (
              <Trans
                i18nKey="pages.settings.backup.reportWithTenant"
                values={{
                  date: report.exportedAt.slice(0, 10),
                  name: report.tenantName,
                  total: report.totalRows,
                }}
                components={{ b: <strong /> }}
              />
            ) : (
              <Trans
                i18nKey="pages.settings.backup.reportNoTenant"
                values={{
                  date: report.exportedAt.slice(0, 10),
                  total: report.totalRows,
                }}
                components={{ b: <strong /> }}
              />
            )}
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
            {Object.entries(report.tables).map(([tbl, n]) => (
              <div
                key={tbl}
                className="row-between"
                style={{ padding: "2px 0" }}
              >
                <span className="muted">{tbl}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          {report.ignoredSections.length > 0 ? (
            <p className="muted" style={{ fontSize: "0.82rem" }}>
              {t("pages.settings.backup.ignoredSections", {
                list: report.ignoredSections.join(", "),
              })}
            </p>
          ) : null}
          {report.remappedUserRefs > 0 ? (
            <p className="muted" style={{ fontSize: "0.82rem" }}>
              {t("pages.settings.backup.remapped", {
                count: report.remappedUserRefs,
              })}
            </p>
          ) : null}
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            {t("pages.settings.backup.secretsKept")}
          </p>
          <p style={{ color: "var(--danger)", fontWeight: 600 }}>
            {/* Contrat de saisie : le mot-clé RESTAURER reste inchangé dans
                toutes les langues (sécurité anti-erreur). */}
            {t("pages.settings.backup.danger", { keyword: "RESTAURER" })}
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="RESTAURER"
            aria-label={t("pages.settings.backup.confirmAria")}
          />
        </Modal>
      ) : null}
    </Card>
  );
}

/* ---------------------------------- Alertes -------------------------------- */
function AlertsTab() {
  const { t } = useTranslation();
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
      setTest((prev) => ({ ...prev, phone: d.alert_phone ?? "" }));
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
      show(t("pages.settings.alerts.saved"), "success");
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.settings.saveError"),
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
      show(t("pages.settings.alerts.testSent"), "success");
    } catch (e) {
      show(
        e instanceof Error
          ? e.message
          : t("pages.settings.alerts.testSendError"),
        "error",
      );
    } finally {
      setTesting(false);
    }
  };

  if (q.loading) return <Spinner label={t("common.loading")} />;
  return (
    <>
      <Card title={t("pages.settings.alerts.recipientsTitle")}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Field
            label={t("pages.settings.alerts.smsField")}
            hint={t("pages.settings.alerts.smsHint")}
          >
            <Input
              value={f.alertPhone}
              onChange={(e) => setF({ ...f, alertPhone: e.target.value })}
              placeholder="+237 6XX XXX XXX"
            />
          </Field>
          <Field label={t("pages.settings.alerts.whatsappField")}>
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
            {t("pages.settings.alerts.alertLow")}
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={f.expiry}
              onChange={(e) => setF({ ...f, expiry: e.target.checked })}
            />{" "}
            {t("pages.settings.alerts.alertExpiry")}
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={f.daily}
              onChange={(e) => setF({ ...f, daily: e.target.checked })}
            />{" "}
            {t("pages.settings.alerts.alertDaily")}
            <input
              type="time"
              value={f.dailyTime}
              onChange={(e) => setF({ ...f, dailyTime: e.target.value })}
              style={{ width: 110 }}
              aria-label={t("pages.settings.alerts.dailyTimeAria")}
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Button loading={saving} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      </Card>
      <Card title={t("pages.settings.alerts.testTitle")}>
        <div
          className="row"
          style={{ flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label={t("pages.settings.alerts.channelField")}>
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
          <Field label={t("pages.settings.alerts.testPhoneField")}>
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
            {t("pages.settings.alerts.testButton")}
          </Button>
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
          {t("pages.settings.alerts.testNote")}
        </p>
      </Card>
    </>
  );
}

/* -------------------------------- Mon compte ------------------------------- */
function AccountTab() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const { show } = useToast();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (pw.next !== pw.confirm) {
      show(t("pages.settings.account.pwMismatch"), "error");
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
      show(t("pages.settings.account.pwSaved"), "success");
    } catch (e) {
      show(
        e instanceof Error ? e.message : t("pages.settings.account.pwError"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t("pages.settings.account.title", { name: user?.name ?? "" })}>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("pages.settings.account.identityLine", {
          email: user?.email ?? "",
          role:
            user?.role === "ADMIN"
              ? t("pages.settings.account.roleAdmin")
              : t("pages.settings.account.roleVendor"),
          licenseSuffix: user?.license
            ? t("pages.settings.account.licenseSuffix", {
                status: licenseStatusLabel(t, user.license.status),
                date: formatDate(user.license.end_date),
              })
            : "",
        })}
      </p>
      <Field label={t("pages.settings.account.pwCurrent")} required>
        <Input
          type="password"
          value={pw.current}
          onChange={(e) => setPw({ ...pw, current: e.target.value })}
          autoComplete="current-password"
        />
      </Field>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field
          label={t("auth.reset.newPassword")}
          required
          hint={t("pages.settings.account.pwHint")}
        >
          <Input
            type="password"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <Field label={t("common.confirm")} required>
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
        {t("pages.settings.account.pwButton")}
      </Button>
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("entreprise");
  return (
    <div className="wrap">
      <PageHeader title={t("nav.settings")} sub={t("pages.settings.sub")} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "entreprise", label: t("pages.settings.tabCompany") },
          { id: "alertes", label: t("pages.settings.tabAlerts") },
          { id: "compte", label: t("pages.settings.tabAccount") },
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
