import type { LogoRatio } from "./logo";

export type LocationId = string;

export const LOCATION_TYPE_OPTIONS = [
  { value: "warehouse", label: "Warehouse" },
  { value: "retail_store", label: "Retail Store" },
  { value: "wholesale_store", label: "Wholesale Store" },
  { value: "retail_and_wholesale", label: "Retail & Wholesale" },
  { value: "distribution_center", label: "Distribution Center" }
] as const;

export type LocationType = (typeof LOCATION_TYPE_OPTIONS)[number]["value"];

/**
 * The subset of location types selectable when creating/editing a storefront — storefronts can only
 * sell. "warehouse" and "distribution_center" are reserved for the Main Store, which is provisioned
 * automatically per tenant and isn't created through the Storefronts screen.
 */
export const STOREFRONT_TYPE_OPTIONS = LOCATION_TYPE_OPTIONS.filter(
  (option) => option.value !== "warehouse" && option.value !== "distribution_center"
);

/** True for a storefront (sells to customers) as opposed to the Main Store (warehouse/distribution). */
export function isStorefrontType(locationType: LocationType): boolean {
  return locationType !== "warehouse" && locationType !== "distribution_center";
}

export type LocationStatus = "active" | "inactive";
export type LocationSyncStatus = "pending" | "synced" | "syncing" | "error";

/** Fields exposed in the create/edit form. */
export type LocationInputFields = {
  locationName: string;
  locationCode: string;
  locationType: LocationType;
  logoPath: string | null;
  logoRatio: LogoRatio | null;
  phone: string | null;
  alternativePhone: string | null;
  email: string | null;
  country: string | null;
  county: string | null;
  city: string | null;
  physicalAddress: string | null;
  managerName: string | null;
  managerPhone: string | null;
  managerEmail: string | null;
  openingTime: string | null;
  closingTime: string | null;
  description: string | null;
  /** Shown on this storefront's own receipts/invoices/quotations instead of the tenant-wide default —
   * each storefront is its own point of sale with its own identity on customer-facing documents. */
  receiptHeader: string | null;
  receiptFooter: string | null;
  canReceiveStock: boolean;
  canSellStock: boolean;
  canTransferStock: boolean;
};

/**
 * Full location record. Includes columns not yet exposed in the UI
 * (display name, geocoding, tax/pricing, working days, notes) so the
 * table can support future inventory/transfer/reporting features without
 * a schema change.
 */
export type Location = LocationInputFields & {
  id: LocationId;
  tenantId: string;
  displayName: string | null;
  buildingName: string | null;
  floorRoom: string | null;
  postalAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsLink: string | null;
  workingDays: string | null;
  defaultTaxRate: number | null;
  allowNegativeStock: boolean;
  priceLevel: string | null;
  isInventoryLocation: boolean;
  status: LocationStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  syncStatus: LocationSyncStatus;
  lastSyncedAt: string | null;
};
