export type ThemeMode = "light" | "dark" | "system";

export type BrandTheme = {
  mode: ThemeMode;
  primary: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  surface: string;
  ink: string;
};
