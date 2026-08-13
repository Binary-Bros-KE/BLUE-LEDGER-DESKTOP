import { basename, extname } from "node:path";
import electron from "electron";
import ExcelJS from "exceljs";
import * as categoryRepository from "@main/database/repositories/category-repository";
import * as customerRepository from "@main/database/repositories/customer-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as supplierRepository from "@main/database/repositories/supplier-repository";
import { requirePermission } from "@main/services/auth-service";
import { createCategory } from "@main/services/category-service";
import { createCustomer, updateCustomer } from "@main/services/customer-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { createProduct, updateProduct } from "@main/services/product-service";
import { createSupplier, updateSupplier } from "@main/services/supplier-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { importCommitRequestSchema, importPreviewRequestSchema } from "@shared/schemas/import";
import { CATEGORY_COLOR_SWATCHES } from "@shared/types/category";
import { customerInputSchema } from "@shared/schemas/customer";
import { productCreateSchema } from "@shared/schemas/product";
import { supplierInputSchema } from "@shared/schemas/supplier";
import {
  IMPORT_ENTITY_OPTIONS,
  IMPORT_FIELD_DEFINITIONS,
  type ImportColumnMapping,
  type ImportCommitResult,
  type ImportEntityType,
  type ImportFieldDefaults,
  type ImportFieldDefinition,
  type ImportParsedFile,
  type ImportPreviewResult,
  type ImportPreviewRow,
  type ImportRowAction
} from "@shared/types/import";

const { dialog } = electron;

const ENTITY_CREATE_SCHEMA = {
  products: productCreateSchema,
  customers: customerInputSchema,
  suppliers: supplierInputSchema
};

const NATURAL_KEY_FIELD: Record<ImportEntityType, string> = {
  products: "sku",
  customers: "phone",
  suppliers: "businessName"
};

const NATURAL_KEY_LABEL: Record<ImportEntityType, string> = {
  products: "SKU",
  customers: "phone number",
  suppliers: "business name"
};

const DISPLAY_NAME_FIELD: Record<ImportEntityType, string> = {
  products: "name",
  customers: "name",
  suppliers: "businessName"
};

/** Opens a native file picker (main-process only — the renderer never sees a raw file path, same
 * convention as image-service.ts's pickAndStore) and parses the whole file into plain header/row
 * text. exceljs already reads both formats — no new dependency. */
export async function pickImportFile(entityType: ImportEntityType): Promise<ImportParsedFile | null> {
  requirePermission("data_import", "view");
  const entityLabel = IMPORT_ENTITY_OPTIONS.find((option) => option.value === entityType)?.label ?? entityType;

  const result = await dialog.showOpenDialog({
    title: `Select file to import ${entityLabel} from`,
    properties: ["openFile"],
    filters: [{ name: "Spreadsheets", extensions: ["csv", "xlsx"] }]
  });
  const [filePath] = result.filePaths;
  if (result.canceled || !filePath) {
    return null;
  }

  const isCsv = extname(filePath).toLowerCase() === ".csv";
  let worksheet: ExcelJS.Worksheet;
  if (isCsv) {
    worksheet = await new ExcelJS.Workbook().csv.readFile(filePath);
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("Couldn't find a sheet in that file");
    worksheet = sheet;
  }

  const columnCount = worksheet.columnCount || worksheet.getRow(1).cellCount;
  const headers: string[] = [];
  for (let col = 1; col <= columnCount; col++) {
    headers.push(String(worksheet.getRow(1).getCell(col).text ?? "").trim());
  }

  const rows: Array<Record<string, string>> = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row, already extracted
    const record: Record<string, string> = {};
    let hasAnyValue = false;
    for (let col = 1; col <= columnCount; col++) {
      const header = headers[col - 1];
      if (!header) continue;
      const text = String(row.getCell(col).text ?? "").trim();
      if (text) hasAnyValue = true;
      record[header] = text;
    }
    if (hasAnyValue) rows.push(record); // skip fully-blank trailing rows
  });

  return { fileName: basename(filePath), headers: headers.filter(Boolean), rows };
}

function isBlank(raw: string): boolean {
  return raw.trim().length === 0;
}

function parseMoney(raw: string): number | null {
  const value = Number(raw.trim().replace(/,/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** For a file whose money columns already hold raw integer cents — no ×100 conversion. */
function parseCentsDirect(raw: string): number | null {
  const value = Number(raw.trim().replace(/,/g, ""));
  return Number.isFinite(value) ? Math.round(value) : null;
}

function parseNumber(raw: string): number | null {
  // Strips thousand separators just like parseMoney/parseCentsDirect below — a stock count over
  // 999 written as "5,958.00" (completely normal spreadsheet formatting) otherwise parses as NaN
  // and gets wrongly rejected as invalid, not because the value is bad but because the comma was
  // never stripped.
  const value = Number(raw.trim().replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function parseBoolean(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(value)) return true;
  if (["false", "no", "n", "0"].includes(value)) return false;
  return null;
}

function normalizeForMatch(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** See the "Tax Rate" import field's own comment at its call site — this file has no separate
 * mappable tax-category column, so the category is inferred from whatever's in that one cell. */
function inferProductTaxTypeFromImportCell(raw: string, numericValue: number): "vat" | "exempted" | "zero_rated" {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("exempt")) return "exempted";
  if (normalized.includes("zero")) return "zero_rated";
  if (isBlank(raw) || numericValue > 0) return "vat";
  return "zero_rated";
}

/** Whether a REQUIRED-but-unmapped field is still OK to proceed with, because every row will fall
 * back to a fixed default value instead (see buildRowCandidate's own "blank" branches below) — used
 * by resolveImportRows' upfront mapping check, which otherwise blocked the whole file before any
 * row was even looked at, with no awareness that a default could satisfy a required field the same
 * way a real mapped column does. */
function fieldHasUsableDefault(field: ImportFieldDefinition, fieldDefaults: ImportFieldDefaults): boolean {
  const value = fieldDefaults[field.key];
  if (!value) return false;
  if (field.kind === "enum") {
    return field.enumOptions?.some((option) => option.value === value) ?? false;
  }
  return true;
}

/** Builds one row's candidate input object + validation errors from its raw mapped cell text —
 * shared by preview and commit so they can never classify the same row differently. */
function buildRowCandidate(
  entityType: ImportEntityType,
  row: Record<string, string>,
  columnMapping: ImportColumnMapping,
  fieldDefaults: ImportFieldDefaults,
  tenantId: string,
  moneyInCents: boolean,
  errors: string[],
  /** Products-only — every SKU already in the DB matching "PROD-%", plus every one auto-generated
   * earlier in this same import run, so two blank-SKU rows in one file can never collide with each
   * other (not just with the DB) — see generateDocumentNumber's own existingNumbers contract. */
  skuPool: string[]
): Record<string, unknown> {
  const candidate: Record<string, unknown> = {};
  const fieldDefs: ImportFieldDefinition[] = IMPORT_FIELD_DEFINITIONS[entityType];

  for (const field of fieldDefs) {
    const header = columnMapping[field.key];
    const raw = header ? (row[header] ?? "") : "";
    const blank = isBlank(raw);

    switch (field.kind) {
      case "text": {
        if (blank) {
          if (field.key === "sku" && entityType === "products") {
            // Same convenience the "New Product" form already gives a manual entry — a blank SKU
            // cell shouldn't block an otherwise-good import row when we can just mint the next one.
            const generated = generateDocumentNumber({ tenantId, prefix: "PROD", digits: 6, existingNumbers: skuPool });
            skuPool.push(generated);
            candidate[field.key] = generated;
          } else if (field.required) {
            errors.push(`${field.label} is required`);
            candidate[field.key] = null;
          } else {
            candidate[field.key] = null;
          }
        } else {
          candidate[field.key] = raw.trim();
        }
        break;
      }
      case "number": {
        if (blank) {
          candidate[field.key] = 0;
        } else {
          const value = parseNumber(raw);
          if (value === null) errors.push(`${field.label} must be a number`);
          else candidate[field.key] = value;
        }
        // No separate mappable column for tax CATEGORY (vat/exempted/zero_rated) — this file's own
        // "Tax Rate" column is the only signal available, so the category is inferred from it: a
        // keyword in the cell wins outright, otherwise a nonzero rate (or a blank cell) means
        // standard-rated (the real-world majority), and an explicit zero with no keyword falls back
        // to zero-rated — see product_tax_type migration's own identical default reasoning.
        if (field.key === "taxRate" && entityType === "products") {
          candidate.taxType = inferProductTaxTypeFromImportCell(raw, candidate.taxRate as number);
        }
        break;
      }
      case "money": {
        if (blank) {
          if (field.required) errors.push(`${field.label} is required`);
          candidate[field.key] = null;
        } else {
          const cents = moneyInCents ? parseCentsDirect(raw) : parseMoney(raw);
          if (cents === null) errors.push(`${field.label} must be a valid amount`);
          else candidate[field.key] = cents;
        }
        break;
      }
      case "boolean": {
        if (blank) {
          const fallback = fieldDefaults[field.key];
          const fallbackValue = fallback !== undefined ? parseBoolean(fallback) : null;
          candidate[field.key] = fallbackValue ?? field.key === "trackStock";
        } else {
          const value = parseBoolean(raw);
          if (value === null) errors.push(`${field.label} must be yes/no or true/false`);
          else candidate[field.key] = value;
        }
        break;
      }
      case "enum": {
        if (blank) {
          // Same fallback shape as "boolean" above — set once in the mapping UI when this field
          // isn't mapped to any column at all, applied to every row. Also covers a mapped-but-messy
          // column: the operator can unmap it here and use a fixed value instead of fighting a file
          // whose own vocabulary doesn't match our enum (e.g. "Business"/"Individual" instead of
          // Retail/Wholesale/Corporate/Walk-In) row by row.
          const fallback = fieldDefaults[field.key];
          const fallbackMatch = fallback
            ? field.enumOptions?.find((option) => option.value === fallback)
            : undefined;
          if (fallbackMatch) {
            candidate[field.key] = fallbackMatch.value;
          } else {
            if (field.required) errors.push(`${field.label} is required`);
            candidate[field.key] = null;
          }
        } else {
          const normalized = normalizeForMatch(raw);
          const match = field.enumOptions?.find(
            (option) => normalizeForMatch(option.value) === normalized || normalizeForMatch(option.label) === normalized
          );
          if (!match) {
            const accepted = field.enumOptions?.map((option) => option.label).join(", ") ?? "";
            errors.push(`${field.label} '${raw.trim()}' isn't recognized — use one of: ${accepted}`);
          } else {
            candidate[field.key] = match.value;
          }
        }
        break;
      }
      case "category": {
        if (blank) {
          candidate.categoryId = null;
        } else {
          const name = raw.trim();
          const matches = categoryRepository.findCategoryRowsByName(tenantId, name);
          if (matches.length > 1) {
            errors.push(`Category '${name}' matches ${matches.length} categories — rename one to be unique`);
          } else if (matches.length === 1) {
            candidate.categoryId = matches[0]!.id;
          } else {
            // Not found — auto-create it as a new top-level category rather than blocking the
            // whole import on a data-migration reality (an import file's categories almost never
            // already exist as real Category rows). This insert is a real, immediately-visible
            // synchronous write, so any LATER row in this same file with the same name finds it
            // via the same lookup above — it only ever gets created once per unique name.
            try {
              const created = createCategory({
                name,
                description: null,
                color: CATEGORY_COLOR_SWATCHES[0]!.value,
                sortOrder: 0,
                parentId: null
              });
              candidate.categoryId = created.id;
            } catch (err) {
              errors.push(err instanceof Error ? err.message : `Failed to create category '${name}'`);
            }
          }
        }
        break;
      }
      case "stockQuantity": {
        // Products-only, and only ever meaningful for a row that will CREATE a new product —
        // productUpdateSchema omits openingStock entirely (see @shared/schemas/product.ts), so this
        // is silently dropped for an update anyway. Deliberately not touching an EXISTING product's
        // stock via import — that's a much riskier "add vs. set" ambiguity a fresh migration import
        // doesn't need to solve; opening stock is exactly for a product that doesn't exist yet.
        if (!blank) {
          const quantity = parseNumber(raw);
          if (quantity === null || quantity < 0) {
            errors.push(`${field.label} must be a non-negative number`);
          } else if (quantity === 0) {
            // Zero is a real, legitimate stock level (out of stock) — there's no actual stock to
            // place anywhere, so don't demand a Storefront just to record "nothing." Previously this
            // fell through to the branch below and errored on every zero-stock row that didn't also
            // resolve a storefront, silently dropping every out-of-stock product from the import.
          } else {
            const storefrontId = candidate.storefrontId as string | null | undefined;
            if (!storefrontId) {
              errors.push(`${field.label} needs a Storefront (map a column, or set a default storefront for all rows) to know where the stock belongs`);
            } else {
              candidate.openingStock = [{ locationId: storefrontId, quantity }];
            }
          }
        }
        break;
      }
      case "storefront": {
        if (blank) {
          // Falls back to a real storefront id chosen once in the mapping UI ("assign every
          // imported product to this one shop") — the overwhelmingly common import shape, since a
          // migration file almost never has its own storefront column at all. Used directly, no
          // re-resolution by name, since it already came from a live picker over real locations.
          candidate.storefrontId = fieldDefaults[field.key] || null;
        } else {
          const matches = locationRepository.findStorefrontRowsByName(tenantId, raw.trim());
          if (matches.length === 0) errors.push(`Storefront '${raw.trim()}' was not found`);
          else if (matches.length > 1) errors.push(`Storefront '${raw.trim()}' matches ${matches.length} storefronts — rename one to be unique`);
          else candidate.storefrontId = matches[0]!.id;
        }
        break;
      }
      case "mainStoreStock": {
        // Products-only, same "opening stock is only for a brand-new product" reasoning as
        // "stockQuantity" above — silently dropped for an update via the same schema-omission.
        if (!blank) {
          const quantity = parseNumber(raw);
          if (quantity === null || quantity < 0) {
            errors.push(`${field.label} must be a non-negative number`);
          } else if (quantity === 0) {
            // Zero is legitimate (nothing sitting at Main Store) — same reasoning as stockQuantity.
          } else {
            const mainStore = locationRepository.findMainStoreLocationRow(tenantId);
            if (!mainStore) {
              errors.push(`${field.label} needs a Main Store location, but this tenant doesn't have one set up`);
              break;
            }
            const allocationChoice = candidate.mainStoreStockAllocation as string | null | undefined;
            let allocationStorefrontId: string | null = null;
            if (allocationChoice === "allocated") {
              const storefrontId = candidate.storefrontId as string | null | undefined;
              if (!storefrontId) {
                errors.push(
                  `${field.label} is set to allocate to a Storefront, but none resolved for this row (map a Storefront column, or set a default storefront for all rows)`
                );
                break;
              }
              allocationStorefrontId = storefrontId;
            }
            const existingOpeningStock = Array.isArray(candidate.openingStock)
              ? (candidate.openingStock as Array<{ locationId: string; quantity: number; allocationStorefrontId?: string | null }>)
              : [];
            candidate.openingStock = [...existingOpeningStock, { locationId: mainStore.id, quantity, allocationStorefrontId }];
          }
        }
        break;
      }
    }
  }

  return candidate;
}

function findExistingByNaturalKey(
  entityType: ImportEntityType,
  tenantId: string,
  value: string
): { id: string } | undefined {
  if (entityType === "products") return productRepository.findProductBySkuRow(tenantId, value);
  if (entityType === "customers") return customerRepository.findCustomerByPhoneRow(tenantId, value);
  return supplierRepository.findSupplierByBusinessNameRow(tenantId, value);
}

export type ResolvedImportRow = {
  rowNumber: number;
  action: ImportRowAction;
  matchedId: string | null;
  naturalKey: string | null;
  displayName: string | null;
  errors: string[];
  candidate: Record<string, unknown>;
};

/** The single resolver both previewImport and commitImport run every row through — commit never
 * trusts a client-supplied "this row is valid" flag, it always re-resolves against the live DB on
 * this exact code path, so preview and commit can never silently disagree. */
export function resolveImportRows(
  entityType: ImportEntityType,
  rows: Array<Record<string, string>>,
  columnMapping: ImportColumnMapping,
  fieldDefaults: ImportFieldDefaults,
  tenantId: string,
  moneyInCents: boolean
): { mappingErrors: string[]; resolved: ResolvedImportRow[] } {
  const fieldDefs = IMPORT_FIELD_DEFINITIONS[entityType];
  const mappingErrors: string[] = [];
  for (const field of fieldDefs) {
    if (field.required && !columnMapping[field.key] && !fieldHasUsableDefault(field, fieldDefaults)) {
      mappingErrors.push(`${field.label} is required — map it to a column before continuing`);
    }
  }
  if (mappingErrors.length > 0) {
    return { mappingErrors, resolved: [] };
  }

  const seenNaturalKeys = new Map<string, number>();
  const schema = ENTITY_CREATE_SCHEMA[entityType];
  const naturalKeyField = NATURAL_KEY_FIELD[entityType];
  const displayNameField = DISPLAY_NAME_FIELD[entityType];
  const skuPool: string[] = entityType === "products" ? productRepository.findMaxProductSkuNumberRow(tenantId) : [];

  const resolved = rows.map((row, index): ResolvedImportRow => {
    const rowNumber = index + 1;
    const errors: string[] = [];
    let candidate = buildRowCandidate(entityType, row, columnMapping, fieldDefaults, tenantId, moneyInCents, errors, skuPool);

    if (errors.length === 0) {
      const result = schema.safeParse(candidate);
      if (!result.success) {
        errors.push(...result.error.issues.map((issue) => issue.message));
      } else {
        candidate = result.data as Record<string, unknown>;
      }
    }

    const naturalKeyValue = typeof candidate[naturalKeyField] === "string" ? (candidate[naturalKeyField] as string) : null;
    let action: ImportRowAction = errors.length > 0 ? "error" : "create";
    let matchedId: string | null = null;

    if (naturalKeyValue) {
      const normalized = naturalKeyValue.trim().toLowerCase();
      const firstSeenRow = seenNaturalKeys.get(normalized);
      if (firstSeenRow !== undefined) {
        errors.push(`Duplicate ${NATURAL_KEY_LABEL[entityType]} '${naturalKeyValue}' also appears in row ${firstSeenRow} of this file`);
        action = "error";
      } else {
        seenNaturalKeys.set(normalized, rowNumber);
      }
    }

    if (action !== "error" && naturalKeyValue) {
      const existing = findExistingByNaturalKey(entityType, tenantId, naturalKeyValue);
      if (existing) {
        action = "update";
        matchedId = existing.id;
      }
    }

    const displayName = typeof candidate[displayNameField] === "string" ? (candidate[displayNameField] as string) : null;

    return { rowNumber, action, matchedId, naturalKey: naturalKeyValue, displayName, errors, candidate };
  });

  return { mappingErrors: [], resolved };
}

export function previewImport(input: unknown): ImportPreviewResult {
  requirePermission("data_import", "view");
  const parsed = importPreviewRequestSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const { mappingErrors, resolved } = resolveImportRows(
    parsed.entityType as ImportEntityType,
    parsed.rows,
    parsed.columnMapping,
    parsed.fieldDefaults,
    tenantId,
    parsed.moneyInCents
  );

  if (mappingErrors.length > 0) {
    return { mappingErrors, rows: [], summary: { toCreate: 0, toUpdate: 0, invalid: 0, total: 0 } };
  }

  const rows: ImportPreviewRow[] = resolved.map((row) => ({
    rowNumber: row.rowNumber,
    action: row.action,
    matchedId: row.matchedId,
    naturalKey: row.naturalKey,
    displayName: row.displayName,
    errors: row.errors
  }));

  const summary = {
    toCreate: rows.filter((row) => row.action === "create").length,
    toUpdate: rows.filter((row) => row.action === "update").length,
    invalid: rows.filter((row) => row.action === "error").length,
    total: rows.length
  };

  return { mappingErrors: [], rows, summary };
}

export function commitImport(input: unknown): ImportCommitResult {
  requirePermission("data_import", "edit");
  const parsed = importCommitRequestSchema.parse(input);
  const entityType = parsed.entityType as ImportEntityType;
  const { tenantId } = getCurrentTenant();
  const { mappingErrors, resolved } = resolveImportRows(
    entityType,
    parsed.rows,
    parsed.columnMapping,
    parsed.fieldDefaults,
    tenantId,
    parsed.moneyInCents
  );

  if (mappingErrors.length > 0) {
    throw new Error(mappingErrors.join("; "));
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors: Array<{ rowNumber: number; message: string }> = [];

  // Each row's create/update call is its own try/catch — one bad row (a permission edge case, a
  // rule createProduct/etc. enforces that preview didn't replicate) never aborts the rest of an
  // otherwise-good batch.
  for (const row of resolved) {
    if (row.action === "error") continue;
    try {
      if (row.action === "create") {
        if (entityType === "products") createProduct(row.candidate);
        else if (entityType === "customers") createCustomer(row.candidate);
        else createSupplier(row.candidate);
        created++;
      } else {
        if (entityType === "products") updateProduct(row.matchedId as string, row.candidate);
        else if (entityType === "customers") updateCustomer(row.matchedId as string, row.candidate);
        else updateSupplier(row.matchedId as string, row.candidate);
        updated++;
      }
    } catch (err) {
      failed++;
      errors.push({ rowNumber: row.rowNumber, message: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  const skipped = resolved.filter((row) => row.action === "error").length;
  for (const row of resolved) {
    if (row.action === "error" && row.errors.length > 0) {
      errors.push({ rowNumber: row.rowNumber, message: row.errors.join("; ") });
    }
  }
  errors.sort((a, b) => a.rowNumber - b.rowNumber);

  return { created, updated, skipped, failed, errors };
}
