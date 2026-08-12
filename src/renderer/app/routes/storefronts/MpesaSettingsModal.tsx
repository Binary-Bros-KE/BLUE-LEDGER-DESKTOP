import { useEffect, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, SelectField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { MpesaEnvironment, MpesaTillSettings } from "@shared/types/mpesa";

const ENVIRONMENT_OPTIONS: Array<{ value: MpesaEnvironment; label: string }> = [
  { value: "sandbox", label: "Sandbox (testing)" },
  { value: "production", label: "Production (live Till)" }
];

const emptyForm: MpesaTillSettings = {
  environment: "sandbox",
  consumerKey: "",
  consumerSecret: "",
  passkey: "",
  shortcode: "",
  tillNumber: "",
  accountReference: ""
};

export function MpesaSettingsModal({
  open,
  onClose,
  locationId,
  locationName
}: {
  open: boolean;
  onClose: () => void;
  locationId: string;
  locationName: string;
}): React.JSX.Element {
  const [form, setForm] = useState<MpesaTillSettings>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Fetched fresh every time this panel opens — never cached, never persisted to this device's
  // own storage (see mpesa-service.ts's own comment on why the secrets can't live on DESKTOP).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSavedAt(null);
    void window.blueLedger.mpesa
      .getSettings(locationId)
      .then((settings) => {
        if (cancelled) return;
        setForm(settings ?? emptyForm);
      })
      .catch((err) => {
        if (!cancelled) {
          const message = getErrorMessage(err, "Failed to load M-Pesa Till settings");
          setError(message);
          showErrorToast(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, locationId]);

  function updateField<K extends keyof MpesaTillSettings>(key: K, value: MpesaTillSettings[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      await window.blueLedger.mpesa.saveSettings(locationId, form);
      setSavedAt(Date.now());
      showSuccessToast("Till settings saved");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save M-Pesa Till settings");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="M-Pesa Till settings"
      description={`Safaricom Till (Buy Goods) credentials for ${locationName}. Stored on the server only — never saved to this device.`}
      widthClassName="max-w-lg"
    >
      {loading ? (
        <div className="flex min-h-[180px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}
          {savedAt && (
            <div className="mb-4 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm font-bold text-success">
              Till settings saved.
            </div>
          )}

          <div className="flex items-start gap-3 rounded-lg border border-dashed border-line bg-soft/60 p-3">
            <Smartphone className="mt-0.5 size-4 flex-none text-muted" aria-hidden="true" />
            <p className="text-xs font-semibold text-muted">
              This enables the "Send STK Push" button at checkout for this storefront. All fields below
              are required to save — close this without saving to leave STK push disabled here; cashiers
              can still record M-Pesa payments manually by transaction code.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Environment"
              value={form.environment}
              onChange={(value) => updateField("environment", value as MpesaEnvironment)}
              options={ENVIRONMENT_OPTIONS}
              className="sm:col-span-2"
            />
            <Field
              label="Consumer Key"
              value={form.consumerKey}
              onChange={(value) => updateField("consumerKey", value)}
              placeholder="Daraja app consumer key"
            />
            <Field
              label="Consumer Secret"
              type="password"
              value={form.consumerSecret}
              onChange={(value) => updateField("consumerSecret", value)}
              placeholder="Daraja app consumer secret"
            />
            <Field
              label="Passkey"
              type="password"
              value={form.passkey}
              onChange={(value) => updateField("passkey", value)}
              placeholder="Lipa Na M-Pesa passkey"
              className="sm:col-span-2"
            />
            <Field
              label="Shortcode"
              value={form.shortcode}
              onChange={(value) => updateField("shortcode", value)}
              placeholder="e.g. 174379"
            />
            <Field
              label="Till Number"
              value={form.tillNumber}
              onChange={(value) => updateField("tillNumber", value)}
              placeholder="e.g. 174379"
            />
            <Field
              label="Account Reference"
              value={form.accountReference}
              onChange={(value) => updateField("accountReference", value)}
              placeholder="Optional — shown on the customer's STK prompt"
              className="sm:col-span-2"
            />
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={onClose}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {saving ? "Saving..." : "Save Till settings"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
