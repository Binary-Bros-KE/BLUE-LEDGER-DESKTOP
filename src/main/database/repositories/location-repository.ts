import { getDatabase } from "@main/database/connection";
import type { LocationInput } from "@shared/schemas/location";
import type { Location, LocationStatus, LocationSyncStatus, LocationType } from "@shared/types/location";
import type { LogoRatio } from "@shared/types/logo";

export type LocationRow = {
  id: string;
  tenant_id: string;
  location_code: string;
  location_name: string;
  display_name: string | null;
  location_type: string;
  logo_path: string | null;
  logo_ratio: string | null;
  phone: string | null;
  alternative_phone: string | null;
  email: string | null;
  country: string | null;
  county: string | null;
  city: string | null;
  physical_address: string | null;
  building_name: string | null;
  floor_room: string | null;
  postal_address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_maps_link: string | null;
  manager_name: string | null;
  manager_phone: string | null;
  manager_email: string | null;
  opening_time: string | null;
  closing_time: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  working_days: string | null;
  default_tax_rate: number | null;
  allow_negative_stock: number;
  price_level: string | null;
  is_inventory_location: number;
  can_receive_stock: number;
  can_sell_stock: number;
  can_transfer_stock: number;
  status: string;
  description: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  sync_status: string;
  last_synced_at: string | null;
};

export function findAllLocationRows(tenantId: string): LocationRow[] {
  return getDatabase()
    .prepare("SELECT * FROM locations WHERE tenant_id = ? ORDER BY created_at ASC")
    .all(tenantId) as LocationRow[];
}

export function findLocationRowById(id: string): LocationRow | undefined {
  return getDatabase().prepare("SELECT * FROM locations WHERE id = ?").get(id) as
    | LocationRow
    | undefined;
}

/** The tenant's one Main Store (warehouse/distribution-center type) — never a sell-only storefront. */
export function findMainStoreLocationRow(tenantId: string): LocationRow | undefined {
  return getDatabase()
    .prepare(
      "SELECT * FROM locations WHERE tenant_id = ? AND location_type = 'distribution_center' LIMIT 1"
    )
    .get(tenantId) as LocationRow | undefined;
}

export function insertLocationRow(
  input: LocationInput & { id: string; tenantId: string; createdBy: string | null }
): LocationRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO locations (
        id, tenant_id, location_code, location_name, location_type, logo_path, logo_ratio,
        phone, alternative_phone, email, country, county, city, physical_address,
        manager_name, manager_phone, manager_email, opening_time, closing_time,
        description, receipt_header, receipt_footer, can_receive_stock, can_sell_stock, can_transfer_stock,
        status, created_at, updated_at, created_by, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.locationCode,
      input.locationName,
      input.locationType,
      input.logoPath,
      input.logoRatio,
      input.phone,
      input.alternativePhone,
      input.email,
      input.country,
      input.county,
      input.city,
      input.physicalAddress,
      input.managerName,
      input.managerPhone,
      input.managerEmail,
      input.openingTime,
      input.closingTime,
      input.description,
      input.receiptHeader,
      input.receiptFooter,
      input.canReceiveStock ? 1 : 0,
      input.canSellStock ? 1 : 0,
      input.canTransferStock ? 1 : 0,
      now,
      now,
      input.createdBy
    );

  const row = findLocationRowById(input.id);
  if (!row) {
    throw new Error("Failed to create location record");
  }
  return row;
}

export function updateLocationRow(
  id: string,
  input: LocationInput & { updatedBy: string | null }
): LocationRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE locations SET
        location_code = ?,
        location_name = ?,
        location_type = ?,
        logo_path = ?,
        logo_ratio = ?,
        phone = ?,
        alternative_phone = ?,
        email = ?,
        country = ?,
        county = ?,
        city = ?,
        physical_address = ?,
        manager_name = ?,
        manager_phone = ?,
        manager_email = ?,
        opening_time = ?,
        closing_time = ?,
        description = ?,
        receipt_header = ?,
        receipt_footer = ?,
        can_receive_stock = ?,
        can_sell_stock = ?,
        can_transfer_stock = ?,
        updated_by = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.locationCode,
      input.locationName,
      input.locationType,
      input.logoPath,
      input.logoRatio,
      input.phone,
      input.alternativePhone,
      input.email,
      input.country,
      input.county,
      input.city,
      input.physicalAddress,
      input.managerName,
      input.managerPhone,
      input.managerEmail,
      input.openingTime,
      input.closingTime,
      input.description,
      input.receiptHeader,
      input.receiptFooter,
      input.canReceiveStock ? 1 : 0,
      input.canSellStock ? 1 : 0,
      input.canTransferStock ? 1 : 0,
      input.updatedBy,
      now,
      id
    );

  const row = findLocationRowById(id);
  if (!row) {
    throw new Error("Location not found after update");
  }
  return row;
}

export function setLocationStatusRow(id: string, status: LocationStatus): LocationRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      "UPDATE locations SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?"
    )
    .run(status, now, id);

  const row = findLocationRowById(id);
  if (!row) {
    throw new Error("Location not found after status update");
  }
  return row;
}

export function mapLocationRow(row: LocationRow): Location {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    locationCode: row.location_code,
    locationName: row.location_name,
    displayName: row.display_name,
    locationType: row.location_type as LocationType,
    logoPath: row.logo_path,
    logoRatio: row.logo_ratio as LogoRatio | null,
    phone: row.phone,
    alternativePhone: row.alternative_phone,
    email: row.email,
    country: row.country,
    county: row.county,
    city: row.city,
    physicalAddress: row.physical_address,
    buildingName: row.building_name,
    floorRoom: row.floor_room,
    postalAddress: row.postal_address,
    latitude: row.latitude,
    longitude: row.longitude,
    googleMapsLink: row.google_maps_link,
    managerName: row.manager_name,
    managerPhone: row.manager_phone,
    managerEmail: row.manager_email,
    openingTime: row.opening_time,
    closingTime: row.closing_time,
    receiptHeader: row.receipt_header,
    receiptFooter: row.receipt_footer,
    workingDays: row.working_days,
    defaultTaxRate: row.default_tax_rate,
    allowNegativeStock: Boolean(row.allow_negative_stock),
    priceLevel: row.price_level,
    isInventoryLocation: Boolean(row.is_inventory_location),
    canReceiveStock: Boolean(row.can_receive_stock),
    canSellStock: Boolean(row.can_sell_stock),
    canTransferStock: Boolean(row.can_transfer_stock),
    status: row.status as LocationStatus,
    description: row.description,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    syncStatus: row.sync_status as LocationSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}
