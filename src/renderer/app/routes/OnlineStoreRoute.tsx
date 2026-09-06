import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Globe,
  ImagePlus,
  Loader2,
  Package,
  PackageCheck,
  ShoppingCart,
  Store,
  Trash2,
  X
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { ProductThumbnail } from "@renderer/shared/components/ProductThumbnail";
import { StatTile } from "@renderer/shared/components/StatTile";
import { TextAreaField, Field } from "@renderer/shared/components/form-fields";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Category } from "@shared/types/category";
import type { StoreOwnerView } from "@shared/types/online-store";
import type { Product, ProductListItem } from "@shared/types/product";
import { DeliveryPanel } from "./online-store/DeliveryPanel";
import { ThemePanel } from "./online-store/ThemePanel";

type PublishFilter = "all" | "published" | "unpublished";

const DOMAIN_STATUS_LABEL: Record<string, string> = {
  NONE: "No custom domain yet",
  PENDING_DNS: "Waiting on DNS — Blue Ledger is connecting it",
  VERIFYING_TLS: "Issuing security certificate",
  LIVE: "Connected"
};

const STORE_STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-white text-ink border border-line",
  LIVE: "bg-success text-white",
  SUSPENDED: "bg-danger text-white"
};

/** Effective online price for a product — its override, or its normal selling price. */
function effectivePriceCents(product: ProductListItem | Product): number {
  return product.onlinePriceCents ?? product.sellingPriceCents;
}

export function OnlineStoreRoute(): React.JSX.Element {
  const currency = useAppStore((state) => state.context?.tenant.currency ?? "");
  const { can } = usePermissions();
  const canEdit = can("online_store", "edit");

  const [overview, setOverview] = useState<StoreOwnerView | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<"products" | "look" | "delivery">("products");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PublishFilter>("all");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadOverview = useCallback(async () => {
    setOverviewError(null);
    try {
      setOverview(await window.blueLedger.onlineStore.overview());
    } catch (err) {
      // Not fatal — the product list still works offline; the owner just can't see live store
      // status / preview URL until they reconnect.
      setOverviewError(getErrorMessage(err, "Couldn't load your online store details"));
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoadError(null);
    try {
      setProducts(await window.blueLedger.product.list(null));
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load products");
      setLoadError(message);
      showErrorToast(message);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    void loadProducts();
  }, [loadOverview, loadProducts]);

  const mergeProduct = useCallback((updated: Product) => {
    setProducts((prev) =>
      prev
        ? prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
        : prev
    );
  }, []);

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const togglePublished = useCallback(
    async (product: ProductListItem) => {
      if (!canEdit || busyIds.has(product.id)) return;
      const next = !product.publishedOnline;
      setBusy(product.id, true);
      try {
        const updated = await window.blueLedger.onlineStore.setProductOnline(product.id, {
          publishedOnline: next
        });
        mergeProduct(updated);
        showSuccessToast(next ? `"${product.name}" is now in your online store` : `"${product.name}" removed from your online store`);
        void loadOverview();
      } catch (err) {
        showErrorToast(getErrorMessage(err, "Couldn't update this product"));
      } finally {
        setBusy(product.id, false);
      }
    },
    [busyIds, canEdit, loadOverview, mergeProduct, setBusy]
  );

  const filtered = useMemo(() => {
    if (!products) return null;
    const term = search.trim().toLowerCase();
    return products
      .filter((p) => p.status === "active")
      .filter((p) => {
        if (term) {
          const haystack = `${p.name} ${p.sku} ${p.barcode ?? ""}`.toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        if (filter === "published") return p.publishedOnline;
        if (filter === "unpublished") return !p.publishedOnline;
        return true;
      })
      .sort((a, b) => Number(b.publishedOnline) - Number(a.publishedOnline) || a.name.localeCompare(b.name));
  }, [products, search, filter]);

  const publishedCount = useMemo(
    () => (products ? products.filter((p) => p.publishedOnline && p.status === "active").length : 0),
    [products]
  );

  const editingProduct = editingId ? (products?.find((p) => p.id === editingId) ?? null) : null;

  const previewUrl = overview?.previewUrl ?? null;
  const liveUrl = overview?.liveUrl ?? null;
  const shownUrl = liveUrl ?? previewUrl;

  const copyUrl = useCallback(() => {
    if (!shownUrl) return;
    void navigator.clipboard.writeText(shownUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [shownUrl]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Online Store</h1>
        <p className="mt-1 text-sm font-semibold text-muted">
          Choose which products appear on your website, set online prices and photos, and manage how
          your store looks. Your domain and technical setup are handled by Blue Ledger.
        </p>
      </div>

      {/* Store status ------------------------------------------------------------------ */}
      <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
        {overview?.store ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide",
                    STORE_STATUS_STYLE[overview.store.status] ?? "bg-white text-ink border border-line"
                  )}
                >
                  <Store className="size-3" aria-hidden="true" />
                  {overview.store.status === "LIVE"
                    ? "Live"
                    : overview.store.status === "SUSPENDED"
                      ? "Suspended"
                      : "Not published yet"}
                </span>
                <span className="text-xs font-semibold text-muted">
                  {DOMAIN_STATUS_LABEL[overview.store.domainStatus] ?? overview.store.domainStatus}
                </span>
              </div>
              {shownUrl && (
                <div className="flex items-center gap-2">
                  <Globe className="size-4 flex-none text-muted" aria-hidden="true" />
                  <span className="text-sm font-bold">{shownUrl.replace(/^https?:\/\//, "")}</span>
                  <button
                    type="button"
                    onClick={copyUrl}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-muted transition hover:bg-soft hover:text-ink"
                  >
                    {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
              {liveUrl && previewUrl && (
                <p className="text-[11px] font-semibold text-muted">
                  Preview address: {previewUrl.replace(/^https?:\/\//, "")}
                </p>
              )}
            </div>
          </div>
        ) : overviewError ? (
          <p className="text-sm font-semibold text-muted">{overviewError}</p>
        ) : !overview ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading your online store…
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-bold">Your online store isn&apos;t set up yet</p>
            <p className="text-xs font-semibold text-muted">
              Blue Ledger will provision your store and connect your domain. You can still choose
              which products to publish now — they&apos;ll go live as soon as your store is ready.
            </p>
          </div>
        )}
      </div>

      {/* Stats ------------------------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile icon={PackageCheck} label="Published online" value={String(publishedCount)} tone="primary" />
        <StatTile
          icon={Package}
          label="Active products"
          value={String(products?.filter((p) => p.status === "active").length ?? 0)}
          tone="warning"
        />
        <StatTile
          icon={ShoppingCart}
          label="Store status"
          value={overview?.store ? (overview.store.status === "LIVE" ? "Live" : "Draft") : "Not set up"}
          tone={overview?.store?.status === "LIVE" ? "success" : "warning"}
        />
      </div>

      {/* Tabs ----------------------------------------------------------------------- */}
      <div className="flex overflow-hidden rounded-md border border-line">
        {(["products", "look", "delivery"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wide transition",
              tab === t ? "bg-ink text-white" : "bg-white text-muted hover:bg-soft"
            )}
          >
            {t === "products" ? "Products" : t === "look" ? "Storefront look" : "Delivery"}
          </button>
        ))}
      </div>

      {tab === "look" || tab === "delivery" ? (
        !overview?.store ? (
          <p className="rounded-lg border border-line bg-white p-5 text-sm font-semibold text-muted shadow-soft">
            Your online store isn&apos;t set up yet — once Blue Ledger provisions it you can configure it here.
          </p>
        ) : tab === "look" ? (
          <ThemePanel
            themeJson={overview.store.themeJson}
            imageUploadsEnabled={overview.imageUploadsEnabled}
            onSaved={loadOverview}
          />
        ) : (
          <DeliveryPanel />
        )
      ) : (
      /* Product list --------------------------------------------------------------- */
      <div className="rounded-lg border border-line bg-white shadow-soft">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative flex-1 min-w-[200px]">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products by name, SKU or barcode"
              className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-semibold outline-none focus:ring-4 focus:ring-accent/20"
            />
          </div>
          <div className="flex overflow-hidden rounded-md border border-line">
            {(["all", "published", "unpublished"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  "px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide transition",
                  filter === value ? "bg-ink text-white" : "bg-white text-muted hover:bg-soft"
                )}
              >
                {value === "all" ? "All" : value === "published" ? "Published" : "Not published"}
              </button>
            ))}
          </div>
        </div>

        {loadError ? (
          <p className="p-6 text-sm font-semibold text-danger">{loadError}</p>
        ) : !filtered ? (
          <div className="flex items-center gap-2 p-6 text-sm font-semibold text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading products…
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm font-semibold text-muted">No products match your filters.</p>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((product) => {
              const firstImage = product.onlineImageUrls[0];
              const priceOverridden = product.onlinePriceCents !== null;
              const busy = busyIds.has(product.id);
              return (
                <li key={product.id} className="flex items-center gap-3 p-4">
                  {firstImage ? (
                    <img
                      src={firstImage.thumbUrl}
                      alt=""
                      className="size-10 flex-none rounded-lg border border-line object-cover"
                    />
                  ) : (
                    <ProductThumbnail imagePath={product.imagePath} />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{product.name}</p>
                    <p className="truncate text-[11px] font-semibold text-muted">
                      {product.categoryName ?? "Uncategorised"} · {product.sku}
                      {product.onlineImageUrls.length > 0
                        ? ` · ${product.onlineImageUrls.length} photo${product.onlineImageUrls.length === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex-none text-right">
                    <p className="text-sm font-extrabold tabular-nums">
                      {formatCents(effectivePriceCents(product))}
                    </p>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
                      {priceOverridden ? "Online price" : `${currency} shelf price`}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={!canEdit || busy}
                    onClick={() => void togglePublished(product)}
                    className={cn(
                      "relative inline-flex h-7 w-12 flex-none items-center rounded-full border transition",
                      product.publishedOnline ? "border-success bg-success" : "border-line bg-soft",
                      (!canEdit || busy) && "opacity-50"
                    )}
                    aria-pressed={product.publishedOnline}
                    aria-label={product.publishedOnline ? "Unpublish" : "Publish"}
                  >
                    <span
                      className={cn(
                        "inline-block size-5 rounded-full bg-white shadow-soft transition",
                        product.publishedOnline ? "translate-x-6" : "translate-x-1"
                      )}
                    />
                  </button>

                  <Button
                    className="h-8 flex-none bg-white px-3 text-ink shadow-none ring-1 ring-line hover:bg-soft hover:text-ink"
                    onClick={() => setEditingId(product.id)}
                    disabled={!canEdit}
                  >
                    Edit
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      )}

      {editingProduct && (
        <OnlineProductModal
          key={editingProduct.id}
          product={editingProduct}
          imageUploadsEnabled={overview?.imageUploadsEnabled ?? false}
          onClose={() => setEditingId(null)}
          onSaved={(updated) => {
            mergeProduct(updated);
            void loadOverview();
          }}
        />
      )}
    </div>
  );
}

/** Per-product online overrides — price, description, and photos. */
function OnlineProductModal({
  product,
  imageUploadsEnabled,
  onClose,
  onSaved
}: {
  product: ProductListItem;
  imageUploadsEnabled: boolean;
  onClose: () => void;
  onSaved: (updated: Product) => void;
}): React.JSX.Element {
  const [priceText, setPriceText] = useState(
    product.onlinePriceCents !== null ? fromCents(product.onlinePriceCents) : ""
  );
  const [description, setDescription] = useState(product.onlineDescription ?? "");
  const [images, setImages] = useState(product.onlineImageUrls);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catIds, setCatIds] = useState<Set<string>>(() => new Set(product.onlineCategoryIds));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    void window.blueLedger.category.list().then(setCategories).catch(() => setCategories([]));
  }, []);

  const toggleCat = useCallback((id: string) => {
    setCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const trimmed = priceText.trim();
      const updated = await window.blueLedger.onlineStore.setProductOnline(product.id, {
        onlinePriceCents: trimmed === "" ? null : toCents(trimmed),
        onlineDescription: description.trim() === "" ? null : description.trim(),
        // never store the product's own primary category as an "extra"
        onlineCategoryIds: [...catIds].filter((id) => id !== product.categoryId)
      });
      onSaved(updated);
      showSuccessToast(`Saved online details for "${product.name}"`);
      onClose();
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't save"));
    } finally {
      setSaving(false);
    }
  }, [catIds, description, onClose, onSaved, priceText, product.categoryId, product.id, product.name]);

  const addPhoto = useCallback(async () => {
    setUploading(true);
    try {
      const updated = await window.blueLedger.onlineStore.uploadImage(product.id);
      setImages(updated.onlineImageUrls);
      onSaved(updated);
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't upload that photo"));
    } finally {
      setUploading(false);
    }
  }, [onSaved, product.id]);

  const removePhoto = useCallback(
    async (url: string) => {
      try {
        const updated = await window.blueLedger.onlineStore.deleteImage(product.id, url);
        setImages(updated.onlineImageUrls);
        onSaved(updated);
      } catch (err) {
        showErrorToast(getErrorMessage(err, "Couldn't remove that photo"));
      }
    },
    [onSaved, product.id]
  );

  return (
    <Modal open onClose={onClose} title={product.name} description={`SKU ${product.sku}`} widthClassName="max-w-xl">
      <div className="space-y-5">
        <Field
          label="Online price (leave blank to use the shelf price)"
          type="text"
          value={priceText}
          onChange={setPriceText}
          placeholder={fromCents(product.sellingPriceCents)}
        />

        <TextAreaField
          label="Online description (leave blank to use the product description)"
          value={description}
          onChange={setDescription}
          rows={4}
          placeholder={product.description ?? "Describe this product for online shoppers"}
        />

        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
            Show under these categories online
          </span>
          <p className="mt-0.5 text-[11px] text-muted">
            Its main category ({product.categoryName ?? "Uncategorised"}) is always included. Tick any
            extra ones — e.g. Best Sellers, New Arrivals.
          </p>
          {categories.length === 0 ? (
            <p className="mt-2 text-xs text-muted">No categories yet.</p>
          ) : (
            <div className="mt-2 grid max-h-44 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border border-line p-3">
              {categories.map((c) => {
                const isPrimary = c.id === product.categoryId;
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex items-center gap-2 text-[13px]",
                      isPrimary ? "text-muted" : "cursor-pointer text-ink"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isPrimary || catIds.has(c.id)}
                      disabled={isPrimary}
                      onChange={() => toggleCat(c.id)}
                      className="size-3.5 flex-none accent-primary"
                    />
                    <span className="truncate">
                      {c.name}
                      {isPrimary ? " (main)" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Photos</span>
          <div className="mt-2 flex flex-wrap gap-3">
            {images.map((image) => (
              <div key={image.url} className="group relative size-24 overflow-hidden rounded-lg border border-line">
                <img src={image.thumbUrl} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => void removePhoto(image.url)}
                  aria-label="Remove photo"
                  className="absolute right-1 top-1 grid size-6 place-items-center rounded-md bg-ink/70 text-white opacity-0 transition group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}

            {imageUploadsEnabled ? (
              <button
                type="button"
                onClick={() => void addPhoto()}
                disabled={uploading}
                className="grid size-24 place-items-center rounded-lg border border-dashed border-line text-muted transition hover:border-ink hover:text-ink disabled:opacity-50"
              >
                {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
              </button>
            ) : (
              <div className="grid w-full max-w-xs place-items-center rounded-lg border border-dashed border-line p-3 text-center text-[11px] font-semibold text-muted">
                Photo uploads aren&apos;t switched on for your store yet. Contact Blue Ledger to enable them.
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-md border border-line px-4 text-xs font-extrabold uppercase tracking-wide text-muted transition hover:bg-soft hover:text-ink"
          >
            <X className="mr-1 size-3" /> Cancel
          </button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
