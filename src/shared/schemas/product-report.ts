import { z } from "zod";

export const productSalesHistoryInputSchema = z.object({
  productId: z.string().trim().min(1),
});

export type ProductSalesHistoryInputParsed = z.infer<typeof productSalesHistoryInputSchema>;

/** Same date-range shape as dateRangeInputSchema, plus how many Slow Moving rows to return —
 * user-adjustable instead of a fixed top 20. Duplicated here rather than `.extend()`-ing
 * dateRangeInputSchema since that one is `.refine()`-wrapped and no longer a plain ZodObject. */
export const productsPerformanceInputSchema = z
  .object({
    startDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be in YYYY-MM-DD format"),
    endDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be in YYYY-MM-DD format"),
    slowMovingLimit: z.coerce.number().int().min(1).max(500).optional(),
    locationId: z.string().trim().min(1).nullish(),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "Start date must be on or before the end date",
    path: ["endDate"],
  });

export type ProductsPerformanceInput = z.infer<typeof productsPerformanceInputSchema>;
