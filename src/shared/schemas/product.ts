import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { UNIT_OF_MEASURE_OPTIONS } from "@shared/types/product";

const nullableId = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

const unitOfMeasureValues = UNIT_OF_MEASURE_OPTIONS.map((option) => option.value) as [string, ...string[]];
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
  quantity: z.coerce.number().int().min(0)
});

export const productCreateSchema = z.object({
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
  reorderLevel: z.coerce.number().int().min(0).max(1_000_000),
  trackStock: z.boolean(),
  allowNegativeStock: z.boolean(),
  imagePath: optionalText(500),
  openingStock: z.array(productOpeningStockEntrySchema).optional().default([])
});

export const productUpdateSchema = productCreateSchema.omit({ openingStock: true });

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
