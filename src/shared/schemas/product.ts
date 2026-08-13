import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { TAX_TYPE_OPTIONS, UNIT_OF_MEASURE_OPTIONS } from "@shared/types/product";

const nullableId = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

const unitOfMeasureValues = UNIT_OF_MEASURE_OPTIONS.map((option) => option.value) as [string, ...string[]];
const taxTypeValues = TAX_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];
// Nullable/optional on purpose — bulk-imported or legacy products may never have this set.
const nullableUnitOfMeasure = z
  .enum(unitOfMeasureValues)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

const priceCents = z.coerce.number().int().min(0).max(100_000_000);
const nullablePriceCents = z.coerce
  .number()
  .int()
  .min(0)
  .max(100_000_000)
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? null : value));

export const productOpeningStockEntrySchema = z.object({
  locationId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(0),
  // Only meaningful when locationId is the tenant's Main Store — passed straight through to
  // applyValidatedStockMovement's own allocationStorefrontId (see inventory-service.ts): a real
  // storefront id earmarks this quantity for that shop, null targets the "unallocated" bucket
  // precisely, and omitting the field entirely (every caller before Products import) falls back to
  // the older, less precise clamped-unallocated behavior — still correct, just not bucket-aware.
  allocationStorefrontId: z.string().trim().min(1).nullable().optional()
});

const productFieldsSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, "SKU is required")
    .max(64)
    .transform((value) => value.toUpperCase()),
  barcode: optionalText(64),
  supplierSku: optionalText(64),
  name: z.string().trim().min(1, "Product name is required").max(200),
  shortName: optionalText(60),
  description: optionalText(1000),
  categoryId: nullableId,
  storefrontId: nullableId,
  unitOfMeasure: nullableUnitOfMeasure,
  buyingPriceCents: priceCents,
  sellingPriceCents: priceCents,
  wholesalePriceCents: nullablePriceCents,
  wholesaleMinQuantity: z.coerce.number().int().min(0).max(1_000_000),
  minimumPriceCents: nullablePriceCents,
  taxRate: z.coerce.number().min(0).max(100),
  // Defaults to "vat" when absent (e.g. bulk import — see import-service.ts, no column maps to this
  // field yet, Phase 1) rather than being required, since most retail goods are standard-rated and
  // an admin can correct any that aren't after the fact.
  taxType: z.enum(taxTypeValues).default("vat"),
  reorderLevel: z.coerce.number().int().min(0).max(1_000_000),
  trackStock: z.boolean(),
  allowNegativeStock: z.boolean(),
  imagePath: optionalText(500)
});

/** A minimum price ABOVE the selling price is never sellable at all — checkout/invoices/quotations
 * all reject the sale outright the moment isPriceBelowMinimum (cart-pricing.ts) sees the normal
 * price under it, with no way to complete the transaction. Rejected here at the source instead of
 * letting a broken product ever get saved — equal is fine (selling exactly at the floor isn't
 * "below" it), only strictly above is blocked. */
function minimumPriceNotAboveSelling(data: { minimumPriceCents: number | null; sellingPriceCents: number }): boolean {
  return data.minimumPriceCents === null || data.minimumPriceCents <= data.sellingPriceCents;
}

const MINIMUM_PRICE_REFINEMENT_OPTS = {
  message: "Minimum price can't be higher than the selling price",
  path: ["minimumPriceCents"] as PropertyKey[]
};

export const productCreateSchema = productFieldsSchema
  .extend({ openingStock: z.array(productOpeningStockEntrySchema).optional().default([]) })
  .refine(minimumPriceNotAboveSelling, MINIMUM_PRICE_REFINEMENT_OPTS);

export const productUpdateSchema = productFieldsSchema.refine(minimumPriceNotAboveSelling, MINIMUM_PRICE_REFINEMENT_OPTS);

/** Backfill tool for a tenant onboarded before tax categories existed — every product bulk-set to
 * one category in a few clicks instead of one-by-one, or a re-import that would just create
 * duplicates (products have no unique code from that era, only names). */
export const bulkSetTaxTypeSchema = z.object({
  productIds: z.array(z.string().trim().min(1)).min(1, "Select at least one product"),
  taxType: z.enum(taxTypeValues)
});

export type BulkSetTaxTypeInput = z.infer<typeof bulkSetTaxTypeSchema>;

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
