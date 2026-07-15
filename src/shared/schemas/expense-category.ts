import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

export const expenseCategoryInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: optionalText(500)
});

export type ExpenseCategoryInput = z.infer<typeof expenseCategoryInputSchema>;
