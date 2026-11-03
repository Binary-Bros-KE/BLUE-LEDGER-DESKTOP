import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field, SelectField } from "@renderer/shared/components/form-fields";
import { toCents } from "@renderer/shared/lib/money";
import { MEASURE_FAMILIES, priceConversionRatio, type ProductUnitConfig } from "@shared/lib/product-units";

/** "" = one unit only; a measure family key (weight, volume, length); or "pack". */
export type UnitsKind = string;
type PackRow = { code: string; factor: string; price: string };

/**
 * The "Sold as" state shared by the Create and Edit product forms — see shared/lib/product-units.ts.
 * Everything in those forms reads per the price unit (per kg); `priceFactor` is what converts it to
 * the per-base-unit values stored and synced.
 */
export function useProductUnits(initial: { unitOfMeasure: string | null; unitConfig: ProductUnitConfig | null } | null) {
  const config = initial?.unitConfig ?? null;
  const [kind, setKind] = useState<UnitsKind>(() => {
    if (config?.kind === "pack") return "pack";
    if (config?.kind === "measure") return MEASURE_FAMILIES.find((f) => f.base === initial?.unitOfMeasure)?.key ?? "";
    return "";
  });
  const [packRows, setPackRows] = useState<PackRow[]>(() =>
    config?.kind === "pack"
      ? config.units.map((u) => ({ code: u.code, factor: String(u.factor), price: u.priceCents === null ? "" : String(u.priceCents / 100) }))
      : []
  );
  const [packDefaultUnit, setPackDefaultUnit] = useState<string | null>(config?.kind === "pack" ? config.defaultSaleUnit : null);
  const [conversionNotice, setConversionNotice] = useState<string | null>(null);

  const family = MEASURE_FAMILIES.find((f) => f.key === kind);

  /** The unit the form's prices read in, given a kind and the product's own unit. */
  function priceUnitOf(forKind: UnitsKind, baseUnit: string): string | null {
    return MEASURE_FAMILIES.find((f) => f.key === forKind)?.units[0]?.code ?? (baseUnit || null);
  }

  /** Switching how a product is sold re-expresses what's typed so it means the same: KES 0.26 per mL
   * becomes KES 260 per L, and says so, so the owner can check it before saving. Returns what the
   * form must apply. */
  function changeKind(next: UnitsKind, baseUnit: string, sellingPriceText: string): { baseUnit: string; ratio: number } {
    const nextFamily = MEASURE_FAMILIES.find((f) => f.key === next);
    const nextBase = nextFamily ? nextFamily.base : baseUnit;
    const fromUnit = priceUnitOf(kind, baseUnit);
    const toUnit = priceUnitOf(next, nextBase);
    const ratio = priceConversionRatio(fromUnit, toUnit);
    if (ratio !== 1 && Number.parseFloat(sellingPriceText) > 0) {
      const converted = (Number.parseFloat(sellingPriceText) * ratio).toFixed(2);
      setConversionNotice(`Price converted: ${sellingPriceText} per ${fromUnit} is ${converted} per ${toUnit}. Check it before saving.`);
    } else {
      setConversionNotice(null);
    }
    setKind(next);
    if (next === "pack" && packRows.length === 0) setPackRows([{ code: "", factor: "", price: "" }]);
    return { baseUnit: nextBase, ratio };
  }

  /** What's in the form as a unit config; a string is what's wrong with it. */
  function buildConfig(): ProductUnitConfig | null | string {
    if (family) {
      const unit = family.units[0]!;
      return { kind: "measure", priceUnit: unit.code, defaultSaleUnit: unit.code, units: family.units.map((u) => ({ code: u.code, factor: u.factor, priceCents: null })) };
    }
    if (kind !== "pack") return null;
    const rows = packRows.filter((row) => row.code.trim() || row.factor.trim() || row.price.trim());
    if (rows.length === 0) return "Add a pack size, or choose One unit only.";
    const units: ProductUnitConfig["units"] = [];
    for (const row of rows) {
      const factor = Number.parseInt(row.factor, 10);
      if (!row.code.trim()) return "Give each pack size a name.";
      if (!factor || factor < 2) return `Enter how many are in one ${row.code.trim()} (at least 2).`;
      units.push({ code: row.code.trim(), factor, priceCents: row.price.trim() ? toCents(row.price) : null });
    }
    return { kind: "pack", priceUnit: null, defaultSaleUnit: units.some((u) => u.code === packDefaultUnit) ? packDefaultUnit : null, units };
  }

  return {
    kind,
    family,
    /** " (per kg)" after a price label. */
    priceLabel: family ? ` (per ${family.units[0]!.code})` : "",
    /** " (kg)" after a stock amount label. */
    countLabel: family ? ` (${family.units[0]!.code})` : "",
    /** How many base units one price unit is: 1000 for per-kg on a g-based product. */
    priceFactor: family ? family.units[0]!.factor : 1,
    packRows,
    setPackRows,
    packDefaultUnit,
    setPackDefaultUnit,
    conversionNotice,
    changeKind,
    buildConfig
  };
}

export function ProductUnitsSection({
  units,
  baseUnit,
  onKindChange
}: {
  units: ReturnType<typeof useProductUnits>;
  baseUnit: string;
  onKindChange: (kind: UnitsKind) => void;
}): React.JSX.Element {
  const namedRows = units.packRows.filter((row) => row.code.trim());

  function updateRow(index: number, patch: Partial<PackRow>): void {
    units.setPackRows(units.packRows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Selling Units</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Sold as"
          value={units.kind}
          onChange={onKindChange}
          options={[
            { value: "", label: "One unit only" },
            ...MEASURE_FAMILIES.map((f) => ({ value: f.key, label: `By ${f.label.toLowerCase()} (${[...f.units.map((u) => u.code), f.base].join(", ")})` })),
            { value: "pack", label: "In packs (carton, crate…)" }
          ]}
        />
      </div>
      {units.family && (
        <p className="mt-2 text-[11px] font-semibold text-muted">
          Prices are per {units.family.units[0]!.code}. Stock shows as {units.family.units[0]!.code} and {units.family.base}, and sales can be in either.
        </p>
      )}
      {units.conversionNotice && <p className="mt-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-bold text-warning">{units.conversionNotice}</p>}

      {units.kind === "pack" && (
        <div className="mt-3 space-y-3 rounded-lg border border-line p-3">
          {units.packRows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-3">
              <Field label="Pack name" value={row.code} onChange={(value) => updateRow(index, { code: value })} placeholder="carton" />
              <Field label={`${baseUnit || "Pieces"} in it`} type="number" value={row.factor} onChange={(value) => updateRow(index, { factor: value })} placeholder="24" />
              <Field label="Own price (optional)" type="number" value={row.price} onChange={(value) => updateRow(index, { price: value })} placeholder="0.00" />
              <button
                type="button"
                onClick={() => units.setPackRows(units.packRows.filter((_, i) => i !== index))}
                aria-label="Remove this pack"
                className="grid size-9 place-items-center rounded-md text-muted transition hover:bg-soft hover:text-danger cursor-pointer"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </div>
          ))}
          {units.packRows.length < 3 && (
            <button
              type="button"
              onClick={() => units.setPackRows([...units.packRows, { code: "", factor: "", price: "" }])}
              className="flex items-center gap-1 text-xs font-bold text-accent cursor-pointer"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add a pack size
            </button>
          )}
          {namedRows.length > 0 && (
            <SelectField
              label="Usually sold as"
              value={units.packDefaultUnit ?? ""}
              onChange={(value) => units.setPackDefaultUnit(value || null)}
              options={[{ value: "", label: baseUnit || "Single unit" }, ...namedRows.map((row) => ({ value: row.code.trim(), label: row.code.trim() }))]}
            />
          )}
          <p className="text-[11px] font-semibold text-muted">Leave the price empty to charge the pack at its pieces&apos; total.</p>
        </div>
      )}
    </div>
  );
}
