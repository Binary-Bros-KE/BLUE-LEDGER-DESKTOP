import { cn } from "@renderer/shared/lib/cn";

const fieldInputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15";

export function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  disabled = false,
  maxLength,
  placeholder,
  className
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <label className={cn("block", className)}>
      <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(fieldInputClass, disabled && "cursor-not-allowed bg-soft text-muted")}
      />
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  className
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <label className={cn("block", className)}>
      <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">{label}</span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(fieldInputClass, "h-auto resize-none p-3")}
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  className
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  className?: string;
}): React.JSX.Element {
  return (
    <label className={cn("block", className)}>
      <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldInputClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CheckboxField({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-soft px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 flex-none accent-primary"
      />
      <span>
        <span className="block text-sm font-bold text-ink">{label}</span>
        {description && <span className="block text-xs font-semibold text-muted">{description}</span>}
      </span>
    </label>
  );
}
