import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Boxes,
  CheckCircle2,
  ClipboardPen,
  Eye,
  FileBarChart,
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
import { ShipmentProgressBar } from "@renderer/shared/components/ShipmentProgressBar";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { computeShipmentStage } from "@shared/lib/purchase";
import { showErrorToast } from "@renderer/shared/lib/toast";
import {
  ALL_YEARS_VALUE,
  buildAvailableYears,
  currentYear,
  matchesYearFilter,
  yearFilterOptions
} from "@renderer/shared/lib/year-filter";
import { formatDocumentDate } from "@shared/lib/date";
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
import type { PurchaseRequisitionListItem } from "@shared/types/purchase-requisition";
import { SUPPLIER_TYPE_OPTIONS, supplierTypeLabel, type Supplier, type SupplierPickerOption, type SupplierType } from "@shared/types/supplier";
import { PurchaseDetailModal } from "./purchases/PurchaseDetailModal";
import { PurchaseFormModal } from "./purchases/PurchaseFormModal";
import { SupplierStatementModal } from "./purchases/SupplierStatementModal";
import { useRequisitionWorkflow } from "./purchases/useRequisitionWorkflow";

/** "requisitions" = still waiting for approval; "requisitions_closed" = rejected or cancelled. */
type StatusFilter = "all" | PurchaseStatus | "requisitions" | "requisitions_closed";

/** One row of the merged list — a purchase, or a requisition that hasn't become one. */
type Row =
  | { kind: "purchase"; at: string; purchase: PurchaseListItem }
  | { kind: "requisition"; at: string; requisition: PurchaseRequisitionListItem };

/** Where a requisition sits in the one-document lifecycle. Once approved it IS its purchase, so it
 * takes that purchase's stage (what a requisition-only viewer, who never sees the purchase row, sees). */
function requisitionStage(requisition: PurchaseRequisitionListItem): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral" | "accent";
} {
  if (requisition.status === "pending") return { label: "Requisition", tone: "warning" };
  if (requisition.status === "rejected") return { label: "Rejected", tone: "danger" };
  if (requisition.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  if (requisition.purchaseStatus) {
    return { label: statusLabel(requisition.purchaseStatus), tone: statusTone(requisition.purchaseStatus) };
  }
  return { label: "Approved", tone: "success" };
}
type PaymentStatusFilter = "all" | PurchasePaymentStatus;
type ShipmentFilter = "all" | "overdue";

function isShipmentOverdue(purchase: PurchaseListItem): boolean {
  return (
    computeShipmentStage({
      shipmentDepartedAt: purchase.shipmentDepartedAt,
      shipmentEta: purchase.shipmentEta,
      isFullyReceived: purchase.status === "received"
    }).stage === "overdue"
  );
}

function filterLabel(filter: StatusFilter): string {
  if (filter === "requisitions") return "Requisitions";
  if (filter === "requisitions_closed") return "Rejected / Cancelled requisitions";
  return filter === "all" ? "All" : statusLabel(filter);
}

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
    return formatDocumentDate(value);
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

/** A purchase in the merged list. A purchase approved from a requisition carries "from REQ-…", so it
 * reads as the same document having moved on a stage. */
function PurchaseRow({
  purchase,
  canEdit,
  localOnly,
  onOpen,
  onEdit
}: {
  purchase: PurchaseListItem;
  canEdit: boolean;
  /** A local-credit role sees no payment figures, and every row is local anyway. */
  localOnly: boolean;
  onOpen: () => void;
  onEdit: () => void;
}): React.JSX.Element {
  return (
    <tr onClick={onOpen} className="cursor-pointer border-t border-line odd:bg-white even:bg-soft/50 hover:bg-soft">
      <td className="truncate px-3 py-2.5 text-xs font-bold tabular-nums text-ink">
        <div className="flex flex-col gap-0.5">
          <span>{purchase.purchaseNumber}</span>
          {purchase.requisitionNumber && (
            <span className="text-[10px] font-semibold text-muted">from {purchase.requisitionNumber}</span>
          )}
        </div>
      </td>
      <td className="truncate px-3 py-2.5 font-extrabold">
        <div className="flex flex-col gap-0.5">
          <span>{purchase.supplierName}</span>
          <span className="text-xs font-semibold text-primary/80">{purchase.locationName}</span>
          {!localOnly && (
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-muted">{supplierTypeLabel(purchase.supplierType)}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <DashedPill tone={statusTone(purchase.status)}>{statusLabel(purchase.status)}</DashedPill>
      </td>
      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-ink">{formatCents(purchase.grandTotalCents)}</td>
      <td className="px-3 py-2.5">
        {localOnly ? (
          <span className="text-xs font-semibold text-muted">—</span>
        ) : (
          <DashedPill tone={paymentStatusTone(purchase.paymentStatus)}>
            {purchase.paymentStatus === "partially_paid" ? "Partially Paid" : purchase.paymentStatus}
          </DashedPill>
        )}
      </td>
      <td className="px-3 py-2.5">
        {purchase.shipmentDepartedAt ? (
          <ShipmentProgressBar
            shipmentDepartedAt={purchase.shipmentDepartedAt}
            shipmentEta={purchase.shipmentEta}
            isFullyReceived={purchase.status === "received"}
            compact
          />
        ) : (
          <span className="text-xs font-semibold text-muted">—</span>
        )}
      </td>
      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">{formatDate(purchase.orderedAt)}</td>
      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">{formatDate(purchase.receivedAt)}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            aria-label="View purchase"
            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
          >
            <Eye className="size-3.5" aria-hidden="true" />
          </button>
          {canEdit && (purchase.status === "draft" || (purchase.status === "ordered" && purchase.amountPaidCents === 0)) && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
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
  );
}

export function PurchasesRoute(): React.JSX.Element {
  const { can, session } = usePermissions();
  const showStorefrontFilter = session?.branch == null;
  // Client request: one Purchases tab for the whole Requisition → Received document. Someone who can
  // only requisition (e.g. a Cashier) gets the same tab with everything purchase-side hidden — no
  // suppliers, costs, totals or statements; their requisitions show the stage they've reached.
  const canViewPurchases = can("purchases", "view") || can("local_credit_purchases", "view");
  // Goods on credit from local suppliers only — see purchase-service.ts requirePurchaseAccess.
  const localOnly = !can("purchases", "view") && can("local_credit_purchases", "view");
  const canCreate = can("purchases", "create") || can("local_credit_purchases", "create");
  const canEdit = can("purchases", "edit");
  const canReceiveGoods = can("purchases", "edit") || can("local_credit_purchases", "edit");
  const canExport = can("purchases", "export");

  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [purchases, setPurchases] = useState<PurchaseListItem[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierPickerOption[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [statementOpen, setStatementOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<PaymentStatusFilter>("all");
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear()));

  const [formOpen, setFormOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);

  const [viewingPurchase, setViewingPurchase] = useState<Purchase | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    if (!canViewPurchases) {
      setPurchases([]);
      return;
    }
    try {
      if (localOnly) {
        const [purchaseList, supplierOptions, productList, locationList] = await Promise.all([
          window.blueLedger.purchase.list(),
          window.blueLedger.supplier.listPickerOptions(),
          window.blueLedger.product.list(),
          window.blueLedger.location.list()
        ]);
        setPurchases(purchaseList);
        setSuppliers(supplierOptions);
        setProducts(productList);
        setLocations(locationList);
        return;
      }
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
      const message = getErrorMessage(err, "Failed to load purchases");
      setLoadError(message);
      showErrorToast(message);
    }
  }, [canViewPurchases, localOnly]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const requisitionFlow = useRequisitionWorkflow({ onConverted: () => void loadAll() });
  const requisitions = requisitionFlow.requisitions;

  useEffect(() => {
    if (!actionError) return undefined;
    const timer = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const availableYears = useMemo(
    () =>
      buildAvailableYears([
        ...(purchases ?? []).map((purchase) => purchase.createdAt),
        ...(requisitions ?? []).map((requisition) => requisition.requestedAt)
      ]),
    [purchases, requisitions]
  );

  const filteredPurchases = useMemo(() => {
    if (!purchases) return null;
    let list = purchases;

    if (statusFilter === "requisitions" || statusFilter === "requisitions_closed") {
      list = [];
    } else if (statusFilter !== "all") {
      list = list.filter((purchase) => purchase.status === statusFilter);
    } else {
      // Client request: a cancelled purchase has no hard-delete mechanism (see this app's own
      // "record, never destroy" convention), so it stays in the database forever — but it shouldn't
      // keep cluttering the everyday "All Statuses" view once it's been cancelled. Only picking the
      // "Cancelled" status filter explicitly still shows it (the branch above, untouched).
      list = list.filter((purchase) => purchase.status !== "cancelled");
    }
    if (supplierFilter) {
      list = list.filter((purchase) => purchase.supplierId === supplierFilter);
    }
    if (typeFilter) {
      list = list.filter((purchase) => purchase.supplierType === typeFilter);
    }
    if (locationFilter) {
      list = list.filter((purchase) => purchase.locationId === locationFilter);
    }
    if (paymentStatusFilter !== "all") {
      list = list.filter((purchase) => purchase.paymentStatus === paymentStatusFilter);
    }
    if (shipmentFilter === "overdue") {
      list = list.filter((purchase) => isShipmentOverdue(purchase));
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
          `${purchase.purchaseNumber} ${purchase.supplierName} ${purchase.supplierInvoiceNumber ?? ""} ${purchase.locationName} ${purchase.requisitionNumber ?? ""}`.toLowerCase();
        return haystack.includes(term);
      });
    }

    return list;
  }, [
    purchases,
    statusFilter,
    supplierFilter,
    typeFilter,
    locationFilter,
    paymentStatusFilter,
    shipmentFilter,
    dateFrom,
    dateTo,
    yearFilter,
    searchTerm
  ]);

  const filteredRequisitions = useMemo(() => {
    if (!requisitions) return [];
    // Supplier / payment / shipment only describe purchases — a requisition has none of them yet.
    if (supplierFilter || typeFilter || paymentStatusFilter !== "all" || shipmentFilter !== "all") return [];
    const shownPurchaseIds = new Set((purchases ?? []).map((purchase) => purchase.id));
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTime = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    const term = searchTerm.trim().toLowerCase();

    return requisitions.filter((requisition) => {
      // An approved requisition IS its purchase from here on — the purchase row stands in for it
      // (unless that purchase isn't on this device yet, or this viewer can't see purchases).
      if (requisition.status === "approved" && requisition.purchaseId && shownPurchaseIds.has(requisition.purchaseId)) {
        return false;
      }
      if (statusFilter === "requisitions") {
        if (requisition.status !== "pending") return false;
      } else if (statusFilter === "requisitions_closed") {
        if (requisition.status !== "rejected" && requisition.status !== "cancelled") return false;
      } else if (statusFilter === "all") {
        // Same as cancelled purchases: withdrawn requisitions drop out of the everyday view.
        if (requisition.status === "cancelled") return false;
      } else if (requisition.purchaseStatus !== statusFilter) {
        return false;
      }
      if (locationFilter && requisition.storefrontId !== locationFilter) return false;
      const at = new Date(requisition.requestedAt).getTime();
      if (fromTime !== null && at < fromTime) return false;
      if (toTime !== null && at > toTime) return false;
      if (!matchesYearFilter(requisition.requestedAt, yearFilter)) return false;
      if (!term) return true;
      return `${requisition.requisitionNumber} ${requisition.requestedByName} ${requisition.storefrontName} ${requisition.purchaseNumber ?? ""}`
        .toLowerCase()
        .includes(term);
    });
  }, [
    requisitions,
    purchases,
    statusFilter,
    supplierFilter,
    typeFilter,
    locationFilter,
    paymentStatusFilter,
    shipmentFilter,
    dateFrom,
    dateTo,
    yearFilter,
    searchTerm
  ]);

  const rows = useMemo<Row[]>(() => {
    const merged: Row[] = [
      ...(filteredPurchases ?? []).map((purchase) => ({ kind: "purchase" as const, at: purchase.createdAt, purchase })),
      ...filteredRequisitions.map((requisition) => ({ kind: "requisition" as const, at: requisition.requestedAt, requisition }))
    ];
    return merged.sort((a, b) => b.at.localeCompare(a.at));
  }, [filteredPurchases, filteredRequisitions]);

  const pendingRequisitionCount = (requisitions ?? []).filter((requisition) => requisition.status === "pending").length;
  const isLoading = (canViewPurchases && purchases === null) || requisitions === null;
  const hasAnything = (purchases?.length ?? 0) > 0 || (requisitions?.length ?? 0) > 0;

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredPurchases) return null;
    const filterParts: string[] = [];
    if (statusFilter !== "all") filterParts.push(`Status: ${filterLabel(statusFilter)}`);
    if (paymentStatusFilter !== "all") filterParts.push(`Payment Status: ${paymentStatusFilter}`);
    if (supplierFilter) {
      filterParts.push(`Supplier: ${suppliers.find((s) => s.id === supplierFilter)?.businessName ?? supplierFilter}`);
    }
    if (typeFilter) filterParts.push(`Type: ${supplierTypeLabel(typeFilter as SupplierType)}`);
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
    typeFilter,
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
    setShipmentFilter("all");
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
      const message = getErrorMessage(err, "Failed to load purchase");
      setActionError(message);
      showErrorToast(message);
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
      const message = getErrorMessage(err, "Failed to load purchase");
      setActionError(message);
      showErrorToast(message);
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

      {canViewPurchases && summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatTile icon={ClipboardPen} label="Requisitions" value={String(pendingRequisitionCount)} tone="warning" />
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
              {canViewPurchases ? "Purchases" : "Requisitions"}
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              {canViewPurchases
                ? "From requisition to received stock — approve a requisition to turn it into a purchase."
                : "Ask for stock to be bought for your storefront. Follow it here until it's received."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canViewPurchases && canExport && exportRequest && <ExportMenu request={exportRequest} />}
            {canViewPurchases && !localOnly && (
              <Button
                type="button"
                onClick={() => setStatementOpen(true)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                <FileBarChart className="mr-1.5 size-4" aria-hidden="true" />
                Statement
              </Button>
            )}
            {requisitionFlow.canCreate && (
              <Button
                type="button"
                onClick={requisitionFlow.openCreate}
                className={cn(
                  "h-9 text-xs",
                  canCreate && "border border-line bg-white text-ink shadow-none hover:bg-soft"
                )}
              >
                <ClipboardPen className="mr-1.5 size-4" aria-hidden="true" />
                New Requisition
              </Button>
            )}
            {canCreate && (
              <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Purchase
              </Button>
            )}
          </div>
        </div>

        {(loadError ?? requisitionFlow.loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? requisitionFlow.loadError ?? actionError}
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
                placeholder={canViewPurchases ? "Search PO #, REQ #, supplier, invoice #" : "Search REQ #, requester"}
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>
          </label>

          <SelectField
            label="Stage"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={[
              { value: "all", label: "All Stages" },
              { value: "requisitions", label: "Requisitions (awaiting approval)" },
              ...PURCHASE_STATUS_OPTIONS.filter((option) => (canViewPurchases && !localOnly) || option.value !== "draft"),
              { value: "requisitions_closed", label: "Rejected / Cancelled requisitions" }
            ]}
          />
          <SelectField label="Year" value={yearFilter} onChange={setYearFilter} options={yearFilterOptions(availableYears)} />
          {canViewPurchases && !localOnly && (
          <>
          <SelectField
            label="Supplier Type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[{ value: "", label: "All Types" }, ...SUPPLIER_TYPE_OPTIONS]}
          />
          <SelectField
            label="Payment Status"
            value={paymentStatusFilter}
            onChange={(value) => setPaymentStatusFilter(value as PaymentStatusFilter)}
            options={[{ value: "all", label: "All Payment Statuses" }, ...PURCHASE_PAYMENT_STATUS_OPTIONS]}
          />
          <SelectField
            label="Shipment"
            value={shipmentFilter}
            onChange={(value) => setShipmentFilter(value as ShipmentFilter)}
            options={[
              { value: "all", label: "All Shipments" },
              { value: "overdue", label: "Overdue Shipments" }
            ]}
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
          </>
          )}
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
          {isLoading ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : !hasAnything ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <ShoppingBag className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">Nothing here yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                {canViewPurchases
                  ? "Raise a requisition, or create a purchase order directly, to start recording stock from suppliers."
                  : "Need stock bought for your storefront? Raise a requisition and a manager will approve it."}
              </p>
              <div className="mt-5 flex gap-2">
                {requisitionFlow.canCreate && (
                  <Button type="button" onClick={requisitionFlow.openCreate} className="h-9 text-xs">
                    <ClipboardPen className="mr-1.5 size-4" aria-hidden="true" />
                    New Requisition
                  </Button>
                )}
                {canCreate && (
                  <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
                    <Plus className="mr-1.5 size-4" aria-hidden="true" />
                    New Purchase
                  </Button>
                )}
              </div>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">Nothing matches your filters</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">Try a different filter combination.</p>
              <Button type="button" onClick={clearFilters} className="mt-5 h-9 text-xs">
                Clear filters
              </Button>
            </div>
          ) : canViewPurchases ? (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[10%]" />
                  <col className="w-[17%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                  <col className="w-[8%]" />
                  <col className="w-[9%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Document #</Th>
                    <Th>Supplier</Th>
                    <Th>Stage</Th>
                    <Th className="text-right">Total Amount</Th>
                    <Th>Payment Status</Th>
                    <Th>Shipment</Th>
                    <Th>Ordered</Th>
                    <Th>Received</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) =>
                    row.kind === "requisition" ? (
                      <tr
                        key={row.requisition.id}
                        onClick={() => void requisitionFlow.openView(row.requisition.id)}
                        className="cursor-pointer border-t border-line bg-warning/5 hover:bg-soft"
                      >
                        <td className="truncate px-3 py-2.5 text-xs font-bold tabular-nums text-ink">
                          <div className="flex flex-col gap-0.5">
                            <span>{row.requisition.requisitionNumber}</span>
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-warning">Requisition</span>
                          </div>
                        </td>
                        <td className="truncate px-3 py-2.5 font-extrabold">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-semibold text-muted">Requested by {row.requisition.requestedByName}</span>
                            <span className="text-xs font-semibold text-primary/80">{row.requisition.storefrontName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <DashedPill tone={requisitionStage(row.requisition).tone}>{requisitionStage(row.requisition).label}</DashedPill>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs font-semibold text-muted">
                          {row.requisition.itemCount} item{row.requisition.itemCount === 1 ? "" : "s"}
                        </td>
                        <td className="px-3 py-2.5 text-xs font-semibold text-muted">—</td>
                        <td className="px-3 py-2.5 text-xs font-semibold text-muted">—</td>
                        <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">{formatDate(row.requisition.requestedAt)}</td>
                        <td className="px-3 py-2.5 text-xs font-semibold text-muted">—</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void requisitionFlow.openView(row.requisition.id);
                              }}
                              aria-label="View requisition"
                              title={requisitionFlow.canApprove && row.requisition.status === "pending" ? "Review" : "View"}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Eye className="size-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <PurchaseRow
                        key={row.purchase.id}
                        purchase={row.purchase}
                        canEdit={canEdit}
                        localOnly={localOnly}
                        onOpen={() => void openView(row.purchase.id)}
                        onEdit={() => void openEditModal(row.purchase.id)}
                      />
                    )
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Requisition #</Th>
                    <Th>Requested By</Th>
                    <Th>Items</Th>
                    <Th>Stage</Th>
                    <Th>Requested</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) =>
                    row.kind === "requisition" ? (
                      <tr
                        key={row.requisition.id}
                        onClick={() => void requisitionFlow.openView(row.requisition.id)}
                        className="cursor-pointer border-t border-line odd:bg-white even:bg-soft/50 hover:bg-soft"
                      >
                        <td className="px-3 py-2.5 text-xs font-bold tabular-nums text-ink">{row.requisition.requisitionNumber}</td>
                        <td className="px-3 py-2.5 font-extrabold">
                          <div className="flex flex-col gap-0.5">
                            <span>{row.requisition.requestedByName}</span>
                            <span className="text-xs font-semibold text-primary/80">{row.requisition.storefrontName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs font-bold tabular-nums text-muted">
                          {row.requisition.itemCount} item{row.requisition.itemCount === 1 ? "" : "s"} ·{" "}
                          {row.requisition.totalQuantityRequested} unit{row.requisition.totalQuantityRequested === 1 ? "" : "s"}
                        </td>
                        <td className="px-3 py-2.5">
                          <DashedPill tone={requisitionStage(row.requisition).tone}>{requisitionStage(row.requisition).label}</DashedPill>
                        </td>
                        <td className="px-3 py-2.5 text-xs font-semibold text-muted">{formatDate(row.requisition.requestedAt)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void requisitionFlow.openView(row.requisition.id);
                              }}
                              aria-label="View requisition"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Eye className="size-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : null
                  )}
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
        locations={localOnly && session?.branch ? locations.filter((location) => location.id === session.branch?.id) : locations}
        localOnly={localOnly}
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
          canReceiveGoods={canReceiveGoods}
          localOnly={localOnly}
          onClose={closeView}
          onEdit={() => void openEditModal(viewingPurchase.id)}
          onChanged={refreshViewing}
        />
      )}

      {requisitionFlow.elements}

      <SupplierStatementModal
        open={canViewPurchases && statementOpen}
        onClose={() => setStatementOpen(false)}
        suppliers={suppliers}
        paymentMethods={paymentMethods}
        onPaid={() => void loadAll()}
      />
    </motion.div>
  );
}
