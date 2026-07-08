import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

export const saleVoidRequestSchema = z.object({
  saleId: z.string().trim().min(1),
  reason: z.string().trim().min(1, "A reason is required").max(500),
  notes: optionalText(500)
});

export type SaleVoidRequestInput = z.infer<typeof saleVoidRequestSchema>;

export const approvalDecisionSchema = z.object({
  notes: optionalText(500)
});

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
