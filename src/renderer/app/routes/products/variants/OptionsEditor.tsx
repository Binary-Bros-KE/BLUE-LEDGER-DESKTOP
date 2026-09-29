import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { VariantOption } from "@shared/types/product";

const inputClass =
  "h-9 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15";

const OPTION_HINTS = ["e.g. Size", "e.g. Colour", "e.g. Material"];

/**
 * Up to 3 options (Size, Colour…), each a name plus value chips. Typing a value and pressing Enter
 * or comma adds it; pasting "S, M, L" adds all three. Renaming an option keeps its values.
 */
export function OptionsEditor({
  options,
  onChange
}: {
  options: VariantOption[];
  onChange: (next: VariantOption[]) => void;
}): React.JSX.Element {
  // Draft text per option row — raw, exactly as typed (never re-derived from the chips).
  const [drafts, setDrafts] = useState<string[]>(() => options.map(() => ""));

  function update(index: number, patch: Partial<VariantOption>): void {
    onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }

  function addValues(index: number, raw: string): void {
    const option = options[index];
    if (!option) return;
    const incoming = raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const next = [...option.values];
    for (const value of incoming) {
      if (!next.some((v) => v.toLowerCase() === value.toLowerCase())) next.push(value);
    }
    update(index, { values: next });
    setDrafts((prev) => prev.map((d, i) => (i === index ? "" : d)));
  }

  return (
    <div className="space-y-2.5">
      {options.map((option, index) => (
        <div key={index} className="rounded-lg border border-line bg-soft/60 p-3">
          <div className="flex items-start gap-2">
            <div className="w-40 flex-none">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Option</span>
              <input
                value={option.name}
                maxLength={30}
                onChange={(e) => update(index, { name: e.target.value })}
                placeholder={OPTION_HINTS[index] ?? "Option name"}
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted">
                Values — type and press Enter
              </span>
              <div className="mt-1 flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
                {option.values.map((value) => (
                  <span
                    key={value}
                    className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-xs font-bold text-ink"
                  >
                    {value}
                    <button
                      type="button"
                      aria-label={`Remove ${value}`}
                      onClick={() => update(index, { values: option.values.filter((v) => v !== value) })}
                      className="cursor-pointer text-muted hover:text-danger"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
                <input
                  value={drafts[index] ?? ""}
                  maxLength={200}
                  onChange={(e) => {
                    const text = e.target.value;
                    if (text.includes(",")) addValues(index, text);
                    else setDrafts((prev) => prev.map((d, i) => (i === index ? text : d)));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addValues(index, drafts[index] ?? "");
                    } else if (e.key === "Backspace" && !(drafts[index] ?? "") && option.values.length > 0) {
                      update(index, { values: option.values.slice(0, -1) });
                    }
                  }}
                  onBlur={() => {
                    if ((drafts[index] ?? "").trim()) addValues(index, drafts[index] ?? "");
                  }}
                  placeholder={option.values.length === 0 ? "e.g. S, M, L, XL" : ""}
                  className="h-6 min-w-24 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:font-normal placeholder:text-muted/60"
                />
              </div>
            </div>
            <button
              type="button"
              aria-label="Remove option"
              onClick={() => {
                onChange(options.filter((_, i) => i !== index));
                setDrafts((prev) => prev.filter((_, i) => i !== index));
              }}
              className="mt-5 grid size-9 flex-none cursor-pointer place-items-center rounded-lg border border-line bg-white text-muted transition hover:bg-danger-soft hover:text-danger"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
      {options.length < 3 && (
        <button
          type="button"
          onClick={() => {
            onChange([...options, { name: "", values: [] }]);
            setDrafts((prev) => [...prev, ""]);
          }}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-accent/60 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-accent transition hover:bg-accent/10"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add option
        </button>
      )}
    </div>
  );
}

/** Options that are complete enough to generate variants from (named, with values). */
export function usableOptions(options: VariantOption[]): VariantOption[] {
  return options
    .map((o) => ({ name: o.name.trim(), values: o.values }))
    .filter((o) => o.name && o.values.length > 0);
}

/** Order-insensitive identity of one combination — used as a React/state key. */
export function comboKey(values: Record<string, string>): string {
  return JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
}

/** A big two-way choice card for the stock mode. */
export function ModeCard({
  selected,
  onClick,
  title,
  body,
  example,
  tone
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  body: string;
  example: string;
  tone: "teal" | "accent";
}): React.JSX.Element {
  const toneClass =
    tone === "teal"
      ? selected
        ? "border-teal bg-teal/10 ring-4 ring-teal/15"
        : "border-line bg-teal/5 hover:border-teal/60"
      : selected
        ? "border-accent bg-accent/10 ring-4 ring-accent/15"
        : "border-line bg-accent/5 hover:border-accent/60";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer flex-col items-start rounded-xl border-2 p-4 text-left transition ${toneClass}`}
    >
      <span className="text-sm font-extrabold text-ink">{title}</span>
      <span className="mt-1 text-xs font-semibold text-muted">{body}</span>
      <span className="mt-3 rounded-md border border-dashed border-line bg-white/70 px-2 py-1 text-[11px] font-bold text-ink">
        {example}
      </span>
    </button>
  );
}
