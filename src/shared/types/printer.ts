export const PRINTER_TYPE_OPTIONS = [
  { value: "epson", label: "Epson (most common)" },
  { value: "star", label: "Star" },
  { value: "tanca", label: "Tanca" },
  { value: "daruma", label: "Daruma" },
  { value: "brother", label: "Brother" },
  { value: "custom", label: "Custom / Generic ESC-POS" }
] as const;

export type PrinterType = (typeof PRINTER_TYPE_OPTIONS)[number]["value"];

export const PRINTER_CONNECTION_OPTIONS = [
  { value: "network", label: "Network (IP Address)" },
  { value: "usb", label: "USB (System Printer Name)" },
  { value: "serial", label: "Serial / COM Port" }
] as const;

export type PrinterConnectionType = (typeof PRINTER_CONNECTION_OPTIONS)[number]["value"];

export type PrinterSettings = {
  enabled: boolean;
  connectionType: PrinterConnectionType;
  address: string;
  printerType: PrinterType;
  paperWidth: number;
  autoPrintOnSale: boolean;
};

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  enabled: false,
  connectionType: "network",
  address: "",
  printerType: "epson",
  paperWidth: 48,
  autoPrintOnSale: true
};

export type PrinterActionResult = {
  success: boolean;
  message: string;
};
