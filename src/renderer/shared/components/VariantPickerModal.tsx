import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import { separateGroupMembers, type VariantPick } from "@renderer/shared/lib/variant-cart";
import { sameVariantValues, variantLabel } from "@shared/lib/variants";
import type { ProductListItem } from "@shared/types/product";

/**
 * "Which one?" popup when a product with variants is added to a cart (Checkout, Invoices,
 * Quotations). Shared stock: pick a value per option (with one option, one tap adds it). Separate
 * stock: pick one of the group's products, each with its own price and stock.
 */
export function VariantPickerModal({
  product,
  products,
  currency,
  stockOf,
  onPick,
  onClose
}: {
  product: ProductListItem;
  products: ProductListItem[];
  currency: string;
  /** stock to show per product (e.g. this storefront's) — defaults to the product's total */
  stockOf?: ((productId: string) => number | null) | undefined;
  onPick: (pick: VariantPick) => void;
  onClose: () => void;
}): React.JSX.Element {
  const config = product.variantConfig;
  const shared = config?.mode === "shared" ? config : null;
  const members = useMemo(() => (shared ? [] : separateGroupMembers(product, products)), [shared, product, products]);
  const groupMain = products.find((p) => p.id === product.variantGroupId);
  const groupOptions = groupMain?.variantConfig?.options ?? config?.options ?? [];
  const title = shared?.title ?? groupMain?.variantConfig?.title ?? config?.title ?? groupMain?.name ?? product.name;

  const [selected, setSelected] = useState<Record<string, string>>({});
  const activeVariants = shared ? shared.variants.filter((v) => v.active) : [];

  /** a value is pickable when some active variant has it AND agrees with the other picks so far */
  function available(optionName: string, value: string): boolean {
    return activeVariants.some(
      (v) =>
        v.values[optionName] === value &&
        Object.entries(selected).every(([name, picked]) => name === optionName || v.values[name] === picked)
    );
  }

  const resolved = shared
    ? activeVariants.find((v) => shared.options.every((o) => selected[o.name]) && sameVariantValues(v.values, selected)) ?? null
    : null;

  function pickShared(values: Record<string, string>): void {
    const variant = activeVariants.find((v) => sameVariantValues(v.values, values));
    if (!variant || !shared) return;
    onPick({ product, variantKey: variant.key, variantLabel: variantLabel(shared.options, variant.values) });
  }

  function choose(optionName: string, value: string): void {
    const next = { ...selected, [optionName]: value };
    // a pick that no longer fits the others clears them
    for (const [name, picked] of Object.entries(next)) {
      if (name !== optionName && !activeVariants.some((v) => v.values[optionName] === value && v.values[name] === picked)) {
        delete next[name];
      }
    }
    if (shared && shared.options.length === 1) {
      pickShared(next);
      return;
    }
    setSelected(next);
  }

  const stock = (p: ProductListItem): number => stockOf?.(p.id) ?? p.totalStock;

  return (
    <Modal open onClose={onClose} title={title} description="Choose the variant" widthClassName="max-w-xl">
      {shared ? (
        <div className="space-y-4">
          {shared.options.map((option) => (
            <div key={option.name}>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">{option.name}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {option.values.map((value) => {
                  const ok = available(option.name, value);
                  const isOn = selected[option.name] === value;
                  // with one option, show each value's own price right on its button
                  const single = shared.options.length === 1 ? activeVariants.find((v) => v.values[option.name] === value) : null;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={!ok}
                      onClick={() => choose(option.name, value)}
                      className={cn(
                        "min-w-16 rounded-lg border-2 px-3 py-2 text-left text-sm font-extrabold transition",
                        !ok
                          ? "cursor-not-allowed border-line bg-soft text-muted/50 line-through"
                          : isOn
                            ? "cursor-pointer border-primary bg-primary text-white"
                            : "cursor-pointer border-line bg-white text-ink hover:border-accent hover:bg-accent/10"
                      )}
                    >
                      {value}
                      {single ? (
                        <span className={cn("block text-[11px] font-bold", isOn ? "text-white/80" : "text-muted")}>
                          {currency} {formatCents(single.priceCents ?? product.sellingPriceCents)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {shared.options.length > 1 && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-soft/60 px-4 py-3">
              <div className="text-sm">
                {resolved ? (
                  <>
                    <p className="font-extrabold text-ink">{variantLabel(shared.options, resolved.values)}</p>
                    <p className="text-xs font-bold text-muted">
                      {currency} {formatCents(resolved.priceCents ?? product.sellingPriceCents)} · {stock(product)} in stock (shared)
                    </p>
                  </>
                ) : (
                  <p className="text-xs font-bold text-muted">Pick {shared.options.map((o) => o.name).join(" and ")}</p>
                )}
              </div>
              <Button type="button" disabled={!resolved} onClick={() => resolved && pickShared(resolved.values)} className="h-10 text-xs disabled:opacity-50">
                <Check className="mr-1.5 size-4" aria-hidden="true" />
                Add
              </Button>
            </div>
          )}
          {shared.options.length === 1 && (
            <p className="text-[11px] font-semibold text-muted">{stock(product)} in stock, shared by all variants</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {members.map((member) => {
            const qty = stock(member);
            const label = variantLabel(groupOptions, member.variantOptions) || member.name;
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => onPick({ product: member, variantKey: null, variantLabel: null })}
                className={cn(
                  "cursor-pointer rounded-lg border-2 px-3 py-2.5 text-left transition hover:border-accent hover:bg-accent/10",
                  member.id === product.id ? "border-accent/60 bg-accent/5" : "border-line bg-white"
                )}
              >
                <span className="block text-sm font-extrabold text-ink">{label}</span>
                <span className="block text-xs font-bold text-muted">
                  {currency} {formatCents(member.sellingPriceCents)}
                </span>
                <span className={cn("block text-[11px] font-bold", qty > 0 ? "text-success" : "text-danger")}>
                  {qty > 0 ? `${qty} in stock` : "Out of stock"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
