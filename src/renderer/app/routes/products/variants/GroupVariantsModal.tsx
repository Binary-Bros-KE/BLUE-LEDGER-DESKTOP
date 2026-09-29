import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, Star, X } from "lucide-react";
import { comboKey, ModeCard } from "@renderer/app/routes/products/variants/OptionsEditor";
import { Button } from "@renderer/shared/components/Button";
import { Field } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { ProductListItem, VariantOption, VariantStockMode } from "@shared/types/product";

const SEPARATORS = /^[\s\-–—/|,:(]+|[\s\-–—/|,:)]+$/g;

/** The words every name starts with — "Shirt Cotton - S" + "Shirt Cotton - M" → "Shirt Cotton". */
function commonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  const split = names.map((n) => n.split(/(\s+)/));
  const first = split[0]!;
  let end = 0;
  for (let i = 0; i < first.length; i++) {
    if (split.every((words) => words[i]?.toLowerCase() === first[i]!.toLowerCase())) end = i + 1;
    else break;
  }
  return first.slice(0, end).join("").replace(SEPARATORS, "").trim();
}

function remainder(name: string, prefix: string): string {
  const rest = name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length) : name;
  return rest.replace(SEPARATORS, "").trim();
}

const cellInput =
  "h-8 w-full rounded-md border border-line bg-white px-2 text-xs font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/15";

/**
 * Group products that already exist ("Shirt - S", "Shirt - M"…) into one product with variants.
 *  - Separate stock: they're linked — every product keeps its own stock, price and history.
 *  - Shared stock: merged into the main product — stock moved in, the others deactivated.
 */
export function GroupVariantsModal({
  products,
  currency,
  onClose,
  onDone
}: {
  products: ProductListItem[];
  currency: string;
  onClose: () => void;
  onDone: (message: string) => void;
}): React.JSX.Element {
  const prefix = useMemo(() => commonPrefix(products.map((p) => p.name)), [products]);
  const [mode, setMode] = useState<VariantStockMode | null>(null);
  const [mainId, setMainId] = useState(
    () => [...products].sort((a, b) => b.totalStock - a.totalStock)[0]?.id ?? ""
  );
  const [title, setTitle] = useState(prefix);
  const [rename, setRename] = useState(true);
  const [optionNames, setOptionNames] = useState<string[]>(["Size"]);
  // values[productId][optionIndex] — raw text as typed
  const [values, setValues] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(products.map((p) => [p.id, [remainder(p.name, prefix)]]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const main = products.find((p) => p.id === mainId) ?? products[0];
  const others = products.filter((p) => p.id !== main?.id);
  const movedUnits = others.reduce((sum, p) => sum + p.totalStock, 0);
  const alreadyVariant = products.filter((p) => p.variantGroupId || p.variantConfig);

  function valueOf(productId: string, index: number): string {
    return values[productId]?.[index] ?? "";
  }

  function setValue(productId: string, index: number, text: string): void {
    setValues((prev) => {
      const row = [...(prev[productId] ?? [])];
      row[index] = text;
      return { ...prev, [productId]: row };
    });
  }

  /** Build the options + per-product values, or return an error to show. */
  function build(): { options: VariantOption[]; entries: Array<{ productId: string; values: Record<string, string> }> } | string {
    const names = optionNames.map((n) => n.trim());
    if (names.some((n) => !n)) return "Give every option a name, e.g. Size";
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return "Option names must be different";
    const entries = products.map((p) => ({
      productId: p.id,
      values: Object.fromEntries(names.map((n, i) => [n, valueOf(p.id, i).trim()]))
    }));
    const missing = entries.find((e) => Object.values(e.values).some((v) => !v));
    if (missing) {
      return `Fill in every value — "${products.find((p) => p.id === missing.productId)?.name}" is missing one`;
    }
    const seen = new Map<string, string>();
    for (const e of entries) {
      const k = comboKey(Object.fromEntries(Object.entries(e.values).map(([a, b]) => [a, b.toLowerCase()])));
      const name = products.find((p) => p.id === e.productId)?.name ?? "";
      if (seen.has(k)) return `"${seen.get(k)}" and "${name}" have the same values — each needs a different one`;
      seen.set(k, name);
    }
    // canonical spelling = first one typed, so "xl" and "XL" don't become two values
    const options = names.map((n) => {
      const list: string[] = [];
      for (const e of entries) {
        const v = e.values[n]!;
        const canonical = list.find((x) => x.toLowerCase() === v.toLowerCase());
        if (canonical) e.values[n] = canonical;
        else list.push(v);
      }
      return { name: n, values: list };
    });
    return { options, entries };
  }

  async function handleSave(): Promise<void> {
    if (!mode || !main) return;
    setError(null);
    const built = build();
    if (typeof built === "string") {
      setError(built);
      return;
    }
    if (
      mode === "shared" &&
      !window.confirm(
        `Merge ${others.length} product${others.length === 1 ? "" : "s"} into "${rename && title.trim() ? title.trim() : main.name}"?\n\n` +
          `• ${movedUnits} unit${movedUnits === 1 ? "" : "s"} of stock move into it (recorded as stock adjustments)\n` +
          `• their barcodes move to their variant, so scanning still works\n` +
          `• they are deactivated — their sales history is kept\n\nThis can't be undone automatically.`
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      if (mode === "shared") {
        await window.blueLedger.product.variantMerge({
          mainProductId: main.id,
          title: title.trim() || null,
          newName: rename && title.trim() && title.trim() !== main.name ? title.trim() : null,
          options: built.options,
          entries: built.entries
        });
      } else {
        await window.blueLedger.product.variantSaveSeparate({
          productId: main.id,
          title: title.trim() || null,
          options: built.options,
          members: built.entries.map((e) => {
            const p = products.find((x) => x.id === e.productId)!;
            return { productId: p.id, values: e.values, name: null, sellingPriceCents: p.sellingPriceCents, barcode: p.barcode };
          })
        });
      }
      const message =
        mode === "shared"
          ? `Merged ${products.length} products into one product with ${products.length} variants.`
          : `Grouped ${products.length} products as variants.`;
      showSuccessToast(message);
      onDone(message);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to group products");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Group as variants"
      description={`${products.length} products become variants of one product`}
      widthClassName="max-w-4xl"
    >
      <div className="space-y-5">
        {alreadyVariant.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-bold text-ink">
            <AlertTriangle className="mt-0.5 size-3.5 flex-none text-warning" aria-hidden="true" />
            Already variants: {alreadyVariant.map((p) => p.name).join(", ")}. Ungroup those first, or add products to an
            existing group from its Variants button.
          </p>
        )}

        <section>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">1 · How is stock kept?</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModeCard
              tone="accent"
              selected={mode === "separate"}
              onClick={() => setMode("separate")}
              title="Separate stock — link them"
              body="Nothing is merged. Every product keeps its own stock, price, barcode and history; they're just shown as one product with options."
              example="Safe for anything you count per size"
            />
            <ModeCard
              tone="teal"
              selected={mode === "shared"}
              onClick={() => setMode("shared")}
              title="Shared stock — merge them"
              body="They become ONE product with one stock count. Stock is moved into the main product and the others are deactivated."
              example="For variants you never count apart, e.g. colours"
            />
          </div>
        </section>

        {mode && main && (
          <>
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Group name (checkout & website)"
                value={title}
                onChange={setTitle}
                maxLength={120}
                placeholder={main.name}
              />
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Options</span>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {optionNames.map((name, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <input
                        value={name}
                        maxLength={30}
                        onChange={(e) => setOptionNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))}
                        placeholder={i === 0 ? "Size" : "Colour"}
                        className="h-10 w-32 rounded-lg border border-line bg-white px-3 text-sm font-semibold outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
                      />
                      {optionNames.length > 1 && (
                        <button
                          type="button"
                          aria-label="Remove option"
                          onClick={() => {
                            setOptionNames((prev) => prev.filter((_, j) => j !== i));
                            setValues((prev) =>
                              Object.fromEntries(Object.entries(prev).map(([id, row]) => [id, row.filter((_, j) => j !== i)]))
                            );
                          }}
                          className="cursor-pointer text-muted hover:text-danger"
                        >
                          <X className="size-4" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  ))}
                  {optionNames.length < 3 && (
                    <button
                      type="button"
                      onClick={() => setOptionNames((prev) => [...prev, ""])}
                      className="inline-flex h-10 cursor-pointer items-center gap-1 rounded-lg border border-dashed border-accent/60 px-3 text-[11px] font-extrabold uppercase text-accent hover:bg-accent/10"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      Option
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                2 · Which variant is each product? <span className="normal-case text-muted">(guessed from the names — check them)</span>
              </p>
              <div className="mt-2 max-h-[40vh] overflow-auto rounded-lg border border-line">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-primary text-white">
                      <th className="w-16 px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Main</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
                      {optionNames.map((n, i) => (
                        <th key={i} className="w-36 px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">
                          {n || `Option ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id} className={cn("border-t border-line", p.id === main.id ? "bg-warning/10" : "bg-white")}>
                        <td className="px-3 py-2">
                          <input
                            type="radio"
                            name="variant-main"
                            checked={p.id === main.id}
                            onChange={() => setMainId(p.id)}
                            aria-label={`Make ${p.name} the main product`}
                            className="size-4 accent-primary"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <p className="line-clamp-2 text-xs font-extrabold text-ink">
                            {p.id === main.id && <Star className="mr-1 inline size-3.5 text-warning" aria-hidden="true" />}
                            {p.name}
                          </p>
                          <p className="text-[11px] font-semibold text-muted">
                            {p.totalStock} in stock · {currency} {formatCents(p.sellingPriceCents)}
                          </p>
                        </td>
                        {optionNames.map((_, i) => (
                          <td key={i} className="px-3 py-2">
                            <input
                              value={valueOf(p.id, i)}
                              maxLength={40}
                              onChange={(e) => setValue(p.id, i, e.target.value)}
                              placeholder="e.g. XL"
                              className={cellInput}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {mode === "shared" ? (
              <section className="space-y-3 rounded-lg border border-teal/40 bg-teal/5 p-4">
                <label className="flex items-center gap-2 text-sm font-bold text-ink">
                  <input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} className="size-4 accent-primary" />
                  Rename “{main.name}” to the group name
                </label>
                <ul className="space-y-1 text-xs font-semibold text-ink">
                  <li>
                    • {movedUnits} unit{movedUnits === 1 ? "" : "s"} from the other {others.length} product
                    {others.length === 1 ? "" : "s"} move into “{main.name}” at the same locations (stock adjustments).
                  </li>
                  <li>• A variant priced differently from the main product keeps its own price.</li>
                  <li>• Their barcodes move onto their variant; the products are deactivated, their history kept.</li>
                </ul>
              </section>
            ) : (
              <p className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-xs font-semibold text-ink">
                Nothing moves: every product keeps its stock, price, barcode and history. You can ungroup any time.
              </p>
            )}
          </>
        )}

        {error && <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>}

        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button type="button" onClick={onClose} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!mode || saving || alreadyVariant.length > 0}
            className="h-9 text-xs disabled:opacity-50"
          >
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
            {mode === "shared" ? "Merge into one product" : "Group as variants"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
