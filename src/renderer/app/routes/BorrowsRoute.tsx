import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Eye, Handshake, Loader2, PackageOpen, Plus, Search } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { SelectField } from "@renderer/shared/components/form-fields";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast } from "@renderer/shared/lib/toast";
import type { ExportListRequest } from "@shared/types/export";
import type { Location } from "@shared/types/location";
import type { Product, ProductListItem } from "@shared/types/product";
import {
  BORROW_DIRECTION_OPTIONS,
  BORROW_STATUS_OPTIONS,
  type Borrow,
  type BorrowDirection,
  type BorrowListItem,
  type BorrowStatus,
  type BorrowSummary
} from "@shared/types/borrow";
import type { Supplier } from "@shared/types/supplier";
import { BorrowDetailModal } from "./borrows/BorrowDetailModal";
import { BorrowFormModal } from "./borrows/BorrowFormModal";

type DirectionFilter = "all" | BorrowDirection;
type StatusFilter = "all" | BorrowStatus;

function directionLabel(direction: BorrowDirection): string {
  return BORROW_DIRECTION_OPTIONS.find((option) => option.value === direction)?.label ?? direction;
}

function statusLabel(status: BorrowStatus): string {
  return BORROW_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function statusTone(status: BorrowStatus): "success" | "warning" | "accent" {
  if (status === "returned") return "success";
  if (status === "partially_returned") return "accent";
  return "warning";
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>{children}</th>
  );
}

export function BorrowsRoute(): React.JSX.Element {
  const { can, session } = usePermissions();
  const showStorefrontFilter = session?.branch == null;
  const canCreate = can("borrows", "create");
  const canEdit = can("borrows", "edit");
  const canExport = can("borrows", "export");

  const [summary, setSummary] = useState<BorrowSummary | null>(null);
  const [borrows, setBorrows] = useState<BorrowListItem[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");

  const [formOpen, setFormOpen] = useState(false);

  const [viewingBorrow, setViewingBorrow] = useState<Borrow | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [summaryResult, borrowList, supplierList, productList, locationList] = await Promise.all([
        window.blueLedger.borrow.summary(),
        window.blueLedger.borrow.list(),
        window.blueLedger.supplier.list(),
        window.blueLedger.product.list(),
        window.blueLedger.location.list()
      ]);
      setSummary(summaryResult);
      setBorrows(borrowList);
      setSuppliers(supplierList);
      setProducts(productList);
      setLocations(locationList);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load borrow records");
      setLoadError(message);
      showErrorToast(message);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!actionError) return undefined;
    const timer = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const filteredBorrows = useMemo(() => {
    if (!borrows) return null;
    let list = borrows;

    if (directionFilter !== "all") {
      list = list.filter((borrow) => borrow.direction === directionFilter);
    }
    if (statusFilter !== "all") {
      list = list.filter((borrow) => borrow.status === statusFilter);
    }
    if (supplierFilter) {
      list = list.filter((borrow) => borrow.supplierId === supplierFilter);
    }
    if (locationFilter) {
      list = list.filter((borrow) => borrow.locationId === locationFilter);
    }

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((borrow) => `${borrow.borrowNumber} ${borrow.supplierName} ${borrow.locationName}`.toLowerCase().includes(term));
    }

    return list;
  }, [borrows, directionFilter, statusFilter, supplierFilter, locationFilter, searchTerm]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredBorrows) return null;
    const filterParts: string[] = [];
    if (directionFilter !== "all") filterParts.push(`Direction: ${directionLabel(directionFilter)}`);
    if (statusFilter !== "all") filterParts.push(`Status: ${statusLabel(statusFilter)}`);
    if (supplierFilter) filterParts.push(`Shop: ${suppliers.find((s) => s.id === supplierFilter)?.businessName ?? supplierFilter}`);
    if (locationFilter) filterParts.push(`Location: ${locations.find((l) => l.id === locationFilter)?.locationName ?? locationFilter}`);
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);

    return {
      module: "borrows",
      title: "Borrow & Lend",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "All borrow/lend records",
      columns: [
        { key: "number", header: "Reference #" },
        { key: "direction", header: "Direction" },
        { key: "shop", header: "Shop" },
        { key: "location", header: "Location" },
        { key: "status", header: "Status" },
        { key: "items", header: "Items", align: "right" },
        { key: "totalQty", header: "Total Qty", align: "right" },
        { key: "remainingQty", header: "Remaining Qty", align: "right" },
        { key: "created", header: "Created" }
      ],
      rows: filteredBorrows.map((borrow) => ({
        number: borrow.borrowNumber,
        direction: directionLabel(borrow.direction),
        shop: borrow.supplierName,
        location: borrow.locationName,
        status: statusLabel(borrow.status),
        items: String(borrow.itemCount),
        totalQty: String(borrow.totalQuantity),
        remainingQty: String(borrow.totalRemainingQuantity),
        created: formatDate(borrow.createdAt)
      })),
      stats: summary
        ? [
          { label: "Total Records", value: String(summary.totalBorrows) },
          { label: "Open", value: String(summary.openCount) },
          { label: "Partially Returned", value: String(summary.partiallyReturnedCount) },
          { label: "Returned", value: String(summary.returnedCount) },
          { label: "Outstanding Borrowed (units)", value: String(summary.outstandingBorrowedQuantity) },
          { label: "Outstanding Lent (units)", value: String(summary.outstandingLentQuantity) }
        ]
        : [],
      fileBaseName: `Borrows_${new Date().toISOString().slice(0, 10)}`
    };
  }, [filteredBorrows, summary, directionFilter, statusFilter, supplierFilter, locationFilter, searchTerm, suppliers, locations]);

  function clearFilters(): void {
    setSearchTerm("");
    setDirectionFilter("all");
    setStatusFilter("all");
    setSupplierFilter("");
    setLocationFilter("");
  }

  async function openView(id: string): Promise<void> {
    setViewLoading(true);
    setActionError(null);
    try {
      const borrow = await window.blueLedger.borrow.get(id);
      setViewingBorrow(borrow);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load borrow record");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setViewLoading(false);
    }
  }

  function closeView(): void {
    setViewingBorrow(null);
  }

  async function refreshViewing(): Promise<void> {
    if (!viewingBorrow) return;
    const borrow = await window.blueLedger.borrow.get(viewingBorrow.id);
    setViewingBorrow(borrow);
    await loadAll();
  }

  function handleSupplierCreated(supplier: Supplier): void {
    setSuppliers((prev) => [...prev, supplier]);
  }

  function handleProductCreated(product: Product): void {
    setProducts((prev) => [...prev, { ...product, categoryName: null, categoryColor: null, totalStock: 0 }]);
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile icon={Handshake} label="Total Records" value={String(summary.totalBorrows)} tone="primary" />
          <StatTile icon={PackageOpen} label="Open" value={String(summary.openCount)} tone="warning" />
          <StatTile icon={PackageOpen} label="Partially Returned" value={String(summary.partiallyReturnedCount)} tone="accent" />
          <StatTile icon={CheckCircle2} label="Returned" value={String(summary.returnedCount)} tone="success" />
          <StatTile
            icon={Handshake}
            label="Outstanding (Borrowed / Lent)"
            value={`${summary.outstandingBorrowedQuantity} / ${summary.outstandingLentQuantity}`}
            tone="accent"
          />
        </div>
      )}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Borrow & Lend</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <Handshake className="size-5 text-primary" aria-hidden="true" />
              Stock Borrowed & Lent
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">Track stock moving between this shop and other shops — no pricing involved.</p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            {canCreate && (
              <Button type="button" onClick={() => setFormOpen(true)} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Borrow / Lend
              </Button>
            )}
          </div>
        </div>

        {(loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? actionError}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block sm:col-span-2 lg:col-span-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Search</span>
            <div className="relative mt-1.5">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search reference #, shop, location"
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>
          </label>

          <SelectField
            label="Direction"
            value={directionFilter}
            onChange={(value) => setDirectionFilter(value as DirectionFilter)}
            options={[{ value: "all", label: "All Directions" }, ...BORROW_DIRECTION_OPTIONS]}
          />
          <SelectField
            label="Status"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={[{ value: "all", label: "All Statuses" }, ...BORROW_STATUS_OPTIONS]}
          />
          <SelectField
            label="Shop"
            value={supplierFilter}
            onChange={setSupplierFilter}
            options={[{ value: "", label: "All Shops" }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.businessName }))]}
          />
          {showStorefrontFilter && (
            <SelectField
              label="Location"
              value={locationFilter}
              onChange={setLocationFilter}
              options={[{ value: "", label: "All Locations" }, ...locations.map((location) => ({ value: location.id, label: location.locationName }))]}
            />
          )}
        </div>

        <div className="mt-5">
          {borrows === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : borrows.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Handshake className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No borrow/lend records yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Record stock you've borrowed from another shop, or stock you've lent out to one.
              </p>
              {canCreate && (
                <Button type="button" onClick={() => setFormOpen(true)} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Borrow / Lend
                </Button>
              )}
            </div>
          ) : filteredBorrows && filteredBorrows.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No records match your filters</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">Try a different filter combination.</p>
              <Button type="button" onClick={clearFilters} className="mt-5 h-9 text-xs">
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[13%]" />
                  <col className="w-[13%]" />
                  <col className="w-[27%]" />
                  <col className="w-[12%]" />
                  <col className="w-[8%]" />
                  <col className="w-[15%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Reference #</Th>
                    <Th>Direction</Th>
                    <Th>Shop</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Items</Th>
                    <Th>Created</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredBorrows ?? []).map((borrow) => (
                    <tr
                      key={borrow.id}
                      onClick={() => void openView(borrow.id)}
                      className="cursor-pointer border-t border-line odd:bg-white even:bg-soft/50 hover:bg-soft"
                    >
                      <td className="truncate px-3 py-2.5 text-xs font-bold tabular-nums text-ink">{borrow.borrowNumber}</td>
                      <td className="px-3 py-2.5">
                        <DashedPill tone={borrow.direction === "borrowed" ? "accent" : "neutral"}>{directionLabel(borrow.direction)}</DashedPill>
                      </td>
                      <td className="truncate px-3 py-2.5 font-extrabold">
                        <div className="flex flex-col gap-0.5">
                          <span>{borrow.supplierName}</span>
                          <span className="text-xs font-semibold text-primary/80">{borrow.locationName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <DashedPill tone={statusTone(borrow.status)}>{statusLabel(borrow.status)}</DashedPill>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-ink">{borrow.itemCount}</td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">{formatDate(borrow.createdAt)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openView(borrow.id);
                            }}
                            aria-label="View borrow record"
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

      <BorrowFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        suppliers={suppliers}
        products={products}
        locations={locations}
        onSupplierCreated={handleSupplierCreated}
        onProductCreated={handleProductCreated}
        onSaved={loadAll}
      />

      {viewLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
          <Loader2 className="size-6 animate-spin text-white" aria-hidden="true" />
        </div>
      )}

      {viewingBorrow && <BorrowDetailModal borrow={viewingBorrow} canEdit={canEdit} onClose={closeView} onChanged={refreshViewing} />}
    </motion.div>
  );
}
