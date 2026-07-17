import { z } from "zod";

export const productSalesHistoryInputSchema = z.object({
  productId: z.string().trim().min(1),
});

export type ProductSalesHistoryInputParsed = z.infer<typeof productSalesHistoryInputSchema>;
