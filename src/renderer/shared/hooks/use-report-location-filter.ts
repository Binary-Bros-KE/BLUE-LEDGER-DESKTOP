import { useEffect, useState } from "react";
import { useAuthStore } from "@renderer/shared/stores/auth-store";
import { isStorefrontType } from "@shared/types/location";
import type { Location } from "@shared/types/location";

export type ReportLocationFilter = {
  /** True only for a session with no assigned branch (Super Admin) — a branch-scoped session's
   * reports are always their own branch server-side regardless of this hook, so the dropdown
   * would be misleading noise for them and stays hidden. */
  canFilter: boolean;
  locations: Location[] | null;
  locationId: string | null;
  setLocationId: (locationId: string | null) => void;
};

/** Powers the optional storefront dropdown on every Reports tab — lets a Super Admin narrow a
 * report to one storefront instead of always seeing every location combined. */
export function useReportLocationFilter(): ReportLocationFilter {
  const session = useAuthStore((state) => state.session);
  const canFilter = session !== null && session.branch === null;
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);

  useEffect(() => {
    if (!canFilter) return;
    void window.blueLedger.location.list().then((list) => {
      setLocations(list.filter((location) => location.status === "active" && isStorefrontType(location.locationType)));
    });
  }, [canFilter]);

  return { canFilter, locations, locationId, setLocationId };
}
