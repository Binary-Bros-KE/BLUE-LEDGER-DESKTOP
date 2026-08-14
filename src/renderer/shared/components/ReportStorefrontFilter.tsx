import { Store } from "lucide-react";
import type { ReportLocationFilter } from "@renderer/shared/hooks/use-report-location-filter";

/** Only renders for a Super Admin (see useReportLocationFilter) — everyone else's reports are
 * already scoped to their own branch, so there's nothing to pick. */
export function ReportStorefrontFilter({ filter }: { filter: ReportLocationFilter }): React.JSX.Element | null {
  if (!filter.canFilter) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5">
      <Store className="size-3.5 flex-none text-muted" aria-hidden="true" />
      <select
        value={filter.locationId ?? ""}
        onChange={(event) => filter.setLocationId(event.target.value === "" ? null : event.target.value)}
        className="border-none bg-transparent text-xs font-bold text-ink outline-none cursor-pointer"
      >
        <option value="">All Storefronts</option>
        {(filter.locations ?? []).map((location) => (
          <option key={location.id} value={location.id}>
            {location.locationName}
          </option>
        ))}
      </select>
    </div>
  );
}
