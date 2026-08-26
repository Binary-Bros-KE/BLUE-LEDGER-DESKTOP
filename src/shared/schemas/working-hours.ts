import { z } from "zod";

const timeStringSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24h HH:mm")
  .nullable();

const workingHoursDaySchema = z.object({
  isOpen: z.boolean(),
  openTime: timeStringSchema,
  closeTime: timeStringSchema
});

export const workingHoursInputSchema = z.object({
  lockEnabled: z.boolean(),
  lockMode: z.enum(["auto", "manual"]),
  manuallyLocked: z.boolean(),
  timezoneOffsetMinutes: z.coerce.number().int().min(-720).max(840),
  // Keyed "0".."6" — Sunday..Saturday, matches JS Date.getDay().
  schedule: z.record(z.string().regex(/^[0-6]$/), workingHoursDaySchema)
});

export type WorkingHoursInput = z.infer<typeof workingHoursInputSchema>;
