/** A generic classification of a logo's shape, used to size it sensibly wherever it's rendered. */
export const LOGO_RATIO_OPTIONS = [
  { value: "landscape", label: "Landscape (wide)" },
  { value: "portrait", label: "Portrait (tall)" },
  { value: "square", label: "Square" }
] as const;

export type LogoRatio = (typeof LOGO_RATIO_OPTIONS)[number]["value"];
