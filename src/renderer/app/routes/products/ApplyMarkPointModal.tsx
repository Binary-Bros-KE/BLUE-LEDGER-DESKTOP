import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { SelectField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast } from "@renderer/shared/lib/toast";
import type { MarkPointBothPricesMode } from "@shared/lib/mark-point";
import type { MarkPointPreview } from "@shared/types/product";

type Scope = "all" | "selected" | "category";

const BOTH_PRICES_OPTIONS: Array<{ value: MarkPointBothPricesMode; label: string }> = [
  { value: "skip", label: "Leave them as they are" },
  { value: "selling_from_buying", label: "Recalculate selling from buying" },
  { value: "buying_from_selling", label: "Recalculate buying from selling" }
];

/**
 * Apply Mark Point (main/services/mark-point-service.ts): a missing price is filled from the other one;
 * products that already have both follow the chosen option. Shows what will change before anything is
 * written. Prices stay editable product by product afterwards.
 */
export function ApplyMarkPointModal({
  open,
  onClose,
  markPoint,
  selectedIds,
  categoryOptions,
  onApplied
}: {
  open: boolean;
  onClose: () => void;
  markPoint: number;
  selectedIds: string[];
  categoryOptions: Array<{ value: string; label: string }>;
  onApplied: (result: MarkPointPreview) => Promise<void> | void;
}): React.JSX.Element {
  const [scope, setScope] = useState<Scope>(selectedIds.length > 0 ? "selected" : "all");
  const [categoryId, setCategoryId] = useState("");
  const [bothPrices, setBothPrices] = useState<MarkPointBothPricesMode>("skip");
  const [preview, setPreview] = useState<MarkPointPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setScope(selectedIds.length > 0 ? "selected" : "all");
  }, [open, selectedIds.length]);

  const request = { scope, productIds: selectedIds, categoryId: categoryId || null, bothPrices };
  const ready = scope !== "category" || categoryId !== "";

  useEffect(() => {
    if (!open || !ready) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.blueLedger.product
      .previewMarkPoint(request)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, "Couldn't work out the changes"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // request is rebuilt each render from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, scope, categoryId, bothPrices, selectedIds.join(",")]);

  async function handleApply(): Promise<void> {
    setApplying(true);
    setError(null);
    try {
      const result = await window.blueLedger.product.applyMarkPoint(request);
      await onApplied(result);
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to apply the mark point");
      setError(message);
      showErrorToast(message);
    } finally {
      setApplying(false);
    }
  }

  const price = (cents: number, factor: number) => formatCents(Math.round(cents * factor));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Apply Mark Point ${markPoint}`}
      description="Selling = buying x mark point (rounded up to the shilling). A missing price is filled in from the other."
      widthClassName="max-w-2xl"
    >
      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Products"
          value={scope}
          onChange={(value) => setScope(value as Scope)}
          options={[
            ...(selectedIds.length > 0 ? [{ value: "selected", label: `Selected (${selectedIds.length})` }] : []),
            { value: "all", label: "All products" },
            { value: "category", label: "One category" }
          ]}
        />
        {scope === "category" ? (
          <SelectField
            label="Category"
            value={categoryId}
            onChange={setCategoryId}
            options={[{ value: "", label: "Choose a category" }, ...categoryOptions]}
          />
        ) : (
          <div />
        )}
        <SelectField
          label="Products that already have both prices"
          value={bothPrices}
          onChange={(value) => setBothPrices(value as MarkPointBothPricesMode)}
          options={BOTH_PRICES_OPTIONS}
          className="sm:col-span-2"
        />
      </div>

      <div className="mt-5 rounded-lg border border-line bg-soft/60 p-4">
        {loading || !preview ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-muted">
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {ready ? "Working out the changes…" : "Choose a category to see the changes."}
          </p>
        ) : (
          <>
            <p className="text-sm font-extrabold text-ink">
              {preview.toUpdate} of {preview.considered} product{preview.considered === 1 ? "" : "s"} will change
            </p>
            <p className="mt-1 text-xs font-semibold text-muted">
              {preview.sellingFilled} selling price{preview.sellingFilled === 1 ? "" : "s"} set from buying ·{" "}
              {preview.buyingFilled} buying price{preview.buyingFilled === 1 ? "" : "s"} set from selling
              {preview.skipped.hasBoth > 0 && ` · ${preview.skipped.hasBoth} left alone (already have both)`}
              {preview.skipped.noPrices > 0 && ` · ${preview.skipped.noPrices} with no price to work from`}
              {preview.skipped.unchanged > 0 && ` · ${preview.skipped.unchanged} already match`}
            </p>
            {preview.sample.length > 0 && (
              <table className="mt-3 w-full table-fixed text-xs">
                <thead>
                  <tr className="text-left text-[10px] font-extrabold uppercase tracking-wider text-muted">
                    <th className="w-2/5 py-1">Product</th>
                    <th className="py-1 text-right">Buying</th>
                    <th className="py-1 text-right">Selling</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row) => (
                    <tr key={row.productId} className="border-t border-line">
                      <td className="truncate py-1.5 font-bold text-ink">{row.name}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.before.buyingPriceCents !== row.after.buyingPriceCents && (
                          <span className="mr-1 text-muted line-through">{price(row.before.buyingPriceCents, row.priceFactor)}</span>
                        )}
                        <span className="font-bold">{price(row.after.buyingPriceCents, row.priceFactor)}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.before.sellingPriceCents !== row.after.sellingPriceCents && (
                          <span className="mr-1 text-muted line-through">{price(row.before.sellingPriceCents, row.priceFactor)}</span>
                        )}
                        <span className="font-bold">{price(row.after.sellingPriceCents, row.priceFactor)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview.toUpdate > preview.sample.length && (
              <p className="mt-2 text-[11px] font-semibold text-muted">…and {preview.toUpdate - preview.sample.length} more.</p>
            )}
          </>
        )}
      </div>

      <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
        <Button type="button" onClick={onClose} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void handleApply()}
          disabled={applying || loading || !preview || preview.toUpdate === 0}
          className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applying ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
          {applying ? "Applying..." : `Update ${preview?.toUpdate ?? 0} product${preview?.toUpdate === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Modal>
  );
}
