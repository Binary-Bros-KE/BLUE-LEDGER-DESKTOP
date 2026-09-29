import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Link2, Loader2, Star } from "lucide-react";
import { comboKey, ModeCard, OptionsEditor, usableOptions } from "@renderer/app/routes/products/variants/OptionsEditor";
import { Button } from "@renderer/shared/components/Button";
import { Field } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { variantCombinations, variantLabel } from "@shared/lib/variants";
import type { ProductListItem, VariantGroupView, VariantOption, VariantStockMode } from "@shared/types/product";

/** Per-combination edits. Money is raw text exactly as typed (converted to cents only on save). */
type RowEdit = {
  price: string;
  sku: string;
  barcode: string;
  /** shared: shown for sale · separate: part of the group */
  on: boolean;
  /** separate: the product already holding this combination (null = a new product will be made) */
  memberId: string | null;
  /** separate, new rows: optional name override */
  name: string;
  /** separate, new rows: "link an existing product instead" search text */
  linkText: string;
  linking: boolean;
  /** shared: the variant's stable key */
  key: string | null;
};

const cellInput =
  "h-8 w-full rounded-md border border-line bg-white px-2 text-xs font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/15";

function emptyRow(): RowEdit {
  return { price: "", sku: "", barcode: "", on: true, memberId: null, name: "", linkText: "", linking: false, key: null };
}

export function ProductVariantsModal({
  productId,
  currency,
  allProducts,
  onClose,
  onChanged
}: {
  productId: string;
  currency: string;
  /** for "link an existing product" in separate-stock mode */
  allProducts: ProductListItem[];
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const datalistId = useId();
  const [view, setView] = useState<VariantGroupView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<VariantStockMode | null>(null);
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState<VariantOption[]>([{ name: "Size", values: [] }]);
  const [rows, setRows] = useState<Record<string, RowEdit>>({});
  const [mainKey, setMainKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function hydrate(v: VariantGroupView): void {
    setView(v);
    setMode(v.mode);
    setTitle(v.title ?? "");
    if (v.options.length > 0) setOptions(v.options);
    const next: Record<string, RowEdit> = {};
    if (v.mode === "shared") {
      for (const variant of v.variants) {
        next[comboKey(variant.values)] = {
          ...emptyRow(),
          price: variant.priceCents === null ? "" : fromCents(variant.priceCents),
          sku: variant.sku ?? "",
          barcode: variant.barcode ?? "",
          on: variant.active,
          key: variant.key
        };
      }
    } else if (v.mode === "separate") {
      for (const member of v.members) {
        const k = comboKey(member.values);
        next[k] = { ...emptyRow(), price: fromCents(member.sellingPriceCents), barcode: member.barcode ?? "", memberId: member.productId };
        if (member.isMain) setMainKey(k);
      }
    }
    setRows(next);
  }

  useEffect(() => {
    window.blueLedger.product
      .variantGet(productId)
      .then(hydrate)
      .catch((err) => setLoadError(getErrorMessage(err, "Failed to load variants")));
  }, [productId]);

  const usable = useMemo(() => usableOptions(options), [options]);
  const combos = useMemo(() => (usable.length > 0 ? variantCombinations(usable) : []), [usable]);
  const comboKeys = useMemo(() => combos.map(comboKey), [combos]);

  // separate mode: the main product always sits on exactly one combination
  const effectiveMainKey = mainKey && comboKeys.includes(mainKey) ? mainKey : (comboKeys[0] ?? null);

  function rowFor(k: string): RowEdit {
    const existing = rows[k];
    if (existing) return existing;
    const base = emptyRow();
    if (mode === "separate" && view) base.price = fromCents(view.mainPriceCents);
    return base;
  }

  function patchRow(k: string, patch: Partial<RowEdit>): void {
    setRows((prev) => ({ ...prev, [k]: { ...rowFor(k), ...prev[k], ...patch } }));
  }

  const productByLinkText = useMemo(() => {
    const map = new Map<string, ProductListItem>();
    for (const p of allProducts) map.set(`${p.name} · ${p.sku}`, p);
    return map;
  }, [allProducts]);

  // separate: members whose combination no longer exists after an options edit get unlinked on save
  const orphanedMembers =
    view && mode === "separate" && view.mode === "separate"
      ? view.members.filter((m) => !m.isMain && !comboKeys.includes(comboKey(m.values)))
      : [];

  const baseName = title.trim() || view?.mainName || "";

  async function handleSave(): Promise<void> {
    if (!view || !mode) return;
    setError(null);
    if (usable.length === 0 || combos.length === 0) {
      setError("Add at least one option with values, e.g. Size: S, M, L");
      return;
    }
    if (combos.length > 300) {
      setError(`That makes ${combos.length} combinations — keep it under 300`);
      return;
    }
    setSaving(true);
    try {
      let next: VariantGroupView;
      if (mode === "shared") {
        next = await window.blueLedger.product.variantSaveShared({
          productId: view.mainProductId,
          title: title.trim() || null,
          options: usable,
          variants: combos.map((values) => {
            const r = rowFor(comboKey(values));
            return {
              key: r.key,
              values,
              priceCents: r.price.trim() ? toCents(r.price.trim()) : null,
              sku: r.sku.trim() || null,
              barcode: r.barcode.trim() || null,
              active: r.on
            };
          })
        });
      } else {
        const members = combos.flatMap((values) => {
          const k = comboKey(values);
          const r = rowFor(k);
          const isMain = k === effectiveMainKey;
          if (!isMain && !r.on) return [];
          const memberId = isMain ? view.mainProductId : r.memberId === view.mainProductId ? null : r.memberId;
          if (!isMain && !memberId && r.linking && r.linkText.trim()) {
            const linked = productByLinkText.get(r.linkText.trim());
            if (!linked) throw new Error(`"${r.linkText.trim()}" — pick a product from the suggestions`);
            // a linked product keeps its own price and barcode (those fields are disabled while linking)
            return [
              { productId: linked.id, values, name: null, sellingPriceCents: linked.sellingPriceCents, barcode: linked.barcode }
            ];
          }
          return [
            {
              productId: memberId,
              values,
              name: !memberId && r.name.trim() ? r.name.trim() : null,
              sellingPriceCents: toCents(r.price.trim() || "0"),
              barcode: r.barcode.trim() || null
            }
          ];
        });
        next = await window.blueLedger.product.variantSaveSeparate({
          productId: view.mainProductId,
          title: title.trim() || null,
          options: usable,
          members
        });
      }
      hydrate(next);
      showSuccessToast("Variants saved");
      onChanged();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save variants");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(): Promise<void> {
    if (!view) return;
    const msg =
      view.mode === "separate"
        ? "Ungroup these products? Every product stays exactly as it is (stock, price, history) — they just stop being variants of one another."
        : "Remove all variants from this product? Its stock stays as it is. Past sales keep their variant names.";
    if (!window.confirm(msg)) return;
    setSaving(true);
    try {
      hydrate(await window.blueLedger.product.variantRemove(view.mainProductId));
      setOptions([{ name: "Size", values: [] }]);
      setMainKey(null);
      showSuccessToast("Variants removed");
      onChanged();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to remove variants");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  const locked = view?.mode !== null && view?.mode !== undefined; // mode can only change after removing

  return (
    <Modal
      open
      onClose={onClose}
      title={view ? `Variants — ${view.mainName}` : "Variants"}
      description="Sizes, colours and other versions of this product"
      widthClassName="max-w-5xl"
    >
      {loadError ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{loadError}</div>
      ) : !view ? (
        <div className="flex min-h-[200px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <div className="space-y-5">
          {view.mainProductId !== productId && (
            <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-bold text-ink">
              This product is a variant in a group — showing the whole group, managed from its main product
              “{view.mainName}”.
            </p>
          )}

          <section>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">1 · How is stock kept?</p>
            {locked ? (
              <p className="mt-2 inline-flex items-center gap-2 rounded-lg border border-line bg-soft px-3 py-2 text-xs font-bold text-ink">
                {mode === "shared" ? "Shared stock — one count for all variants" : "Separate stock — each variant is its own product"}
                <span className="font-semibold text-muted">(remove the variants to change this)</span>
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ModeCard
                  tone="teal"
                  selected={mode === "shared"}
                  onClick={() => setMode("shared")}
                  title="Shared stock"
                  body="One stock count for the product. Each variant can still have its own price, SKU and barcode."
                  example={`Stays one product: ${view.mainName} (${view.mainTotalStock} in stock)`}
                />
                <ModeCard
                  tone="accent"
                  selected={mode === "separate"}
                  onClick={() => setMode("separate")}
                  title="Separate stock"
                  body="Each variant is counted on its own — it becomes its own product with its own stock, price and barcode."
                  example="e.g. shoes by size, where you need to know how many of each size you have"
                />
              </div>
            )}
          </section>

          {mode && (
            <>
              <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">2 · Group name</p>
                  <Field
                    label="Shown at checkout and on the website"
                    value={title}
                    onChange={setTitle}
                    maxLength={120}
                    placeholder={view.mainName}
                    className="mt-1"
                  />
                </div>
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">3 · Options</p>
                  <div className="mt-1.5">
                    <OptionsEditor options={options} onChange={setOptions} />
                  </div>
                </div>
              </section>

              <section>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                    4 · Variants ({combos.length})
                  </p>
                  <p className="text-[11px] font-semibold text-muted">
                    {mode === "shared"
                      ? "Leave price blank to use the product's own price. Untick a combination you don't sell."
                      : "Untick a combination you don't sell. New products start with 0 stock — add stock as usual."}
                  </p>
                </div>

                {combos.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed border-line bg-soft/60 p-4 text-sm font-semibold text-muted">
                    Add an option and its values above to see the variants.
                  </p>
                ) : (
                  <div className="mt-2 max-h-[46vh] overflow-auto rounded-lg border border-line">
                    <table className="w-full min-w-[760px] border-collapse text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-primary text-white">
                          <Th className="w-12">{mode === "shared" ? "Sell" : "Use"}</Th>
                          <Th>Variant</Th>
                          {mode === "separate" && <Th>Product</Th>}
                          <Th className="w-32 text-right">Price ({currency})</Th>
                          {mode === "shared" && <Th className="w-32">SKU</Th>}
                          <Th className="w-36">Barcode</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {combos.map((values) => {
                          const k = comboKey(values);
                          const r = rowFor(k);
                          const label = variantLabel(usable, values);
                          const isMain = mode === "separate" && k === effectiveMainKey;
                          const member =
                            mode === "separate"
                              ? isMain
                                ? view.members.find((m) => m.isMain) ?? null
                                : r.memberId && r.memberId !== view.mainProductId
                                  ? view.members.find((m) => m.productId === r.memberId) ?? null
                                  : null
                              : null;
                          return (
                            <tr key={k} className={cn("border-t border-line", r.on || isMain ? "bg-white" : "bg-soft/70 text-muted")}>
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={isMain || r.on}
                                  disabled={isMain}
                                  onChange={(e) => patchRow(k, { on: e.target.checked })}
                                  aria-label={`Use ${label}`}
                                  className="size-4 accent-primary"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <span className="font-extrabold text-ink">{label}</span>
                              </td>
                              {mode === "separate" && (
                                <td className="px-3 py-2">
                                  {isMain ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink">
                                      <Star className="size-3.5 text-warning" aria-hidden="true" />
                                      {view.mainName}
                                      <span className="font-semibold text-muted">· this product</span>
                                    </span>
                                  ) : member ? (
                                    <span className="text-xs font-bold text-ink">
                                      {member.name}
                                      <span className="font-semibold text-muted"> · {member.totalStock} in stock</span>
                                    </span>
                                  ) : r.linking ? (
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        list={datalistId}
                                        value={r.linkText}
                                        onChange={(e) => patchRow(k, { linkText: e.target.value })}
                                        placeholder="Search an existing product"
                                        className={cellInput}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => patchRow(k, { linking: false, linkText: "" })}
                                        className="flex-none cursor-pointer text-[10px] font-extrabold uppercase text-muted hover:underline"
                                      >
                                        New
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        value={r.name}
                                        maxLength={200}
                                        onChange={(e) => patchRow(k, { name: e.target.value })}
                                        placeholder={`New: ${baseName} - ${label}`}
                                        className={cellInput}
                                      />
                                      <button
                                        type="button"
                                        title="Link an existing product instead"
                                        onClick={() => patchRow(k, { linking: true })}
                                        className="grid size-8 flex-none cursor-pointer place-items-center rounded-md border border-line text-muted transition hover:bg-soft hover:text-ink"
                                      >
                                        <Link2 className="size-3.5" aria-hidden="true" />
                                      </button>
                                    </div>
                                  )}
                                </td>
                              )}
                              <td className="px-3 py-2">
                                <input
                                  value={r.price}
                                  inputMode="decimal"
                                  onChange={(e) => patchRow(k, { price: e.target.value })}
                                  placeholder={mode === "shared" ? fromCents(view.mainPriceCents) : "0.00"}
                                  className={cn(cellInput, "text-right tabular-nums")}
                                  disabled={mode === "separate" && r.linking}
                                />
                              </td>
                              {mode === "shared" && (
                                <td className="px-3 py-2">
                                  <input
                                    value={r.sku}
                                    maxLength={64}
                                    onChange={(e) => patchRow(k, { sku: e.target.value })}
                                    placeholder="optional"
                                    className={cellInput}
                                  />
                                </td>
                              )}
                              <td className="px-3 py-2">
                                <input
                                  value={r.barcode}
                                  maxLength={64}
                                  onChange={(e) => patchRow(k, { barcode: e.target.value })}
                                  placeholder="optional"
                                  className={cellInput}
                                  disabled={mode === "separate" && r.linking}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {mode === "separate" && combos.length > 0 && (
                  <label className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-ink">
                    <Star className="size-3.5 text-warning" aria-hidden="true" />
                    This product (“{view.mainName}”) is the variant:
                    <select
                      value={effectiveMainKey ?? ""}
                      onChange={(e) => {
                        const nextKey = e.target.value;
                        const holder = rows[nextKey];
                        if (holder?.memberId && holder.memberId !== view.mainProductId) {
                          showErrorToast("Another product already is that variant — pick a free one");
                          return;
                        }
                        if (effectiveMainKey) patchRow(effectiveMainKey, { memberId: null, price: fromCents(view.mainPriceCents) });
                        patchRow(nextKey, { memberId: view.mainProductId, price: fromCents(view.mainPriceCents), on: true });
                        setMainKey(nextKey);
                      }}
                      className="h-8 rounded-md border border-line bg-white px-2 text-xs font-bold outline-none focus:border-accent"
                    >
                      {combos.map((values) => (
                        <option key={comboKey(values)} value={comboKey(values)}>
                          {variantLabel(usable, values)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {orphanedMembers.length > 0 && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-bold text-ink">
                    <AlertTriangle className="mt-0.5 size-3.5 flex-none text-warning" aria-hidden="true" />
                    No longer matching any variant, so they'll leave the group (the products themselves are kept):{" "}
                    {orphanedMembers.map((m) => m.name).join(", ")}
                  </p>
                )}
              </section>
            </>
          )}

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              {view.mode && (
                <Button
                  type="button"
                  onClick={() => void handleRemove()}
                  disabled={saving}
                  className="h-9 border border-danger/40 bg-white text-xs text-danger shadow-none hover:bg-danger-soft"
                >
                  {view.mode === "separate" ? "Ungroup" : "Remove variants"}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={onClose} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
                Close
              </Button>
              {mode && (
                <Button type="button" onClick={() => void handleSave()} disabled={saving} className="h-9 text-xs disabled:opacity-50">
                  {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                  Save variants
                </Button>
              )}
            </div>
          </div>

          <datalist id={datalistId}>
            {allProducts
              .filter((p) => p.id !== view.mainProductId && !p.variantGroupId && !p.variantConfig && p.status === "active")
              .map((p) => (
                <option key={p.id} value={`${p.name} · ${p.sku}`} />
              ))}
          </datalist>
        </div>
      )}
    </Modal>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>{children}</th>
  );
}
