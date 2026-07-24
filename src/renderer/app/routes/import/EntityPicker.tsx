import { IMPORT_ENTITY_OPTIONS, type ImportEntityType } from "@shared/types/import";

export function EntityPicker({
  value,
  onChange
}: {
  value: ImportEntityType;
  onChange: (value: ImportEntityType) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {IMPORT_ENTITY_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`h-10 cursor-pointer rounded-lg border px-4 text-sm font-bold transition ${
              active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-soft"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
