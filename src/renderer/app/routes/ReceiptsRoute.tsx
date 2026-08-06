import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Ban, Eye, Layers, Loader2, Package, PackagePlus, ReceiptText, Search, Undo2, Wallet } from "lucide-react";
import { AttachDeliveryModal } from "@renderer/shared/components/AttachDeliveryModal";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { DeliveryNotePreview } from "@renderer/shared/components/DeliveryNotePreview";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { ReceiptPreview } from "@renderer/shared/components/ReceiptPreview";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import {
  ALL_YEARS_VALUE,
  buildAvailableYears,
  currentYear,
  matchesYearFilter,
  yearFilterOptions
} from "@renderer/shared/lib/year-filter";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { formatDocumentDateTime } from "@shared/lib/date";
import type { ExportListRequest } from "@shared/types/export";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { Sale, SaleDelivery, SaleListItem } from "@shared/types/sale";
import type { SaleReturn } from "@shared/types/sale-return";
import type { SaleVoid } from "@shared/types/sale-void";

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

function formatDate(value: string | null): string {
  return value ? formatDocumentDateTime(value) : "—";
}

function statusLabel(status: SaleStatusEntry | undefined): string {
  if (!status) return "Completed";
  const labels: string[] = [];
  if (status.approvedVoid) labels.push("Voided");
  if (status.approvedReturn) labels.push("Returned");
  if (status.pendingVoid || status.pendingReturn) labels.push("Pending Approval");
  if (!status.approvedVoid && !status.approvedReturn && !status.pendingVoid && !status.pendingReturn) {
    labels.push("Completed");
  }
  if (status.rejectedVoid) labels.push("Void Rejected");
  if (status.rejectedReturn) labels.push("Return Rejected");
  return labels.join(", ");
}

type SaleStatusEntry = {
  approvedVoid: boolean;
  pendingVoid: boolean;
  rejectedVoid: boolean;
  approvedReturn: boolean;
  pendingReturn: boolean;
  rejectedReturn: boolean;
};

type DeliveryFilter = "all" | "with_delivery" | "pending_delivery";

const DELIVERY_FILTER_TABS: Array<{ value: DeliveryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "with_delivery", label: "With Delivery" },
  { value: "pending_delivery", label: "Pending Delivery" }
];

type ReturnsFilter = "all" | "pending" | "approved" | "rejected";

const RETURNS_FILTER_TABS: Array<{ value: ReturnsFilter; label: string }> = [
  { value: "all", label: "All Returns" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" }
];

export function ReceiptsRoute(): React.JSX.Element {
  const tenantContext = useAppStore((state) => state.context?.tenant ?? null);
  const { can, session } = usePermissions();
  const showStorefrontFilter = session?.branch == null;
  const canRequest = can("sales", "edit");
  const canExport = can("sales", "export");

  const [sales, setSales] = useState<SaleListItem[] | null>(null);
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [voids, setVoids] = useState<SaleVoid[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const [returnsFilter, setReturnsFilter] = useState<ReturnsFilter>("all");
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear()));
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationFilter, setLocationFilter] = useState("");

  const [viewingSale, setViewingSale] = useState<Sale | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [viewingDelivery, setViewingDelivery] = useState<{
    delivery: SaleDelivery;
    sourceNumber: string | null;
    locationId: string;
    saleId: string;
  } | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [attachingDeliverySale, setAttachingDeliverySale] = useState<SaleListItem | null>(null);

  const [returnModalSale, setReturnModalSale] = useState<Sale | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState("");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const [voidModalSale, setVoidModalSale] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidNotes, setVoidNotes] = useState("");
  const [voidSaving, setVoidSaving] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [saleList, returnList, voidList] = await Promise.all([
        window.blueLedger.sale.list(),
        window.blueLedger.saleReturn.list(),
        window.blueLedger.saleVoid.list()
      ]);
      setSales(saleList);
      setReturns(returnList);
      setVoids(voidList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load receipts"));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!showStorefrontFilter) return;
    window.blueLedger.location
      .list()
      .then((list) => setLocations(list.filter((location) => isStorefrontType(location.locationType))))
      .catch(() => undefined);
  }, [showStorefrontFilter]);

  const saleStatusInfo = useMemo(() => {
    const map = new Map<
      string,
      {
        approvedVoid: boolean;
        pendingVoid: boolean;
        rejectedVoid: boolean;
        approvedReturn: boolean;
        pendingReturn: boolean;
        rejectedReturn: boolean;
      }
    >();
    const emptyEntry = () => ({
      approvedVoid: false,
      pendingVoid: false,
      rejectedVoid: false,
      approvedReturn: false,
      pendingReturn: false,
      rejectedReturn: false
    });
    for (const voidRequest of voids) {
      const entry = map.get(voidRequest.saleId) ?? emptyEntry();
      if (voidRequest.status === "approved") entry.approvedVoid = true;
      if (voidRequest.status === "pending_approval") entry.pendingVoid = true;
      if (voidRequest.status === "rejected") entry.rejectedVoid = true;
      map.set(voidRequest.saleId, entry);
    }
    for (const returnRequest of returns) {
      const entry = map.get(returnRequest.saleId) ?? emptyEntry();
      if (returnRequest.status === "approved") entry.approvedReturn = true;
      if (returnRequest.status === "pending_approval") entry.pendingReturn = true;
      if (returnRequest.status === "rejected") entry.rejectedReturn = true;
      map.set(returnRequest.saleId, entry);
    }
    return map;
  }, [voids, returns]);

  const deliveryCounts = useMemo(() => {
    const withDelivery = sales?.filter((sale) => sale.hasDeliveryNote).length ?? 0;
    const pendingDelivery = sales?.filter((sale) => sale.deliveryIsDelivered === false).length ?? 0;
    return { withDelivery, pendingDelivery };
  }, [sales]);

  const returnsCounts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const status of saleStatusInfo.values()) {
      if (status.pendingVoid || status.pendingReturn) pending++;
      if (status.approvedVoid || status.approvedReturn) approved++;
      if (status.rejectedVoid || status.rejectedReturn) rejected++;
    }
    return { pending, approved, rejected };
  }, [saleStatusInfo]);

  const availableYears = useMemo(() => buildAvailableYears((sales ?? []).map((sale) => sale.completedAt)), [sales]);

  const filteredSales = useMemo(() => {
    if (!sales) return null;
    const term = searchTerm.trim().toLowerCase();
    return sales.filter((sale) => {
      if (term) {
        const haystack = `${sale.receiptNumber ?? ""} ${sale.customerName ?? ""} ${sale.employeeName}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (!matchesYearFilter(sale.completedAt, yearFilter)) return false;
      if (locationFilter && sale.locationId !== locationFilter) return false;
      if (sale.completedAt) {
        const saleDate = sale.completedAt.slice(0, 10);
        if (dateFrom && saleDate < dateFrom) return false;
        if (dateTo && saleDate > dateTo) return false;
      }
      if (deliveryFilter === "with_delivery" && !sale.hasDeliveryNote) return false;
      if (deliveryFilter === "pending_delivery" && sale.deliveryIsDelivered !== false) return false;
      if (returnsFilter !== "all") {
        const status = saleStatusInfo.get(sale.id);
        if (returnsFilter === "pending" && !(status?.pendingVoid || status?.pendingReturn)) return false;
        if (returnsFilter === "approved" && !(status?.approvedVoid || status?.approvedReturn)) return false;
        if (returnsFilter === "rejected" && !(status?.rejectedVoid || status?.rejectedReturn)) return false;
      }
      return true;
    });
  }, [sales, searchTerm, yearFilter, locationFilter, dateFrom, dateTo, deliveryFilter, returnsFilter, saleStatusInfo]);

  const summary = useMemo(() => {
    if (!filteredSales) return null;
    const totalRevenueCents = filteredSales.reduce((sum, sale) => sum + sale.grandTotalCents, 0);
    const totalItems = filteredSales.reduce((sum, sale) => sum + sale.itemCount, 0);
    return {
      count: filteredSales.length,
      totalRevenueCents,
      totalItems,
      averageCents: filteredSales.length > 0 ? Math.round(totalRevenueCents / filteredSales.length) : 0
    };
  }, [filteredSales]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredSales) return null;
    const filterParts: string[] = [];
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);
    if (yearFilter !== ALL_YEARS_VALUE) filterParts.push(`Year: ${yearFilter}`);
    if (locationFilter) {
      filterParts.push(`Storefront: ${locations.find((l) => l.id === locationFilter)?.locationName ?? locationFilter}`);
    }
    if (dateFrom || dateTo) filterParts.push(`Date: ${dateFrom || "…"} to ${dateTo || "…"}`);
    if (deliveryFilter !== "all") {
      filterParts.push(`Delivery: ${DELIVERY_FILTER_TABS.find((tab) => tab.value === deliveryFilter)?.label}`);
    }
    if (returnsFilter !== "all") {
      filterParts.push(`Returns: ${RETURNS_FILTER_TABS.find((tab) => tab.value === returnsFilter)?.label}`);
    }

    return {
      module: "sales",
      title: "Receipts",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "All receipts",
      columns: [
        { key: "receipt", header: "Receipt" },
        { key: "date", header: "Date" },
        { key: "customer", header: "Customer" },
        { key: "cashier", header: "Cashier" },
        { key: "items", header: "Items", align: "right" },
        { key: "total", header: "Total", align: "right" },
        { key: "status", header: "Status" },
        { key: "delivery", header: "Delivery" }
      ],
      rows: filteredSales.map((sale) => ({
        receipt: sale.receiptNumber ?? "—",
        date: formatDate(sale.completedAt),
        customer: sale.customerName ?? "Walk-in",
        cashier: sale.employeeName,
        items: String(sale.itemCount),
        total: formatCents(sale.grandTotalCents),
        status: statusLabel(saleStatusInfo.get(sale.id)),
        delivery: sale.hasDeliveryNote ? (sale.deliveryIsDelivered ? "Delivered" : "Pending Delivery") : "—"
      })),
      stats: summary
        ? [
            { label: "Total Receipts", value: String(summary.count) },
            { label: "Total Revenue", value: formatCents(summary.totalRevenueCents) },
            { label: "Items Sold", value: String(summary.totalItems) },
            { label: "Average Sale", value: formatCents(summary.averageCents) }
          ]
        : [],
      fileBaseName: `Receipts_${new Date().toISOString().slice(0, 10)}`
    };
  }, [filteredSales, summary, searchTerm, yearFilter, locationFilter, locations, dateFrom, dateTo, deliveryFilter, returnsFilter, saleStatusInfo]);

  async function openReceipt(saleId: string): Promise<void> {
    setViewLoading(true);
    setActionError(null);
    try {
      const sale = await window.blueLedger.sale.get(saleId);
      setViewingSale(sale);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load receipt"));
    } finally {
      setViewLoading(false);
    }
  }

  async function openDeliveryNote(sale: SaleListItem): Promise<void> {
    setDeliveryLoading(true);
    setActionError(null);
    try {
      const delivery = await window.blueLedger.deliveryNote.getForSale(sale.id);
      if (delivery) setViewingDelivery({ delivery, sourceNumber: sale.receiptNumber, locationId: sale.locationId, saleId: sale.id });
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load delivery note"));
    } finally {
      setDeliveryLoading(false);
    }
  }

  function openReturnModal(sale: Sale): void {
    setReturnModalSale(sale);
    setReturnQuantities({});
    setReturnReason("");
    setReturnNotes("");
    setReturnError(null);
  }

  function openVoidModal(sale: Sale): void {
    setVoidModalSale(sale);
    setVoidReason("");
    setVoidNotes("");
    setVoidError(null);
  }

  function remainingReturnableQuantity(saleItemId: string, originalQuantity: number): number {
    let approvedReturned = 0;
    for (const returnRequest of returns) {
      if (returnRequest.status !== "approved") continue;
      for (const item of returnRequest.items) {
        if (item.saleItemId === saleItemId) approvedReturned += item.quantity;
      }
    }
    return originalQuantity - approvedReturned;
  }

  async function handleSubmitReturn(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!returnModalSale) return;
    setReturnSaving(true);
    setReturnError(null);

    const items = Object.entries(returnQuantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));

    if (items.length === 0) {
      setReturnError("Select at least one item to return");
      setReturnSaving(false);
      return;
    }

    try {
      await window.blueLedger.saleReturn.request({
        saleId: returnModalSale.id,
        reason: returnReason,
        notes: returnNotes,
        items
      });
      setReturnModalSale(null);
      await loadAll();
      showSuccessToast("Return request submitted");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to submit return request");
      setReturnError(message);
      showErrorToast(message);
    } finally {
      setReturnSaving(false);
    }
  }

  async function handleSubmitVoid(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!voidModalSale) return;
    setVoidSaving(true);
    setVoidError(null);

    try {
      await window.blueLedger.saleVoid.request({
        saleId: voidModalSale.id,
        reason: voidReason,
        notes: voidNotes
      });
      setVoidModalSale(null);
      await loadAll();
      showSuccessToast("Void request submitted");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to submit void request");
      setVoidError(message);
      showErrorToast(message);
    } finally {
      setVoidSaving(false);
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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Receipts</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <ReceiptText className="size-5 text-primary" aria-hidden="true" />
              Transaction History
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Every completed sale, latest first — reprint, download, or process a return or void.
            </p>
          </div>
          {canExport && exportRequest && <ExportMenu request={exportRequest} />}
        </div>

        {(loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? actionError}
          </div>
        )}

        {sales !== null && sales.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile icon={ReceiptText} label="Total Receipts" value={String(summary?.count ?? 0)} tone="primary" />
              <StatTile icon={Wallet} label="Total Revenue" value={formatCents(summary?.totalRevenueCents ?? 0)} tone="success" />
              <StatTile icon={Layers} label="Items Sold" value={String(summary?.totalItems ?? 0)} tone="accent" />
              <StatTile icon={ReceiptText} label="Average Sale" value={formatCents(summary?.averageCents ?? 0)} tone="warning" />
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
                    placeholder="Search by receipt number, customer, or cashier"
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
              {showStorefrontFilter && (
                <SelectField
                  label="Storefront"
                  value={locationFilter}
                  onChange={setLocationFilter}
                  options={[
                    { value: "", label: "All Storefronts" },
                    ...locations.map((location) => ({ value: location.id, label: location.locationName }))
                  ]}
                  className="w-44"
                />
              )}
              <label className="block">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="mt-1.5 h-10 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="mt-1.5 h-10 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </label>
              {(dateFrom || dateTo) && (
                <Button
                  type="button"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="h-10 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                >
                  Clear dates
                </Button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-soft px-1 py-0.5">
                {DELIVERY_FILTER_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setDeliveryFilter(tab.value)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[11px] font-extrabold transition cursor-pointer",
                      deliveryFilter === tab.value ? "bg-primary text-white" : "text-muted hover:bg-white"
                    )}
                  >
                    {tab.label}
                    {tab.value === "with_delivery" && ` (${deliveryCounts.withDelivery})`}
                    {tab.value === "pending_delivery" && ` (${deliveryCounts.pendingDelivery})`}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-soft px-1 py-0.5">
                {RETURNS_FILTER_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setReturnsFilter(tab.value)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[11px] font-extrabold transition cursor-pointer",
                      returnsFilter === tab.value ? "bg-primary text-white" : "text-muted hover:bg-white"
                    )}
                  >
                    {tab.label}
                    {tab.value === "pending" && ` (${returnsCounts.pending})`}
                    {tab.value === "approved" && ` (${returnsCounts.approved})`}
                    {tab.value === "rejected" && ` (${returnsCounts.rejected})`}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <Button type="button" onClick={() => void loadAll()} className="h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : sales === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : sales.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <ReceiptText className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No completed sales yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Receipts will show up here once a sale is completed at checkout.
              </p>
            </div>
          ) : filteredSales && filteredSales.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <Search className="size-7 text-muted" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-extrabold">No receipts match your filters</h3>
              <Button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setDateFrom("");
                  setDateTo("");
                  setDeliveryFilter("all");
                  setReturnsFilter("all");
                }}
                className="mt-5 h-9 text-xs"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full  table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[12%]" />
                  <col className="w-[13%]" />
                  <col className="w-[4%]" />
                  <col className="w-[7%]" />
                  <col className="w-[5%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Receipt</Th>
                    <Th>Cashier</Th>
                    <Th>Items</Th>
                    <Th>Total</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredSales ?? []).map((sale) => {
                    const status = saleStatusInfo.get(sale.id);
                    return (
                      <tr key={sale.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                        <td className="truncate px-4 py-3 text-xs font-bold tabular-nums text-muted">
                          <div>
                          <span>{sale.receiptNumber ?? "—"}</span>
                          <span className="block text-[10px] font-normal text-muted">
                            {formatDate(sale.completedAt)}
                          </span>
                          <span className="text-ink font-bold">{sale.customerName ?? "Walk-in"}</span>
                          </div>
                        </td>
                        <td className="truncate px-4 py-3 text-xs font-semibold text-muted">
                          <div className="flex flex-col gap-0.5">
                            <span>{sale.employeeName}</span>
                            <span className="text-xs font-bold text-warning">{sale.locationName}</span>
                          </div>
                          </td>
                        <td className="px-4 py-3 text-xs font-bold tabular-nums text-muted">{sale.itemCount}</td>
                        <td className="px-4 py-3 text-xs font-bold tabular-nums text-ink">
                          {formatCents(sale.grandTotalCents)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {status?.approvedVoid && <DashedPill tone="danger">Voided</DashedPill>}
                            {status?.approvedReturn && <DashedPill tone="warning">Returned</DashedPill>}
                            {(status?.pendingVoid || status?.pendingReturn) && (
                              <DashedPill tone="accent">Pending Approval</DashedPill>
                            )}
                            {!status?.approvedVoid &&
                              !status?.approvedReturn &&
                              !status?.pendingVoid &&
                              !status?.pendingReturn && <DashedPill tone="neutral">Completed</DashedPill>}
                            {status?.rejectedVoid && <DashedPill tone="neutral">Void Rejected</DashedPill>}
                            {status?.rejectedReturn && <DashedPill tone="neutral">Return Rejected</DashedPill>}
                            {sale.hasDeliveryNote && (
                              <DashedPill tone={sale.deliveryIsDelivered ? "success" : "warning"}>
                                {sale.deliveryIsDelivered ? "Delivered" : "Pending"}
                              </DashedPill>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void openReceipt(sale.id)}
                              aria-label={`View receipt ${sale.receiptNumber ?? ""}`}
                              title="View Receipt"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Eye className="size-3.5" aria-hidden="true" />
                            </button>
                            {sale.hasDeliveryNote && (
                              <button
                                type="button"
                                onClick={() => void openDeliveryNote(sale)}
                                aria-label={`View delivery note for ${sale.receiptNumber ?? ""}`}
                                title="View Delivery Note"
                                className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-primary cursor-pointer"
                              >
                                <Package className="size-3.5" aria-hidden="true" />
                              </button>
                            )}
                            {!sale.hasDeliveryNote && canRequest && (
                              <button
                                type="button"
                                onClick={() => setAttachingDeliverySale(sale)}
                                aria-label={`Attach delivery for ${sale.receiptNumber ?? ""}`}
                                title="Attach Delivery"
                                className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-primary cursor-pointer"
                              >
                                <PackagePlus className="size-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <Modal
        open={viewingSale !== null || viewLoading}
        onClose={() => setViewingSale(null)}
        title={viewingSale?.receiptNumber ?? "Receipt"}
        description="Reprint, download, or process a return / void for this sale."
        widthClassName="max-w-lg"
      >
        {viewLoading ? (
          <div className="flex min-h-[200px] items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : viewingSale ? (
          <div>
            {tenantContext && <ReceiptPreview sale={viewingSale} tenant={tenantContext} />}

            {viewingSale.items.some((item) => item.isLocallySourced) && (
              <div className="mt-4 rounded-lg border border-line bg-soft px-3.5 py-3">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">
                  Sourced From Another Shop
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-muted">
                  Internal record only — never shown on the printed/shared receipt.
                </p>
                <div className="mt-2 space-y-1.5">
                  {viewingSale.items
                    .filter((item) => item.isLocallySourced)
                    .map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-bold text-ink">{item.productName}</p>
                          <p className="truncate text-muted">{item.localSupplierName ?? "No supplier recorded"}</p>
                        </div>
                        <span className="flex-none font-bold tabular-nums text-ink">
                          Cost {item.localCostCents !== null ? formatCents(item.localCostCents) : "—"}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {canRequest && (
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
                <Button
                  type="button"
                  onClick={() => {
                    const sale = viewingSale;
                    setViewingSale(null);
                    openReturnModal(sale);
                  }}
                  disabled={Boolean(saleStatusInfo.get(viewingSale.id)?.approvedVoid)}
                  className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Undo2 className="mr-1.5 size-3.5" aria-hidden="true" />
                  Request Return
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const sale = viewingSale;
                    setViewingSale(null);
                    openVoidModal(sale);
                  }}
                  disabled={
                    Boolean(saleStatusInfo.get(viewingSale.id)?.approvedVoid) ||
                    Boolean(saleStatusInfo.get(viewingSale.id)?.pendingVoid)
                  }
                  className="h-9 border border-danger/30 bg-white text-xs text-danger shadow-none hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Ban className="mr-1.5 size-3.5" aria-hidden="true" />
                  Void Sale
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={viewingDelivery !== null || deliveryLoading}
        onClose={() => setViewingDelivery(null)}
        title={viewingDelivery?.delivery.deliveryNoteNumber ?? "Delivery Note"}
        description="Print, download, share, or mark this delivery as delivered."
        widthClassName="max-w-lg"
      >
        {deliveryLoading ? (
          <div className="flex min-h-[160px] items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : viewingDelivery && tenantContext ? (
          <DeliveryNotePreview
            delivery={viewingDelivery.delivery}
            tenant={tenantContext}
            locationId={viewingDelivery.locationId}
            sourceDocumentLabel="Receipt"
            sourceDocumentNumber={viewingDelivery.sourceNumber}
            parentEntity="sale"
            parentEntityId={viewingDelivery.saleId}
            onDeliveredChange={(next) => setViewingDelivery((prev) => (prev ? { ...prev, delivery: next } : prev))}
          />
        ) : null}
      </Modal>

      {attachingDeliverySale && (
        <AttachDeliveryModal
          saleId={attachingDeliverySale.id}
          customerName={attachingDeliverySale.customerName}
          onClose={() => setAttachingDeliverySale(null)}
          onAttached={() => {
            setAttachingDeliverySale(null);
            showSuccessToast("Delivery attached");
            void loadAll();
          }}
        />
      )}

      <Modal
        open={returnModalSale !== null}
        onClose={() => setReturnModalSale(null)}
        title="Request Return"
        description="Select the items and quantities being returned. A manager must approve before stock is restocked."
        widthClassName="max-w-lg"
      >
        {returnModalSale && (
          <form onSubmit={handleSubmitReturn}>
            {returnError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                {returnError}
              </div>
            )}

            <div className="space-y-2">
              {returnModalSale.items.map((item) => {
                const remaining = remainingReturnableQuantity(item.id, item.quantity);
                return (
                  <div key={item.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-ink">{item.productName}</p>
                        <p className="text-[11px] font-semibold text-muted">
                          Sold {item.quantity} · {remaining} eligible for return
                        </p>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        disabled={remaining <= 0}
                        value={returnQuantities[item.id] ?? 0}
                        onChange={(event) =>
                          setReturnQuantities((prev) => ({
                            ...prev,
                            [item.id]: Math.max(0, Math.min(remaining, Number(event.target.value)))
                          }))
                        }
                        className="h-9 w-20 rounded-lg border border-line px-2 text-center text-sm font-bold outline-none focus:border-accent disabled:cursor-not-allowed disabled:bg-soft"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <Field
              label="Reason"
              value={returnReason}
              onChange={setReturnReason}
              placeholder="e.g. Customer changed their mind"
              required
              className="mt-4"
            />
            <TextAreaField
              label="Notes"
              value={returnNotes}
              onChange={setReturnNotes}
              placeholder="Optional additional detail"
              className="mt-4"
              rows={2}
            />

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
              <Button
                type="button"
                onClick={() => setReturnModalSale(null)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={returnSaving}
                className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {returnSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                {returnSaving ? "Submitting..." : "Submit Return Request"}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={voidModalSale !== null}
        onClose={() => setVoidModalSale(null)}
        title="Void Sale"
        description="This invalidates the entire sale and restocks every item. A manager must approve it first."
        widthClassName="max-w-md"
      >
        {voidModalSale && (
          <form onSubmit={handleSubmitVoid}>
            {voidError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                {voidError}
              </div>
            )}

            <div className="rounded-lg border border-line bg-soft px-3.5 py-2.5">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Voiding</p>
              <p className="mt-0.5 text-sm font-bold text-ink">
                {voidModalSale.receiptNumber} · {formatCents(voidModalSale.grandTotalCents)}
              </p>
            </div>

            <Field
              label="Reason"
              value={voidReason}
              onChange={setVoidReason}
              placeholder="e.g. Rang up the wrong sale"
              required
              className="mt-4"
            />
            <TextAreaField
              label="Notes"
              value={voidNotes}
              onChange={setVoidNotes}
              placeholder="Optional additional detail"
              className="mt-4"
              rows={2}
            />

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
              <Button
                type="button"
                onClick={() => setVoidModalSale(null)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={voidSaving}
                className="h-9 border border-danger bg-danger text-xs text-white shadow-none hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {voidSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                {voidSaving ? "Submitting..." : "Submit Void Request"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </motion.div>
  );
}
