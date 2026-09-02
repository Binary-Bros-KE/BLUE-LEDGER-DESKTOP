import { z } from "zod";

// Only meaningful for a branch-less session (Super Admin) — see resolveReportLocationScope in
// auth-service.ts, which ignores this for anyone with an assigned branch.
const locationIdField = z.string().trim().min(1).nullish();

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
    locationId: locationIdField,
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "Start date must be on or before the end date",
    path: ["endDate"],
  });

export type DateRangeInput = z.infer<typeof dateRangeInputSchema>;

export const salesTrendWindowInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("daily"), anchor: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), locationId: locationIdField }),
  z.object({ mode: z.literal("weekly"), anchor: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), locationId: locationIdField }),
  z.object({ mode: z.literal("monthly"), anchor: z.string().trim().regex(/^\d{4}-\d{2}$/), locationId: locationIdField }),
  z.object({ mode: z.literal("yearly"), anchor: z.string().trim().regex(/^\d{4}$/), locationId: locationIdField }),
  z
    .object({
      mode: z.literal("custom"),
      startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      locationId: locationIdField,
    })
    .refine((value) => value.startDate <= value.endDate, {
      message: "Start date must be on or before the end date",
      path: ["endDate"],
    }),
]);

export type SalesTrendWindowInput = z.infer<typeof salesTrendWindowInputSchema>;

/** Shared param shape for the handful of report calls with no date range at all (Inventory,
 * Outstanding Invoices, Outstanding Purchases) — still filterable by storefront. */
export const locationScopeInputSchema = z.object({ locationId: locationIdField });

export const stockAsOfDateInputSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  locationId: locationIdField,
});

export type StockAsOfDateInput = z.infer<typeof stockAsOfDateInputSchema>;
