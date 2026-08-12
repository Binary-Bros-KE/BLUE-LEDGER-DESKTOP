import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Eye, Loader2, PackageCheck, Plus, Printer, Search, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { QuickCreateProductModal } from "@renderer/shared/components/QuickCreateProductModal";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { buildAvailableYears, currentYear, matchesYearFilter, yearFilterOptions } from "@renderer/shared/lib/year-filter";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { MainStoreAllocationSummary } from "@shared/types/main-store";
import type { LocationStockLevel } from "@shared/types/inventory";
import type { ProductListItem } from "@shared/types/product";
import type { StockReceipt, StockReceiptListItem } from "@shared/types/stock-receipt";

type Destination = "main_store" | "storefront" | "main_store_transfer";

type DraftItem = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

export function GoodsReceivedRoute(): React.JSX.Element {
  const { can, session } = usePermissions();
  const canCreate = can("inventory", "edit");
  // Same deliberate split as MainStoreStockModal: a Manager keeps "inventory" (their own
  // storefront's stock) but never gets "main_store" — see role-service.ts's own comment. Receiving
  // straight to a storefront doesn't need it; earmarking stock at Main Store does.
  const canReceiveIntoMainStore = can("main_store", "edit");
  // Same permission MainStoreStockModal's own Transfer tab (distributeFromMainStore) checks — this
  // is the bulk counterpart of that single-product flow, not a separate capability.
  const canTransferFromMainStore = can("stock_transfers", "create");

  const needsStorefrontPicker = session?.branch == null;
  const ownBranchId = session?.branch?.id ?? null;

  const [receipts, setReceipts] = useState<StockReceiptListItem[] | null>(null);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear()));
  const [locationFilter, setLocationFilter] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [destination, setDestination] = useState<Destination>(canReceiveIntoMainStore ? "main_store" : "storefront");
  const [allocationStorefrontId, setAllocationStorefrontId] = useState("");
  const [createLocationId, setCreateLocationId] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createItems, setCreateItems] = useState<DraftItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [quickCreateProductOpen, setQuickCreateProductOpen] = useState(false);

  const [allocationSummary, setAllocationSummary] = useState<MainStoreAllocationSummary[]>([]);
  const [storefrontStock, setStorefrontStock] = useState<LocationStockLevel[]>([]);

  const [viewingReceipt, setViewingReceipt] = useState<StockReceipt | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const loadReceipts = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await window.blueLedger.stockReceipt.list();
      setReceipts(list);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load goods received"));
    }
  }, []);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  useEffect(() => {
    if (canCreate) {
      window.blueLedger.product
        .list()
        .then(setProducts)
        .catch(() => undefined);
    }
    // Also needed for the branch-less Storefront filter below, not just the create form.
    if (canCreate || needsStorefrontPicker) {
      window.blueLedger.location
        .list()
        .then(setLocations)
        .catch(() => undefined);
    }
  }, [canCreate, needsStorefrontPicker]);

  const storefronts = useMemo(
    () => locations.filter((location) => isStorefrontType(location.locationType)),
    [locations]
  );

  const effectiveStorefrontLocationId = needsStorefrontPicker ? createLocationId : ownBranchId;

  // Live-preview stock lookups — refreshed whenever the destination (or which bucket/storefront)
  // changes, so "Current Stock" / "New Total" in the preview table always reflect the choice
  // actually being submitted, not a stale snapshot from when the modal opened. A transfer needs
  // BOTH sources at once: allocationSummary to show what's actually available to draw from at Main
  // Store (the whole point of the field feedback this destination exists to fix — see
  // getAvailableToTransfer below), and storefrontStock for the same "Current Stock"/"New Total at
  // the receiving storefront" preview the plain "storefront" destination already shows.
  useEffect(() => {
    if (!createOpen) return;
    if (destination === "main_store" || destination === "main_store_transfer") {
      window.blueLedger.mainStore
        .allocationSummary()
        .then(setAllocationSummary)
        .catch(() => undefined);
    }
    if (destination !== "main_store") {
      if (effectiveStorefrontLocationId) {
        window.blueLedger.inventory
          .listForLocation(effectiveStorefrontLocationId)
          .then(setStorefrontStock)
          .catch(() => undefined);
      } else {
        setStorefrontStock([]);
      }
    }
  }, [createOpen, destination, effectiveStorefrontLocationId]);

  function getCurrentStock(productId: string): number {
    if (destination === "main_store") {
      const row = allocationSummary.find((r) => r.productId === productId);
      if (!row) return 0;
      return allocationStorefrontId ? (row.allocatedByStorefront[allocationStorefrontId] ?? 0) : row.unallocatedQuantity;
    }
    return storefrontStock.find((r) => r.productId === productId)?.quantity ?? 0;
  }

  /** What's actually available to draw from at Main Store for the storefront this receipt is going
   * to — that storefront's own earmarked allocation plus the unallocated pool, the exact same
   * allocated-then-unallocated order distributeMainStoreStockCore itself draws from. Purely
   * informational here (the real enforcement happens server-side, atomically, per item) — this is
   * what lets the person filling out the receipt see up front whether a quantity will actually go
   * through instead of finding out only after submitting. */
  function getAvailableToTransfer(productId: string): number {
    const row = allocationSummary.find((r) => r.productId === productId);
    if (!row) return 0;
    const allocated = effectiveStorefrontLocationId ? (row.allocatedByStorefront[effectiveStorefrontLocationId] ?? 0) : 0;
    return row.unallocatedQuantity + allocated;
  }

  const filteredPickerProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((product) => product.status === "active")
      .filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [products, productSearch]);

  const availableYears = useMemo(() => buildAvailableYears((receipts ?? []).map((r) => r.createdAt)), [receipts]);

  const filteredReceipts = useMemo(() => {
    if (!receipts) return null;
    let list = receipts.filter((r) => matchesYearFilter(r.createdAt, yearFilter));
    if (locationFilter) {
      // Matches either the physical destination (locationId) or the Main-Store earmark
      // (allocationStorefrontId) — picking "Storefront X" should surface everything relevant to it,
      // including stock received at Main Store but earmarked for that storefront.
      list = list.filter((r) => r.locationId === locationFilter || r.allocationStorefrontId === locationFilter);
    }
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((r) =>
        `${r.receiptNumber} ${r.locationName} ${r.allocationStorefrontName ?? ""} ${r.receivedByName}`
          .toLowerCase()
          .includes(term)
      );
    }
    return list;
  }, [receipts, searchTerm, yearFilter, locationFilter]);

  const counts = useMemo(() => {
    const source = receipts ?? [];
    return {
      total: source.length,
      items: source.reduce((sum, r) => sum + r.itemCount, 0),
      units: source.reduce((sum, r) => sum + r.totalQuantityReceived, 0)
    };
  }, [receipts]);

  function openCreateModal(): void {
    setDestination(canReceiveIntoMainStore ? "main_store" : "storefront");
    setAllocationStorefrontId("");
    setCreateLocationId("");
    setCreateNotes("");
    setCreateItems([]);
    setProductSearch("");
    setCreateError(null);
    setCreateOpen(true);
  }

  function addDraftItem(product: ProductListItem): void {
    setCreateItems((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { productId: product.id, productName: product.name, sku: product.sku, quantity: 1 }];
    });
    setProductSearch("");
  }

  function updateDraftItemQuantity(productId: string, quantity: number): void {
    const next = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
    setCreateItems((prev) => prev.map((item) => (item.productId === productId ? { ...item, quantity: next } : item)));
  }

  /** Permissive counterpart used only by the free-typing quantity input's onChange — allows 0
   * mid-edit so clearing "1" to type "80" isn't fought by an immediate re-clamp on every keystroke.
   * updateDraftItemQuantity's own clamp still applies on blur (see StockRequestsRoute's own pair). */
  function updateDraftItemQuantityDraft(productId: string, raw: string): void {
    const parsed = raw === "" ? 0 : Math.floor(Number(raw));
    const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    setCreateItems((prev) => prev.map((item) => (item.productId === productId ? { ...item, quantity: next } : item)));
  }

  function removeDraftItem(productId: string): void {
    setCreateItems((prev) => prev.filter((item) => item.productId !== productId));
  }

  async function submitCreateReceipt(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setCreateError(null);

    if (createItems.length === 0) {
      setCreateError("Add at least one product");
      return;
    }
    if (destination !== "main_store" && needsStorefrontPicker && !createLocationId) {
      setCreateError("Choose which storefront this receipt is for");
      return;
    }
    if (destination === "main_store_transfer") {
      const shortItem = createItems.find((item) => item.quantity > getAvailableToTransfer(item.productId));
      if (shortItem) {
        setCreateError(`Not enough stock at Main Store for ${shortItem.productName}`);
        return;
      }
    }

    setCreateSaving(true);
    try {
      await window.blueLedger.stockReceipt.create({
        destination,
        locationId: destination !== "main_store" && needsStorefrontPicker ? createLocationId : null,
        allocationStorefrontId: destination === "main_store" ? allocationStorefrontId || null : null,
        notes: createNotes,
        items: createItems.map((item) => ({ productId: item.productId, quantityReceived: item.quantity }))
      });
      setCreateOpen(false);
      await loadReceipts();
      showSuccessToast(destination === "main_store_transfer" ? "Stock transferred from Main Store" : "Goods received recorded");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to record goods received");
      setCreateError(message);
      showErrorToast(message);
    } finally {
      setCreateSaving(false);
    }
  }

  async function openView(id: string): Promise<void> {
    setViewLoading(true);
    setActionError(null);
    try {
      const receipt = await window.blueLedger.stockReceipt.get(id);
      setViewingReceipt(receipt);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load receipt"));
    } finally {
      setViewLoading(false);
    }
  }

  async function handlePrint(): Promise<void> {
    if (!viewingReceipt) return;
    setPrinting(true);
    setActionError(null);
    try {
      const result = await window.blueLedger.printer.printStockReceiptDocument(viewingReceipt.id);
      if (result.success) {
        showSuccessToast(result.message);
      } else {
        setActionError(result.message);
        showErrorToast(result.message);
      }
    } catch (err) {
      const message = getErrorMessage(err, "Failed to print goods received note");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setPrinting(false);
    }
  }

  async function handlePreview(): Promise<void> {
    if (!viewingReceipt) return;
    setPreviewing(true);
    setActionError(null);
    try {
      await window.blueLedger.printer.previewStockReceiptPdf(viewingReceipt.id);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to open preview");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setPreviewing(false);
    }
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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Inventory</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <PackageCheck className="size-5 text-primary" aria-hidden="true" />
              Goods Received
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Receive many products in one batch, with a permanent record you can reprint anytime.
            </p>
          </div>
          {canCreate && (
            <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              New Receipt
            </Button>
          )}
        </div>

        {(loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? actionError}
          </div>
        )}

        {receipts !== null && receipts.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <StatTile icon={PackageCheck} label="Total Receipts" value={String(counts.total)} tone="primary" />
              <StatTile icon={PackageCheck} label="Line Items" value={String(counts.items)} tone="accent" />
              <StatTile icon={PackageCheck} label="Units Received" value={String(counts.units)} tone="success" />
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block sm:max-w-xs sm:flex-1">
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
                    placeholder="Search by receipt #, destination, or receiver"
                    className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
                  />
                </div>
              </label>

              <SelectField
                label="Year"
                value={yearFilter}
                onChange={setYearFilter}
                options={yearFilterOptions(availableYears)}
                className="w-32"
              />
              {needsStorefrontPicker && (
                <SelectField
                  label="Storefront"
                  value={locationFilter}
                  onChange={setLocationFilter}
                  options={[
                    { value: "", label: "All Locations" },
                    ...locations.map((location) => ({ value: location.id, label: location.locationName }))
                  ]}
                  className="w-44"
                />
              )}
            </div>
          </>
        )}

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <Button type="button" onClick={() => void loadReceipts()} className="h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : receipts === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : receipts.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <PackageCheck className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No goods received yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Receive many products at once — batches show up here with a full history you can reopen anytime.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Receipt
                </Button>
              )}
            </div>
          ) : filteredReceipts && filteredReceipts.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <Search className="size-7 text-muted" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-extrabold">No receipts match your filters</h3>
              <Button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setYearFilter(String(currentYear()));
                }}
                className="mt-5 h-9 text-xs"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[20%]" />
                  <col className="w-[25%]" />
                  <col className="w-[20%]" />
                  <col className="w-[25%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Receipt #</Th>
                    <Th>Destination</Th>
                    <Th>Items</Th>
                    <Th>Received By</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredReceipts ?? []).map((receipt) => (
                    <tr key={receipt.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        <div className="flex flex-col gap-0.5">
                          <span>{receipt.receiptNumber}</span>
                          <span>{formatDateTime(receipt.createdAt)}</span>
                        </div>
                      </td>
                      <td className="truncate px-4 py-3 font-extrabold">
                        <div className="flex flex-col gap-0.5">
                          <span>{receipt.locationName}</span>
                          {receipt.allocationStorefrontName && (
                            <DashedPill tone="accent">For {receipt.allocationStorefrontName}</DashedPill>
                          )}
                          {receipt.sourceType === "transfer" && <DashedPill tone="warning">Transfer</DashedPill>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        {receipt.itemCount} item{receipt.itemCount === 1 ? "" : "s"} ·{" "}
                        {receipt.totalQuantityReceived} unit{receipt.totalQuantityReceived === 1 ? "" : "s"}
                      </td>
                      <td className="truncate px-4 py-3 text-xs font-bold text-muted">{receipt.receivedByName}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void openView(receipt.id)}
                            aria-label={`View ${receipt.receiptNumber}`}
                            title="View details"
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                          >
                            <Eye className="size-3.5" aria-hidden="true" />
                          </button>
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

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Goods Received"
        description="Receive many products at once — the totals below preview exactly what will be recorded."
        widthClassName="max-w-2xl"
      >
        <form onSubmit={submitCreateReceipt}>
          {createError && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {createError}
            </div>
          )}

          {(canReceiveIntoMainStore || canTransferFromMainStore) && (
            <div className="flex gap-1.5 rounded-lg border border-line bg-soft p-1">
              {canReceiveIntoMainStore && (
                <button
                  type="button"
                  onClick={() => {
                    setDestination("main_store");
                    setCreateLocationId("");
                  }}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
                    destination === "main_store" ? "bg-primary text-white" : "text-muted hover:bg-white"
                  )}
                >
                  Into Main Store
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDestination("storefront");
                  setAllocationStorefrontId("");
                }}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
                  destination === "storefront" ? "bg-primary text-white" : "text-muted hover:bg-white"
                )}
              >
                Direct to Storefront
              </button>
              {canTransferFromMainStore && (
                <button
                  type="button"
                  onClick={() => {
                    setDestination("main_store_transfer");
                    setAllocationStorefrontId("");
                  }}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
                    destination === "main_store_transfer" ? "bg-primary text-white" : "text-muted hover:bg-white"
                  )}
                >
                  Transfer from Main Store
                </button>
              )}
            </div>
          )}

          {destination === "main_store" ? (
            <SelectField
              label="Earmark for (optional)"
              value={allocationStorefrontId}
              onChange={setAllocationStorefrontId}
              options={[
                { value: "", label: "Unallocated" },
                ...storefronts.map((location) => ({ value: location.id, label: location.locationName }))
              ]}
              className="mt-3"
            />
          ) : needsStorefrontPicker ? (
            <SelectField
              label="Storefront"
              value={createLocationId}
              onChange={setCreateLocationId}
              options={[
                { value: "", label: "Select a storefront..." },
                ...storefronts.map((location) => ({ value: location.id, label: location.locationName }))
              ]}
              className="mt-3"
            />
          ) : null}

          <div className="mt-4 flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Products</span>
            <button
              type="button"
              onClick={() => setQuickCreateProductOpen(true)}
              className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
            >
              <Plus className="size-3" aria-hidden="true" />
              New Product
            </button>
          </div>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="text"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Search product by name or SKU"
              className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
            {filteredPickerProducts.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-soft">
                {filteredPickerProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addDraftItem(product)}
                    className="flex w-full items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-soft cursor-pointer"
                  >
                    <span className="font-bold text-ink">
                      {product.name} <span className="font-semibold text-muted">({product.sku})</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {createItems.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-soft">
                    <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider text-muted">Product</th>
                    <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider text-muted">Qty Received</th>
                    {destination === "main_store_transfer" && (
                      <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider text-muted">
                        Available at Main Store
                      </th>
                    )}
                    <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider text-muted">Current Stock</th>
                    <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider text-muted">New Total</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {createItems.map((item) => {
                    const currentStock = getCurrentStock(item.productId);
                    const availableToTransfer = getAvailableToTransfer(item.productId);
                    const overRequested = destination === "main_store_transfer" && item.quantity > availableToTransfer;
                    return (
                      <tr key={item.productId} className="border-t border-line">
                        <td className="px-3 py-2">
                          <p className="font-extrabold text-ink">{item.productName}</p>
                          <p className="text-[10px] font-semibold text-muted">{item.sku}</p>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={1}
                            value={item.quantity === 0 ? "" : item.quantity}
                            onChange={(event) => updateDraftItemQuantityDraft(item.productId, event.target.value)}
                            onBlur={() => updateDraftItemQuantity(item.productId, item.quantity)}
                            aria-label={`Quantity for ${item.productName}`}
                            className={cn(
                              "h-8 w-16 rounded-md border px-2 text-center text-sm font-extrabold tabular-nums text-ink outline-none focus:border-accent",
                              overRequested ? "border-danger" : "border-line"
                            )}
                          />
                        </td>
                        {destination === "main_store_transfer" && (
                          <td
                            className={cn(
                              "px-3 py-2 text-right font-bold tabular-nums",
                              overRequested ? "text-danger" : "text-muted"
                            )}
                            title={
                              overRequested
                                ? "Not enough stock at Main Store (earmarked for this storefront + unallocated) to cover this quantity"
                                : undefined
                            }
                          >
                            {availableToTransfer}
                          </td>
                        )}
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-muted">{currentStock}</td>
                        <td className="px-3 py-2 text-right font-extrabold tabular-nums text-success">
                          {currentStock + item.quantity}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeDraftItem(item.productId)}
                            aria-label={`Remove ${item.productName}`}
                            className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <TextAreaField
            label="Notes"
            value={createNotes}
            onChange={setCreateNotes}
            placeholder="Optional — e.g. supplier or delivery note reference"
            className="mt-4"
            rows={2}
          />

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createSaving}
              className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {createSaving ? "Recording..." : "Record Receipt"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={viewingReceipt !== null || viewLoading}
        onClose={() => setViewingReceipt(null)}
        title={viewingReceipt?.receiptNumber ?? "Goods Received"}
        description="Frozen at the moment of receiving — reflects exactly what was true then, even if stock has moved since."
        widthClassName="max-w-lg"
      >
        {viewLoading ? (
          <div className="flex min-h-[160px] items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : viewingReceipt ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <DashedPill tone="ink">{viewingReceipt.locationName}</DashedPill>
              {viewingReceipt.allocationStorefrontName && (
                <DashedPill tone="accent">For {viewingReceipt.allocationStorefrontName}</DashedPill>
              )}
              {viewingReceipt.sourceType === "transfer" && (
                <DashedPill tone="warning">Transferred from Main Store</DashedPill>
              )}
              <span className="text-xs font-semibold text-muted">
                Received by {viewingReceipt.receivedByName} · {formatDateTime(viewingReceipt.createdAt)}
              </span>
            </div>

            <div className="rounded-lg border border-line">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-soft">
                    <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-muted">
                      Product
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider text-muted">
                      Received
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider text-muted">
                      Before
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider text-muted">
                      After
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {viewingReceipt.items.map((item) => (
                    <tr key={item.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <p className="font-extrabold text-ink">{item.productName}</p>
                        <p className="text-[10px] font-semibold text-muted">{item.sku}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-extrabold tabular-nums">{item.quantityReceived}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-muted">{item.previousQuantity}</td>
                      <td className="px-3 py-2 text-right font-extrabold tabular-nums text-success">{item.newQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {viewingReceipt.notes && (
              <div className="rounded-lg border border-line bg-soft/40 p-3">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Notes</p>
                <p className="mt-1 text-sm font-semibold text-ink">{viewingReceipt.notes}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 border-t border-line pt-4">
              <Button
                type="button"
                onClick={() => void handlePrint()}
                disabled={printing}
                className="h-9 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {printing ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
                )}
                Print
              </Button>
              <Button
                type="button"
                onClick={() => void handlePreview()}
                disabled={previewing}
                className="h-9 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {previewing ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Eye className="mr-1.5 size-3.5" aria-hidden="true" />
                )}
                Preview
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <QuickCreateProductModal
        open={quickCreateProductOpen}
        onClose={() => setQuickCreateProductOpen(false)}
        onCreated={(product) => {
          // No storefrontId passed — same as Purchases: this receipt IS the "receive stock" step,
          // so the new product starts at zero stock and gets its quantity set right here in the
          // draft items table below, not inside the popup.
          const listItem = { ...product, categoryName: null, categoryColor: null, totalStock: 0 };
          setProducts((prev) => [...prev, listItem]);
          addDraftItem(listItem);
          setQuickCreateProductOpen(false);
        }}
      />
    </motion.div>
  );
}
