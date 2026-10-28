import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Ban,
  CheckCircle2,
  ClipboardPen,
  Clock,
  Eye,
  Link2,
  Loader2,
  PackagePlus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  XCircle
} from "lucide-react";
import { PurchaseFormModal, type PurchaseFromRequisition } from "@renderer/app/routes/purchases/PurchaseFormModal";
import { Button } from "@renderer/shared/components/Button";
import { useConfirm } from "@renderer/shared/components/ConfirmModal";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { QuickCreateProductModal } from "@renderer/shared/components/QuickCreateProductModal";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { Product, ProductListItem } from "@shared/types/product";
import { PURCHASE_STATUS_OPTIONS, type PurchaseStatus } from "@shared/types/purchase";
import type {
  PurchaseRequisition,
  PurchaseRequisitionListItem,
  PurchaseRequisitionStatus
} from "@shared/types/purchase-requisition";
import type { Supplier } from "@shared/types/supplier";

type FilterTab = "all" | PurchaseRequisitionStatus;

const FILTER_TABS: Array<{ value: FilterTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" }
];

/** A line in the New Requisition form — a catalog product (productId) or a free-text item. */
type DraftLine = {
  key: string;
  productId: string | null;
  itemName: string;
  sku: string | null;
  quantity: number;
  notes: string;
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusTone(status: PurchaseRequisitionStatus): "warning" | "success" | "danger" | "neutral" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "cancelled") return "neutral";
  return "warning";
}

function purchaseStatusLabel(status: PurchaseStatus | null): string | null {
  if (!status) return null;
  return PURCHASE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

/** Small "type to find a product" picker — used both in the New Requisition form and to link a
 * free-text line to a catalog product. */
function ProductSearch({
  products,
  placeholder,
  onPick
}: {
  products: ProductListItem[];
  placeholder: string;
  onPick: (product: ProductListItem) => void;
}): React.JSX.Element {
  const [term, setTerm] = useState("");
  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return [];
    return products
      .filter((product) => product.status === "active")
      .filter((product) => `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [products, term]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input
        type="text"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
      />
      {matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-white shadow-soft">
          {matches.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => {
                onPick(product);
                setTerm("");
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-soft cursor-pointer"
            >
              <span className="min-w-0 truncate font-bold text-ink">{product.name}</span>
              <span className="flex-none text-[11px] font-semibold text-muted">{product.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PurchaseRequisitionsRoute(): React.JSX.Element {
  const { can, session } = usePermissions();
  const confirm = useConfirm();
  const canCreate = can("purchase_requisitions", "create");
  const canApprove = can("purchase_requisitions", "approve");
  // Approving creates a Purchase, which needs these too (purchase-service.ts re-checks regardless).
  const canConvert = canApprove && can("purchases", "create");
  const needsStorefrontPicker = session?.branch == null;
  const employeeId = session?.employee.id ?? null;

  const [requisitions, setRequisitions] = useState<PurchaseRequisitionListItem[] | null>(null);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterTab>("all");
  const [locationFilter, setLocationFilter] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createStorefrontId, setCreateStorefrontId] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createLines, setCreateLines] = useState<DraftLine[]>([]);
  const [freeTextName, setFreeTextName] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [viewing, setViewing] = useState<PurchaseRequisition | null>(null);
  const [viewBusy, setViewBusy] = useState(false);
  const [linkingItemId, setLinkingItemId] = useState<string | null>(null);
  const [createProductForItem, setCreateProductForItem] = useState<{ itemId: string; name: string } | null>(null);

  const [rejecting, setRejecting] = useState<PurchaseRequisition | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSaving, setRejectSaving] = useState(false);

  const [converting, setConverting] = useState<PurchaseFromRequisition | null>(null);

  const storefronts = useMemo(
    () => locations.filter((location) => location.status === "active" && isStorefrontType(location.locationType)),
    [locations]
  );
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const loadRequisitions = useCallback(async (): Promise<void> => {
    try {
      setRequisitions(await window.blueLedger.purchaseRequisition.list());
      setLoadError(null);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load requisitions"));
    }
  }, []);

  useEffect(() => {
    void loadRequisitions();
    // Reference data: each optional — a role without Products/Suppliers access still gets a working
    // page (free-text items only / no conversion), never a failed load.
    void window.blueLedger.product.list().then(setProducts).catch(() => setProducts([]));
    void window.blueLedger.location.list().then(setLocations).catch(() => setLocations([]));
    if (canConvert) {
      void window.blueLedger.supplier.list().then(setSuppliers).catch(() => setSuppliers([]));
    }
  }, [loadRequisitions, canConvert]);

  const counts = useMemo(() => {
    const list = requisitions ?? [];
    return {
      total: list.length,
      pending: list.filter((r) => r.status === "pending").length,
      approved: list.filter((r) => r.status === "approved").length,
      closed: list.filter((r) => r.status === "rejected" || r.status === "cancelled").length
    };
  }, [requisitions]);

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return (requisitions ?? []).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (locationFilter && r.storefrontId !== locationFilter) return false;
      if (!needle) return true;
      return `${r.requisitionNumber} ${r.storefrontName} ${r.requestedByName} ${r.purchaseNumber ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [requisitions, searchTerm, statusFilter, locationFilter]);

  // ---- New requisition -------------------------------------------------------------------------

  function openCreate(): void {
    setCreateStorefrontId("");
    setCreateNotes("");
    setCreateLines([]);
    setFreeTextName("");
    setCreateError(null);
    setCreateOpen(true);
  }

  function addCatalogLine(product: ProductListItem): void {
    setCreateLines((prev) =>
      prev.some((line) => line.productId === product.id)
        ? prev
        : [...prev, { key: product.id, productId: product.id, itemName: product.name, sku: product.sku, quantity: 1, notes: "" }]
    );
  }

  function addFreeTextLine(): void {
    const name = freeTextName.trim();
    if (!name) return;
    setCreateLines((prev) => [
      ...prev,
      { key: `free_${Date.now()}_${prev.length}`, productId: null, itemName: name, sku: null, quantity: 1, notes: "" }
    ]);
    setFreeTextName("");
  }

  function updateLine(key: string, patch: Partial<DraftLine>): void {
    setCreateLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function submitCreate(): Promise<void> {
    setCreateError(null);
    if (needsStorefrontPicker && !createStorefrontId) {
      setCreateError("Choose which storefront this requisition is for");
      return;
    }
    if (createLines.length === 0) {
      setCreateError("Add at least one item");
      return;
    }
    setCreateSaving(true);
    try {
      const created = await window.blueLedger.purchaseRequisition.create({
        storefrontId: needsStorefrontPicker ? createStorefrontId : null,
        notes: createNotes,
        items: createLines.map((line) => ({
          productId: line.productId,
          itemName: line.itemName,
          quantity: line.quantity,
          notes: line.notes
        }))
      });
      showSuccessToast(`Requisition ${created.requisitionNumber} sent for approval`);
      setCreateOpen(false);
      await loadRequisitions();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to create requisition");
      setCreateError(message);
      showErrorToast(message);
    } finally {
      setCreateSaving(false);
    }
  }

  // ---- View / review ---------------------------------------------------------------------------

  async function openView(id: string): Promise<void> {
    setViewBusy(true);
    try {
      setViewing(await window.blueLedger.purchaseRequisition.get(id));
      setLinkingItemId(null);
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to open requisition"));
    } finally {
      setViewBusy(false);
    }
  }

  async function linkItem(itemId: string, productId: string): Promise<void> {
    if (!viewing) return;
    setViewBusy(true);
    try {
      setViewing(await window.blueLedger.purchaseRequisition.linkItem(viewing.id, { itemId, productId }));
      setLinkingItemId(null);
      void loadRequisitions();
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to link product"));
    } finally {
      setViewBusy(false);
    }
  }

  function handleProductCreated(product: Product): void {
    setProducts((prev) => [...prev, { ...product, categoryName: null, categoryColor: null, totalStock: 0 }]);
    const target = createProductForItem;
    setCreateProductForItem(null);
    if (target) void linkItem(target.itemId, product.id);
  }

  async function handleCancel(requisition: PurchaseRequisition): Promise<void> {
    const ok = await confirm({
      title: `Cancel ${requisition.requisitionNumber}?`,
      message: "It will be withdrawn and can no longer be approved.",
      tone: "danger",
      confirmLabel: "Cancel Requisition"
    });
    if (!ok) return;
    setViewBusy(true);
    try {
      setViewing(await window.blueLedger.purchaseRequisition.cancel(requisition.id));
      showSuccessToast("Requisition cancelled");
      await loadRequisitions();
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to cancel requisition"));
    } finally {
      setViewBusy(false);
    }
  }

  async function submitReject(): Promise<void> {
    if (!rejecting) return;
    if (!rejectReason.trim()) {
      showErrorToast("A reason is required");
      return;
    }
    setRejectSaving(true);
    try {
      const updated = await window.blueLedger.purchaseRequisition.reject(rejecting.id, { reason: rejectReason });
      showSuccessToast(`${updated.requisitionNumber} rejected`);
      setRejecting(null);
      if (viewing?.id === updated.id) setViewing(updated);
      await loadRequisitions();
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to reject requisition"));
    } finally {
      setRejectSaving(false);
    }
  }

  function startConvert(requisition: PurchaseRequisition): void {
    const lines: PurchaseFromRequisition["items"] = [];
    for (const item of requisition.items) {
      const product = item.productId ? productById.get(item.productId) : undefined;
      if (!product) {
        showErrorToast(`Link "${item.itemName}" to a product first`);
        return;
      }
      lines.push({ product, quantity: item.quantityRequested });
    }
    setConverting({
      requisitionId: requisition.id,
      requisitionNumber: requisition.requisitionNumber,
      locationId: requisition.storefrontId,
      items: lines
    });
  }

  async function handleConverted(): Promise<void> {
    const id = converting?.requisitionId;
    setConverting(null);
    await loadRequisitions();
    if (id && viewing?.id === id) await openView(id);
  }

  // ---- Render ----------------------------------------------------------------------------------

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
              <ClipboardPen className="size-5 text-primary" aria-hidden="true" />
              Purchase Requisitions
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              {canApprove
                ? "Requests to buy stock. Approve one to turn it into a purchase."
                : "Ask for stock to be bought for your storefront — a manager approves it into a purchase."}
            </p>
          </div>
          {canCreate && (
            <Button type="button" onClick={openCreate} className="h-9 text-xs">
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              New Requisition
            </Button>
          )}
        </div>

        {loadError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError}
          </div>
        )}

        {requisitions !== null && requisitions.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile icon={ClipboardPen} label="Total" value={String(counts.total)} tone="primary" />
              <StatTile icon={Clock} label="Pending" value={String(counts.pending)} tone="warning" />
              <StatTile icon={CheckCircle2} label="Approved" value={String(counts.approved)} tone="success" />
              <StatTile icon={XCircle} label="Rejected / Cancelled" value={String(counts.closed)} tone="danger" />
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block sm:max-w-xs sm:flex-1">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Search</span>
                <div className="relative mt-1.5">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Requisition #, storefront, requester, PO #"
                    className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
                  />
                </div>
              </label>
              {needsStorefrontPicker && (
                <SelectField
                  label="Storefront"
                  value={locationFilter}
                  onChange={setLocationFilter}
                  options={[
                    { value: "", label: "All Storefronts" },
                    ...storefronts.map((location) => ({ value: location.id, label: location.locationName }))
                  ]}
                  className="w-44"
                />
              )}
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-soft px-1 py-0.5">
                {FILTER_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setStatusFilter(tab.value)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[11px] font-extrabold transition cursor-pointer",
                      statusFilter === tab.value ? "bg-primary text-white" : "text-muted hover:bg-white"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="mt-5">
          {requisitions === null && !loadError ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : requisitions !== null && requisitions.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <ClipboardPen className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No requisitions yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Running low on something, or need a product the shop doesn't stock yet? Raise a requisition and a
                manager will approve it into a purchase.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreate} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Requisition
                </Button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <Search className="size-7 text-muted" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-extrabold">No requisitions match your filters</h3>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Requisition #</Th>
                    <Th>Requested By</Th>
                    <Th>Items</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-ink">{r.requisitionNumber}</span>
                          <span>{formatDateTime(r.requestedAt)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-extrabold">
                        <div className="flex flex-col gap-0.5">
                          <span>{r.requestedByName}</span>
                          <span className="text-xs font-semibold text-muted">{r.storefrontName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        {r.itemCount} item{r.itemCount === 1 ? "" : "s"} · {r.totalQuantityRequested} unit
                        {r.totalQuantityRequested === 1 ? "" : "s"}
                        {r.status === "pending" && r.unlinkedItemCount > 0 && (
                          <span className="ml-1.5 text-accent">
                            · {r.unlinkedItemCount} new item{r.unlinkedItemCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <DashedPill tone={statusTone(r.status)}>{r.status}</DashedPill>
                          {r.purchaseNumber && (
                            <DashedPill tone="accent">
                              {r.purchaseNumber} · {purchaseStatusLabel(r.purchaseStatus)}
                            </DashedPill>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => void openView(r.id)}
                            aria-label={`View ${r.requisitionNumber}`}
                            title={canApprove && r.status === "pending" ? "Review" : "View details"}
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

      {/* ---- New requisition ---- */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Purchase Requisition"
        description="List what needs to be bought. Pick products from the catalog, or describe something the shop doesn't stock yet."
        widthClassName="max-w-3xl"
      >
        {createError && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {createError}
          </div>
        )}

        {needsStorefrontPicker && (
          <SelectField
            label="Storefront"
            value={createStorefrontId}
            onChange={setCreateStorefrontId}
            options={[
              { value: "", label: "Select storefront" },
              ...storefronts.map((location) => ({ value: location.id, label: location.locationName }))
            ]}
            className="mb-4 max-w-xs"
          />
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">From the catalog</span>
            <div className="mt-1.5">
              <ProductSearch products={products} placeholder="Search products by name or SKU" onPick={addCatalogLine} />
            </div>
          </div>
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Not in the catalog</span>
            <div className="mt-1.5 flex gap-2">
              <input
                type="text"
                value={freeTextName}
                onChange={(event) => setFreeTextName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addFreeTextLine();
                  }
                }}
                placeholder="e.g. Samsung A15 charger"
                className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              <Button
                type="button"
                onClick={addFreeTextLine}
                disabled={!freeTextName.trim()}
                className="h-10 flex-none text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          {createLines.length === 0 ? (
            <div className="flex min-h-[120px] flex-col items-center justify-center bg-soft/60 p-6 text-center">
              <PackagePlus className="size-6 text-muted" aria-hidden="true" />
              <p className="mt-2 text-xs font-bold text-muted">No items yet</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-soft text-muted">
                  <Th>Item</Th>
                  <Th className="w-24">Qty</Th>
                  <Th>Note</Th>
                  <Th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {createLines.map((line) => (
                  <tr key={line.key} className="border-t border-line">
                    <td className="px-4 py-2">
                      <p className="font-extrabold text-ink">{line.itemName}</p>
                      <p className="text-[11px] font-semibold text-muted">
                        {line.productId ? line.sku : <span className="text-accent">New item — not in catalog yet</span>}
                      </p>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={1}
                        value={line.quantity === 0 ? "" : line.quantity}
                        onChange={(event) => updateLine(line.key, { quantity: Math.max(0, Math.floor(Number(event.target.value) || 0)) })}
                        onBlur={() => updateLine(line.key, { quantity: Math.max(1, line.quantity) })}
                        className="h-8 w-20 rounded-md border border-line px-2 text-right text-sm font-bold outline-none focus:border-accent"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={line.notes}
                        onChange={(event) => updateLine(line.key, { notes: event.target.value })}
                        placeholder="Optional (colour, size, brand…)"
                        className="h-8 w-full rounded-md border border-line px-2 text-xs font-semibold outline-none placeholder:font-normal placeholder:text-muted/60 focus:border-accent"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setCreateLines((prev) => prev.filter((entry) => entry.key !== line.key))}
                        aria-label={`Remove ${line.itemName}`}
                        className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <TextAreaField
          label="Reason / Notes"
          value={createNotes}
          onChange={setCreateNotes}
          placeholder="Why is this needed? (optional)"
          rows={2}
          className="mt-4"
        />

        <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
          <Button
            type="button"
            onClick={() => setCreateOpen(false)}
            className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submitCreate()}
            disabled={createSaving}
            className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createSaving && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />}
            Send for Approval
          </Button>
        </div>
      </Modal>

      {/* ---- View / review ---- */}
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? viewing.requisitionNumber : "Requisition"}
        description={viewing ? `${viewing.storefrontName} · requested by ${viewing.requestedByName} · ${formatDateTime(viewing.requestedAt)}` : ""}
        widthClassName="max-w-3xl"
      >
        {viewing && (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <DashedPill tone={statusTone(viewing.status)}>{viewing.status}</DashedPill>
              {viewing.purchaseNumber && (
                <DashedPill tone="accent">
                  <ShoppingBag className="mr-1 inline size-3" aria-hidden="true" />
                  {viewing.purchaseNumber} · {purchaseStatusLabel(viewing.purchaseStatus)}
                </DashedPill>
              )}
              {viewing.reviewedByName && (
                <span className="text-[11px] font-semibold text-muted">
                  {viewing.status === "cancelled" ? "Cancelled" : "Reviewed"} by {viewing.reviewedByName} ·{" "}
                  {formatDateTime(viewing.reviewedAt)}
                </span>
              )}
            </div>

            {viewing.notes && (
              <p className="mt-3 rounded-lg bg-soft/60 px-3 py-2 text-xs font-semibold text-ink">{viewing.notes}</p>
            )}
            {viewing.rejectionReason && (
              <p className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
                Rejected: {viewing.rejectionReason}
              </p>
            )}

            <div className="mt-4 overflow-hidden rounded-lg border border-line">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-soft text-muted">
                    <Th>Requested</Th>
                    <Th>Catalog Product</Th>
                    <Th className="w-20 text-right">Qty</Th>
                  </tr>
                </thead>
                <tbody>
                  {viewing.items.map((item) => {
                    const canLink = canApprove && viewing.status === "pending";
                    return (
                      <tr key={item.id} className="border-t border-line align-top">
                        <td className="px-4 py-2.5">
                          <p className="font-extrabold text-ink">{item.itemName}</p>
                          {item.notes && <p className="text-[11px] font-semibold text-muted">{item.notes}</p>}
                        </td>
                        <td className="px-4 py-2.5">
                          {item.productId && linkingItemId !== item.id ? (
                            <div className="flex items-center gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-bold text-ink">{item.productName ?? item.itemName}</p>
                                <p className="text-[11px] font-semibold text-muted">{item.sku}</p>
                              </div>
                              {canLink && (
                                <button
                                  type="button"
                                  onClick={() => setLinkingItemId(item.id)}
                                  className="flex-none text-[10px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
                                >
                                  Change
                                </button>
                              )}
                            </div>
                          ) : canLink ? (
                            <div className="space-y-1.5">
                              <ProductSearch
                                products={products}
                                placeholder="Link to an existing product"
                                onPick={(product) => void linkItem(item.id, product.id)}
                              />
                              <button
                                type="button"
                                onClick={() => setCreateProductForItem({ itemId: item.id, name: item.itemName })}
                                className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
                              >
                                <Plus className="size-3" aria-hidden="true" />
                                Create as new product
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs font-bold text-accent">New item — not in catalog</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-extrabold tabular-nums">{item.quantityRequested}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {viewing.status === "pending" && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <div>
                  {(viewing.requestedBy === employeeId || canApprove) && (
                    <Button
                      type="button"
                      onClick={() => void handleCancel(viewing)}
                      disabled={viewBusy}
                      className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:opacity-50"
                    >
                      <Ban className="mr-1.5 size-4" aria-hidden="true" />
                      Cancel Requisition
                    </Button>
                  )}
                </div>
                {canApprove && (
                  <div className="flex flex-wrap items-center gap-2">
                    {viewing.unlinkedItemCount > 0 && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-muted">
                        <Link2 className="size-3.5" aria-hidden="true" />
                        Link {viewing.unlinkedItemCount} new item{viewing.unlinkedItemCount === 1 ? "" : "s"} to approve
                      </span>
                    )}
                    <Button
                      type="button"
                      onClick={() => {
                        setRejectReason("");
                        setRejecting(viewing);
                      }}
                      disabled={viewBusy}
                      className="h-9 border border-danger/40 bg-white text-xs text-danger shadow-none hover:bg-danger-soft disabled:opacity-50"
                    >
                      <XCircle className="mr-1.5 size-4" aria-hidden="true" />
                      Reject
                    </Button>
                    <Button
                      type="button"
                      onClick={() => startConvert(viewing)}
                      disabled={viewBusy || viewing.unlinkedItemCount > 0 || !canConvert}
                      title={canConvert ? undefined : "Your role also needs permission to create purchases"}
                      className="h-9 bg-teal text-xs hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
                      Approve &amp; Create Purchase
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ---- Reject ---- */}
      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={rejecting ? `Reject ${rejecting.requisitionNumber}` : "Reject"}
        description="The requester will see this reason."
        widthClassName="max-w-md"
      >
        <TextAreaField label="Reason" value={rejectReason} onChange={setRejectReason} placeholder="Why is this being rejected?" rows={3} />
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            onClick={() => setRejecting(null)}
            className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
          >
            Back
          </Button>
          <Button
            type="button"
            onClick={() => void submitReject()}
            disabled={rejectSaving}
            className="h-9 border border-danger bg-danger text-xs text-white shadow-none hover:brightness-110 disabled:opacity-50"
          >
            {rejectSaving && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />}
            Reject Requisition
          </Button>
        </div>
      </Modal>

      <QuickCreateProductModal
        open={createProductForItem !== null}
        onClose={() => setCreateProductForItem(null)}
        onCreated={handleProductCreated}
        initialName={createProductForItem?.name ?? ""}
      />

      {canConvert && (
        <PurchaseFormModal
          open={converting !== null}
          onClose={() => setConverting(null)}
          editingPurchase={null}
          fromRequisition={converting}
          suppliers={suppliers}
          products={products}
          locations={locations}
          onSupplierCreated={(supplier) => setSuppliers((prev) => [...prev, supplier])}
          onProductCreated={(product) =>
            setProducts((prev) => [...prev, { ...product, categoryName: null, categoryColor: null, totalStock: 0 }])
          }
          onSaved={handleConverted}
        />
      )}

      {viewBusy && viewing === null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
          <Loader2 className="size-6 animate-spin text-white" aria-hidden="true" />
        </div>
      )}
    </motion.div>
  );
}
