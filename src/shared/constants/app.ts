export const APP_NAME = "Blue Ledger POS";
export const APP_PROTOCOL = "blue-ledger";
export const DEFAULT_TENANT_SLUG = "local-demo";

export const SYNC_ENDPOINTS = {
  health: "/health",
  push: "/sync/push",
  pull: "/sync/pull",
  heartbeat: "/sync/heartbeat"
} as const;

export const THEME_STORAGE_KEY = "blue-ledger-theme";
export const PRINTER_SETTINGS_STORAGE_KEY = "blue-ledger-printer-settings";
