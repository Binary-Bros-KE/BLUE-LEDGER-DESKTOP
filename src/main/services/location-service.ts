import { randomUUID } from "node:crypto";
import * as locationRepository from "@main/database/repositories/location-repository";
import { getCurrentEmployeeId, requirePermission, requireSignedIn } from "@main/services/auth-service";
import { deleteManagedLocationLogo } from "@main/services/image-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { locationInputSchema } from "@shared/schemas/location";
import type { Location, LocationStatus } from "@shared/types/location";

/** Every signed-in employee can read the list — storefronts are needed anywhere a destination/branch
 * must be picked (stock transfers, the Main Store view, etc.), which is already gated by its own
 * permission. Managing locations (create/edit/status) below remains gated behind "locations". */
export function listLocations(): Location[] {
  requireSignedIn();
  const { tenantId } = getCurrentTenant();
  return locationRepository.findAllLocationRows(tenantId).map(locationRepository.mapLocationRow);
}

export function getLocation(id: string): Location {
  requireSignedIn();
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

/**
 * Every tenant gets exactly one Main Store automatically — it's never created through the Storefronts
 * screen (storefronts can only be sell-only types). Safe every boot: a no-op once a distribution-center
 * location already exists for this tenant.
 */
export function ensureMainStoreLocation(tenantId: string): void {
  const existing = locationRepository
    .findAllLocationRows(tenantId)
    .find((row) => row.location_type === "distribution_center");
  if (existing) return;

  locationRepository.insertLocationRow({
    id: `location_${randomUUID()}`,
    tenantId,
    locationName: "Main Store",
    locationCode: "MAIN-STORE",
    locationType: "distribution_center",
    logoPath: null,
    logoRatio: null,
    phone: null,
    alternativePhone: null,
    email: null,
    country: null,
    county: null,
    city: null,
    physicalAddress: null,
    managerName: null,
    managerPhone: null,
    managerEmail: null,
    openingTime: null,
    closingTime: null,
    description: "Central stock — receives and distributes products to storefronts.",
    receiptHeader: null,
    receiptFooter: null,
    invoiceHeader: null,
    invoiceFooter: null,
    quotationHeader: null,
    quotationFooter: null,
    showProductImagesOnInvoices: false,
    showProductImagesOnQuotations: false,
    defaultIncludeBusinessInfo: true,
    canReceiveStock: true,
    canSellStock: false,
    canTransferStock: true,
    createdBy: null
  });
}
