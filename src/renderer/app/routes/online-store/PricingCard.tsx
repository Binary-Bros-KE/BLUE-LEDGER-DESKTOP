import { useEffect, useState } from "react";
import { Loader2, Percent } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { WEB_ROUND_TO_OPTIONS, webMarkUp, type StoreOwnerView, type WebPricing } from "@shared/types/online-store";

/**
 * Website price markup — every shelf price shows on the website (and is charged on online orders)
 * as shelf price + this %, rounded. A product with its own online price keeps that price exactly.
 * Stored on the cloud store (web_stores.pricingJson), applied by the server, so it follows every
 * shelf-price change automatically.
 */
export function PricingCard({
  pricing,
  currency,
  canEdit,
  onSaved
}: {
  pricing: WebPricing;
  currency: string;
  canEdit: boolean;
  onSaved: (view: StoreOwnerView) => void;
}): React.JSX.Element {
  // Raw text, exactly as typed (this app's money/number-input rule).
  const [percentText, setPercentText] = useState(String(pricing.markupPercent));
  const [roundTo, setRoundTo] = useState(pricing.markupPercent ? pricing.roundTo : 10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPercentText(String(pricing.markupPercent));
    setRoundTo(pricing.markupPercent ? pricing.roundTo : 10);
  }, [pricing.markupPercent, pricing.roundTo]);

  const value = Number(percentText);
  const valid = percentText.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 500;
  const dirty = valid && (value !== pricing.markupPercent || (value > 0 && roundTo !== pricing.roundTo));
  const example = 1600_00;

  async function save(): Promise<void> {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const view = await window.blueLedger.onlineStore.updateConfig({ pricingJson: { markupPercent: value, roundTo } });
      onSaved(view);
      showSuccessToast(value ? `Website prices are now shelf price + ${value}%` : "Website prices now match your shelf prices");
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't save website pricing"));
    } finally {
      setSaving(false);
    }
  }

  const fmt = (cents: number): string => `${currency} ${(cents / 100).toLocaleString()}`;

  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[220px] flex-1">
          <p className="flex items-center gap-2 text-sm font-extrabold">
            <Percent className="size-4 text-primary" aria-hidden="true" /> Website price markup
          </p>
          <p className="mt-0.5 text-xs font-semibold text-muted">
            Website prices = shelf price + markup, rounded. Products with their own online price keep it exactly.
          </p>
        </div>
        <label className="block">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted">Markup %</span>
          <input
            value={percentText}
            onChange={(e) => setPercentText(e.target.value.replace(/[^\d.]/g, ""))}
            disabled={!canEdit}
            inputMode="decimal"
            className="mt-1 block h-10 w-24 rounded-md border border-line bg-white px-3 text-sm font-bold outline-none focus:ring-4 focus:ring-accent/20 disabled:bg-soft"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted">Round to nearest</span>
          <select
            value={roundTo}
            onChange={(e) => setRoundTo(Number(e.target.value))}
            disabled={!canEdit}
            className="mt-1 block h-10 rounded-md border border-line bg-white px-3 text-sm font-bold outline-none focus:ring-4 focus:ring-accent/20 disabled:bg-soft"
          >
            {WEB_ROUND_TO_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 (none)" : n}
              </option>
            ))}
          </select>
        </label>
        {canEdit ? (
          <Button className="h-10" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" /> : null}
            Save
          </Button>
        ) : null}
      </div>
      <p className="mt-3 text-xs font-semibold text-muted">
        {valid && value > 0
          ? `Example: shelf ${fmt(example)} → website ${fmt(webMarkUp(example, { markupPercent: value, roundTo }))}`
          : "No markup — the website shows your shelf prices."}
        {!valid ? <span className="ml-2 text-danger">Enter a percentage from 0 to 500.</span> : null}
      </p>
    </div>
  );
}
