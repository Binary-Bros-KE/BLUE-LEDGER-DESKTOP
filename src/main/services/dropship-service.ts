import { z } from "zod";
import * as dropshipRepository from "@main/database/repositories/dropship-repository";
import { requirePermission } from "@main/services/auth-service";
import { fetchDropshipPriceReport } from "@main/services/license-service";
import type { DropshipPriceReport, DropshipState } from "@shared/types/dropship";

/** Renderer read for the "Supplier stock" badge. Just names and a timestamp — no permission gate, the
 * same way the product list itself is readable by anyone who can see that screen. */
export function getDropshipState(): DropshipState {
  return {
    links: dropshipRepository.listDropshipLinks(),
    suppliers: dropshipRepository.readDropshipState()?.suppliers ?? []
  };
}

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const priceReportQuerySchema = z.object({
  startDate: dateField,
  endDate: dateField,
  search: z.string().trim().max(100).optional(),
  direction: z.enum(["all", "raised", "lowered"]).optional(),
  outcome: z.enum(["all", "updated", "kept"]).optional(),
  offset: z.number().int().min(0).optional()
});

/** The "Supplier Price Changes" report — server-side history, so it's fetched live (null offline).
 * This device's own calendar days, same as every other report. */
export async function getDropshipPriceReport(input: unknown): Promise<DropshipPriceReport | null> {
  requirePermission("reports", "view");
  const query = priceReportQuerySchema.parse(input);
  return fetchDropshipPriceReport({ ...query, timezoneOffsetMinutes: new Date().getTimezoneOffset() });
}
