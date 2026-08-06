import { useEffect, useState } from "react";
import { Loader2, Package } from "lucide-react";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { TAX_TYPE_OPTIONS, type ProductListItem, type ProductStockSummary } from "@shared/types/product";

function InfoRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-soft/60 px-3 py-2">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

/** A comprehensive, read-only product popup — every field a cashier (or anyone else browsing the
 * catalog) might want without a follow-up trip to Products, plus just two extra stock numbers (this
 * location's own, and Main Store's total/unallocated) rather than the full cross-storefront
 * breakdown `ProductDetailModal` shows — that one stays reserved for roles with real inventory
 * access. Shared between Checkout and the Products list. */
export function ProductInfoModal({ product, onClose }: { product: ProductListItem; onClose: () => void }): React.JSX.Element {
  const vatRatePercent = useAppStore((state) => state.context?.tenant.vatRatePercent ?? 16);
  const [summary, setSummary] = useState<ProductStockSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.blueLedger.product.stockSummary(product.id);
        if (!cancelled) setSummary(result);
      } catch (err) {
        if (!cancelled) setSummaryError(getErrorMessage(err, "Failed to load stock info"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  useEffect(() => {
    let cancelled = false;
    if (!product.imagePath) {
      setImageUrl(null);
      return undefined;
    }
    void window.blueLedger.product.readImagePreview(product.imagePath).then((url) => {
      if (!cancelled) setImageUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [product.imagePath]);

  const showMainStoreRow = summary && summary.ownLocationName !== "Main Store";

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      description={`SKU ${product.sku}${product.categoryName ? ` · ${product.categoryName}` : ""}`}
      widthClassName="max-w-2xl"
    >
      <div className="space-y-5">
        <div className="flex items-start gap-4">
          <div
            className="relative grid size-20 flex-none place-items-center overflow-hidden rounded-lg"
            style={{ backgroundColor: imageUrl ? undefined : (product.categoryColor ?? "#83795f") }}
          >
            {imageUrl ? (
              // Absolute (not size-full) — see ProductThumbnail.tsx's own doc comment for why a
              // percentage height inside a place-items-center grid cell can't be trusted otherwise.
              <img src={imageUrl} alt="" className="absolute inset-0 size-full object-contain" />
            ) : (
              <Package className="size-8 text-white/90" aria-hidden="true" />
            )}
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2.5">
            <InfoRow label="Short Name" value={product.shortName ?? "—"} />
            <InfoRow label="Barcode" value={product.barcode ?? "—"} />
            <InfoRow label="Category" value={product.categoryName ?? "Uncategorized"} />
            <InfoRow label="Status" value={product.status} />
          </div>
        </div>

        {product.description && (
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Description</p>
            <p className="mt-1 text-sm font-semibold text-ink">{product.description}</p>
          </div>
        )}

        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Pricing</p>
          <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <InfoRow label="Selling Price" value={formatCents(product.sellingPriceCents)} />
            <InfoRow
              label="Wholesale Price"
              value={
                product.wholesalePriceCents !== null
                  ? `${formatCents(product.wholesalePriceCents)} (${product.wholesaleMinQuantity}+)`
                  : "—"
              }
            />
            <InfoRow label="Minimum Price" value={product.minimumPriceCents !== null ? formatCents(product.minimumPriceCents) : "—"} />
            <InfoRow
              label="Tax"
              value={
                product.taxType === "vat"
                  ? `${TAX_TYPE_OPTIONS.find((o) => o.value === "vat")?.label} (${vatRatePercent}%)`
                  : (TAX_TYPE_OPTIONS.find((o) => o.value === product.taxType)?.label ?? product.taxType)
              }
            />
          </div>
        </div>

        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Stock</p>
          <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <InfoRow label="Reorder Level" value={String(product.reorderLevel)} />
            <InfoRow label="Tracks Stock" value={product.trackStock ? "Yes" : "No"} />
            <InfoRow label="Allow Negative Stock" value={product.allowNegativeStock ? "Yes" : "No"} />
          </div>
          {summaryError ? (
            <p className="mt-2 text-sm font-bold text-danger">{summaryError}</p>
          ) : !summary ? (
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading stock levels...
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {summary.ownLocationName && (
                <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <span className="text-sm font-bold text-ink">{summary.ownLocationName}</span>
                  <span className="text-sm font-extrabold tabular-nums text-ink">{summary.ownLocationQuantity} units</span>
                </div>
              )}
              {showMainStoreRow && (
                <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <span className="text-sm font-bold text-ink">Main Store (total)</span>
                  <span className="text-sm font-extrabold tabular-nums text-ink">{summary.mainStoreQuantity} units</span>
                </div>
              )}
              {showMainStoreRow && (
                <div className="flex items-center justify-between rounded-lg border border-dashed border-line px-3 py-2">
                  <span className="text-sm font-bold text-muted">Main Store (unassigned to any storefront)</span>
                  <span className="text-sm font-extrabold tabular-nums text-ink">{summary.mainStoreUnallocatedQuantity} units</span>
                </div>
              )}
              {!summary.ownLocationName && !showMainStoreRow && (
                <p className="text-sm font-semibold text-muted">No stock recorded anywhere yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
