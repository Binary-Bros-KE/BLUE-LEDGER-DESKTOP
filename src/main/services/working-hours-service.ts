import * as locationRepository from "@main/database/repositories/location-repository";
import * as workingHoursRepository from "@main/database/repositories/working-hours-repository";
import { getCurrentBranchScope, getCurrentIsSuperAdmin, requireSignedIn, requireSuperAdmin } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { workingHoursInputSchema } from "@shared/schemas/working-hours";
import { computeWorkingHoursLockStatus, type WorkingHoursLockStatus } from "@shared/lib/working-hours-lock";
import { isStorefrontType, type LocationType } from "@shared/types/location";
import type { WorkingHours, WorkingHoursStorefrontEntry } from "@shared/types/working-hours";

/** Every storefront, joined with its own WorkingHours row if one exists — a storefront that's never
 * been configured comes back with `config: null` (always-open, matches
 * computeWorkingHoursLockStatus's own "no config means never locked" rule). Backs the Working Hours
 * settings screen's storefront picker. Super-Admin-only, same as every other function here except
 * getMyLockStatus (which every signed-in employee needs to call on their own behalf). */
export function listWorkingHours(): WorkingHoursStorefrontEntry[] {
  requireSuperAdmin();
  const { tenantId } = getCurrentTenant();
  const storefronts = locationRepository
    .findAllLocationRows(tenantId)
    .filter((row) => isStorefrontType(row.location_type as LocationType));
  const rows = workingHoursRepository.findAllWorkingHoursRows(tenantId);
  const rowByLocationId = new Map(rows.map((row) => [row.location_id, row]));

  return storefronts.map((location) => {
    const row = rowByLocationId.get(location.id);
    return {
      locationId: location.id,
      locationName: location.location_name,
      config: row ? workingHoursRepository.mapWorkingHoursRow(row) : null
    };
  });
}

export function getWorkingHours(locationId: string): WorkingHours | null {
  requireSuperAdmin();
  const { tenantId } = getCurrentTenant();
  const row = workingHoursRepository.findWorkingHoursRowByLocationId(tenantId, locationId);
  return row ? workingHoursRepository.mapWorkingHoursRow(row) : null;
}

/** Upserts the one WorkingHours row for this storefront — created on first save, updated
 * thereafter (see the model's own doc comment: never boot-seeded, one row per storefront by
 * application-level convention, enforced here locally by a real UNIQUE(tenant_id, location_id)). */
export function upsertWorkingHours(locationId: string, input: unknown): WorkingHours {
  requireSuperAdmin();
  const parsed = workingHoursInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  const location = locationRepository.findLocationRowById(locationId);
  if (!location || location.tenant_id !== tenantId) {
    throw new Error("Storefront not found");
  }

  const existing = workingHoursRepository.findWorkingHoursRowByLocationId(tenantId, locationId);
  const row = existing
    ? workingHoursRepository.updateWorkingHoursRow(existing.id, parsed)
    : workingHoursRepository.insertWorkingHoursRow(tenantId, locationId, parsed);
  return workingHoursRepository.mapWorkingHoursRow(row);
}

/** The one-tap emergency lock/unlock — only meaningful once a storefront already has a WorkingHours
 * row in "manual" mode; there's nothing to toggle for a storefront that's never been configured, so
 * this deliberately does NOT create one. */
export function setManualLock(locationId: string, locked: boolean): WorkingHours {
  requireSuperAdmin();
  const { tenantId } = getCurrentTenant();
  const existing = workingHoursRepository.findWorkingHoursRowByLocationId(tenantId, locationId);
  if (!existing) {
    throw new Error("Set up working hours for this storefront before using manual lock.");
  }
  const row = workingHoursRepository.setWorkingHoursManualLockRow(existing.id, locked);
  return workingHoursRepository.mapWorkingHoursRow(row);
}

/**
 * The signed-in employee's OWN lock status, right now — this is what App.tsx's gate polls (via IPC)
 * on its recurring interval. Every signed-in employee can call this (not Super-Admin-gated — the
 * whole point is telling a NON-Super-Admin whether they're currently locked out). A Super Admin
 * always gets `{ locked: false }` regardless of the storefront's own config; a branch-less employee
 * (no storefront to check) is likewise never locked.
 */
export function getMyLockStatus(): WorkingHoursLockStatus {
  requireSignedIn();
  if (getCurrentIsSuperAdmin()) return { locked: false };

  const branchId = getCurrentBranchScope();
  if (!branchId) return { locked: false };

  const { tenantId } = getCurrentTenant();
  const row = workingHoursRepository.findWorkingHoursRowByLocationId(tenantId, branchId);
  return computeWorkingHoursLockStatus(row ? workingHoursRepository.mapWorkingHoursRow(row) : null);
}
