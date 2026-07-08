import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

const saleReturnItemInputSchema = z.object({
  saleItemId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0")
});

export const saleReturnRequestSchema = z.object({
  saleId: z.string().trim().min(1),
  reason: z.string().trim().min(1, "A reason is required").max(500),
  notes: optionalText(500),
  items: z.array(saleReturnItemInputSchema).min(1, "Select at least one item to return")
});

export type SaleReturnRequestInput = z.infer<typeof saleReturnRequestSchema>;
