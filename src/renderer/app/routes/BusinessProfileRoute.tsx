import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Camera,
  CheckCircle2,
  Circle,
  Image as ImageIcon,
  Loader2,
  PenLine,
  Save,
  X
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, SelectField } from "@renderer/shared/components/form-fields";
import { StampBadge } from "@renderer/shared/components/StampBadge";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { logoBoxClassName } from "@renderer/shared/lib/logo";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { LOGO_RATIO_OPTIONS, type LogoRatio } from "@shared/types/logo";
import {
  BUSINESS_TYPE_OPTIONS,
  CURRENCY_OPTIONS,
  type BusinessType,
  type Currency,
  type TenantRecord
} from "@shared/types/tenant";

type FormState = {
  businessName: string;
  businessLogoPath: string;
  businessLogoRatio: LogoRatio | "";
  businessRegistrationNumber: string;
  kraPin: string;
  primaryPhone: string;
  alternativePhone: string;
  email: string;
  website: string;
  country: string;
  countyState: string;
  cityTown: string;
  physicalAddress: string;
  businessType: BusinessType;
  currency: Currency;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  vatRatePercent: string;
  pricesTaxInclusive: boolean;
};

function toFormState(record: TenantRecord): FormState {
  return {
    businessName: record.businessName,
    businessLogoPath: record.businessLogoPath ?? "",
    businessLogoRatio: record.businessLogoRatio ?? "",
    businessRegistrationNumber: record.businessRegistrationNumber ?? "",
    kraPin: record.kraPin ?? "",
    primaryPhone: record.primaryPhone ?? "",
    alternativePhone: record.alternativePhone ?? "",
    email: record.email ?? "",
    website: record.website ?? "",
    country: record.country ?? "",
    countyState: record.countyState ?? "",
    cityTown: record.cityTown ?? "",
    physicalAddress: record.physicalAddress ?? "",
    businessType: record.businessType,
    currency: record.currency,
    ownerName: record.ownerName ?? "",
    ownerPhone: record.ownerPhone ?? "",
    ownerEmail: record.ownerEmail ?? "",
    vatRatePercent: String(record.vatRatePercent),
    pricesTaxInclusive: record.pricesTaxInclusive
  };
}

export function BusinessProfileRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canEdit = can("business_profile", "edit");

  const [profile, setProfile] = useState<TenantRecord | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    void window.blueLedger.tenant.getProfile().then((record) => {
      if (cancelled) return;
      setProfile(record);
      setForm(toFormState(record));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!form?.businessLogoPath) {
      setLogoPreviewUrl(null);
      return;
    }

    void window.blueLedger.tenant.readImagePreview(form.businessLogoPath).then((dataUrl) => {
      if (!cancelled) setLogoPreviewUrl(dataUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [form?.businessLogoPath]);

  const dirty = useMemo(() => {
    if (!profile || !form) return false;
    return JSON.stringify(toFormState(profile)) !== JSON.stringify(form);
  }, [profile, form]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSavedAt(null);
  }

  async function handlePickLogo(): Promise<void> {
    const path = await window.blueLedger.tenant.pickLogo();
    if (path) {
      updateField("businessLogoPath", path);
    }
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!form) return;

    setSaving(true);
    setError(null);

    try {
      const updated = await window.blueLedger.tenant.updateProfile({
        ...form,
        businessLogoRatio: form.businessLogoRatio || null,
        vatRatePercent: Number(form.vatRatePercent) || 0
      });
      setProfile(updated);
      setForm(toFormState(updated));
      setSavedAt(Date.now());
      showSuccessToast("Business profile saved");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save business profile");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !form || !profile) {
    return (
      <div className="mt-8 flex min-h-[420px] items-center justify-center text-muted">
        <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      </div>
    );
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

      <form onSubmit={handleSave} className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">
              Business Profile
            </p>
            <h2 className="mt-1 text-xl font-extrabold">Your business information</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Used on receipts, reports, and — once cloud sync is enabled — your Blue Ledger account.
            </p>
          </div>
          <StampBadge
            label="Cloud Sync"
            sublabel={profile.syncStatus === "synced" ? "Synced" : "Pending"}
            tone={profile.syncStatus === "synced" ? "success" : "warning"}
            rotate={-8}
            className="w-20"
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center gap-4">
          <div
            className={cn(
              "grid flex-none place-items-center overflow-hidden rounded-2xl border border-dashed border-gray-300 bg-white",
              logoBoxClassName(form.businessLogoRatio)
            )}
          >
            {logoPreviewUrl ? (
              <img src={logoPreviewUrl} alt="Business logo" className="size-full object-contain p-1.5" />
            ) : (
              <ImageIcon className="size-6 text-muted" aria-hidden="true" />
            )}
          </div>
          <div>
            {canEdit && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => void handlePickLogo()}
                  className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                >
                  <Camera className="mr-2 size-4" aria-hidden="true" />
                  {form.businessLogoPath ? "Replace logo" : "Choose logo"}
                </Button>
                {form.businessLogoPath && (
                  <Button
                    type="button"
                    onClick={() => {
                      updateField("businessLogoPath", "");
                      updateField("businessLogoRatio", "");
                    }}
                    className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                  >
                    <X className="mr-1.5 size-3.5" aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </div>
            )}
            <p className="mt-2 text-xs font-semibold text-muted">
              JPG, PNG, or WEBP · max 10MB. Copied into Blue Ledger's own storage, so it stays put even
              if you move or delete the original file.
            </p>
          </div>
        </div>

        {form.businessLogoPath && (
          <SelectField
            label="Logo Shape"
            value={form.businessLogoRatio}
            onChange={(value) => updateField("businessLogoRatio", value as LogoRatio)}
            options={[{ value: "", label: "Not set" }, ...LOGO_RATIO_OPTIONS]}
            className="mt-3 max-w-xs"
          />
        )}

        <FormSection title="Business Information">
          <Field
            label="Business Name"
            value={form.businessName}
            onChange={(value) => updateField("businessName", value)}
            placeholder="e.g. Mama Njeri Wholesalers"
            required
          />
          <SelectField
            label="Business Type"
            value={form.businessType}
            onChange={(value) => updateField("businessType", value as BusinessType)}
            options={BUSINESS_TYPE_OPTIONS}
          />
          <SelectField
            label="Currency"
            value={form.currency}
            onChange={(value) => updateField("currency", value as Currency)}
            options={CURRENCY_OPTIONS}
          />
          <Field
            label="Business Registration Number"
            value={form.businessRegistrationNumber}
            onChange={(value) => updateField("businessRegistrationNumber", value)}
            placeholder="e.g. BN-2024-001234"
          />
          <Field
            label="KRA PIN"
            value={form.kraPin}
            onChange={(value) => updateField("kraPin", value)}
            placeholder="e.g. A012345678Z"
          />
        </FormSection>

        <FormSection title="Tax Settings">
          <Field
            label="Standard (VAT) Rate (%)"
            type="number"
            value={form.vatRatePercent}
            onChange={(value) => updateField("vatRatePercent", value)}
            placeholder="16"
          />
          <SelectField
            label="Default product prices are"
            value={form.pricesTaxInclusive ? "inclusive" : "exclusive"}
            onChange={(value) => updateField("pricesTaxInclusive", value === "inclusive")}
            options={[
              { value: "inclusive", label: "Inclusive of tax (Kenya's norm)" },
              { value: "exclusive", label: "Exclusive of tax" }
            ]}
          />
          <p className="text-xs font-semibold text-muted sm:col-span-2">
            Every product picks one of three tax categories — Standard (this rate), Exempted, or
            Zero-Rated — from its own edit screen. Each product can also override inclusive vs.
            exclusive individually; this setting is only the default new products start with.
          </p>
        </FormSection>

        <FormSection title="Contact">
          <Field
            label="Primary Phone"
            value={form.primaryPhone}
            onChange={(value) => updateField("primaryPhone", value)}
            placeholder="e.g. 0712 345 678"
          />
          <Field
            label="Alternative Phone"
            value={form.alternativePhone}
            onChange={(value) => updateField("alternativePhone", value)}
            placeholder="e.g. 0722 345 678"
          />
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={(value) => updateField("email", value)}
            placeholder="e.g. info@yourbusiness.co.ke"
          />
          <Field
            label="Website"
            value={form.website}
            onChange={(value) => updateField("website", value)}
            placeholder="e.g. www.yourbusiness.co.ke"
          />
        </FormSection>

        <FormSection title="Location">
          <Field
            label="Country"
            value={form.country}
            onChange={(value) => updateField("country", value)}
            placeholder="e.g. Kenya"
          />
          <Field
            label="County / State"
            value={form.countyState}
            onChange={(value) => updateField("countyState", value)}
            placeholder="e.g. Nairobi"
          />
          <Field
            label="City / Town"
            value={form.cityTown}
            onChange={(value) => updateField("cityTown", value)}
            placeholder="e.g. Nairobi CBD"
          />
          <Field
            label="Physical Address"
            value={form.physicalAddress}
            onChange={(value) => updateField("physicalAddress", value)}
            placeholder="e.g. Moi Avenue, Reliable House, 2nd Floor"
            className="sm:col-span-2"
          />
        </FormSection>

        <FormSection title="Owner">
          <Field
            label="Owner Name"
            value={form.ownerName}
            onChange={(value) => updateField("ownerName", value)}
            placeholder="e.g. Jane Njeri"
          />
          <Field
            label="Owner Phone"
            value={form.ownerPhone}
            onChange={(value) => updateField("ownerPhone", value)}
            placeholder="e.g. 0712 345 678"
          />
          <Field
            label="Owner Email"
            type="email"
            value={form.ownerEmail}
            onChange={(value) => updateField("ownerEmail", value)}
            placeholder="e.g. owner@yourbusiness.co.ke"
          />
        </FormSection>

        <div className="mt-4 rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3 text-xs font-semibold text-muted">
          Receipt, invoice, and quotation headers/footers now live on each storefront — open{" "}
          <span className="font-bold text-ink">Storefronts</span> and edit the branch you want to
          configure. This keeps every branch's documents showing that branch's own identity.
        </div>

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-5">
          <SaveStatus dirty={dirty} savedAt={savedAt} />
          {canEdit && (
            <Button
              type="submit"
              disabled={!dirty || saving}
              className="disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="mr-2 size-4" aria-hidden="true" />
              )}
              {saving ? "Saving..." : "Save changes"}
            </Button>
          )}
        </div>
      </form>
    </motion.div>
  );
}

function SaveStatus({ dirty, savedAt }: { dirty: boolean; savedAt: number | null }): React.JSX.Element {
  if (dirty) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-bold text-warning bg-warning/10 px-2 py-1 rounded-md">
        <PenLine className="size-3.5 flex-none" aria-hidden="true" />
        You have unsaved changes.
      </p>
    );
  }

  if (savedAt) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-bold text-success bg-success/10 px-2 py-1 rounded-md">
        <CheckCircle2 className="size-3.5 flex-none" aria-hidden="true" />
        All changes saved.
      </p>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold text-muted bg-muted/10 px-2 py-1 rounded-md">
      <Circle className="size-3.5 flex-none" aria-hidden="true" />
      No changes yet.
    </p>
  );
}

function FormSection({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mt-5 border-t border-line pt-5">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">{title}</p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}
