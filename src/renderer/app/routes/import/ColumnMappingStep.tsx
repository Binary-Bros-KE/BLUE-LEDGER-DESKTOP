import { SelectField } from "@renderer/shared/components/form-fields";
import type { ImportColumnMapping, ImportFieldDefinition } from "@shared/types/import";

export function ColumnMappingStep({
  fields,
  headers,
  mapping,
  onChange
}: {
  fields: ImportFieldDefinition[];
  headers: string[];
  mapping: ImportColumnMapping;
  onChange: (mapping: ImportColumnMapping) => void;
}): React.JSX.Element {
  const headerOptions = [
    { value: "", label: "— Not mapped —" },
    ...headers.map((header) => ({ value: header, label: header }))
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field) => (
        <div key={field.key} className="rounded-lg border border-line bg-soft p-3">
          <SelectField
            label={`${field.label}${field.required ? " *" : ""}`}
            value={mapping[field.key] ?? ""}
            onChange={(value) => onChange({ ...mapping, [field.key]: value || null })}
            options={headerOptions}
          />
          {field.kind === "enum" && field.enumOptions && (
            <p className="mt-1.5 text-[11px] font-semibold text-muted">
              Accepted: {field.enumOptions.map((option) => option.label).join(", ")}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
