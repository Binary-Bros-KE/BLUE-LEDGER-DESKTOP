/** Sentinel for "don't filter by year at all" in a year-filter dropdown's string value. */
export const ALL_YEARS_VALUE = "all";

export function currentYear(): number {
  return new Date().getFullYear();
}

/** Every year actually present in a list, plus the current year (so a brand new tenant with zero
 * history this year still gets a sensible default option), newest first. */
export function buildAvailableYears(dates: Array<string | null | undefined>): number[] {
  const years = new Set<number>([currentYear()]);
  for (const value of dates) {
    if (!value) continue;
    const year = new Date(value).getFullYear();
    if (Number.isFinite(year)) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

export function yearFilterOptions(availableYears: number[]): Array<{ value: string; label: string }> {
  return [
    { value: ALL_YEARS_VALUE, label: "All Years" },
    ...availableYears.map((year) => ({ value: String(year), label: String(year) }))
  ];
}

/** True if `dateValue` falls within `yearFilter` — always true for the "All Years" sentinel. */
export function matchesYearFilter(dateValue: string | null | undefined, yearFilter: string): boolean {
  if (yearFilter === ALL_YEARS_VALUE) return true;
  if (!dateValue) return false;
  return new Date(dateValue).getFullYear() === Number(yearFilter);
}
