import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { SelectField } from "@renderer/shared/components/form-fields";
import { cn } from "@renderer/shared/lib/cn";
import { isStorefrontType } from "@shared/types/location";
import type { Location } from "@shared/types/location";

/**
 * Shown only when the signed-in session has no assigned branch (Super Admin, typically) — lets
 * them pick which storefront a Checkout/Invoice/Quotation document belongs to instead of being
 * flatly blocked (see sale-service.ts's requireActiveSession for the backend half of this). Kept
 * inline in the same form rather than a separate "pick first" screen, so nobody loses cart/form
 * progress switching between them.
 *
 * `compact` is a single-line pill for Checkout's toolbar, where the full callout block pushed the
 * whole POS down to mid-screen; Invoices/Quotations keep the full block.
 */
export function StorefrontPicker({
  value,
  onChange,
  compact = false,
  className
}: {
  value: string;
  onChange: (locationId: string) => void;
  compact?: boolean;
  className?: string;
}): React.JSX.Element {
  const [locations, setLocations] = useState<Location[] | null>(null);

  useEffect(() => {
    void window.blueLedger.location.list().then((list) => {
      setLocations(list.filter((location) => location.status === "active" && isStorefrontType(location.locationType)));
    });
  }, []);

  const options = [
    { value: "", label: locations === null ? "Loading…" : "Select a storefront" },
    ...(locations ?? []).map((location) => ({ value: location.id, label: location.locationName }))
  ];

  if (compact) {
    return (
      // Just the dropdown — its own "Select a storefront" placeholder says what it's for. Warning-
      // tinted until something is picked, since a sale can't be held/charged without one.
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Storefront"
        title="Your account has no assigned branch — choose a storefront for this sale."
        className={cn(
          "h-11 max-w-[14rem] cursor-pointer rounded-lg border px-3 text-sm font-bold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15",
          value ? "border-line bg-white" : "border-warning/60 bg-warning/10",
          className
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className={cn("rounded-lg border border-dashed border-warning/50 bg-warning/10 p-4", className)}>
      <div className="flex items-center gap-2">
        <Store className="size-4 flex-none text-warning" aria-hidden="true" />
        <p className="text-xs font-bold text-ink">Your account has no assigned branch — choose a storefront for this document.</p>
      </div>
      <SelectField label="Storefront" value={value} onChange={onChange} options={options} className="mt-2 max-w-xs" />
    </div>
  );
}
