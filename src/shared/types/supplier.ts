export type SupplierId = string;

export const SUPPLIER_PAYMENT_OPTION_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "other", label: "Other" }
] as const;

export type SupplierPaymentOption = (typeof SUPPLIER_PAYMENT_OPTION_OPTIONS)[number]["value"];

export const SUPPLIER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" }
] as const;

export type SupplierStatus = (typeof SUPPLIER_STATUS_OPTIONS)[number]["value"];

export type SupplierSyncStatus = "pending" | "synced" | "syncing" | "error";

export type SupplierInputFields = {
  businessName: string;
  contactPerson: string | null;
  phone1: string;
  phone2: string | null;
  email: string | null;
  kraPin: string | null;
  website: string | null;
  country: string | null;
  county: string | null;
  town: string | null;
  physicalAddress: string | null;
  paymentOption: SupplierPaymentOption;
  mpesaName: string | null;
  mpesaNumber: string | null;
  mpesaAlternativeNumber: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  creditLimitCents: number | null;
  notes: string | null;
};

/** The master list of businesses products are purchased from — never deleted, only deactivated, since
 * future Purchases and inventory records will reference a supplier by id. */
export type Supplier = SupplierInputFields & {
  id: SupplierId;
  tenantId: string;
  /** Auto-generated at creation (e.g. SUP-000001) and never editable afterward. */
  supplierCode: string;
  status: SupplierStatus;
  createdAt: string;
  updatedAt: string;
  syncStatus: SupplierSyncStatus;
  lastSyncedAt: string | null;
};
