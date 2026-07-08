import { randomUUID } from "node:crypto";
import * as locationRepository from "@main/database/repositories/location-repository";
import { getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { deleteManagedLocationLogo } from "@main/services/image-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { locationInputSchema } from "@shared/schemas/location";
import type { Location, LocationStatus } from "@shared/types/location";

export function listLocations(): Location[] {
  requirePermission("locations", "view");
  const { tenantId } = getCurrentTenant();
  return locationRepository.findAllLocationRows(tenantId).map(locationRepository.mapLocationRow);
}

export function getLocation(id: string): Location {
  requirePermission("locations", "view");
  const row = locationRepository.findLocationRowById(id);
  if (!row) {
    throw new Error("Location not found");
  }
  return locationRepository.mapLocationRow(row);
}

export function createLocation(input: unknown): Location {
  requirePermission("locations", "create");
  const parsed = locationInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const row = locationRepository.insertLocationRow({
    ...parsed,
    id: `location_${randomUUID()}`,
    tenantId,
    createdBy: getCurrentEmployeeId()
  });
  return locationRepository.mapLocationRow(row);
}

export function updateLocation(id: string, input: unknown): Location {
  requirePermission("locations", "edit");
  const parsed = locationInputSchema.parse(input);
  const existing = locationRepository.findLocationRowById(id);

  const row = locationRepository.updateLocationRow(id, { ...parsed, updatedBy: getCurrentEmployeeId() });

  if (existing?.logo_path && existing.logo_path !== parsed.logoPath) {
    deleteManagedLocationLogo(existing.logo_path);
  }

  return locationRepository.mapLocationRow(row);
}

export function setLocationStatus(id: string, status: LocationStatus): Location {
  requirePermission("locations", "edit");
  const row = locationRepository.setLocationStatusRow(id, status);
  return locationRepository.mapLocationRow(row);
}
