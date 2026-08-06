import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Boxes,
  CheckCircle2,
  Eye,
  FileClock,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Wallet
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { SelectField } from "@renderer/shared/components/form-fields";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import {
  ALL_YEARS_VALUE,
  buildAvailableYears,
  currentYear,
  matchesYearFilter,
  yearFilterOptions
} from "@renderer/shared/lib/year-filter";
import type { ExportListRequest } from "@shared/types/export";
import type { Location } from "@shared/types/location";
import type { PaymentMethod } from "@shared/types/payment-method";
import type { Product, ProductListItem } from "@shared/types/product";
import {
  PURCHASE_PAYMENT_STATUS_OPTIONS,
  PURCHASE_STATUS_OPTIONS,
  type Purchase,
  type PurchaseListItem,
  type PurchasePaymentStatus,
  type PurchaseStatus,
  type PurchaseSummary
} from "@shared/types/purchase";
import type { Supplier } from "@shared/types/supplier";
import { PurchaseDetailModal } from "./purchases/PurchaseDetailModal";
import { PurchaseFormModal } from "./purchases/PurchaseFormModal";

type StatusFilter = "all" | PurchaseStatus;
type PaymentStatusFilter = "all" | PurchasePaymentStatus;

function statusLabel(status: PurchaseStatus): string {
  return PURCHASE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function statusTone(status: PurchaseStatus): "success" | "warning" | "danger" | "neutral" | "accent" {
  if (status === "received") return "success";
  if (status === "partially_received") return "accent";
  if (status === "ordered") return "warning";
  if (status === "cancelled") return "danger";
  return "neutral";
}

function paymentStatusTone(status: PurchasePaymentStatus): "success" | "warning" | "neutral" {
  if (status === "paid") return "success";
  if (status === "partially_paid") return "warning";
  return "neutral";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

export function PurchasesRoute(): React.JSX.Element {
  const { can, session } = usePermissions();
  const showStorefrontFilter = session?.branch == null;
  const canCreate = can("purchases", "create");
  const canEdit = can("purchases", "edit");
  const canExport = can("purchases", "export");

  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [purchases, setPurchases] = useState<PurchaseListItem[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<PaymentStatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear()));

  const [formOpen, setFormOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);

  const [viewingPurchase, setViewingPurchase] = useState<Purchase | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [summaryResult, purchaseList, supplierList, productList, locationList, methodList] = await Promise.all([
        window.blueLedger.purchase.summary(),
        window.blueLedger.purchase.list(),
        window.blueLedger.supplier.list(),
        window.blueLedger.product.list(),
        window.blueLedger.location.list(),
        window.blueLedger.paymentMethod.list()
      ]);
      setSummary(summaryResult);
      setPurchases(purchaseList);
      setSuppliers(supplierList);
      setProducts(productList);
      setLocations(locationList);
      setPaymentMethods(methodList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load purchases"));
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

  const availableYears = useMemo(
    () => buildAvailableYears((purchases ?? []).map((purchase) => purchase.createdAt)),
    [purchases]
  );

  const filteredPurchases = useMemo(() => {
    if (!purchases) return null;
    let list = purchases;

    if (statusFilter !== "all") {
      list = list.filter((purchase) => purchase.status === statusFilter);
    }
    if (supplierFilter) {
      list = list.filter((purchase) => purchase.supplierId === supplierFilter);
    }
    if (locationFilter) {
      list = list.filter((purchase) => purchase.locationId === locationFilter);
    }
    if (paymentStatusFilter !== "all") {
      list = list.filter((purchase) => purchase.paymentStatus === paymentStatusFilter);
    }
    if (dateFrom) {
      const fromTime = new Date(dateFrom).getTime();
      list = list.filter((purchase) => new Date(purchase.createdAt).getTime() >= fromTime);
    }
    if (dateTo) {
      const toTime = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1;
      list = list.filter((purchase) => new Date(purchase.createdAt).getTime() <= toTime);
    }

    list = list.filter((purchase) => matchesYearFilter(purchase.createdAt, yearFilter));

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((purchase) => {
        const haystack =
          `${purchase.purchaseNumber} ${purchase.supplierName} ${purchase.supplierInvoiceNumber ?? ""} ${purchase.locationName}`.toLowerCase();
        return haystack.includes(term);
      });
    }

    return list;
  }, [
    purchases,
    statusFilter,
    supplierFilter,
    locationFilter,
    paymentStatusFilter,
    dateFrom,
    dateTo,
    yearFilter,
    searchTerm
  ]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredPurchases) return null;
    const filterParts: string[] = [];
    if (statusFilter !== "all") filterParts.push(`Status: ${statusLabel(statusFilter)}`);
    if (paymentStatusFilter !== "all") filterParts.push(`Payment Status: ${paymentStatusFilter}`);
    if (supplierFilter) {
      filterParts.push(`Supplier: ${suppliers.find((s) => s.id === supplierFilter)?.businessName ?? supplierFilter}`);
    }
    if (locationFilter) {
      filterParts.push(`Destination: ${locations.find((l) => l.id === locationFilter)?.locationName ?? locationFilter}`);
    }
    if (dateFrom || dateTo) filterParts.push(`Date: ${dateFrom || "…"} to ${dateTo || "…"}`);
    if (yearFilter !== ALL_YEARS_VALUE) filterParts.push(`Year: ${yearFilter}`);
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);

    return {
      module: "purchases",
      title: "Purchases",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "All purchase orders",
      columns: [
        { key: "poNumber", header: "PO #" },
        { key: "supplier", header: "Supplier" },
        { key: "supplierInvoice", header: "Supplier Invoice #" },
        { key: "destination", header: "Destination" },
        { key: "status", header: "Status" },
        { key: "total", header: "Total Amount", align: "right" },
        { key: "paymentStatus", header: "Payment Status" },
        { key: "ordered", header: "Ordered" },
        { key: "received", header: "Received" }
      ],
      rows: filteredPurchases.map((purchase) => ({
        poNumber: purchase.purchaseNumber,
        supplier: purchase.supplierName,
        supplierInvoice: purchase.supplierInvoiceNumber ?? "—",
        destination: purchase.locationName,
        status: statusLabel(purchase.status),
        total: formatCents(purchase.grandTotalCents),
        paymentStatus: purchase.paymentStatus === "partially_paid" ? "Partially Paid" : purchase.paymentStatus,
        ordered: formatDate(purchase.orderedAt),
        received: formatDate(purchase.receivedAt)
      })),
      stats: summary
        ? [
          { label: "Total Purchases", value: String(summary.totalPurchases) },
          { label: "Draft", value: String(summary.draftCount) },
          { label: "Ordered", value: String(summary.orderedCount) },
          { label: "Partially Received", value: String(summary.partiallyReceivedCount) },
          { label: "Received", value: String(summary.receivedCount) },
          { label: "Outstanding Payments", value: formatCents(summary.outstandingSupplierPaymentsCents ?? 0) }
        ]
        : [],
      fileBaseName: `Purchases_${new Date().toISOString().slice(0, 10)}`
    };
  }, [
    filteredPurchases,
    summary,
    statusFilter,
    paymentStatusFilter,
    supplierFilter,
    locationFilter,
    dateFrom,
    dateTo,
    yearFilter,
    searchTerm,
    suppliers,
    locations
  ]);

  function clearFilters(): void {
    setSearchTerm("");
    setStatusFilter("all");
    setSupplierFilter("");
    setLocationFilter("");
    setPaymentStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  }

  async function openView(id: string): Promise<void> {
    setViewLoading(true);
    setActionError(null);
    try {
      const purchase = await window.blueLedger.purchase.get(id);
      setViewingPurchase(purchase);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load purchase"));
    } finally {
      setViewLoading(false);
    }
  }

  function closeView(): void {
    setViewingPurchase(null);
  }

  async function refreshViewing(): Promise<void> {
    if (!viewingPurchase) return;
    const purchase = await window.blueLedger.purchase.get(viewingPurchase.id);
    setViewingPurchase(purchase);
    await loadAll();
  }

  function openCreateModal(): void {
    setEditingPurchase(null);
    setFormOpen(true);
  }

  async function openEditModal(id: string): Promise<void> {
    setActionError(null);
    try {
      const purchase = await window.blueLedger.purchase.get(id);
      setEditingPurchase(purchase);
      setFormOpen(true);
      setViewingPurchase(null);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load purchase"));
    }
  }

  function handleSupplierCreated(supplier: Supplier): void {
    setSuppliers((prev) => [...prev, supplier]);
  }

  function handleProductCreated(product: Product): void {
    setProducts((prev) => [...prev, { ...product, categoryName: null, categoryColor: null, totalStock: 0 }]);
  }

  const outstandingCents = summary?.outstandingSupplierPaymentsCents ?? 0;

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile icon={ShoppingBag} label="Total Purchases" value={String(summary.totalPurchases)} tone="primary" />
          <StatTile icon={FileClock} label="Draft" value={String(summary.draftCount)} tone="warning" />
          <StatTile icon={Boxes} label="Ordered" value={String(summary.orderedCount)} tone="accent" />
          <StatTile icon={Package} label="Partially Received" value={String(summary.partiallyReceivedCount)} tone="accent" />
          <StatTile icon={CheckCircle2} label="Received" value={String(summary.receivedCount)} tone="success" />
          <StatTile icon={Wallet} label="Outstanding Payments" value={formatCents(outstandingCents)} tone="danger" />
        </div>
      )}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Purchases</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <ShoppingBag className="size-5 text-primary" aria-hidden="true" />
              Purchase Orders
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Order stock from suppliers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            {canCreate && (
              <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Purchase
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
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search PO #, supplier, invoice #"
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>
          </label>

          <SelectField
            label="Status"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={[{ value: "all", label: "All Statuses" }, ...PURCHASE_STATUS_OPTIONS]}
          />
          <SelectField label="Year" value={yearFilter} onChange={setYearFilter} options={yearFilterOptions(availableYears)} />
          <SelectField
            label="Payment Status"
            value={paymentStatusFilter}
            onChange={(value) => setPaymentStatusFilter(value as PaymentStatusFilter)}
            options={[{ value: "all", label: "All Payment Statuses" }, ...PURCHASE_PAYMENT_STATUS_OPTIONS]}
          />
          <SelectField
            label="Supplier"
            value={supplierFilter}
            onChange={setSupplierFilter}
            options={[
              { value: "", label: "All Suppliers" },
              ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.businessName }))
            ]}
          />
          {showStorefrontFilter && (
            <SelectField
              label="Storefront"
              value={locationFilter}
              onChange={setLocationFilter}
              options={[
                { value: "", label: "All Locations" },
                ...locations.map((location) => ({ value: location.id, label: location.locationName }))
              ]}
            />
          )}
          <label className="block">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">From Date</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">To Date</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </label>
        </div>

        <div className="mt-5">
          {purchases === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : purchases.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <ShoppingBag className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No purchases yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Create your first purchase order to start recording inventory from suppliers.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Purchase
                </Button>
              )}
            </div>
          ) : filteredPurchases && filteredPurchases.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No purchases match your filters</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">Try a different filter combination.</p>
              <Button type="button" onClick={clearFilters} className="mt-5 h-9 text-xs">
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[10%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>PO #</Th>
                    <Th>Supplier</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Total Amount</Th>
                    <Th>Payment Status</Th>
                    <Th>Ordered</Th>
                    <Th>Received</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredPurchases ?? []).map((purchase) => (
                    <tr
                      key={purchase.id}
                      onClick={() => void openView(purchase.id)}
                      className="cursor-pointer border-t border-line odd:bg-white even:bg-soft/50 hover:bg-soft"
                    >
                      <td className="truncate px-3 py-2.5 text-xs font-bold tabular-nums text-ink">
                        {purchase.purchaseNumber}
                      </td>
                      <td className="truncate px-3 py-2.5 font-extrabold">
                        <div className="flex flex-col gap-0.5">
                          <span>
                            {purchase.supplierName}
                          </span>
                          <span className="text-xs font-semibold text-primary/80">
                            {purchase.locationName}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <DashedPill tone={statusTone(purchase.status)}>{statusLabel(purchase.status)}</DashedPill>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-ink">
                        {formatCents(purchase.grandTotalCents)}
                      </td>
                      <td className="px-3 py-2.5">
                        <DashedPill tone={paymentStatusTone(purchase.paymentStatus)}>
                          {purchase.paymentStatus === "partially_paid" ? "Partially Paid" : purchase.paymentStatus}
                        </DashedPill>
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {formatDate(purchase.orderedAt)}
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {formatDate(purchase.receivedAt)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openView(purchase.id);
                            }}
                            aria-label="View purchase"
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                          >
                            <Eye className="size-3.5" aria-hidden="true" />
                          </button>
                          {canEdit && purchase.status === "draft" && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void openEditModal(purchase.id);
                              }}
                              aria-label="Edit purchase"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
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

      <PurchaseFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editingPurchase={editingPurchase}
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

      {viewingPurchase && (
        <PurchaseDetailModal
          purchase={viewingPurchase}
          paymentMethods={paymentMethods}
          canEdit={canEdit}
          onClose={closeView}
          onEdit={() => void openEditModal(viewingPurchase.id)}
          onChanged={refreshViewing}
        />
      )}
    </motion.div>
  );
}
