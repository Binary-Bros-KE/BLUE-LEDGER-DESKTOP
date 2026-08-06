import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Download, Loader2, Printer, RefreshCw, Settings as SettingsIcon, XCircle } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { CheckboxField, Field, SelectField } from "@renderer/shared/components/form-fields";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { useUpdateStatusWidget } from "@renderer/app/layouts/useUpdateStatusWidget";
import {
  DEFAULT_PRINTER_SETTINGS,
  PRINTER_CONNECTION_OPTIONS,
  PRINTER_TYPE_OPTIONS,
  type PrinterConnectionType,
  type PrinterType
} from "@shared/types/printer";

type FormState = {
  enabled: boolean;
  connectionType: PrinterConnectionType;
  address: string;
  printerType: PrinterType;
  paperWidth: string;
  autoPrintOnSale: boolean;
};

const ADDRESS_PLACEHOLDER: Record<PrinterConnectionType, string> = {
  network: "192.168.1.50:9100",
  usb: "EPSON TM-T88V (or leave blank for auto)",
  serial: "COM3"
};

const ADDRESS_HELP: Record<PrinterConnectionType, string> = {
  network: "The printer's IP address, with an optional :port (defaults to 9100).",
  usb: "The exact name Windows shows for the printer, or leave blank to auto-detect.",
  serial: "The serial/COM port the printer is connected to."
};

export function SettingsRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canEdit = can("settings", "edit");

  const updateStatus = useUpdateStatusWidget();
  const [checkingNow, setCheckingNow] = useState(false);

  async function handleCheckForUpdates(): Promise<void> {
    setCheckingNow(true);
    try {
      await window.blueLedger.update.checkNow();
    } finally {
      setCheckingNow(false);
    }
  }

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<FormState>({
    enabled: DEFAULT_PRINTER_SETTINGS.enabled,
    connectionType: DEFAULT_PRINTER_SETTINGS.connectionType,
    address: DEFAULT_PRINTER_SETTINGS.address,
    printerType: DEFAULT_PRINTER_SETTINGS.printerType,
    paperWidth: String(DEFAULT_PRINTER_SETTINGS.paperWidth),
    autoPrintOnSale: DEFAULT_PRINTER_SETTINGS.autoPrintOnSale
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await window.blueLedger.printer.getSettings();
        setForm({
          enabled: settings.enabled,
          connectionType: settings.connectionType,
          address: settings.address,
          printerType: settings.printerType,
          paperWidth: String(settings.paperWidth),
          autoPrintOnSale: settings.autoPrintOnSale
        });
      } catch (err) {
        setLoadError(getErrorMessage(err, "Failed to load printer settings"));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveNotice(null);
    setTestResult(null);
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);

    try {
      await window.blueLedger.printer.saveSettings({
        enabled: form.enabled,
        connectionType: form.connectionType,
        address: form.address,
        printerType: form.printerType,
        paperWidth: Number(form.paperWidth) || DEFAULT_PRINTER_SETTINGS.paperWidth,
        autoPrintOnSale: form.autoPrintOnSale
      });
      setSaveNotice("Printer settings saved");
    } catch (err) {
      setSaveError(getErrorMessage(err, "Failed to save printer settings"));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.blueLedger.printer.testConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: getErrorMessage(err, "Failed to test printer connection") });
    } finally {
      setTesting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative mt-6 space-y-5 pb-10 pl-4"
    >
      <span
        className="pointer-events-none absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-2 left-0 top-2 border-l-2 border-dashed border-line"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -left-[5px] bottom-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Settings</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
            <SettingsIcon className="size-5 text-primary" aria-hidden="true" />
            Preferences
          </h2>
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-ink">
            <Printer className="size-4 text-primary" aria-hidden="true" />
            Receipt Printer
          </h3>
          <p className="mt-1 text-xs font-semibold text-muted">
            Configure the ESC/POS thermal printer used to print receipts at checkout.
          </p>

          {loadError && (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {loadError}
            </div>
          )}

          {!loaded ? (
            <div className="mt-6 flex min-h-[160px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : (
            <form onSubmit={handleSave} className="mt-4 max-w-xl">
              {saveError && (
                <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                  {saveError}
                </div>
              )}
              {saveNotice && (
                <div className="mb-4 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm font-bold text-success">
                  {saveNotice}
                </div>
              )}

              <CheckboxField
                label="Enable receipt printing"
                description="Turn this off if you don't have a thermal printer set up yet"
                checked={form.enabled}
                onChange={(checked) => updateField("enabled", checked)}
              />

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField
                  label="Connection Type"
                  value={form.connectionType}
                  onChange={(value) => updateField("connectionType", value as PrinterConnectionType)}
                  options={PRINTER_CONNECTION_OPTIONS}
                />
                <SelectField
                  label="Printer Type"
                  value={form.printerType}
                  onChange={(value) => updateField("printerType", value as PrinterType)}
                  options={PRINTER_TYPE_OPTIONS}
                />
              </div>

              <Field
                label="Printer Address"
                value={form.address}
                onChange={(value) => updateField("address", value)}
                placeholder={ADDRESS_PLACEHOLDER[form.connectionType]}
                className="mt-4"
              />
              <p className="mt-1.5 text-[11px] font-semibold text-muted">{ADDRESS_HELP[form.connectionType]}</p>

              <Field
                label="Paper Width (characters per line)"
                type="number"
                value={form.paperWidth}
                onChange={(value) => updateField("paperWidth", value)}
                placeholder="49"
                className="mt-4 max-w-[220px]"
              />
              <p className="mt-1.5 text-[11px] font-semibold text-muted">
                Controls how wide receipts/invoices/quotations print on a USB thermal printer. Content prints
                at its true size (not shrunk to fit), so setting this too high cuts off the right edge instead
                of just looking narrow. Increase it one step at a time and reprint — the moment anything on
                the right (a column, a total) gets cut off, back off to the last value that printed cleanly.
                The exact right number varies by printer model.
              </p>

              <div className="mt-4">
                <CheckboxField
                  label="Print automatically after each sale"
                  description="If off, use the Print button on the receipt instead"
                  checked={form.autoPrintOnSale}
                  onChange={(checked) => updateField("autoPrintOnSale", checked)}
                />
              </div>

              {testResult && (
                <div
                  className={`mt-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold ${
                    testResult.success
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-danger/30 bg-danger-soft text-danger"
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="size-4 flex-none" aria-hidden="true" />
                  ) : (
                    <XCircle className="size-4 flex-none" aria-hidden="true" />
                  )}
                  {testResult.message}
                </div>
              )}

              {canEdit && (
                <div className="mt-6 flex items-center gap-3 border-t border-line pt-5">
                  <Button
                    type="button"
                    onClick={() => void handleTestConnection()}
                    disabled={testing || !form.address}
                    className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {testing ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" /> : null}
                    Test Connection
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                    {saving ? "Saving..." : "Save Printer Settings"}
                  </Button>
                </div>
              )}
            </form>
          )}
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-ink">
            <Download className="size-4 text-primary" aria-hidden="true" />
            App Updates
          </h3>
          <p className="mt-1 text-xs font-semibold text-muted">
            Checks automatically at startup and every few hours. Version {updateStatus?.currentVersion ?? "—"}.
          </p>

          <div className="mt-4 max-w-xl">
            {updateStatus?.status === "downloaded" && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm font-bold text-ink">
                <CheckCircle2 className="size-4 flex-none text-accent" aria-hidden="true" />
                Version {updateStatus.version} is downloaded and ready — restart the app to install it.
              </div>
            )}
            {updateStatus?.status === "downloading" && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-soft/60 px-4 py-3 text-sm font-bold text-muted">
                <Loader2 className="size-4 flex-none animate-spin" aria-hidden="true" />
                Downloading version {updateStatus.version} in the background...
              </div>
            )}
            {updateStatus?.status === "not-available" && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm font-bold text-success">
                <CheckCircle2 className="size-4 flex-none" aria-hidden="true" />
                You're on the latest version.
              </div>
            )}
            {updateStatus?.status === "error" && updateStatus.error && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                <XCircle className="size-4 flex-none" aria-hidden="true" />
                {updateStatus.error}
              </div>
            )}

            <Button
              type="button"
              onClick={() => void handleCheckForUpdates()}
              disabled={checkingNow}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkingNow ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="mr-1.5 size-4" aria-hidden="true" />
              )}
              {checkingNow ? "Checking..." : "Check for Updates Now"}
            </Button>
          </div>
        </div>
      </section>
    </motion.div>
  );
}
