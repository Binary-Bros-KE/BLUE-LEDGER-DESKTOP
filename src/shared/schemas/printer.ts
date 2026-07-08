import { z } from "zod";
import { PRINTER_CONNECTION_OPTIONS, PRINTER_TYPE_OPTIONS, type PrinterConnectionType, type PrinterType } from "@shared/types/printer";

const connectionTypeValues = PRINTER_CONNECTION_OPTIONS.map((option) => option.value) as [
  PrinterConnectionType,
  ...PrinterConnectionType[]
];
const printerTypeValues = PRINTER_TYPE_OPTIONS.map((option) => option.value) as [PrinterType, ...PrinterType[]];

export const printerSettingsSchema = z.object({
  enabled: z.boolean(),
  connectionType: z.enum(connectionTypeValues),
  address: z.string().trim().max(200),
  printerType: z.enum(printerTypeValues),
  paperWidth: z.coerce.number().int().min(20).max(80),
  autoPrintOnSale: z.boolean()
});

export type PrinterSettingsInput = z.infer<typeof printerSettingsSchema>;
