import { z } from "zod";

export const loginInputSchema = z.object({
  employeeCode: z.string().trim().min(1, "Employee code is required").max(30),
  pin: z
    .string()
    .trim()
    .min(1, "PIN is required")
    .max(20)
    .regex(/^\d+$/, "PIN must contain only digits")
});

export type LoginInput = z.infer<typeof loginInputSchema>;
