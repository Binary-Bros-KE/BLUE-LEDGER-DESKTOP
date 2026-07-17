import { z } from "zod";

export const customerPurchaseHistoryInputSchema = z.object({
  customerId: z.string().trim().min(1),
});

export type CustomerPurchaseHistoryInputParsed = z.infer<typeof customerPurchaseHistoryInputSchema>;
