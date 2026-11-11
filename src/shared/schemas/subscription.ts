import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { DEFAULT_SUBSCRIPTION_PERIOD_DAYS, isValidDate } from "@shared/lib/subscription-schedule";

const calendarDate = z
  .string()
  .trim()
  .refine(isValidDate, "Enter a valid date");

const periodDays = z.coerce
  .number()
  .int("Period must be whole days")
  .min(1, "Period must be at least 1 day")
  .max(3660, "Period can't be more than 10 years")
  .default(DEFAULT_SUBSCRIPTION_PERIOD_DAYS);

const amountCents = z.coerce.number().int().min(0, "Amount can't be negative").nullable().optional().default(null);

export const subscriptionInputSchema = z.object({
  customerId: z.string().trim().min(1, "Choose a customer"),
  /** Ignored for an employee assigned to a storefront: theirs is always used. */
  locationId: z.string().trim().min(1).nullable().optional().default(null),
  serviceName: z.string().trim().min(1, "Enter the service, e.g. DStv Compact").max(120),
  accountNumber: optionalText(60),
  startDate: calendarDate,
  periodDays,
  amountCents,
  notes: optionalText(500)
});

export type SubscriptionInput = z.infer<typeof subscriptionInputSchema>;

export const subscriptionRenewSchema = z.object({
  startDate: calendarDate,
  periodDays,
  amountCents
});

export type SubscriptionRenewInput = z.infer<typeof subscriptionRenewSchema>;

export const subscriptionNoticeSchema = z.object({
  stage: z.enum(["week", "three_days", "due", "expired"]),
  channel: z.enum(["whatsapp", "email", "other"]),
  recipient: optionalText(160)
});

export type SubscriptionNoticeInput = z.infer<typeof subscriptionNoticeSchema>;
