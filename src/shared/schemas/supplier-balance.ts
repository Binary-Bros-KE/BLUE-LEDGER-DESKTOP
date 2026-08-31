import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

/** A manual balance entry — covers both "record balance carried forward from the old system" (a
 * positive amount, no purchase behind it) and any later correction (positive or negative). Deliberately
 * one generic action rather than a separate one-time-only "opening balance" flow: a supplier's balance
 * is a running total (see supplier-balance-service.ts's own doc comment), so "set the starting point"
 * and "correct it later" are the same operation — the note field, when filled in, is what tells them
 * apart on the statement (e.g. "Carried forward from old system as of Jan 2026"), but it's optional,
 * same as every other notes field in this app. amountCents is signed: positive increases what's owed
 * to the supplier, negative decreases it. */
export const supplierBalanceAdjustSchema = z.object({
  amountCents: z.coerce
    .number()
    .int()
    .refine((value) => value !== 0, "Enter a non-zero amount")
    .refine((value) => Math.abs(value) <= 100_000_000_000, "Amount is too large"),
  notes: optionalText(500)
});

export type SupplierBalanceAdjustInput = z.infer<typeof supplierBalanceAdjustSchema>;
