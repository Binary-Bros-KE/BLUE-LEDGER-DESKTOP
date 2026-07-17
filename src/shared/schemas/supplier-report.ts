import { z } from "zod";

export const supplierPurchaseHistoryInputSchema = z.object({
  supplierId: z.string().trim().min(1),
});

export type SupplierPurchaseHistoryInputParsed = z.infer<typeof supplierPurchaseHistoryInputSchema>;
