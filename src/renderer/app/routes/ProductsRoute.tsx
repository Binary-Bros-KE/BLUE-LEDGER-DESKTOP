import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Boxes,
  Info,
  Loader2,
  Package,
  PackageX,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  TrendingDown
} from "lucide-react";
import { ProductCreateModal } from "@renderer/app/routes/products/ProductCreateModal";
import { ProductDetailModal } from "@renderer/app/routes/products/ProductDetailModal";
import { ProductEditModal } from "@renderer/app/routes/products/ProductEditModal";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { SelectField } from "@renderer/shared/components/form-fields";
import { ProductInfoModal } from "@renderer/shared/components/ProductInfoModal";
import { ProductThumbnail } from "@renderer/shared/components/ProductThumbnail";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import type { Category } from "@shared/types/category";
import type { ExportListRequest } from "@shared/types/export";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { ProductListItem } from "@shared/types/product";

function LowStockBadge(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-danger">
      <TrendingDown className="size-3" aria-hidden="true" />
      Low
    </span>
  );
}

function OutOfStockBadge(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
      <PackageX className="size-3" aria-hidden="true" />
      Out of Stock
    </span>
  );
}

function buildCategoryOptions(categories: Category[]): { value: string; label: string }[] {
  const byId = new Map(categories.map((category) => [category.id, category]));

  function pathLabel(category: Category): string {
    const parts = [category.name];
    let current = category;
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent;
    }
    return parts.join(" › ");
  }

  return categories
    .map((category) => ({ value: category.id, label: pathLabel(category) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function ProductsRoute(): React.JSX.Element {
  const currency = useAppStore((state) => state.context?.tenant.currency ?? "");
  const { can } = usePermissions();
  const canCreate = can("products", "create");
  const canEdit = can("products", "edit");
  const canViewInventory = can("inventory", "view");
  const canExport = can("products", "export");

  const [products, setProducts] = useState<ProductListItem[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductListItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [detailProduct, setDetailProduct] = useState<ProductListItem | null>(null);
  const [infoProduct, setInfoProduct] = useState<ProductListItem | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [outOfStockOnly, setOutOfStockOnly] = useState(false);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [productList, categoryList, locationList] = await Promise.all([
        window.blueLedger.product.list(),
        window.blueLedger.category.list(),
        window.blueLedger.location.list()
      ]);
      setProducts(productList);
      setCategories(categoryList);
      setLocations(locationList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load products"));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const categoryOptions = useMemo(() => buildCategoryOptions(categories), [categories]);
  const storefronts = useMemo(() => locations.filter((location) => isStorefrontType(location.locationType)), [locations]);

  const filteredProducts = useMemo(() => {
    if (!products) return null;
    const term = searchTerm.trim().toLowerCase();

    return products.filter((product) => {
      if (term) {
        const haystack = `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (categoryFilter && product.categoryId !== categoryFilter) return false;
      if (statusFilter && product.status !== statusFilter) return false;
      if (lowStockOnly && product.totalStock > product.reorderLevel) return false;
      if (outOfStockOnly && product.totalStock > 0) return false;
      return true;
    });
  }, [products, searchTerm, categoryFilter, statusFilter, lowStockOnly, outOfStockOnly]);

  const stockAlerts = useMemo(() => {
    if (!products) return { lowStockCount: 0, outOfStockCount: 0 };
    return {
      lowStockCount: products.filter((product) => product.totalStock <= product.reorderLevel).length,
      outOfStockCount: products.filter((product) => product.totalStock <= 0).length
    };
  }, [products]);

  const hasActiveFilters = Boolean(
    searchTerm || categoryFilter || statusFilter || lowStockOnly || outOfStockOnly
  );

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredProducts) return null;
    const filterParts: string[] = [];
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);
    if (categoryFilter) {
      filterParts.push(`Category: ${categoryOptions.find((c) => c.value === categoryFilter)?.label ?? categoryFilter}`);
    }
    if (statusFilter) filterParts.push(`Status: ${statusFilter}`);
    if (lowStockOnly) filterParts.push("Low Stock Only");
    if (outOfStockOnly) filterParts.push("Out of Stock Only");

    return {
      module: "products",
      title: "Products",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "Full product catalog",
      columns: [
        { key: "name", header: "Product" },
        { key: "sku", header: "SKU" },
        { key: "category", header: "Category" },
        { key: "price", header: "Price", align: "right" },
        { key: "stock", header: "Stock", align: "right" },
        { key: "status", header: "Status" }
      ],
      rows: filteredProducts.map((product) => ({
        name: product.name,
        sku: product.sku,
        category: product.categoryName ?? "Uncategorized",
        price: `${currency} ${formatCents(product.sellingPriceCents)}`,
        stock: String(product.totalStock),
        status: product.status
      })),
      stats: [
        { label: "Total Products", value: String(filteredProducts.length) },
        { label: "Low Stock Alerts", value: String(stockAlerts.lowStockCount) },
        { label: "Out of Stock Alerts", value: String(stockAlerts.outOfStockCount) }
      ],
      fileBaseName: `Products_${new Date().toISOString().slice(0, 10)}`
    };
  }, [filteredProducts, stockAlerts, searchTerm, categoryFilter, statusFilter, lowStockOnly, outOfStockOnly, categoryOptions, currency]);

  function clearFilters(): void {
    setSearchTerm("");
    setCategoryFilter("");
    setStatusFilter("");
    setLowStockOnly(false);
    setOutOfStockOnly(false);
  }

  function openEditModal(product: ProductListItem): void {
    setEditingProduct(product);
  }

  async function handleProductSaved(): Promise<void> {
    await loadAll();
    setEditingProduct(null);
    setNotice("Product updated.");
  }

  async function handleProductCreated(): Promise<void> {
    setCreateOpen(false);
    await loadAll();
    setNotice("Product created.");
  }

  async function handleToggleStatus(product: ProductListItem): Promise<void> {
    const nextStatus = product.status === "active" ? "inactive" : "active";
    await window.blueLedger.product.setStatus(product.id, nextStatus);
    await loadAll();
    setNotice(nextStatus === "active" ? "Product activated." : "Product deactivated.");
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative mt-6 space-y-5 pb-10 pl-4"
    >
      <span
        className="pointer-events-none absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-2 left-0 top-2 border-l-2 border-dashed border-line"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -left-[5px] bottom-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Products</p>
            <h2 className="mt-1 text-xl font-extrabold">Product catalog</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Master catalog.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            {canCreate && (
              <Button type="button" onClick={() => setCreateOpen(true)} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Product
              </Button>
            )}
          </div>
        </div>

        {notice && (
          <div className="mt-4 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm font-bold text-success">
            {notice}
          </div>
        )}

        {products !== null && products.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile icon={Package} label="Total Products" value={String(products.length)} tone="primary" />
            <StatTile
              icon={AlertTriangle}
              label="Low Stock Alerts"
              value={String(stockAlerts.lowStockCount)}
              tone="danger"
            />
            <StatTile
              icon={PackageX}
              label="Out of Stock Alerts"
              value={String(stockAlerts.outOfStockCount)}
              tone="danger"
            />
          </div>
        )}

        {products !== null && products.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Search
              </span>
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by name, SKU, or barcode"
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
            <SelectField
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "", label: "All Statuses" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" }
              ]}
            />

            <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
              <button
                type="button"
                onClick={() => setLowStockOnly((prev) => !prev)}
                className={cn(
                  "flex h-[38px] items-center gap-1.5 rounded-lg border px-3 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
                  lowStockOnly ? "border-danger bg-danger-soft text-danger" : "border-line text-muted hover:bg-soft"
                )}
              >
                <TrendingDown className="size-3.5" aria-hidden="true" />
                Low Stock Only
              </button>
              <button
                type="button"
                onClick={() => setOutOfStockOnly((prev) => !prev)}
                className={cn(
                  "flex h-[38px] items-center gap-1.5 rounded-lg border px-3 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
                  outOfStockOnly ? "border-danger bg-danger text-white" : "border-line text-muted hover:bg-soft"
                )}
              >
                <PackageX className="size-3.5" aria-hidden="true" />
                Out of Stock Only
              </button>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-[11px] font-extrabold uppercase tracking-wider text-accent hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <p className="text-sm font-bold text-danger">{loadError}</p>
              <Button type="button" onClick={() => void loadAll()} className="mt-4 h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : products === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : products.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Package className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No products yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                {canCreate
                  ? 'Click "New Product" above to start tracking pricing and stock.'
                  : "Ask an admin to add your first product."}
              </p>
            </div>
          ) : filteredProducts && filteredProducts.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No products match your filters</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Try a different search term or clear the filters below.
              </p>
              <Button type="button" onClick={clearFilters} className="mt-5 h-9 text-xs">
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[31%]" />
                  <col className="w-[11%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                  <col className="w-[15%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Product</Th>
                    <Th className="text-right">Price</Th>
                    <Th className="text-right">Stock</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredProducts ?? []).map((product) => (
                    <tr key={product.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProductThumbnail imagePath={product.imagePath} />
                          <div className="min-w-0">
                            <p className="truncate font-extrabold" title={product.name}>
                              {product.name}
                            </p>
                            <p className="truncate text-xs tabular-nums text-muted">{product.sku}</p>
                            <span className="truncate px-4 py-3 text-sm font-semibold text-muted">
                        {product.categoryName ?? "Uncategorized"}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">
                        {currency} {formatCents(product.sellingPriceCents)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <span
                            className={cn(
                              "font-extrabold tabular-nums",
                              product.totalStock <= product.reorderLevel && "text-warning"
                            )}
                          >
                            {product.totalStock}
                          </span>
                          {product.totalStock <= 0 ? (
                            <OutOfStockBadge />
                          ) : (
                            product.totalStock <= product.reorderLevel && <LowStockBadge />
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone={product.status === "active" ? "success" : "neutral"}>
                          {product.status}
                        </DashedPill>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {canViewInventory && (
                            <button
                              type="button"
                              onClick={() => setDetailProduct(product)}
                              aria-label={`View inventory for ${product.name}`}
                              title="Inventory & movements"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Boxes className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(product)}
                              aria-label={`Edit ${product.name}`}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </button>
                          )} 
                          <button
                            type="button"
                            onClick={() => setInfoProduct(product)}
                            aria-label={`View details for ${product.name}`}
                            title="Product details"
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-primary cursor-pointer"
                          >
                            <Info className="size-3.5" aria-hidden="true" />
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => void handleToggleStatus(product)}
                              aria-label={
                                product.status === "active"
                                  ? `Deactivate ${product.name}`
                                  : `Activate ${product.name}`
                              }
                              className={cn(
                                "grid size-8 place-items-center rounded-lg border transition cursor-pointer",
                                product.status === "active"
                                  ? "border-line text-muted hover:bg-danger-soft hover:text-danger"
                                  : "border-line text-muted hover:bg-success/15 hover:text-success"
                              )}
                            >
                              {product.status === "active" ? (
                                <PowerOff className="size-3.5" aria-hidden="true" />
                              ) : (
                                <Power className="size-3.5" aria-hidden="true" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <ProductCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        categories={categories}
        locations={locations}
        onCreated={() => void handleProductCreated()}
        onCategoryCreated={(category) => setCategories((prev) => [...prev, category])}
      />

      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          categories={categories}
          storefronts={storefronts}
          onClose={() => setEditingProduct(null)}
          onSaved={() => void handleProductSaved()}
        />
      )}

      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          currency={currency}
          locations={locations}
          onClose={() => setDetailProduct(null)}
        />
      )}
      {infoProduct && <ProductInfoModal product={infoProduct} onClose={() => setInfoProduct(null)} />}
    </motion.div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}
