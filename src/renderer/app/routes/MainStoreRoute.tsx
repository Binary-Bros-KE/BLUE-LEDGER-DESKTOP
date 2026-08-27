import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Boxes,
  History,
  Loader2,
  Package,
  PackageX,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Settings2,
  TrendingDown
} from "lucide-react";
import { MainStoreStockModal } from "@renderer/app/routes/main-store/MainStoreStockModal";
import { ProductHistoryModal } from "@renderer/app/routes/main-store/ProductHistoryModal";
import { ProductCreateModal } from "@renderer/app/routes/products/ProductCreateModal";
import { ProductEditModal } from "@renderer/app/routes/products/ProductEditModal";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { ProductThumbnail } from "@renderer/shared/components/ProductThumbnail";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Category } from "@shared/types/category";
import type { ExportListRequest } from "@shared/types/export";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { MainStoreProductRow } from "@shared/types/main-store";
import type { Product } from "@shared/types/product";

type StatusFilter = "active" | "inactive" | "all";

function LowStockBadge(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-danger">
      <TrendingDown className="size-3" aria-hidden="true" />
      Low
    </span>
  );
}

/** A product is "out" once its TRUE total (Main Store + every storefront combined) hits zero —
 * matches ProductsRoute.tsx's own totalStock<=0 convention. Not "any one storefront's shelf is at
 * zero" — plenty of total stock elsewhere means it isn't actually out. */
function rowHasOutOfStock(row: MainStoreProductRow): boolean {
  return row.totalStock <= 0;
}

function OutOfStockBadge(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
      <PackageX className="size-3" aria-hidden="true" />
      Out of Stock
    </span>
  );
}

export function MainStoreRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("products", "create");
  const canEdit = can("products", "edit");
  const canManageStock = can("main_store", "edit") || can("stock_transfers", "create");
  const canExport = can("main_store", "export");

  const [locations, setLocations] = useState<Location[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<MainStoreProductRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [outOfStockOnly, setOutOfStockOnly] = useState(false);

  const [stockModalProduct, setStockModalProduct] = useState<MainStoreProductRow | null>(null);
  const [historyProduct, setHistoryProduct] = useState<MainStoreProductRow | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);

  const loadReference = useCallback(async () => {
    setLoadError(null);
    try {
      const [locationList, categoryList] = await Promise.all([
        window.blueLedger.location.list(),
        window.blueLedger.category.list()
      ]);
      setLocations(locationList);
      setCategories(categoryList);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load storefronts");
      setLoadError(message);
      showErrorToast(message);
    }
  }, []);

  useEffect(() => {
    void loadReference();
  }, [loadReference]);

  /** Storefronts sell — the Main Store (warehouse/distribution-center type) never appears in this list. */
  const storefronts = useMemo(
    () => (locations ?? []).filter((location) => isStorefrontType(location.locationType)),
    [locations]
  );

  const loadRows = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await window.blueLedger.mainStore.listProductRows();
      setRows(result);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load products");
      setLoadError(message);
      showErrorToast(message);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    let list = rows;

    if (statusFilter !== "all") {
      list = list.filter((row) => row.status === statusFilter);
    }
    if (lowStockOnly) {
      list = list.filter((row) => row.hasLowStock);
    }
    if (outOfStockOnly) {
      list = list.filter((row) => rowHasOutOfStock(row));
    }
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((row) => `${row.productName} ${row.sku}`.toLowerCase().includes(term));
    }
    return list;
  }, [rows, statusFilter, lowStockOnly, outOfStockOnly, searchTerm]);

  const summary = useMemo(() => {
    if (!rows) return null;
    const totalProducts = rows.length;
    const totalAtMainStore = rows.reduce((sum, row) => sum + row.totalAtMainStore, 0);
    const unallocatedUnits = rows.reduce((sum, row) => sum + row.unallocatedQuantity, 0);
    // A deactivated product shouldn't count toward reorder alerts — nobody is buying it, so its
    // shelf running low/out isn't something anyone needs to act on.
    const activeRows = rows.filter((row) => row.status === "active");
    const lowStockAlerts = activeRows.filter((row) => row.hasLowStock).length;
    const outOfStockAlerts = activeRows.filter((row) => rowHasOutOfStock(row)).length;
    return { totalProducts, totalAtMainStore, unallocatedUnits, lowStockAlerts, outOfStockAlerts };
  }, [rows]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredRows) return null;
    const filterParts: string[] = [`Status: ${statusFilter}`];
    if (lowStockOnly) filterParts.push("Low Stock Only");
    if (outOfStockOnly) filterParts.push("Out of Stock Only");
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);

    // One row per product now (not one per product-storefront pair) — Main Store is a single
    // combined figure (unallocated + allocated), and every storefront gets its own column instead
    // of its own row, so the whole picture for a product reads left-to-right on one line.
    const rowsOut = filteredRows.map((row, index) => {
      const out: Record<string, string> = {
        number: String(index + 1),
        product: row.productName,
        category: row.categoryName ?? "Uncategorized",
        mainStore: String(row.totalAtMainStore),
        totalStock: String(row.totalStock)
      };
      for (const location of storefronts) {
        const entry = row.storefronts.find((s) => s.storefrontId === location.id);
        out[`storefront_${location.id}`] = String(entry?.onHandQuantity ?? 0);
      }
      return out;
    });

    return {
      module: "main_store",
      title: "Main Store",
      subtitle: filterParts.join(" · "),
      columns: [
        { key: "number", header: "#" },
        { key: "product", header: "Product" },
        { key: "category", header: "Category" },
        { key: "mainStore", header: "Main Store", align: "right" },
        ...storefronts.map((location) => ({ key: `storefront_${location.id}`, header: location.locationName, align: "right" as const })),
        { key: "totalStock", header: "Total Stock", align: "right" }
      ],
      rows: rowsOut,
      stats: summary
        ? [
            { label: "Total Products", value: String(summary.totalProducts) },
            { label: "Total Units at Main Store", value: String(summary.totalAtMainStore) },
            { label: "Unallocated Units", value: String(summary.unallocatedUnits) },
            { label: "Low Stock Alerts", value: String(summary.lowStockAlerts) },
            { label: "Out of Stock Alerts", value: String(summary.outOfStockAlerts) }
          ]
        : [],
      fileBaseName: `MainStore_${new Date().toISOString().slice(0, 10)}`
    };
  }, [filteredRows, summary, statusFilter, lowStockOnly, outOfStockOnly, searchTerm, storefronts]);

  async function handleProductCreated(): Promise<void> {
    setCreateOpen(false);
    await loadRows();
    setNotice("Product created.");
    showSuccessToast("Product created.");
  }

  async function handleToggleStatus(row: MainStoreProductRow): Promise<void> {
    setRowActionError(null);
    const nextStatus = row.status === "active" ? "inactive" : "active";
    try {
      await window.blueLedger.product.setStatus(row.productId, nextStatus);
      await loadRows();
      const message = nextStatus === "active" ? "Product activated." : "Product deactivated.";
      setNotice(message);
      showSuccessToast(message);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to update product status");
      setRowActionError(message);
      showErrorToast(message);
    }
  }

  async function handleEditClick(row: MainStoreProductRow): Promise<void> {
    setRowActionError(null);
    try {
      const product = await window.blueLedger.product.get(row.productId);
      setEditingProduct(product);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load product");
      setRowActionError(message);
      showErrorToast(message);
    }
  }

  async function handleProductSaved(): Promise<void> {
    await loadRows();
    setEditingProduct(null);
    setNotice("Product updated.");
    showSuccessToast("Product updated.");
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

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile icon={Package} label="Total Products" value={String(summary.totalProducts)} tone="primary" />
          <StatTile icon={Boxes} label="Total Units at Main Store" value={String(summary.totalAtMainStore)} tone="accent" />
          <StatTile icon={Boxes} label="Unallocated Units" value={String(summary.unallocatedUnits)} tone="warning" />
          <StatTile icon={AlertTriangle} label="Low Stock Alerts" value={String(summary.lowStockAlerts)} tone="danger" />
          <StatTile icon={PackageX} label="Out of Stock Alerts" value={String(summary.outOfStockAlerts)} tone="danger" />
        </div>
      )}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Inventory</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <Boxes className="size-5 text-primary" aria-hidden="true" />
              Main Store
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Every product's Main Store holding.
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
        {(loadError ?? rowActionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? rowActionError}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="block flex-1 sm:max-w-xs">
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
                placeholder="Search by product name or SKU"
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>
          </label>

          <div className="flex gap-1.5 rounded-lg border border-line bg-soft px-1 py-0.5">
            {(["active", "inactive", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={cn(
                  "rounded-md px-3 py-1 text-[8px] font-extrabold uppercase tracking-wide transition cursor-pointer",
                  statusFilter === value ? "bg-primary text-white" : "text-muted hover:bg-white"
                )}
              >
                {value}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setLowStockOnly((prev) => !prev)}
            className={cn(
              "flex h-[38px] items-center gap-1.5 rounded-lg border px-3 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
              lowStockOnly
                ? "border-danger bg-danger-soft text-danger"
                : "border-line text-muted hover:bg-soft"
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
              outOfStockOnly
                ? "border-danger bg-danger text-white"
                : "border-line text-muted hover:bg-soft"
            )}
          >
            <PackageX className="size-3.5" aria-hidden="true" />
            Out of Stock Only
          </button>
        </div>

        <div className="mt-5">
          {rows === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : filteredRows && filteredRows.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Package className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No products found</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                {rows.length === 0 ? "Add a product to get started." : "Try a different filter or search term."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {(filteredRows ?? []).map((row) => (
                <div key={row.productId} className="overflow-hidden rounded-lg border-2 border-line border-primary/60 shadow-soft">
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-soft/60 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductThumbnail imagePath={row.imagePath} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="line-clamp-2 text-sm font-extrabold leading-snug text-ink" title={row.productName}>
                            {row.productName}
                          </p>
                          {row.status === "inactive" && <DashedPill tone="neutral">Inactive</DashedPill>}
                          {row.hasLowStock && <LowStockBadge />}
                          {rowHasOutOfStock(row) && <OutOfStockBadge />}
                        </div>
                        <p className="text-[11px] font-semibold text-muted">
                          {row.sku} · {row.categoryName ?? "Uncategorized"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={cn(
                          "font-display text-lg font-black tabular-nums",
                          row.totalStock > 0 ? "text-success" : "text-danger"
                        )}
                      >
                        Total Stock: {row.totalStock}
                      </span>
                      <button
                        type="button"
                        onClick={() => setHistoryProduct(row)}
                        aria-label="View history"
                        title="History"
                        className="grid size-8 place-items-center rounded-lg border border-line bg-white text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                      >
                        <History className="size-3.5" aria-hidden="true" />
                      </button>
                      {canManageStock && (
                        <button
                          type="button"
                          onClick={() => setStockModalProduct(row)}
                          aria-label="Manage stock"
                          title="Manage stock"
                          className="grid size-8 place-items-center rounded-lg border border-line bg-white text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                        >
                          <Settings2 className="size-3.5" aria-hidden="true" />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => void handleEditClick(row)}
                          aria-label="Edit product"
                          title="Edit product"
                          className="grid size-8 place-items-center rounded-lg border border-line bg-white text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => void handleToggleStatus(row)}
                          aria-label={row.status === "active" ? "Deactivate" : "Activate"}
                          title={row.status === "active" ? "Deactivate" : "Activate"}
                          className={cn(
                            "grid size-8 place-items-center rounded-lg border bg-white transition cursor-pointer",
                            row.status === "active"
                              ? "border-line text-muted hover:bg-danger-soft hover:text-danger"
                              : "border-line text-muted hover:bg-success/15 hover:text-success"
                          )}
                        >
                          {row.status === "active" ? (
                            <PowerOff className="size-3.5" aria-hidden="true" />
                          ) : (
                            <Power className="size-3.5" aria-hidden="true" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-sm">
                      <thead>
                        <tr className="bg-primary text-white">
                          <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">
                            Storefront
                          </th>
                          <th className="px-4 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">
                            Allocated at Main Store
                          </th>
                          <th className="px-4 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">
                            On Hand at Shop
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-line bg-white">
                          <td className="px-4 py-2 font-bold text-ink">Unallocated</td>
                          <td className="px-4 py-2 text-right font-extrabold tabular-nums">{row.unallocatedQuantity}</td>
                          <td className="px-4 py-2 text-right text-muted">—</td>
                        </tr>
                        {row.storefronts.map((entry) => (
                          <tr key={entry.storefrontId} className="border-t border-line odd:bg-white even:bg-soft/40">
                            <td className="px-4 py-2 font-bold text-ink">{entry.storefrontName}</td>
                            <td className="px-4 py-2 text-right font-extrabold tabular-nums">{entry.allocatedQuantity}</td>
                            <td className="px-4 py-2 text-right">
                              <span className="inline-flex items-center gap-1.5 font-extrabold tabular-nums">
                                {entry.onHandQuantity}
                                {entry.onHandQuantity <= 0 ? (
                                  <OutOfStockBadge />
                                ) : (
                                  entry.isLow && <LowStockBadge />
                                )}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {stockModalProduct && (
        <MainStoreStockModal
          product={stockModalProduct}
          onClose={() => setStockModalProduct(null)}
          onChanged={() => void loadRows()}
        />
      )}

      {historyProduct && (
        <ProductHistoryModal
          productId={historyProduct.productId}
          productName={historyProduct.productName}
          onClose={() => setHistoryProduct(null)}
        />
      )}

      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          categories={categories}
          storefronts={storefronts}
          onClose={() => setEditingProduct(null)}
          onSaved={() => void handleProductSaved()}
        />
      )}

      <ProductCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        categories={categories}
        locations={locations ?? []}
        onCreated={() => void handleProductCreated()}
        onCategoryCreated={(category) => setCategories((prev) => [...prev, category])}
      />
    </motion.div>
  );
}
