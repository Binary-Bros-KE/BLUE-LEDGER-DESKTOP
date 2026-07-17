import { z } from "zod";

export const dateRangeInputSchema = z
  .object({
    startDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be in YYYY-MM-DD format"),
    endDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be in YYYY-MM-DD format"),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "Start date must be on or before the end date",
    path: ["endDate"],
  });

export type DateRangeInput = z.infer<typeof dateRangeInputSchema>;

export const salesTrendWindowInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("daily"), anchor: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ mode: z.literal("weekly"), anchor: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ mode: z.literal("monthly"), anchor: z.string().trim().regex(/^\d{4}-\d{2}$/) }),
  z.object({ mode: z.literal("yearly"), anchor: z.string().trim().regex(/^\d{4}$/) }),
  z
    .object({
      mode: z.literal("custom"),
      startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .refine((value) => value.startDate <= value.endDate, {
      message: "Start date must be on or before the end date",
      path: ["endDate"],
    }),
]);

export type SalesTrendWindowInput = z.infer<typeof salesTrendWindowInputSchema>;
