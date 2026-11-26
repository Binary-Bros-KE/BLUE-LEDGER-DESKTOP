export type PriceTagPrinters = {
  /** Installed Windows printers. */
  printers: string[];
  /** The receipt printer from Settings, used when no other printer is picked. */
  receiptPrinter: string | null;
  /** Printable width of the receipt roll, from Settings' Paper Width. */
  rollWidthMm: number;
};
