import { z } from "zod";

// Variants — see docs/VARIANTS.md. Shape rules shared by every variants action; the cross-row rules
// (values must match the options, no duplicate combinations, SKU/barcode uniqueness) are checked in
// product-variant-service.ts where the other products are visible.

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableCode = z
  .string()
  .trim()
  .max(64)
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));
const nullablePrice = z.coerce.number().int().min(0).max(100_000_000_000).nullable();
const optionValues = z.record(z.string(), z.string().trim().min(1).max(40));

export const variantOptionSchema = z.object({
  name: text(30),
  values: z.array(text(40)).min(1, "Every option needs at least one value").max(50)
});

const optionsSchema = z
  .array(variantOptionSchema)
  .min(1, "Add at least one option, e.g. Size")
  .max(3, "At most 3 options (e.g. Size, Colour, Material)")
  .refine((opts) => new Set(opts.map((o) => o.name.toLowerCase())).size === opts.length, "Option names must be different")
  .refine(
    (opts) => opts.every((o) => new Set(o.values.map((v) => v.toLowerCase())).size === o.values.length),
    "An option can't list the same value twice"
  );

const titleSchema = z
  .string()
  .trim()
  .max(120)
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

/** Shared stock: one product, one stock — variants live inside it. */
export const saveSharedVariantsSchema = z.object({
  productId: text(80),
  title: titleSchema,
  options: optionsSchema,
  variants: z
    .array(
      z.object({
        key: z.string().trim().max(40).nullable().optional(),
        values: optionValues,
        priceCents: nullablePrice,
        sku: nullableCode,
        barcode: nullableCode,
        active: z.boolean()
      })
    )
    .min(1, "Keep at least one variant")
    .max(300)
});

/** Separate stock: each variant is its own product. productId null = create a new product. */
export const saveSeparateVariantsSchema = z.object({
  productId: text(80),
  title: titleSchema,
  options: optionsSchema,
  members: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(80).nullable(),
        values: optionValues,
        /** new products only — blank = "<title> - <label>" */
        name: z.string().trim().max(200).nullable().optional(),
        sellingPriceCents: z.coerce.number().int().min(0).max(100_000_000_000),
        barcode: nullableCode
      })
    )
    .min(2, "A variant group needs at least 2 products")
    .max(300)
});

/** Group existing products into ONE shared-stock product — stock summed into the main product, the
 * others deactivated. */
export const mergeIntoSharedVariantsSchema = z.object({
  mainProductId: text(80),
  title: titleSchema,
  /** optional rename of the main product (it now stands for the whole group) */
  newName: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  options: optionsSchema,
  entries: z
    .array(z.object({ productId: text(80), values: optionValues }))
    .min(2, "Pick at least 2 products to group")
    .max(100)
});

export type SaveSharedVariantsInput = z.infer<typeof saveSharedVariantsSchema>;
export type SaveSeparateVariantsInput = z.infer<typeof saveSeparateVariantsSchema>;
export type MergeIntoSharedVariantsInput = z.infer<typeof mergeIntoSharedVariantsSchema>;
