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
// app_settings key for this machine's chosen Checkout layout — never rename (an existing install's
// saved choice is looked up by exactly this string; renaming it silently resets everyone to default).
export const CHECKOUT_LAYOUT_STORAGE_KEY = "blue-ledger-checkout-layout";
