import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { allowsDecimals, baseToAmount, unitChoices, unitFactor } from "@shared/lib/product-units";
import type { ProductListItem } from "@shared/types/product";

/**
 * A cart/document line's quantity, in the unit it's being sold in. `quantity` is always whole base
 * units: "1.5" with kg selected is 1500 of g (shared/lib/product-units.ts). Switching unit keeps the
 * same physical amount where it can; a pack only sells whole, so switching to it rounds to whole
 * packs, never below one. A product with one unit gets just the number, as before.
 */
export function LineQuantityField({
  product,
  quantity,
  unitCode,
  onQuantityChange,
  onUnitChange,
  stepper = false
}: {
  product: Pick<ProductListItem, "unitOfMeasure" | "unitConfig">;
  quantity: number;
  unitCode: string | null;
  onQuantityChange: (quantity: number) => void;
  /** Also resets a typed price, which was per the old unit — the caller does that. */
  onUnitChange: (unitCode: string | null, quantity: number) => void;
  /** +/- buttons either side (Checkout's cart). */
  stepper?: boolean;
}): React.JSX.Element {
  const config = product.unitConfig;
  const factor = unitFactor(config, unitCode);
  const decimals = allowsDecimals(config, unitCode);
  // Only while typing, so the field can be emptied on the way to a new number.
  const [draft, setDraft] = useState<string | null>(null);

  function handleType(text: string): void {
    const cleaned = decimals ? text.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1") : text.replace(/\D/g, "");
    setDraft(cleaned);
    const next = Math.round(Number(cleaned) * factor);
    if (next >= 1) onQuantityChange(next);
  }

  function switchUnit(next: string | null): void {
    if (next === unitCode) return;
    const nextFactor = unitFactor(config, next);
    setDraft(null);
    onUnitChange(next, config?.kind === "pack" ? Math.max(1, Math.round(quantity / nextFactor)) * nextFactor : quantity);
  }

  const choices = unitChoices(product.unitOfMeasure, config);

  return (
    <div className="flex items-center gap-1">
      {stepper && (
        <button
          type="button"
          onClick={() => onQuantityChange(quantity - factor)}
          disabled={quantity <= factor}
          className="grid size-7 place-items-center rounded-md border border-line text-muted transition hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
        >
          <Minus className="size-3" aria-hidden="true" />
        </button>
      )}
      <input
        type="text"
        inputMode={decimals ? "decimal" : "numeric"}
        value={draft ?? String(baseToAmount(quantity, config, unitCode))}
        onChange={(event) => handleType(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={() => setDraft(null)}
        aria-label="Quantity"
        className="h-7 w-12 rounded-md border border-line text-center text-xs font-bold outline-none focus:border-accent"
      />
      {stepper && (
        <button
          type="button"
          onClick={() => onQuantityChange(quantity + factor)}
          className="grid size-7 place-items-center rounded-md border border-line text-muted transition hover:bg-soft cursor-pointer"
        >
          <Plus className="size-3" aria-hidden="true" />
        </button>
      )}
      {choices.length > 1 && (
        <div className="flex flex-none rounded-md bg-soft p-0.5">
          {choices.map((choice) => (
            <button
              key={choice.code ?? "__base__"}
              type="button"
              onClick={() => switchUnit(choice.code)}
              aria-pressed={unitCode === choice.code}
              className={`rounded px-1.5 py-0.5 text-[11px] font-bold cursor-pointer ${unitCode === choice.code ? "bg-white text-ink shadow-sm" : "text-muted"}`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
