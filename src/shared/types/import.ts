import { CUSTOMER_TYPE_OPTIONS } from "@shared/types/customer";
import { UNIT_OF_MEASURE_OPTIONS } from "@shared/types/product";
import { SUPPLIER_PAYMENT_OPTION_OPTIONS } from "@shared/types/supplier";

export type ImportEntityType = "products" | "customers" | "suppliers";

export const IMPORT_ENTITY_OPTIONS: Array<{ value: ImportEntityType; label: string }> = [
  { value: "products", label: "Products" },
  { value: "customers", label: "Customers" },
  { value: "suppliers", label: "Suppliers" }
];

/** How a mapped column's raw text gets parsed/resolved. "category"/"storefront" resolve a plain
 * name (typed in the spreadsheet) to an internal id via a name lookup — see import-service.ts.
 * "stockQuantity" is Products-only and depends on "storefront" having already resolved earlier in
 * the same field list (see PRODUCT_FIELDS' own ordering comment) — it turns into the same
 * `openingStock: [{locationId, quantity}]` shape createProduct's own "New Product" form already
 * sends, so an imported row gets real stock the exact same way a manually-created product does.
 * "mainStoreStock" is the same idea but for stock sitting at the tenant's Main Store instead of a
 * storefront — it depends on "mainStoreStockAllocation" (a plain "enum") having already resolved
 * earlier in the same field list, and (only when that choice is "allocated") on "storefront" too,
 * since "allocated" means earmarked for whichever storefront that field resolved to. Appends a
 * SECOND `openingStock` entry (targeting Main Store's own location id) alongside whatever
 * "stockQuantity" already added for the storefront — a product can arrive with stock at both. */
export type ImportFieldKind = "text" | "number" | "money" | "boolean" | "enum" | "category" | "storefront" | "stockQuantity" | "mainStoreStock";

export type ImportFieldDefinition = {
  /** Matches the underlying create-schema's own field name (sku, name, buyingPriceCents, ...). */
  key: string;
  label: string;
  required: boolean;
  kind: ImportFieldKind;
  /** Human-readable header variants used to seed a best-guess column mapping — matched against the
   * file's own headers after both sides are normalized (lowercased, non-alphanumerics stripped). */
  aliases: string[];
  /** Only set for kind "enum" — the accepted values, shown in the mapping UI and used to normalize
   * a cell's text (matched against either .value or .label, case/punctuation-insensitively). */
  enumOptions?: ReadonlyArray<{ value: string; label: string }>;
};

/** Whether stock recorded at Main Store (via "mainStoreStockQuantity") sits in the general
 * "unallocated" bucket or is earmarked for the row's own resolved storefront — the exact same two
 * states the Main Store screen's own allocation breakdown already tracks. */
const MAIN_STORE_STOCK_ALLOCATION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "unallocated", label: "Unallocated (sitting at Main Store)" },
  { value: "allocated", label: "Allocated to the Storefront above" }
];

const PRODUCT_FIELDS: ImportFieldDefinition[] = [
  // Not required — same as the "New Product" form, a blank cell gets an auto-generated "PROD-..."
  // SKU at import time (see import-service.ts's buildRowCandidate) instead of blocking the row.
  { key: "sku", label: "SKU", required: false, kind: "text", aliases: ["sku", "product code", "item code"] },
  { key: "name", label: "Product Name", required: true, kind: "text", aliases: ["name", "product name", "item name"] },
  { key: "category", label: "Category", required: false, kind: "category", aliases: ["category", "product category"] },
  { key: "storefront", label: "Storefront", required: false, kind: "storefront", aliases: ["storefront", "location", "branch", "store"] },
  // Must come AFTER "storefront" above — buildRowCandidate resolves fields in this exact array
  // order, and this one reads candidate.storefrontId (already resolved by "storefront"'s own case)
  // to know which location the imported quantity belongs to.
  { key: "openingStockQuantity", label: "Stock Quantity (At Hand)", required: false, kind: "stockQuantity", aliases: ["stock", "stock quantity", "quantity", "qty", "quantity in stock", "at hand", "stock on hand", "current stock", "opening stock"] },
  // Must come AFTER "storefront" and BEFORE "mainStoreStockQuantity" — see that field's own
  // ordering comment. A plain enum field otherwise (no custom parsing case needed).
  { key: "mainStoreStockAllocation", label: "Store Stock Allocation", required: false, kind: "enum", aliases: ["allocation", "store stock allocation", "allocation status", "store stock status"], enumOptions: MAIN_STORE_STOCK_ALLOCATION_OPTIONS },
  // Must come AFTER both "storefront" and "mainStoreStockAllocation" above — buildRowCandidate
  // resolves fields in this exact array order, and this one reads candidate.mainStoreStockAllocation
  // (and, only when that's "allocated", candidate.storefrontId) to know which allocation bucket at
  // Main Store the quantity belongs in.
  { key: "mainStoreStockQuantity", label: "Store Stock (At Main Store)", required: false, kind: "mainStoreStock", aliases: ["store stock", "warehouse stock", "main store stock", "stock in store", "stock at store", "store quantity", "warehouse quantity", "hq stock"] },
  // Nullable/optional on purpose — a lot of real import files (especially migrated from another
  // system) never tracked this at all, and there's no safe value to guess on their behalf.
  { key: "unitOfMeasure", label: "Unit of Measure", required: false, kind: "enum", aliases: ["unit of measure", "uom", "unit", "units"], enumOptions: UNIT_OF_MEASURE_OPTIONS },
  { key: "buyingPriceCents", label: "Buying Price", required: true, kind: "money", aliases: ["buying price", "cost price", "purchase price"] },
  { key: "sellingPriceCents", label: "Selling Price", required: true, kind: "money", aliases: ["selling price", "price", "retail price"] },
  { key: "wholesalePriceCents", label: "Wholesale Price", required: false, kind: "money", aliases: ["wholesale price"] },
  { key: "wholesaleMinQuantity", label: "Wholesale Min Quantity", required: false, kind: "number", aliases: ["wholesale min qty", "wholesale minimum quantity"] },
  { key: "minimumPriceCents", label: "Minimum Price", required: false, kind: "money", aliases: ["minimum price", "min price", "floor price"] },
  { key: "taxRate", label: "Tax Rate (%)", required: false, kind: "number", aliases: ["tax rate", "tax", "vat", "vat rate"] },
  { key: "reorderLevel", label: "Reorder Level", required: false, kind: "number", aliases: ["reorder level", "reorder point", "low stock level"] },
  { key: "trackStock", label: "Track Stock", required: false, kind: "boolean", aliases: ["track stock", "manage stock"] },
  { key: "allowNegativeStock", label: "Allow Negative Stock", required: false, kind: "boolean", aliases: ["allow negative stock", "allow negative"] },
  { key: "barcode", label: "Barcode", required: false, kind: "text", aliases: ["barcode", "bar code"] },
  { key: "supplierSku", label: "Supplier SKU", required: false, kind: "text", aliases: ["supplier sku", "supplier code", "vendor sku"] },
  { key: "shortName", label: "Short Name", required: false, kind: "text", aliases: ["short name"] },
  { key: "description", label: "Description", required: false, kind: "text", aliases: ["description", "details"] }
];

const CUSTOMER_FIELDS: ImportFieldDefinition[] = [
  { key: "name", label: "Customer Name", required: true, kind: "text", aliases: ["name", "customer name", "full name"] },
  { key: "phone", label: "Phone", required: true, kind: "text", aliases: ["phone", "phone number", "mobile", "contact"] },
  { key: "customerType", label: "Customer Type", required: true, kind: "enum", aliases: ["customer type", "type"], enumOptions: CUSTOMER_TYPE_OPTIONS },
  { key: "email", label: "Email", required: false, kind: "text", aliases: ["email", "email address"] },
  { key: "physicalAddress", label: "Address", required: false, kind: "text", aliases: ["address", "physical address"] },
  { key: "creditLimitCents", label: "Credit Limit", required: false, kind: "money", aliases: ["credit limit"] },
  { key: "notes", label: "Notes", required: false, kind: "text", aliases: ["notes", "remarks", "comment"] }
];

const SUPPLIER_FIELDS: ImportFieldDefinition[] = [
  { key: "businessName", label: "Business Name", required: true, kind: "text", aliases: ["business name", "company name", "supplier name", "name"] },
  { key: "phone1", label: "Phone", required: true, kind: "text", aliases: ["phone", "phone1", "phone number", "primary phone", "contact"] },
  { key: "paymentOption", label: "Payment Option", required: true, kind: "enum", aliases: ["payment option", "payment method", "preferred payment"], enumOptions: SUPPLIER_PAYMENT_OPTION_OPTIONS },
  { key: "contactPerson", label: "Contact Person", required: false, kind: "text", aliases: ["contact person", "contact name"] },
  { key: "phone2", label: "Alternative Phone", required: false, kind: "text", aliases: ["phone2", "alternative phone", "secondary phone"] },
  { key: "email", label: "Email", required: false, kind: "text", aliases: ["email", "email address"] },
  { key: "website", label: "Website", required: false, kind: "text", aliases: ["website", "url"] },
  { key: "country", label: "Country", required: false, kind: "text", aliases: ["country"] },
  { key: "county", label: "County", required: false, kind: "text", aliases: ["county", "region", "state"] },
  { key: "town", label: "Town", required: false, kind: "text", aliases: ["town", "city"] },
  { key: "physicalAddress", label: "Address", required: false, kind: "text", aliases: ["address", "physical address"] },
  { key: "mpesaName", label: "M-Pesa Name", required: false, kind: "text", aliases: ["mpesa name", "m-pesa name"] },
  { key: "mpesaNumber", label: "M-Pesa Number", required: false, kind: "text", aliases: ["mpesa number", "m-pesa number", "mpesa"] },
  { key: "mpesaAlternativeNumber", label: "M-Pesa Alternative Number", required: false, kind: "text", aliases: ["mpesa alternative number", "alternative mpesa"] },
  { key: "bankName", label: "Bank Name", required: false, kind: "text", aliases: ["bank name", "bank"] },
  { key: "bankAccountName", label: "Bank Account Name", required: false, kind: "text", aliases: ["bank account name", "account name"] },
  { key: "bankAccountNumber", label: "Bank Account Number", required: false, kind: "text", aliases: ["bank account number", "account number"] },
  { key: "creditLimitCents", label: "Credit Limit", required: false, kind: "money", aliases: ["credit limit"] },
  { key: "notes", label: "Notes", required: false, kind: "text", aliases: ["notes", "remarks", "comment"] }
];

export const IMPORT_FIELD_DEFINITIONS: Record<ImportEntityType, ImportFieldDefinition[]> = {
  products: PRODUCT_FIELDS,
  customers: CUSTOMER_FIELDS,
  suppliers: SUPPLIER_FIELDS
};

/** Result of picking + parsing a file — never a raw file path, only the parsed content (see
 * import-service.ts's pickImportFile, which mirrors image-service.ts's file-picking convention). */
export type ImportParsedFile = {
  fileName: string;
  headers: string[];
  rows: Array<Record<string, string>>;
};

/** Target field key -> source header string, or null if that field isn't mapped to any column. */
export type ImportColumnMapping = Record<string, string | null>;

/** Target field key -> a fixed value applied to EVERY row when that field isn't mapped to a source
 * column at all (a real-world import file usually just doesn't have a "storefront" column — every
 * row in the file is for the one shop it came from). Only meaningful for "boolean" kind fields
 * (stores "true"/"false", parsed the same way a mapped cell would be) and "storefront" kind fields
 * (stores a real Location id chosen from a picker, used directly — never re-resolved by name).
 * Ignored for every other field kind. See import-service.ts's buildRowCandidate for how this is
 * consulted — only in the same "blank" branch a genuinely-unmapped/empty-cell field already hits,
 * so this is a pure fallback, never overrides real column data. */
export type ImportFieldDefaults = Record<string, string>;

export type ImportPreviewRequest = {
  entityType: ImportEntityType;
  rows: Array<Record<string, string>>;
  columnMapping: ImportColumnMapping;
  fieldDefaults: ImportFieldDefaults;
  /** Off by default — money columns are assumed to hold plain decimal amounts (e.g. "150.00"),
   * matching how anyone typing prices into a spreadsheet actually writes them. Turn on only for a
   * file whose money columns already hold raw integer cents (e.g. a direct export of Blue Ledger's
   * own *_cents database columns) — otherwise every amount gets multiplied by 100 twice. */
  moneyInCents: boolean;
};

/** Identical envelope to the preview request, on purpose — commit re-resolves against the live DB
 * on the exact same code path as preview, so it never trusts a client-supplied "this row is valid"
 * flag (see import-service.ts's resolveImportRows). */
export type ImportCommitRequest = ImportPreviewRequest;

export type ImportRowAction = "create" | "update" | "error";

export type ImportPreviewRow = {
  /** 1-based index into the submitted `rows` array (header row excluded). */
  rowNumber: number;
  action: ImportRowAction;
  /** Existing record id, set only when action === "update". */
  matchedId: string | null;
  /** Resolved natural key (sku / phone / businessName) — shown in the preview table. */
  naturalKey: string | null;
  displayName: string | null;
  /** Always empty unless action === "error" — can hold more than one message per row. */
  errors: string[];
};

export type ImportPreviewResult = {
  /** Non-empty ONLY when a required field has no column mapped at all — in that case `rows` is
   * empty and the user needs to fix the mapping before any row-level preview makes sense. */
  mappingErrors: string[];
  rows: ImportPreviewRow[];
  summary: { toCreate: number; toUpdate: number; invalid: number; total: number };
};

export type ImportCommitResult = {
  created: number;
  updated: number;
  /** Rows that resolved as "error" during preview — never attempted. */
  skipped: number;
  /** Rows that were attempted (create/update) but threw at commit time. */
  failed: number;
  errors: Array<{ rowNumber: number; message: string }>;
};
