import { getDatabase } from "@main/database/connection";
import { THEME_STORAGE_KEY } from "@shared/constants/app";
import { brandThemeSchema } from "@shared/schemas/theme";
import type { BrandTheme } from "@shared/types/theme";

export const defaultBrandTheme: BrandTheme = {
  mode: "light",
  primary: "#082a8f",
  accent: "#0b84ff",
  success: "#14b8a6",
  warning: "#f59e0b",
  danger: "#dc2626",
  surface: "#f8fbff",
  ink: "#111827"
};

export function saveTheme(theme: BrandTheme): BrandTheme {
  const parsed = brandThemeSchema.parse(theme);
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `
    )
    .run(THEME_STORAGE_KEY, JSON.stringify(parsed), now);

  return parsed;
}
