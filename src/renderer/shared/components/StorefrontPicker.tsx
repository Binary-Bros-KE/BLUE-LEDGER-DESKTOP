import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { SelectField } from "@renderer/shared/components/form-fields";
import { isStorefrontType } from "@shared/types/location";
import type { Location } from "@shared/types/location";

/**
 * Shown only when the signed-in session has no assigned branch (Super Admin, typically) — lets
 * them pick which storefront a Checkout/Invoice/Quotation document belongs to instead of being
 * flatly blocked (see sale-service.ts's requireActiveSession for the backend half of this). Kept
 * inline in the same form rather than a separate "pick first" screen, so nobody loses cart/form
 * progress switching between them.
 */
export function StorefrontPicker({ value, onChange }: { value: string; onChange: (locationId: string) => void }): React.JSX.Element {
  const [locations, setLocations] = useState<Location[] | null>(null);

  useEffect(() => {
    void window.blueLedger.location.list().then((list) => {
      setLocations(list.filter((location) => location.status === "active" && isStorefrontType(location.locationType)));
    });
  }, []);

  return (
    <div className="rounded-lg border border-dashed border-warning/50 bg-warning/10 p-4">
      <div className="flex items-center gap-2">
        <Store className="size-4 flex-none text-warning" aria-hidden="true" />
        <p className="text-xs font-bold text-ink">Your account has no assigned branch — choose a storefront for this document.</p>
      </div>
      <SelectField
        label="Storefront"
        value={value}
        onChange={onChange}
        options={[
          { value: "", label: locations === null ? "Loading…" : "Select a storefront" },
          ...(locations ?? []).map((location) => ({ value: location.id, label: location.locationName }))
        ]}
        className="mt-2 max-w-xs"
      />
    </div>
  );
}
