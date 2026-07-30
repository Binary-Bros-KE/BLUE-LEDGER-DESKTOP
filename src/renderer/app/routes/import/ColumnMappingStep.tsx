import { SelectField } from "@renderer/shared/components/form-fields";
import type { ImportColumnMapping, ImportFieldDefaults, ImportFieldDefinition } from "@shared/types/import";

/** Only shown once a field ISN'T mapped to any column — a real import file almost never has its
 * own "storefront" column (the whole file is for one shop) or "track stock"/"allow negative stock"
 * columns at all, so instead of forcing the user to fabricate a column full of the same repeated
 * value, they pick ONE value here and it's applied to every row. See import-service.ts's
 * buildRowCandidate — this only ever fills the same "blank" fallback a genuinely-empty mapped cell
 * would already hit, never overrides real column data. */
function DefaultForAllRows({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}): React.JSX.Element {
  return (
    <div className="mt-2 border-t border-line/60 pt-2">
      <SelectField label={label} value={value} onChange={onChange} options={options} />
    </div>
  );
}

export function ColumnMappingStep({
  fields,
  headers,
  mapping,
  onMappingChange,
  fieldDefaults,
  onFieldDefaultsChange,
  storefronts
}: {
  fields: ImportFieldDefinition[];
  headers: string[];
  mapping: ImportColumnMapping;
  onMappingChange: (mapping: ImportColumnMapping) => void;
  fieldDefaults: ImportFieldDefaults;
  onFieldDefaultsChange: (defaults: ImportFieldDefaults) => void;
  storefronts: Array<{ id: string; locationName: string }>;
}): React.JSX.Element {
  const headerOptions = [
    { value: "", label: "— Not mapped —" },
    ...headers.map((header) => ({ value: header, label: header }))
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field) => {
        const isMapped = Boolean(mapping[field.key]);
        return (
          <div key={field.key} className="rounded-lg border border-line bg-soft p-3">
            <SelectField
              label={`${field.label}${field.required ? " *" : ""}`}
              value={mapping[field.key] ?? ""}
              onChange={(value) => onMappingChange({ ...mapping, [field.key]: value || null })}
              options={headerOptions}
            />
            {field.kind === "enum" && field.enumOptions && (
              <p className="mt-1.5 text-[11px] font-semibold text-muted">
                Accepted: {field.enumOptions.map((option) => option.label).join(", ")}
              </p>
            )}

            {!isMapped && field.kind === "boolean" && (
              <DefaultForAllRows
                label="Default for every row"
                value={fieldDefaults[field.key] ?? ""}
                onChange={(value) => onFieldDefaultsChange({ ...fieldDefaults, [field.key]: value })}
                options={[
                  { value: "", label: field.key === "trackStock" ? "Yes (built-in default)" : "No (built-in default)" },
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" }
                ]}
              />
            )}

            {!isMapped && field.kind === "storefront" && (
              <DefaultForAllRows
                label="Assign every row to one storefront"
                value={fieldDefaults[field.key] ?? ""}
                onChange={(value) => onFieldDefaultsChange({ ...fieldDefaults, [field.key]: value })}
                options={[
                  { value: "", label: "— No default —" },
                  ...storefronts.map((storefront) => ({ value: storefront.id, label: storefront.locationName }))
                ]}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
