import { useEffect, useMemo, useState } from "react";
import { Loader2, Printer, Search } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { SelectField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import {
  buildPriceTagsMarkup,
  PRICE_TAG_SIZE_OPTIONS,
  priceTagFor,
  priceTagLayout,
  type PriceTagSize
} from "@shared/lib/price-tags";
import type { PriceTagPrinters } from "@shared/types/price-tags";
import type { ProductListItem } from "@shared/types/product";

// The tag size and printer belong to this computer's printer, so they're remembered per machine.
const SIZE_KEY = "blue-ledger.price-tags.size";
const PRINTER_KEY = "blue-ledger.price-tags.printer";
const PREVIEW_LIMIT = 6;

function readSetting(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // remembering the choice is only a convenience
  }
}

/** Shelf price tags for a batch of products: pick products (search, category, or the products already
 * ticked on the Products tab), set copies, then print to the receipt printer or a label printer. */
export function PriceTagsModal({
  open,
  onClose,
  products,
  categoryOptions,
  initialSelectedIds,
  currency
}: {
  open: boolean;
  onClose: () => void;
  products: ProductListItem[];
  categoryOptions: ReadonlyArray<{ value: string; label: string }>;
  initialSelectedIds: string[];
  currency: string;
}): React.JSX.Element {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [copies, setCopies] = useState<Map<string, number>>(new Map());
  const [size, setSize] = useState<PriceTagSize>("40x30");
  const [printerName, setPrinterName] = useState("");
  const [printerInfo, setPrinterInfo] = useState<PriceTagPrinters | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearchTerm("");
    setCategoryFilter("");
    setCopies(new Map(initialSelectedIds.map((id) => [id, 1])));
    const savedSize = readSetting(SIZE_KEY);
    if (PRICE_TAG_SIZE_OPTIONS.some((option) => option.value === savedSize)) setSize(savedSize as PriceTagSize);
    setPrinterName(readSetting(PRINTER_KEY));
    window.blueLedger.printer
      .priceTagPrinters()
      .then(setPrinterInfo)
      .catch(() => setPrinterInfo({ printers: [], receiptPrinter: null, rollWidthMm: 72 }));
    // initialSelectedIds is read once per opening, on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeProducts = useMemo(() => products.filter((product) => product.status === "active"), [products]);
  const shownProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return activeProducts.filter((product) => {
      if (categoryFilter && product.categoryId !== categoryFilter) return false;
      if (!term) return true;
      return `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLowerCase().includes(term);
    });
  }, [activeProducts, searchTerm, categoryFilter]);

  const selected = useMemo(() => activeProducts.filter((product) => copies.has(product.id)), [activeProducts, copies]);
  const totalTags = selected.reduce((sum, product) => sum + (copies.get(product.id) ?? 1), 0);
  const allShownSelected = shownProducts.length > 0 && shownProducts.every((product) => copies.has(product.id));

  function toggle(productId: string): void {
    setCopies((current) => {
      const next = new Map(current);
      if (next.has(productId)) next.delete(productId);
      else next.set(productId, 1);
      return next;
    });
  }

  function toggleAllShown(): void {
    setCopies((current) => {
      const next = new Map(current);
      for (const product of shownProducts) {
        if (allShownSelected) next.delete(product.id);
        else if (!next.has(product.id)) next.set(product.id, 1);
      }
      return next;
    });
  }

  function setCopiesFor(productId: string, value: string): void {
    const count = Math.max(1, Math.min(500, Math.floor(Number(value)) || 1));
    setCopies((current) => new Map(current).set(productId, count));
  }

  const rollWidthMm = printerInfo?.rollWidthMm ?? 72;
  const layout = useMemo(() => priceTagLayout(size, rollWidthMm), [size, rollWidthMm]);
  const preview = useMemo(() => {
    const tags = selected.slice(0, PREVIEW_LIMIT).map((product) => priceTagFor(product, currency));
    const { css, body } = buildPriceTagsMarkup(tags, layout);
    // On screen every tag gets an outline so sticker edges are visible.
    return `<style>${css} .bl-tags { display: flex; flex-wrap: wrap; gap: 8px; } .bl-tags .tag { outline: 1px solid #cbd5e1; }</style>${body}`;
  }, [selected, currency, layout]);

  const printerOptions = [
    {
      value: "",
      label: printerInfo?.receiptPrinter ? `Receipt printer (${printerInfo.receiptPrinter})` : "Windows default printer"
    },
    ...(printerInfo?.printers ?? []).map((name) => ({ value: name, label: name }))
  ];

  async function handlePrint(): Promise<void> {
    setPrinting(true);
    try {
      writeSetting(SIZE_KEY, size);
      writeSetting(PRINTER_KEY, printerName);
      const result = await window.blueLedger.printer.printPriceTags({
        size,
        printerName,
        items: selected.map((product) => ({ productId: product.id, copies: copies.get(product.id) ?? 1 }))
      });
      if (result.success) {
        showSuccessToast(result.message);
        onClose();
      } else {
        showErrorToast(result.message);
      }
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to print price tags"));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Print Price Tags"
      description="Pick products, set how many tags each, then print to the thermal printer."
      widthClassName="max-w-5xl"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Search</span>
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Name, SKU, or barcode"
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </div>
            </label>
            <SelectField
              label="Category"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[{ value: "", label: "All Categories" }, ...categoryOptions]}
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={toggleAllShown}
              disabled={shownProducts.length === 0}
              className="cursor-pointer text-[11px] font-extrabold uppercase tracking-wider text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {allShownSelected ? "Unselect" : "Select"} all {shownProducts.length} shown
            </button>
            {copies.size > 0 && (
              <button
                type="button"
                onClick={() => setCopies(new Map())}
                className="cursor-pointer text-[11px] font-extrabold uppercase tracking-wider text-muted hover:underline"
              >
                Clear selection
              </button>
            )}
          </div>

          <ul className="mt-2 max-h-[46vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {shownProducts.length === 0 ? (
              <li className="p-6 text-center text-sm font-semibold text-muted">No products match.</li>
            ) : (
              shownProducts.map((product) => {
                const isSelected = copies.has(product.id);
                const tag = priceTagFor(product, currency);
                return (
                  <li key={product.id} className={isSelected ? "flex items-center gap-3 bg-accent/10 px-3 py-2" : "flex items-center gap-3 px-3 py-2"}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(product.id)}
                      aria-label={`Select ${product.name}`}
                      className="size-3.5 shrink-0 accent-primary"
                    />
                    <button type="button" onClick={() => toggle(product.id)} className="min-w-0 flex-1 cursor-pointer text-left">
                      <p className="truncate text-sm font-bold text-ink">{product.name}</p>
                      <p className="text-xs font-semibold text-muted">
                        {tag.price}
                        {tag.unit ? ` ${tag.unit}` : ""}
                        {product.categoryName ? ` · ${product.categoryName}` : ""}
                      </p>
                    </button>
                    {isSelected && (
                      <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-muted">
                        Copies
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={copies.get(product.id) ?? 1}
                          onChange={(event) => setCopiesFor(product.id, event.target.value)}
                          className="h-8 w-16 rounded-lg border border-line bg-white px-2 text-right text-sm font-bold text-ink outline-none focus:border-accent"
                        />
                      </label>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="min-w-0 space-y-4">
          <SelectField label="Tag Size" value={size} onChange={(value) => setSize(value as PriceTagSize)} options={PRICE_TAG_SIZE_OPTIONS} />
          <SelectField label="Printer" value={printerName} onChange={setPrinterName} options={printerOptions} />
          <p className="text-xs font-semibold text-muted">
            {size === "roll"
              ? `Tags print one under another on the receipt roll (${layout.widthMm} mm wide, from Paper Width in Settings), with dashed lines to cut along.`
              : "One tag per sticker. Set the label printer's paper size to the same size in Windows printer preferences."}
          </p>

          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
              Preview{selected.length > PREVIEW_LIMIT ? ` (first ${PREVIEW_LIMIT} products)` : ""}
            </p>
            <div className="mt-1.5 max-h-[30vh] overflow-auto rounded-lg border border-line bg-soft/50 p-3">
              {selected.length === 0 ? (
                <p className="py-6 text-center text-sm font-semibold text-muted">Tick products to see their tags.</p>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: preview }} />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-xs font-extrabold text-ink">
          {totalTags} tag{totalTags === 1 ? "" : "s"} for {selected.length} product{selected.length === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={onClose}
            className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handlePrint()}
            disabled={printing || selected.length === 0}
            className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {printing ? (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Printer className="mr-1.5 size-4" aria-hidden="true" />
            )}
            {printing ? "Printing..." : "Print Tags"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
