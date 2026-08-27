import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Ban,
  CheckCircle2,
  Copy,
  Eye,
  FileBarChart,
  FileText,
  Loader2,
  Package,
  PackagePlus,
  Plus,
  Printer,
  Receipt,
  Search,
  Share2,
  Wallet,
  X
} from "lucide-react";
import { AttachDeliveryModal } from "@renderer/shared/components/AttachDeliveryModal";
import { Button } from "@renderer/shared/components/Button";
import { useConfirm } from "@renderer/shared/components/ConfirmModal";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { DeliveryNotePreview } from "@renderer/shared/components/DeliveryNotePreview";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import {
  ExtraChargesSection,
  type DeliveryDraft,
  type ServiceChargeDraft
} from "@renderer/shared/components/ExtraChargesSection";
import { CheckboxField, Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { QuickCreateCustomerModal } from "@renderer/shared/components/QuickCreateCustomerModal";
import { QuickCreateProductModal } from "@renderer/shared/components/QuickCreateProductModal";
import { ShareModal } from "@renderer/shared/components/ShareModal";
import { StatementPreview } from "@renderer/shared/components/StatementPreview";
import { StatTile } from "@renderer/shared/components/StatTile";
import { StockByLocationRow } from "@renderer/shared/components/StockByLocationRow";
import { StorefrontPicker } from "@renderer/shared/components/StorefrontPicker";
import { SupplierPicker } from "@renderer/shared/components/SupplierPicker";
import { TaxBreakdownTable } from "@renderer/shared/components/TaxBreakdownTable";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { useProductStockOverview } from "@renderer/shared/hooks/use-product-stock-overview";
import { computeLinePricing, isPriceBelowMinimum } from "@renderer/shared/lib/cart-pricing";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, fromCents, toCents, totalCentsToUnitCostText, unitCostToTotalCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { computeAddedTaxCents, computeTaxBreakdown, taxModeBadgeLabel } from "@shared/lib/tax-calculation";
import {
  ALL_YEARS_VALUE,
  buildAvailableYears,
  currentYear,
  matchesYearFilter,
  yearFilterOptions
} from "@renderer/shared/lib/year-filter";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { formatDocumentDate, formatDocumentDateTime } from "@shared/lib/date";
import type { Customer } from "@shared/types/customer";
import type { Supplier } from "@shared/types/supplier";
import type { ExportListRequest } from "@shared/types/export";
import type { InvoiceListItem, InvoiceSummary } from "@shared/types/invoice";
import type { InvoiceCancellation } from "@shared/types/invoice-cancellation";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { PaymentMethod } from "@shared/types/payment-method";
import type { ProductListItem } from "@shared/types/product";
import {
  PAYMENT_STATUS_OPTIONS,
  TRANSACTION_TYPE_OPTIONS,
  type PaymentStatus,
  type Sale,
  type SaleDelivery,
  type TransactionType
} from "@shared/types/sale";
import type { CustomerStatementViewModel } from "@shared/types/statement";

type FilterTab = "all" | "outstanding" | "partially_paid" | "overdue" | "paid" | "cancelled" | "recent";

const FILTER_TABS: Array<{ value: FilterTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "outstanding", label: "Outstanding" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

type SortKey = "invoiceNumber" | "customerName" | "invoiceDate" | "dueDate" | "grandTotalCents" | "balanceDueCents";

type CartLine = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  /** Raw decimal text, not cents — same reasoning as priceOverride below (see money.ts's own
   * fromCents/toCents split doc comment). Converted to cents only at the point of use
   * (computeLinePricing calls, the submit payload), never stored as cents in this component's state. */
  discount: string;
  /** Cashier-entered price override for this line only (e.g. product is 450, cashier charges 600)
   * — never written back to the product's own selling price. Empty string means "use the normal/
   * wholesale price". Raw text on purpose (see money.ts's own fromCents/toCents split). */
  priceOverride: string;
  /** Same locally-sourced fields as CheckoutRoute's own CartLine — an invoice is a sale like any
   * other, and a customer wanting something this shop doesn't stock is just as likely to want it
   * billed on credit as paid for on the spot. */
  isLocallySourced: boolean;
  localCost: string;
  localSupplierId: string | null;
};

function statusTone(status: PaymentStatus): "success" | "warning" | "danger" | "neutral" | "accent" {
  if (status === "paid") return "success";
  if (status === "overdue") return "danger";
  if (status === "partially_paid") return "warning";
  if (status === "cancelled") return "neutral";
  return "accent";
}

function statusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function transactionTypeLabel(type: TransactionType): string {
  return TRANSACTION_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function formatDate(value: string | null): string {
  return value ? formatDocumentDate(value) : "—";
}

function formatDateTime(value: string | null): string {
  return value ? formatDocumentDateTime(value) : "—";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function Th({
  children,
  className,
  onClick,
  active,
  direction
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  direction?: "asc" | "desc";
}): React.JSX.Element {
  return (
    <th
      onClick={onClick}
      className={cn(
        "px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider",
        onClick && "cursor-pointer select-none hover:text-white/80",
        className
      )}
    >
      {children}
      {active && <span className="ml-1">{direction === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

export function InvoicesRoute(): React.JSX.Element {
  const currency = useAppStore((state) => state.context?.tenant.currency ?? "");
  const tenantContext = useAppStore((state) => state.context?.tenant ?? null);
  const { can, session } = usePermissions();
  const showStorefrontFilter = session?.branch == null;
  const canCreate = can("sales", "create");
  const canEdit = can("sales", "edit");
  const canExport = can("sales", "export");
  // Cancelling outright (no approval step) is gated the same as approving one — whoever can approve
  // someone else's cancellation request can just as well skip the request step themselves. Matches
  // Manager/Super Admin's default role grants; Cashier/Storekeeper have no "approvals" access at all,
  // so they only ever see the canEdit-gated Request Cancel button below.
  const canApproveDirectly = can("approvals", "approve");
  const confirm = useConfirm();

  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [invoiceCancellations, setInvoiceCancellations] = useState<InvoiceCancellation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear()));
  const [filterLocations, setFilterLocations] = useState<Location[]>([]);
  const [locationFilter, setLocationFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("invoiceDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [viewingSale, setViewingSale] = useState<Sale | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [cancelRequestSale, setCancelRequestSale] = useState<Sale | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelNotes, setCancelNotes] = useState("");
  const [cancelRequestSaving, setCancelRequestSaving] = useState(false);
  const [cancelRequestError, setCancelRequestError] = useState<string | null>(null);
  const [printingThermal, setPrintingThermal] = useState(false);
  const [sharing, setSharing] = useState(false);

  const [viewingDelivery, setViewingDelivery] = useState<{
    delivery: SaleDelivery;
    sourceNumber: string | null;
    locationId: string;
    saleId: string;
  } | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [attachingDeliveryInvoice, setAttachingDeliveryInvoice] = useState<InvoiceListItem | null>(null);

  const [statementPickerOpen, setStatementPickerOpen] = useState(false);
  const [statementSearch, setStatementSearch] = useState("");
  const [statementVm, setStatementVm] = useState<CustomerStatementViewModel | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidMethodId, setMarkPaidMethodId] = useState("");
  const [markPaidReference, setMarkPaidReference] = useState("");
  const [markPaidSaving, setMarkPaidSaving] = useState(false);
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  // Non-null while the create modal is actually editing an existing invoice in place, rather than
  // creating a new one — reuses the same modal/state/submit-button rather than a second near-
  // identical form (the two only differ in a few gated sections, see the JSX below).
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [createCustomerId, setCreateCustomerId] = useState<string | null>(null);
  // Only ever consulted when session.branch is null (see StorefrontPicker/requireActiveSession).
  const [createStorefrontId, setCreateStorefrontId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [quickCreateCustomerOpen, setQuickCreateCustomerOpen] = useState(false);
  const [quickCreateProductOpen, setQuickCreateProductOpen] = useState(false);
  const [createTransactionType, setCreateTransactionType] = useState<"invoice" | "wholesale_sale">("invoice");
  const [createDueDate, setCreateDueDate] = useState(todayIsoDate());
  const [createNotes, setCreateNotes] = useState("");
  const [createIncludeTaxBreakdown, setCreateIncludeTaxBreakdown] = useState(true);
  const [createIncludeBusinessInfo, setCreateIncludeBusinessInfo] = useState(true);
  // Kept in sync by the effect below — openCreateModal() reads this synchronously when a brand-new
  // invoice form opens, same reasoning/pattern as CheckoutRoute's own identical ref.
  const defaultIncludeBusinessInfoRef = useRef(true);
  const [createItems, setCreateItems] = useState<CartLine[]>([]);
  const [createServiceCharges, setCreateServiceCharges] = useState<ServiceChargeDraft[]>([]);
  const [createDelivery, setCreateDelivery] = useState<DeliveryDraft | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [includeInitialPayment, setIncludeInitialPayment] = useState(false);
  const [initialPaymentMethodId, setInitialPaymentMethodId] = useState("");
  const [initialPaymentAmount, setInitialPaymentAmount] = useState("");
  const [initialPaymentReference, setInitialPaymentReference] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [summaryResult, invoiceList, customerList, productList, methodList, supplierList, cancellationList] =
        await Promise.all([
          window.blueLedger.invoice.summary(),
          window.blueLedger.invoice.list(),
          window.blueLedger.customer.list(),
          window.blueLedger.product.list(),
          window.blueLedger.paymentMethod.list(),
          window.blueLedger.supplier.list(),
          window.blueLedger.invoiceCancellation.list()
        ]);
      setSuppliers(supplierList);
      setSummary(summaryResult);
      setInvoices(invoiceList);
      setCustomers(customerList);
      setProducts(productList);
      setPaymentMethods(methodList);
      setInvoiceCancellations(cancellationList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load invoices"));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!showStorefrontFilter) return;
    window.blueLedger.location
      .list()
      .then((list) => setFilterLocations(list.filter((location) => isStorefrontType(location.locationType))))
      .catch(() => undefined);
  }, [showStorefrontFilter]);

  const activePaymentMethods = useMemo(
    () => paymentMethods.filter((method) => method.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [paymentMethods]
  );

  // An approved cancellation is already reflected by the invoice's own paymentStatus turning
  // "cancelled" (see invoice-cancellation-service.ts), so this only needs to surface the two states
  // that AREN'T visible anywhere else: a request still awaiting a decision, and one that was turned
  // down (same "Pending Approval"/"X Rejected" pattern ReceiptsRoute already uses for void/return).
  const cancellationStatusBySaleId = useMemo(() => {
    const map = new Map<string, { pending: boolean; rejected: boolean }>();
    for (const cancellation of invoiceCancellations) {
      const entry = map.get(cancellation.saleId) ?? { pending: false, rejected: false };
      if (cancellation.status === "pending_approval") entry.pending = true;
      if (cancellation.status === "rejected") entry.rejected = true;
      map.set(cancellation.saleId, entry);
    }
    return map;
  }, [invoiceCancellations]);
  const selectedRecordMethod = activePaymentMethods.find((method) => method.id === paymentMethodId) ?? null;
  const selectedMarkPaidMethod = activePaymentMethods.find((method) => method.id === markPaidMethodId) ?? null;
  const selectedInitialMethod = activePaymentMethods.find((method) => method.id === initialPaymentMethodId) ?? null;

  const availableYears = useMemo(
    () => buildAvailableYears((invoices ?? []).map((invoice) => invoice.invoiceDate)),
    [invoices]
  );

  const filteredInvoices = useMemo(() => {
    if (!invoices) return null;
    let list = invoices;

    if (activeTab === "outstanding") {
      list = list.filter((invoice) => ["unpaid", "partially_paid", "overdue"].includes(invoice.paymentStatus));
    } else if (activeTab === "partially_paid") {
      list = list.filter((invoice) => invoice.paymentStatus === "partially_paid");
    } else if (activeTab === "overdue") {
      list = list.filter((invoice) => invoice.paymentStatus === "overdue");
    } else if (activeTab === "paid") {
      list = list.filter((invoice) => invoice.paymentStatus === "paid");
    } else if (activeTab === "cancelled") {
      list = list.filter((invoice) => invoice.paymentStatus === "cancelled");
    } else if (activeTab === "recent") {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      list = list.filter((invoice) => new Date(invoice.createdAt).getTime() >= sevenDaysAgo);
    }

    list = list.filter((invoice) => matchesYearFilter(invoice.invoiceDate, yearFilter));

    if (locationFilter) {
      list = list.filter((invoice) => invoice.locationId === locationFilter);
    }

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((invoice) => {
        const haystack = `${invoice.invoiceNumber ?? ""} ${invoice.customerName ?? ""} ${invoice.receiptNumber ?? ""}`.toLowerCase();
        return haystack.includes(term);
      });
    }

    const sorted = [...list].sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * direction;
      }
      return String(aValue).localeCompare(String(bValue)) * direction;
    });

    return sorted;
  }, [invoices, activeTab, searchTerm, yearFilter, locationFilter, sortKey, sortDir]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredInvoices) return null;
    const filterParts: string[] = [];
    if (activeTab !== "all") filterParts.push(`Filter: ${FILTER_TABS.find((tab) => tab.value === activeTab)?.label}`);
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);
    if (yearFilter !== ALL_YEARS_VALUE) filterParts.push(`Year: ${yearFilter}`);
    if (locationFilter) {
      filterParts.push(`Storefront: ${filterLocations.find((l) => l.id === locationFilter)?.locationName ?? locationFilter}`);
    }

    return {
      module: "sales",
      title: "Invoices",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "All invoices",
      columns: [
        { key: "invoiceNumber", header: "Invoice #" },
        { key: "customer", header: "Customer" },
        { key: "type", header: "Type" },
        { key: "issued", header: "Issued" },
        { key: "due", header: "Due" },
        { key: "amount", header: "Amount", align: "right" },
        { key: "paid", header: "Paid", align: "right" },
        { key: "balance", header: "Balance", align: "right" },
        { key: "status", header: "Status" }
      ],
      rows: filteredInvoices.map((invoice) => ({
        invoiceNumber: invoice.invoiceNumber ?? "—",
        customer: invoice.customerName ?? "Walk-in",
        type: transactionTypeLabel(invoice.transactionType),
        issued: formatDate(invoice.invoiceDate),
        due: formatDate(invoice.dueDate),
        amount: `${currency} ${formatCents(invoice.grandTotalCents)}`,
        paid: `${currency} ${formatCents(invoice.amountPaidCents)}`,
        balance: `${currency} ${formatCents(invoice.balanceDueCents)}`,
        status: statusLabel(invoice.paymentStatus)
      })),
      stats: summary
        ? [
          { label: "Total Outstanding", value: `${currency} ${formatCents(summary.totalOutstandingCents)}` },
          { label: "Total Overdue", value: `${currency} ${formatCents(summary.totalOverdueCents)}` },
          { label: "Total Paid", value: `${currency} ${formatCents(summary.totalPaidCents)}` },
          { label: "Total Invoices", value: String(summary.totalInvoices) },
          { label: "Total Invoice Value", value: `${currency} ${formatCents(summary.totalInvoiceValueCents)}` }
        ]
        : [],
      fileBaseName: `Invoices_${new Date().toISOString().slice(0, 10)}`
    };
  }, [filteredInvoices, summary, activeTab, searchTerm, yearFilter, locationFilter, filterLocations, currency]);

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function openView(saleId: string): Promise<void> {
    setViewLoading(true);
    setActionError(null);
    try {
      const sale = await window.blueLedger.sale.get(saleId);
      setViewingSale(sale);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load invoice"));
    } finally {
      setViewLoading(false);
    }
  }

  function closeView(): void {
    setViewingSale(null);
  }

  async function openDeliveryNote(invoice: InvoiceListItem): Promise<void> {
    setDeliveryLoading(true);
    setActionError(null);
    try {
      const delivery = await window.blueLedger.deliveryNote.getForSale(invoice.id);
      if (delivery) setViewingDelivery({ delivery, sourceNumber: invoice.invoiceNumber, locationId: invoice.locationId, saleId: invoice.id });
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load delivery note"));
    } finally {
      setDeliveryLoading(false);
    }
  }

  async function refreshViewing(saleId: string): Promise<void> {
    const sale = await window.blueLedger.sale.get(saleId);
    setViewingSale(sale);
  }

  async function openStatement(customerId: string): Promise<void> {
    setStatementPickerOpen(false);
    setStatementLoading(true);
    setActionError(null);
    try {
      const vm = await window.blueLedger.statement.getForCustomer(customerId);
      setStatementVm(vm);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to generate statement"));
    } finally {
      setStatementLoading(false);
    }
  }

  function openRecordPayment(): void {
    setPaymentMethodId("");
    setPaymentAmount(viewingSale ? fromCents(viewingSale.balanceDueCents) : "");
    setPaymentReference("");
    setPaymentNotes("");
    setPaymentError(null);
    setRecordPaymentOpen(true);
  }

  async function submitRecordPayment(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!viewingSale) return;
    setPaymentSaving(true);
    setPaymentError(null);
    try {
      await window.blueLedger.invoice.recordPayment(viewingSale.id, {
        paymentMethodId,
        amountCents: toCents(paymentAmount),
        reference: paymentReference,
        notes: paymentNotes
      });
      setRecordPaymentOpen(false);
      await refreshViewing(viewingSale.id);
      await loadAll();
      showSuccessToast("Payment recorded");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to record payment");
      setPaymentError(message);
      showErrorToast(message);
    } finally {
      setPaymentSaving(false);
    }
  }

  function openMarkPaid(): void {
    setMarkPaidMethodId("");
    setMarkPaidReference("");
    setMarkPaidError(null);
    setMarkPaidOpen(true);
  }

  async function submitMarkPaid(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!viewingSale) return;
    setMarkPaidSaving(true);
    setMarkPaidError(null);
    try {
      await window.blueLedger.invoice.markPaid(viewingSale.id, {
        paymentMethodId: markPaidMethodId,
        reference: markPaidReference,
        notes: null
      });
      setMarkPaidOpen(false);
      await refreshViewing(viewingSale.id);
      await loadAll();
      showSuccessToast("Invoice marked as paid");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to mark invoice as paid");
      setMarkPaidError(message);
      showErrorToast(message);
    } finally {
      setMarkPaidSaving(false);
    }
  }

  async function handleCancelInvoice(): Promise<void> {
    if (!viewingSale) return;
    const confirmed = await confirm({
      title: "Cancel this invoice?",
      message: `Cancel invoice ${viewingSale.invoiceNumber}? This restocks every item and, if anything was paid, records a refund. This can't be undone.`,
      tone: "danger",
      confirmLabel: "Cancel Invoice"
    });
    if (!confirmed) return;
    setActionError(null);
    try {
      await window.blueLedger.invoice.cancel(viewingSale.id, {});
      await refreshViewing(viewingSale.id);
      await loadAll();
      showSuccessToast("Invoice cancelled — stock restored and any payment reversed");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to cancel invoice");
      setActionError(message);
      showErrorToast(message);
    }
  }

  function openCancelRequestModal(): void {
    if (!viewingSale) return;
    setCancelRequestSale(viewingSale);
    setCancelReason("");
    setCancelNotes("");
    setCancelRequestError(null);
  }

  async function handleSubmitCancelRequest(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!cancelRequestSale) return;
    setCancelRequestSaving(true);
    setCancelRequestError(null);
    try {
      await window.blueLedger.invoiceCancellation.request({
        saleId: cancelRequestSale.id,
        reason: cancelReason,
        notes: cancelNotes
      });
      setCancelRequestSale(null);
      await refreshViewing(cancelRequestSale.id);
      await loadAll();
      showSuccessToast("Cancellation request submitted");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to submit cancellation request");
      setCancelRequestError(message);
      showErrorToast(message);
    } finally {
      setCancelRequestSaving(false);
    }
  }

  async function handleDuplicateInvoice(): Promise<void> {
    if (!viewingSale) return;
    setActionError(null);
    try {
      const duplicate = await window.blueLedger.invoice.duplicate(viewingSale.id);
      await loadAll();
      setViewingSale(duplicate);
      showSuccessToast(`Invoice duplicated — ${duplicate.invoiceNumber ?? ""}`);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to duplicate invoice");
      setActionError(message);
      showErrorToast(message);
    }
  }

  async function handlePrint(): Promise<void> {
    if (!viewingSale) return;
    setActionError(null);
    try {
      const result = await window.blueLedger.printer.printInvoiceDocument(viewingSale.id);
      if (!result.success) setActionError(result.message);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to print invoice"));
    }
  }

  async function handlePreview(): Promise<void> {
    if (!viewingSale) return;
    setActionError(null);
    try {
      await window.blueLedger.printer.previewInvoicePdf(viewingSale.id);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to open preview"));
    }
  }

  async function handleToggleTaxBreakdown(next: boolean): Promise<void> {
    if (!viewingSale) return;
    try {
      const updated = await window.blueLedger.sale.setIncludeTaxBreakdown(viewingSale.id, next);
      setViewingSale(updated);
      showSuccessToast(next ? "Tax breakdown will now show on this invoice" : "Tax breakdown hidden on this invoice");
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to update the tax breakdown setting"));
    }
  }

  async function handleToggleBusinessInfo(next: boolean): Promise<void> {
    if (!viewingSale) return;
    try {
      const updated = await window.blueLedger.sale.setIncludeBusinessInfo(viewingSale.id, next);
      setViewingSale(updated);
      showSuccessToast(next ? "Storefront information will now show on this invoice" : "Storefront information hidden on this invoice");
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to update the storefront information setting"));
    }
  }

  async function handlePrintThermal(): Promise<void> {
    if (!viewingSale) return;
    setPrintingThermal(true);
    setActionError(null);
    try {
      const result = await window.blueLedger.printer.printInvoiceThermal(viewingSale.id);
      if (!result.success) setActionError(result.message);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to print invoice"));
    } finally {
      setPrintingThermal(false);
    }
  }

  const filteredCustomers = useMemo(() => {
    const active = customers.filter((customer) => customer.status === "active");
    const term = customerSearch.trim().toLowerCase();
    if (!term) return active.slice(0, 20);
    return active
      .filter((customer) => `${customer.name} ${customer.phone}`.toLowerCase().includes(term))
      .slice(0, 20);
  }, [customers, customerSearch]);

  const filteredStatementCustomers = useMemo(() => {
    const active = customers.filter((customer) => customer.status === "active");
    const term = statementSearch.trim().toLowerCase();
    if (!term) return active.slice(0, 20);
    return active
      .filter((customer) => `${customer.name} ${customer.phone}`.toLowerCase().includes(term))
      .slice(0, 20);
  }, [customers, statementSearch]);

  const selectedCreateCustomer = customers.find((customer) => customer.id === createCustomerId) ?? null;

  const filteredCreateProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((product) => product.status === "active")
      .filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [products, productSearch]);

  const productById = useMemo(() => {
    const map = new Map<string, ProductListItem>();
    for (const product of products) map.set(product.id, product);
    return map;
  }, [products]);

  const createLinePricing = useMemo(
    () =>
      createItems
        .map((line) => {
          const product = productById.get(line.productId);
          if (!product) return null;
          return {
            line,
            product,
            pricing: computeLinePricing(
              product,
              line.quantity,
              toCents(line.discount),
              { vatRatePercent: tenantContext?.vatRatePercent ?? 16, pricesTaxInclusive: tenantContext?.pricesTaxInclusive ?? true },
              line.priceOverride.trim() ? toCents(line.priceOverride) : null
            )
          };
        })
        .filter((entry): entry is { line: CartLine; product: ProductListItem; pricing: ReturnType<typeof computeLinePricing> } => entry !== null),
    [createItems, productById, tenantContext]
  );

  const createLineStock = useProductStockOverview(createLinePricing.map((entry) => entry.line.productId));

  const createTotals = useMemo(() => {
    let subtotalCents = 0;
    let discountAmountCents = 0;
    let taxAmountCents = 0;
    let lineTotalCentsSum = 0;
    for (const entry of createLinePricing) {
      subtotalCents += entry.pricing.lineSubtotalCents;
      discountAmountCents += entry.pricing.discountAmountCents;
      taxAmountCents += entry.pricing.taxCents;
      lineTotalCentsSum += entry.pricing.lineTotalCents;
    }
    const serviceChargesFeeCents = createServiceCharges.reduce((sum, charge) => sum + toCents(charge.fee), 0);
    const deliveryFeeCents = createDelivery ? toCents(createDelivery.fee) : 0;
    // Sums each line's own lineTotalCents (already resolved per-product) rather than branching off
    // one global toggle — see CheckoutRoute.tsx's computeDraftTotals for the same reasoning.
    const grandTotalCents = lineTotalCentsSum + serviceChargesFeeCents + deliveryFeeCents;
    const addedTaxCents = computeAddedTaxCents(
      createLinePricing.map((entry) => ({
        unitPriceCents: entry.pricing.unitPriceCents,
        quantity: entry.line.quantity,
        discountAmountCents: entry.pricing.discountAmountCents,
        lineTotalCents: entry.pricing.lineTotalCents
      }))
    );
    return {
      subtotalCents,
      discountAmountCents,
      taxAmountCents,
      serviceChargesFeeCents,
      deliveryFeeCents,
      grandTotalCents,
      addedTaxCents
    };
  }, [createLinePricing, createServiceCharges, createDelivery]);

  const initialPaymentCents = includeInitialPayment && initialPaymentAmount.trim() !== "" ? toCents(initialPaymentAmount) : 0;

  const effectiveCreateLocationId = session?.branch ? session.branch.id : createStorefrontId || null;

  useEffect(() => {
    if (!effectiveCreateLocationId) {
      defaultIncludeBusinessInfoRef.current = true;
      return;
    }
    let cancelled = false;
    void window.blueLedger.location
      .get(effectiveCreateLocationId)
      .then((location) => {
        if (!cancelled) defaultIncludeBusinessInfoRef.current = location?.defaultIncludeBusinessInfo ?? true;
      })
      .catch(() => {
        if (!cancelled) defaultIncludeBusinessInfoRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveCreateLocationId]);

  function openCreateModal(): void {
    setEditingInvoiceId(null);
    setCreateCustomerId(null);
    setCreateStorefrontId("");
    setCustomerSearch("");
    setCreateTransactionType("invoice");
    setCreateDueDate(todayIsoDate());
    setCreateNotes("");
    setCreateIncludeTaxBreakdown(true);
    setCreateIncludeBusinessInfo(defaultIncludeBusinessInfoRef.current);
    setCreateItems([]);
    setCreateServiceCharges([]);
    setCreateDelivery(null);
    setProductSearch("");
    setIncludeInitialPayment(false);
    setInitialPaymentMethodId("");
    setInitialPaymentAmount("");
    setInitialPaymentReference("");
    setCreateError(null);
    setCreateOpen(true);
  }

  /** Prefills the same create-invoice form/state in place of a blank one — only reachable while the
   * invoice is fully unpaid (see updateInvoice's own requireEditableUnpaidInvoice). The storefront and
   * "record an initial payment" sections stay hidden in this mode (see the JSX below) — a storefront
   * is fixed at creation, and a payment can't be recorded through an edit. */
  function openEditInvoice(sale: Sale): void {
    setEditingInvoiceId(sale.id);
    setCreateCustomerId(sale.customerId);
    setCreateStorefrontId(sale.locationId);
    setCustomerSearch("");
    setCreateTransactionType(sale.transactionType === "wholesale_sale" ? "wholesale_sale" : "invoice");
    setCreateDueDate(sale.dueDate ?? todayIsoDate());
    setCreateNotes(sale.invoiceNotes ?? "");
    setCreateIncludeTaxBreakdown(sale.includeTaxBreakdown);
    setCreateIncludeBusinessInfo(sale.includeBusinessInfo);
    setCreateItems(
      sale.items.map((item) => ({
        productId: item.productId,
        name: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        discount: fromCents(item.discountAmountCents),
        // Pre-filled with the item's own current price so re-submitting without touching this line
        // keeps its price exactly as it was — same "don't silently re-price from the product's
        // CURRENT price" reasoning as duplicateInvoice's own cart-building (see invoice-service.ts).
        priceOverride: fromCents(item.unitPriceCents),
        isLocallySourced: item.isLocallySourced,
        // item.localCostCents is stored as the TOTAL for this line (see money.ts's own doc comment
        // on the pair below) — back it out to the per-unit figure this field shows.
        localCost: totalCentsToUnitCostText(item.localCostCents, item.quantity),
        localSupplierId: item.localSupplierId
      }))
    );
    setCreateServiceCharges(
      sale.serviceCharges.map((charge) => ({
        key: crypto.randomUUID(),
        name: charge.name,
        fee: fromCents(charge.feeCents),
        cost: fromCents(charge.costCents)
      }))
    );
    setCreateDelivery(
      sale.delivery
        ? {
          riderId: sale.delivery.riderId,
          recipientName: sale.delivery.recipientName,
          country: sale.delivery.country ?? "",
          town: sale.delivery.town ?? "",
          physicalAddress: sale.delivery.physicalAddress,
          notes: sale.delivery.notes ?? "",
          fee: fromCents(sale.delivery.feeCents),
          cost: fromCents(sale.delivery.costCents)
        }
        : null
    );
    setProductSearch("");
    setIncludeInitialPayment(false);
    setInitialPaymentMethodId("");
    setInitialPaymentAmount("");
    setInitialPaymentReference("");
    setCreateError(null);
    setCreateOpen(true);
  }

  function addCreateLine(product: ProductListItem): void {
    setCreateItems((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      if (existing) {
        return prev.map((line) => (line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          quantity: 1,
          discount: "0.00",
          priceOverride: "",
          isLocallySourced: false,
          localCost: "",
          localSupplierId: null
        }
      ];
    });
    setProductSearch("");
  }

  function updateCreateQuantity(productId: string, quantity: number): void {
    const next = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
    setCreateItems((prev) => prev.map((line) => (line.productId === productId ? { ...line, quantity: next } : line)));
  }

  /** Permissive counterpart used only by the free-typing quantity input's onChange — allows 0
   * mid-edit (see the input's own value prop, which renders "" for 0) so clearing "1" to type "80"
   * isn't fought by an immediate re-clamp on every keystroke. updateCreateQuantity's own clamp still
   * applies on blur. */
  function updateCreateQuantityDraft(productId: string, raw: string): void {
    const parsed = raw === "" ? 0 : Math.floor(Number(raw));
    const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    setCreateItems((prev) => prev.map((line) => (line.productId === productId ? { ...line, quantity: next } : line)));
  }

  function updateCreateDiscount(productId: string, value: string): void {
    setCreateItems((prev) => prev.map((line) => (line.productId === productId ? { ...line, discount: value } : line)));
  }

  function updateCreatePriceOverride(productId: string, value: string): void {
    setCreateItems((prev) =>
      prev.map((line) => (line.productId === productId ? { ...line, priceOverride: value } : line))
    );
  }

  function toggleCreateLocallySourced(productId: string): void {
    setCreateItems((prev) =>
      prev.map((line) =>
        line.productId === productId
          ? {
            ...line,
            isLocallySourced: !line.isLocallySourced,
            ...(line.isLocallySourced ? { localCost: "", localSupplierId: null } : {})
          }
          : line
      )
    );
  }

  function updateCreateLocalCost(productId: string, value: string): void {
    setCreateItems((prev) => prev.map((line) => (line.productId === productId ? { ...line, localCost: value } : line)));
  }

  function updateCreateLocalSupplier(productId: string, supplierId: string | null): void {
    setCreateItems((prev) =>
      prev.map((line) => (line.productId === productId ? { ...line, localSupplierId: supplierId } : line))
    );
  }

  function removeCreateLine(productId: string): void {
    setCreateItems((prev) => prev.filter((line) => line.productId !== productId));
  }

  async function submitCreateInvoice(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setCreateSaving(true);
    setCreateError(null);

    if (!createCustomerId) {
      setCreateError("Select a customer");
      setCreateSaving(false);
      return;
    }
    if (createItems.length === 0 && createServiceCharges.length === 0) {
      setCreateError("Add at least one product or service charge");
      setCreateSaving(false);
      return;
    }
    if (!editingInvoiceId && session && !session.branch && !createStorefrontId) {
      const message = "Choose a storefront for this invoice";
      setCreateError(message);
      showErrorToast(message);
      setCreateSaving(false);
      return;
    }

    const payload = {
      customerId: createCustomerId,
      transactionType: createTransactionType,
      dueDate: createDueDate,
      invoiceNotes: createNotes,
      includeTaxBreakdown: createIncludeTaxBreakdown,
      includeBusinessInfo: createIncludeBusinessInfo,
      locationId: session && !session.branch ? createStorefrontId : undefined,
      items: createItems.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discountAmountCents: toCents(line.discount),
        unitPriceCents: line.priceOverride.trim() ? toCents(line.priceOverride) : undefined,
        isLocallySourced: line.isLocallySourced,
        // line.localCost is what the user typed as the PER-UNIT cost — localCostCents itself is
        // still stored/reported as the line's total (see money.ts's own doc comment), so multiply
        // here rather than changing anything downstream.
        localCostCents:
          line.isLocallySourced && line.localCost.trim() ? unitCostToTotalCents(line.localCost, line.quantity) : undefined,
        localSupplierId: line.localSupplierId
      })),
      serviceCharges: createServiceCharges.map((charge) => ({
        name: charge.name,
        feeCents: toCents(charge.fee),
        costCents: toCents(charge.cost)
      })),
      delivery: createDelivery
        ? {
          riderId: createDelivery.riderId,
          recipientName: createDelivery.recipientName,
          country: createDelivery.country,
          town: createDelivery.town,
          physicalAddress: createDelivery.physicalAddress,
          notes: createDelivery.notes,
          feeCents: toCents(createDelivery.fee),
          costCents: toCents(createDelivery.cost)
        }
        : null,
      initialPayment:
        includeInitialPayment && initialPaymentMethodId && initialPaymentCents > 0
          ? {
            paymentMethodId: initialPaymentMethodId,
            amountCents: initialPaymentCents,
            reference: initialPaymentReference
          }
          : null
    };

    try {
      if (editingInvoiceId) {
        const updated = await window.blueLedger.invoice.update(editingInvoiceId, payload);
        setCreateOpen(false);
        await loadAll();
        if (viewingSale?.id === editingInvoiceId) setViewingSale(updated);
        showSuccessToast("Invoice updated");
      } else {
        await window.blueLedger.invoice.create(payload);
        setCreateOpen(false);
        await loadAll();
        showSuccessToast("Invoice created");
      }
    } catch (err) {
      const message = getErrorMessage(err, editingInvoiceId ? "Failed to update invoice" : "Failed to create invoice");
      setCreateError(message);
      showErrorToast(message);
    } finally {
      setCreateSaving(false);
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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Invoices</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <FileText className="size-5 text-primary" aria-hidden="true" />
              Billing &amp; Receivables
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Wholesale invoices and credit sales.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            <Button
              type="button"
              onClick={() => {
                setStatementSearch("");
                setStatementPickerOpen(true);
              }}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              <FileBarChart className="mr-1.5 size-4" aria-hidden="true" />
              Statement
            </Button>
            {canCreate && (
              <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Invoice
              </Button>
            )}
          </div>
        </div>

        {(loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? actionError}
          </div>
        )}

        {summary && (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3"> 
            <StatTile
              icon={Wallet}
              label="Total Outstanding"
              value={`${currency} ${formatCents(summary.totalOutstandingCents)}`}
              tone="primary"
            />
            <StatTile
              icon={Ban}
              label="Total Overdue"
              value={`${currency} ${formatCents(summary.totalOverdueCents)}`}
              tone="danger"
            />

            <StatTile icon={FileText} label="Total Invoices" value={String(summary.totalInvoices)} tone="accent" />
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-b border-line pb-3">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "h-8 rounded-lg px-3 text-xs font-extrabold transition cursor-pointer",
                activeTab === tab.value ? "bg-primary text-white" : "text-muted hover:bg-soft"
              )}
            >
              {tab.label}
            </button>
          ))}
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
                placeholder="Search by invoice number or customer"
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
                ...filterLocations.map((location) => ({ value: location.id, label: location.locationName }))
              ]}
              className="w-44"
            />
          )}
        </div>

        <div className="mt-5">
          {invoices === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : filteredInvoices && filteredInvoices.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <FileText className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No invoices found</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                {invoices.length === 0
                  ? "Create your first invoice to start tracking wholesale billing."
                  : "Try a different filter or search term."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[7%]" />
                  <col className="w-[9%]" />
                  <col className="w-[5%]" />
                  <col className="w-[5%]" />
                  <col className="w-[5%]" />
                  <col className="w-[5%]" />
                  <col className="w-[5%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th onClick={() => toggleSort("invoiceNumber")} active={sortKey === "invoiceNumber"} direction={sortDir}>
                      Invoice #
                    </Th>
                    <Th onClick={() => toggleSort("invoiceDate")} active={sortKey === "invoiceDate"} direction={sortDir}>
                      Issued
                    </Th>
                    <Th onClick={() => toggleSort("grandTotalCents")} active={sortKey === "grandTotalCents"} direction={sortDir} className="text-right">
                      Amount
                    </Th>
                    <Th className="text-right">Paid</Th>
                    <Th onClick={() => toggleSort("balanceDueCents")} active={sortKey === "balanceDueCents"} direction={sortDir} className="text-right">
                      Balance
                    </Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredInvoices ?? []).map((invoice) => (
                    <tr key={invoice.id} className="border-t border-line odd:bg-white even:bg-soft/50">

                      <td className="truncate px-3 py-2.5 text-xs font-bold tabular-nums text-ink">
                        <div className="flex flex-col gap-0.5">
                          <span className="truncate font-bold text-muted">
                            {invoice.invoiceNumber}
                          </span>
                          <span>
                            {invoice.customerName ?? "—"}
                          </span>
                          <span className="text-primary">
                            {invoice.locationName ?? "—"}
                          </span>
                        </div>
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        <div className="flex flex-col gap-0.5">
                          <span>ISSUE: {formatDate(invoice.invoiceDate)}</span>
                          <span className="text-warning font-bold">DUE: {formatDate(invoice.dueDate)}</span>
                        </div>
                      </td>

                      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-ink">
                        {formatCents(invoice.grandTotalCents)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-muted">
                        {formatCents(invoice.amountPaidCents)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-ink">
                        {formatCents(invoice.balanceDueCents)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <DashedPill tone={statusTone(invoice.paymentStatus)}>
                            {statusLabel(invoice.paymentStatus)}
                          </DashedPill>
                          {cancellationStatusBySaleId.get(invoice.id)?.pending && (
                            <DashedPill tone="accent">Cancellation Pending</DashedPill>
                          )}
                          {!cancellationStatusBySaleId.get(invoice.id)?.pending &&
                            cancellationStatusBySaleId.get(invoice.id)?.rejected && (
                              <DashedPill tone="neutral">Cancellation Rejected</DashedPill>
                            )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void openView(invoice.id)}
                            aria-label="View invoice"
                            title="View Invoice"
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                          >
                            <Eye className="size-3.5" aria-hidden="true" />
                          </button>
                          {invoice.hasDeliveryNote && (
                            <button
                              type="button"
                              onClick={() => void openDeliveryNote(invoice)}
                              aria-label="View delivery note"
                              title="View Delivery Note"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-primary cursor-pointer"
                            >
                              <Package className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {!invoice.hasDeliveryNote && canEdit && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAttachingDeliveryInvoice(invoice);
                              }}
                              aria-label="Attach delivery"
                              title="Attach Delivery"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-primary cursor-pointer"
                            >
                              <PackagePlus className="size-3.5" aria-hidden="true" />
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

      <Modal
        open={viewingSale !== null || viewLoading}
        onClose={closeView}
        title={viewingSale?.invoiceNumber ?? "Invoice"}
        description="Products sold, payment history, and outstanding balance."
        widthClassName="max-w-2xl"
      >
        {viewLoading ? (
          <div className="flex min-h-[220px] items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : viewingSale ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <DashedPill tone={statusTone(viewingSale.paymentStatus)}>{statusLabel(viewingSale.paymentStatus)}</DashedPill>
              <DashedPill tone="accent">{transactionTypeLabel(viewingSale.transactionType)}</DashedPill>
              {cancellationStatusBySaleId.get(viewingSale.id)?.pending && (
                <DashedPill tone="accent">Cancellation Pending</DashedPill>
              )}
              {!cancellationStatusBySaleId.get(viewingSale.id)?.pending &&
                cancellationStatusBySaleId.get(viewingSale.id)?.rejected && (
                  <DashedPill tone="neutral">Cancellation Rejected</DashedPill>
                )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Customer</p>
                <p className="mt-0.5 truncate text-sm font-bold text-ink">{viewingSale.customerName ?? "—"}</p>
              </div>
              <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Storefront</p>
                <p className="mt-0.5 truncate text-sm font-bold text-ink">{viewingSale.locationName}</p>
              </div>
              <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Issued By</p>
                <p className="mt-0.5 truncate text-sm font-bold text-ink">{viewingSale.employeeName}</p>
              </div>
              <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Invoice Date</p>
                <p className="mt-0.5 text-sm font-bold text-ink">{formatDate(viewingSale.invoiceDate)}</p>
              </div>
              <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Due Date</p>
                <p className="mt-0.5 text-sm font-bold text-ink">{formatDate(viewingSale.dueDate)}</p>
              </div>
            </div>

            <div className="mt-4">
              <CheckboxField
                label="Include tax information"
                description="Shows the Tax Breakdown section on this invoice's print, download, and share"
                checked={viewingSale.includeTaxBreakdown}
                onChange={(checked) => void handleToggleTaxBreakdown(checked)}
              />
            </div>

            <div className="mt-4">
              <CheckboxField
                label="Include storefront information"
                description="Shows the shop name, logo, address, contacts and header/footer text on this invoice. Turn off for a fully anonymous invoice."
                checked={viewingSale.includeBusinessInfo}
                onChange={(checked) => void handleToggleBusinessInfo(checked)}
              />
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Products</p>
              <div className="mt-2 space-y-1.5">
                {viewingSale.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-bold leading-snug text-ink" title={item.productName}>
                        {item.productName}
                      </p>
                      <p className="text-[11px] font-semibold text-muted">
                        {item.quantity} x {currency} {formatCents(item.unitPriceCents)}
                      </p>
                    </div>
                    <p className="mt-0.5 flex-none text-sm font-extrabold text-ink">{formatCents(item.lineTotalCents)}</p>
                  </div>
                ))}
              </div>
            </div>

            {viewingSale.items.some((item) => item.isLocallySourced) && (
              <div className="mt-4 rounded-lg border border-line bg-soft px-3.5 py-3">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">
                  Sourced From Another Shop
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-muted">
                  Internal record only — never shown on the printed/shared invoice.
                </p>
                <div className="mt-2 space-y-1.5">
                  {viewingSale.items
                    .filter((item) => item.isLocallySourced)
                    .map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <p className="line-clamp-2 font-bold leading-snug text-ink" title={item.productName}>
                            {item.productName}
                          </p>
                          <p className="truncate text-muted">{item.localSupplierName ?? "No supplier recorded"}</p>
                        </div>
                        <span className="mt-0.5 flex-none font-bold tabular-nums text-ink">
                          Unit Cost {item.localCostCents !== null ? formatCents(Math.round(item.localCostCents / item.quantity)) : "—"}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {viewingSale.serviceCharges.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Service Charges</p>
                <div className="mt-2 space-y-1.5">
                  {viewingSale.serviceCharges.map((charge) => (
                    <div
                      key={charge.id}
                      className="flex items-center justify-between rounded-lg border border-dashed border-line px-3 py-2"
                    >
                      <p className="text-sm font-bold text-ink">{charge.name}</p>
                      <p className="text-sm font-extrabold text-ink">{formatCents(charge.feeCents)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {viewingSale.delivery && (
              <div className="mt-4 rounded-lg border border-dashed border-line bg-soft/50 p-3">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Delivery</p>
                <div className="mt-2 grid grid-cols-2 gap-2.5 text-sm">
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Recipient</p>
                    <p className="font-bold text-ink">{viewingSale.delivery.recipientName}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Fee</p>
                    <p className="font-bold text-ink">{formatCents(viewingSale.delivery.feeCents)}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Address</p>
                    <p className="font-semibold text-ink">
                      {[viewingSale.delivery.physicalAddress, viewingSale.delivery.town, viewingSale.delivery.country]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                  {viewingSale.delivery.riderName && (
                    <div className="col-span-2">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Rider</p>
                      <p className="font-semibold text-ink">
                        {viewingSale.delivery.riderName}
                        {viewingSale.delivery.riderPhone ? ` · ${viewingSale.delivery.riderPhone}` : ""}
                      </p>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-[10px] font-semibold text-muted">
                  {viewingSale.delivery.isDelivered ? "Delivered" : "Not yet delivered"} — use the delivery note
                  button in the table to print, download, share, or update this.
                </p>
              </div>
            )}

            {viewingSale.invoiceNotes && (
              <div className="mt-4 rounded-lg border border-line bg-soft px-3.5 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Invoice Notes</p>
                <p className="mt-1 whitespace-pre-line text-sm font-semibold text-ink">{viewingSale.invoiceNotes}</p>
              </div>
            )}

            <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between text-muted">
                <span className="font-semibold">Subtotal</span>
                <span className="font-bold tabular-nums">{formatCents(viewingSale.subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span className="font-semibold">Discount</span>
                <span className="font-bold tabular-nums">-{formatCents(viewingSale.discountAmountCents)}</span>
              </div>
              {viewingSale.serviceCharges.length > 0 && (
                <div className="flex justify-between text-muted">
                  <span className="font-semibold">Service Charges</span>
                  <span className="font-bold tabular-nums">
                    {formatCents(viewingSale.serviceCharges.reduce((sum, charge) => sum + charge.feeCents, 0))}
                  </span>
                </div>
              )}
              {viewingSale.delivery && viewingSale.delivery.feeCents > 0 && (
                <div className="flex justify-between text-muted">
                  <span className="font-semibold">Delivery Fee</span>
                  <span className="font-bold tabular-nums">{formatCents(viewingSale.delivery.feeCents)}</span>
                </div>
              )}
              {viewingSale.includeTaxBreakdown && computeAddedTaxCents(viewingSale.items) > 0 && (
                <div className="flex justify-between text-muted">
                  <span className="font-semibold">Total Tax</span>
                  <span className="font-bold tabular-nums">{formatCents(computeAddedTaxCents(viewingSale.items))}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-extrabold text-ink">
                <span>Total</span>
                <span>{formatCents(viewingSale.grandTotalCents)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span className="font-semibold">Amount Paid</span>
                <span className="font-bold tabular-nums">{formatCents(viewingSale.amountPaidCents)}</span>
              </div>
              <div className="flex justify-between rounded-lg bg-danger-soft px-3 py-2 text-base font-extrabold text-danger">
                <span>Balance Due</span>
                <span>{formatCents(viewingSale.balanceDueCents)}</span>
              </div>
            </div>

            <TaxBreakdownTable
              breakdown={computeTaxBreakdown(viewingSale.items)}
              tenantTaxConfig={{ vatRatePercent: tenantContext?.vatRatePercent ?? 16, pricesTaxInclusive: tenantContext?.pricesTaxInclusive ?? true }}
            />

            <div className="mt-4">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Payment History</p>
              {viewingSale.payments.length === 0 ? (
                <p className="mt-2 text-xs font-semibold text-muted">No payments recorded yet.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {viewingSale.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-ink">
                          {payment.paymentMethodName}
                          {payment.reference ? ` · ${payment.reference}` : ""}
                        </p>
                        <p className="text-[11px] font-semibold text-muted">
                          {formatDateTime(payment.receivedAt)} · {payment.receivedByName}
                        </p>
                      </div>
                      <p className="flex-none text-sm font-extrabold text-success">{formatCents(payment.amountCents)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {canEdit && viewingSale.paymentStatus !== "cancelled" && viewingSale.paymentStatus !== "paid" && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button type="button" onClick={openRecordPayment} className="h-9 text-xs">
                  <Wallet className="mr-1.5 size-3.5" aria-hidden="true" />
                  Record Payment
                </Button>
                <Button
                  type="button"
                  onClick={openMarkPaid}
                  className="h-9 border border-success/40 bg-white text-xs text-success shadow-none hover:bg-success/10"
                >
                  <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" />
                  Mark as Paid
                </Button>
              </div>
            )}

            <div className="mt-2 grid grid-cols-3 gap-2">
              <Button
                type="button"
                onClick={() => void handlePrint()}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
                Print
              </Button>
              <Button
                type="button"
                onClick={() => void handlePreview()}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                <Eye className="mr-1.5 size-3.5" aria-hidden="true" />
                Preview
              </Button>
              <Button
                type="button"
                onClick={() => setSharing(true)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
                Share
              </Button>
            </div>

            <Button
              type="button"
              onClick={() => void handlePrintThermal()}
              disabled={printingThermal}
              title="For shops with only a narrow thermal receipt printer — no A4 printer needed."
              className="mt-2 h-9 w-full border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {printingThermal ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Receipt className="mr-1.5 size-3.5" aria-hidden="true" />
              )}
              Print via Receipt Printer
            </Button>

            <ShareModal
              open={sharing}
              onClose={() => setSharing(false)}
              entity="sale"
              entityId={viewingSale.id}
              documentLabel={`Invoice ${viewingSale.invoiceNumber ?? ""}`.trim()}
              customerId={viewingSale.customerId}
              hasDeliveryNote={viewingSale.delivery !== null}
            />

            {(canEdit && viewingSale.amountPaidCents === 0 && viewingSale.paymentStatus !== "cancelled") || canCreate ? (
              <div className={cn("mt-2 grid gap-2", canEdit && viewingSale.amountPaidCents === 0 && viewingSale.paymentStatus !== "cancelled" && canCreate ? "grid-cols-2" : "grid-cols-1")}>
                {canEdit && viewingSale.amountPaidCents === 0 && viewingSale.paymentStatus !== "cancelled" && (
                  <Button
                    type="button"
                    onClick={() => openEditInvoice(viewingSale)}
                    className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                  >
                    <FileText className="mr-1.5 size-3.5" aria-hidden="true" />
                    Edit Invoice
                  </Button>
                )}
                {canCreate && (
                  <Button
                    type="button"
                    onClick={() => void handleDuplicateInvoice()}
                    className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                  >
                    <Copy className="mr-1.5 size-3.5" aria-hidden="true" />
                    Duplicate Invoice
                  </Button>
                )}
              </div>
            ) : null}

            {(canApproveDirectly || canEdit) && viewingSale.paymentStatus !== "cancelled" && (
              <div className={cn("mt-2 grid gap-2", canApproveDirectly && canEdit ? "grid-cols-2" : "grid-cols-1")}>
                {canApproveDirectly && (
                  <Button
                    type="button"
                    onClick={() => void handleCancelInvoice()}
                    className="h-9 border border-danger/30 bg-white text-xs text-danger shadow-none hover:bg-danger-soft"
                  >
                    <X className="mr-1.5 size-3.5" aria-hidden="true" />
                    Cancel Invoice
                  </Button>
                )}
                {canEdit && (
                  <Button
                    type="button"
                    onClick={openCancelRequestModal}
                    disabled={Boolean(cancellationStatusBySaleId.get(viewingSale.id)?.pending)}
                    className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Ban className="mr-1.5 size-3.5" aria-hidden="true" />
                    {cancellationStatusBySaleId.get(viewingSale.id)?.pending ? "Cancellation Requested" : "Request Cancel"}
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={cancelRequestSale !== null}
        onClose={() => setCancelRequestSale(null)}
        title="Request Invoice Cancellation"
        description="A manager must approve this before anything changes — stock and money both stay exactly as they are until then."
        widthClassName="max-w-md"
      >
        {cancelRequestSale && (
          <form onSubmit={handleSubmitCancelRequest}>
            {cancelRequestError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                {cancelRequestError}
              </div>
            )}

            <div className="rounded-lg border border-line bg-soft px-3.5 py-2.5">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Cancelling</p>
              <p className="mt-0.5 text-sm font-bold text-ink">
                {cancelRequestSale.invoiceNumber} · {formatCents(cancelRequestSale.grandTotalCents)}
              </p>
            </div>

            <Field
              label="Reason"
              value={cancelReason}
              onChange={setCancelReason}
              placeholder="e.g. Customer changed their mind"
              required
              className="mt-4"
            />
            <TextAreaField
              label="Notes"
              value={cancelNotes}
              onChange={setCancelNotes}
              placeholder="Optional additional detail"
              className="mt-4"
              rows={2}
            />

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
              <Button
                type="button"
                onClick={() => setCancelRequestSale(null)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={cancelRequestSaving}
                className="h-9 border border-danger bg-danger text-xs text-white shadow-none hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelRequestSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                {cancelRequestSaving ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </form>
        )}
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
            sourceDocumentLabel="Invoice"
            sourceDocumentNumber={viewingDelivery.sourceNumber}
            parentEntity="sale"
            parentEntityId={viewingDelivery.saleId}
            onDeliveredChange={(next) => setViewingDelivery((prev) => (prev ? { ...prev, delivery: next } : prev))}
          />
        ) : null}
      </Modal>

      {attachingDeliveryInvoice && (
        <AttachDeliveryModal
          parentEntity="sale"
          parentId={attachingDeliveryInvoice.id}
          customerName={attachingDeliveryInvoice.customerName}
          onClose={() => setAttachingDeliveryInvoice(null)}
          onAttached={() => {
            setAttachingDeliveryInvoice(null);
            showSuccessToast("Delivery attached");
            void loadAll();
          }}
        />
      )}

      <Modal
        open={statementPickerOpen}
        onClose={() => setStatementPickerOpen(false)}
        title="Generate Statement"
        description="Search for a customer to see every invoice they haven't fully paid off yet."
        widthClassName="max-w-md"
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            autoFocus
            type="text"
            value={statementSearch}
            onChange={(event) => setStatementSearch(event.target.value)}
            placeholder="Search customers..."
            className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
        </div>
        <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
          {filteredStatementCustomers.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs font-semibold text-muted">No customers found</p>
          ) : (
            filteredStatementCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => void openStatement(customer.id)}
                className="flex w-full items-center justify-between rounded-lg border border-line px-3.5 py-2.5 text-left transition hover:bg-soft cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-ink">{customer.name}</p>
                  <p className="text-[11px] font-semibold text-muted">{customer.phone}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </Modal>

      <Modal
        open={statementVm !== null || statementLoading}
        onClose={() => setStatementVm(null)}
        title={statementVm ? `Statement — ${statementVm.customerName}` : "Statement"}
        description="Print, download, or share this customer's outstanding balance."
        widthClassName="max-w-lg"
      >
        {statementLoading ? (
          <div className="flex min-h-[160px] items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : statementVm ? (
          <StatementPreview vm={statementVm} />
        ) : null}
      </Modal>

      <Modal
        open={recordPaymentOpen}
        onClose={() => setRecordPaymentOpen(false)}
        title="Record Payment"
        description="Multiple payments are supported — collect balances over several days or weeks."
        widthClassName="max-w-md"
      >
        <form onSubmit={submitRecordPayment}>
          {paymentError && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {paymentError}
            </div>
          )}
          <SelectField
            label="Payment Method"
            value={paymentMethodId}
            onChange={setPaymentMethodId}
            options={[
              { value: "", label: "Select payment method" },
              ...activePaymentMethods.map((method) => ({ value: method.id, label: method.name }))
            ]}
          />
          <Field
            label="Amount"
            type="number"
            value={paymentAmount}
            onChange={setPaymentAmount}
            placeholder="0.00"
            required
            className="mt-4"
          />
          {selectedRecordMethod?.requiresReference && (
            <Field
              label="Reference"
              value={paymentReference}
              onChange={setPaymentReference}
              placeholder="e.g. M-Pesa code, transaction ID, cheque number"
              required
              className="mt-4"
            />
          )}
          <TextAreaField label="Notes" value={paymentNotes} onChange={setPaymentNotes} className="mt-4" rows={2} />
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={() => setRecordPaymentOpen(false)}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={paymentSaving || !paymentMethodId} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
              {paymentSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {paymentSaving ? "Saving..." : "Record Payment"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={markPaidOpen}
        onClose={() => setMarkPaidOpen(false)}
        title="Mark as Paid"
        description="Records a final payment for the full remaining balance."
        widthClassName="max-w-sm"
      >
        <form onSubmit={submitMarkPaid}>
          {markPaidError && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {markPaidError}
            </div>
          )}
          {viewingSale && (
            <div className="mb-4 rounded-lg border border-line bg-soft px-3.5 py-2.5">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Remaining Balance</p>
              <p className="mt-0.5 text-lg font-extrabold text-ink">{formatCents(viewingSale.balanceDueCents)}</p>
            </div>
          )}
          <SelectField
            label="Payment Method"
            value={markPaidMethodId}
            onChange={setMarkPaidMethodId}
            options={[
              { value: "", label: "Select payment method" },
              ...activePaymentMethods.map((method) => ({ value: method.id, label: method.name }))
            ]}
          />
          {selectedMarkPaidMethod?.requiresReference && (
            <Field
              label="Reference"
              value={markPaidReference}
              onChange={setMarkPaidReference}
              placeholder="e.g. M-Pesa code, transaction ID"
              required
              className="mt-4"
            />
          )}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={() => setMarkPaidOpen(false)}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={markPaidSaving || !markPaidMethodId}
              className="h-9 bg-success text-xs hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {markPaidSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {markPaidSaving ? "Saving..." : "Confirm Paid"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={editingInvoiceId ? "Edit Invoice" : "New Invoice"}
        description={
          editingInvoiceId
            ? "Only available while nothing has been paid yet — the storefront and items are re-priced from scratch on save."
            : "Goods are considered delivered now — payment can be collected in full or over time."
        }
        widthClassName="max-w-2xl"
      >
        <form onSubmit={submitCreateInvoice}>
          {createError && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {createError}
            </div>
          )}

          {!editingInvoiceId && session && !session.branch && (
            <div className="mb-4">
              <StorefrontPicker value={createStorefrontId} onChange={setCreateStorefrontId} />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Customer</span>
              <button
                type="button"
                onClick={() => setQuickCreateCustomerOpen(true)}
                className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
              >
                <Plus className="size-3" aria-hidden="true" />
                New Customer
              </button>
            </div>
            {selectedCreateCustomer ? (
              <div className="mt-1.5 flex items-center justify-between rounded-lg border border-line bg-soft px-3.5 py-2.5">
                <div>
                  <p className="text-sm font-extrabold text-ink">{selectedCreateCustomer.name}</p>
                  <p className="text-[11px] font-semibold text-muted">{selectedCreateCustomer.phone}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateCustomerId(null)}
                  className="text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative mt-1.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder="Search customer by name or phone"
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
                {filteredCustomers.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-soft">
                    {filteredCustomers.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => {
                          setCreateCustomerId(customer.id);
                          setCustomerSearch("");
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-soft cursor-pointer"
                      >
                        <span className="font-bold text-ink">{customer.name}</span>
                        <span className="text-xs font-semibold text-muted">{customer.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <SelectField
              label="Transaction Type"
              value={createTransactionType}
              onChange={(value) => setCreateTransactionType(value as "invoice" | "wholesale_sale")}
              options={[
                { value: "invoice", label: "Invoice" },
                { value: "wholesale_sale", label: "Wholesale Sale" }
              ]}
            />
            <Field label="Due Date" type="date" value={createDueDate} onChange={setCreateDueDate} required />
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Products</span>
              <button
                type="button"
                onClick={() => {
                  // Without a storefront, the popup has nowhere to seed opening stock — its own
                  // Stock Quantity field just silently doesn't render (see
                  // QuickCreateProductModal's storefrontId prop), which looked like a random,
                  // unexplained bug rather than this. Same guard/message as submitting the
                  // invoice itself (below), just earlier.
                  if (session && !session.branch && !createStorefrontId) {
                    const message = "Choose a storefront above before adding a new product";
                    setCreateError(message);
                    showErrorToast(message);
                    return;
                  }
                  setQuickCreateProductOpen(true);
                }}
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
              {filteredCreateProducts.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-soft">
                  {filteredCreateProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addCreateLine(product)}
                      className="flex w-full items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-soft cursor-pointer"
                    >
                      <span className="font-bold text-ink">{product.name}</span>
                      <span className="text-xs font-semibold text-muted">{formatCents(product.sellingPriceCents)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3 space-y-2">
              {createLinePricing.length === 0 ? (
                <p className="text-xs font-semibold text-muted">No products added yet.</p>
              ) : (
                createLinePricing.map(({ line, product, pricing }) => (
                  <div key={line.productId} className="rounded-lg border border-line p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-extrabold leading-snug text-ink" title={line.name}>
                          {line.name}
                        </p>
                        <p className="text-[11px] font-semibold text-muted">@ {formatCents(pricing.unitPriceCents)}</p>
                        <StockByLocationRow balances={createLineStock.get(line.productId)} />
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1">
                        {(() => {
                          const badge = taxModeBadgeLabel(product, {
                            vatRatePercent: tenantContext?.vatRatePercent ?? 16,
                            pricesTaxInclusive: tenantContext?.pricesTaxInclusive ?? true
                          });
                          return <DashedPill tone={badge.tone}>{badge.label}</DashedPill>;
                        })()}
                        <button
                          type="button"
                          onClick={() => removeCreateLine(line.productId)}
                          className="text-[11px] font-extrabold uppercase text-danger hover:underline cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
                        Qty
                        <input
                          type="number"
                          min={1}
                          value={line.quantity === 0 ? "" : line.quantity}
                          onChange={(event) => updateCreateQuantityDraft(line.productId, event.target.value)}
                          onBlur={() => updateCreateQuantity(line.productId, line.quantity)}
                          className="h-8 w-16 rounded-md border border-line text-center text-xs font-bold outline-none focus:border-accent"
                        />
                      </label>
                      <label
                        className="flex items-center gap-1.5 text-[11px] font-bold text-muted"
                        title="Override this line's unit price for this document only — the product's own price is never changed"
                      >
                        Price
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.priceOverride}
                          onChange={(event) => updateCreatePriceOverride(line.productId, event.target.value)}
                          placeholder={fromCents(pricing.unitPriceCents)}
                          className={cn(
                            "h-8 w-20 rounded-md border px-1.5 text-right text-xs font-semibold outline-none focus:border-accent",
                            line.priceOverride.trim() && isPriceBelowMinimum(toCents(line.priceOverride), product.minimumPriceCents)
                              ? "border-danger text-danger"
                              : "border-line"
                          )}
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
                        Discount
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.discount}
                          onChange={(event) => updateCreateDiscount(line.productId, event.target.value)}
                          className="h-8 w-20 rounded-md border border-line px-1.5 text-right text-xs font-semibold outline-none focus:border-accent"
                        />
                      </label>
                      <span className="text-sm font-extrabold text-ink">{formatCents(pricing.lineTotalCents)}</span>
                    </div>

                    {line.priceOverride.trim() && isPriceBelowMinimum(toCents(line.priceOverride), product.minimumPriceCents) && (
                      <p className="mt-1 text-right text-[10px] font-bold text-danger">
                        Below minimum price of {fromCents(product.minimumPriceCents)}
                      </p>
                    )}

                    <label className="mt-2 flex items-center gap-1.5 text-[10px] font-bold text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={line.isLocallySourced}
                        onChange={() => toggleCreateLocallySourced(line.productId)}
                        className="size-3.5 accent-accent"
                      />
                      Sourced from another shop
                    </label>

                    {line.isLocallySourced && (
                      <div className="mt-2 flex flex-col gap-2.5 rounded-md bg-soft/60 p-2.5">
                        <label className="block text-sm font-extrabold text-ink">
                          Unit Cost
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.localCost}
                            onChange={(event) => updateCreateLocalCost(line.productId, event.target.value)}
                            placeholder="0.00"
                            className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm font-semibold outline-none focus:border-accent"
                          />
                        </label>
                        {line.localCost.trim() && (
                          <p className="text-[10px] font-semibold text-muted">
                            Total for {line.quantity}: {formatCents(unitCostToTotalCents(line.localCost, line.quantity))}
                          </p>
                        )}
                        <div>
                          <p className="text-sm font-extrabold text-ink">Local supplier</p>
                          <SupplierPicker
                            suppliers={suppliers}
                            value={line.localSupplierId}
                            onChange={(supplierId) => updateCreateLocalSupplier(line.productId, supplierId)}
                            onSupplierCreated={(supplier) => setSuppliers((prev) => [...prev, supplier])}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <TextAreaField label="Invoice Notes" value={createNotes} onChange={setCreateNotes} className="mt-4" rows={2} />

          <div className="mt-4">
            <CheckboxField
              label="Include tax information"
              description="Shows the Tax Breakdown section on this invoice's print, download, and share — can still be changed later from the invoice's own detail view"
              checked={createIncludeTaxBreakdown}
              onChange={setCreateIncludeTaxBreakdown}
            />
          </div>

          <div className="mt-4">
            <CheckboxField
              label="Include storefront information"
              description="Shows the shop name, logo, address, contacts and header/footer text on this invoice — can still be changed later from the invoice's own detail view"
              checked={createIncludeBusinessInfo}
              onChange={setCreateIncludeBusinessInfo}
            />
          </div>

          <ExtraChargesSection
            serviceCharges={createServiceCharges}
            onServiceChargesChange={setCreateServiceCharges}
            delivery={createDelivery}
            onDeliveryChange={setCreateDelivery}
            customerName={selectedCreateCustomer?.name ?? ""}
          />

          {!editingInvoiceId && (
            <div className="mt-4">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-soft px-3.5 py-2.5">
                <input
                  type="checkbox"
                  checked={includeInitialPayment}
                  onChange={(event) => setIncludeInitialPayment(event.target.checked)}
                  className="size-4 accent-primary"
                />
                <span className="text-sm font-bold text-ink">Record an initial payment now</span>
              </label>

              {includeInitialPayment && (
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <SelectField
                    label="Payment Method"
                    value={initialPaymentMethodId}
                    onChange={setInitialPaymentMethodId}
                    options={[
                      { value: "", label: "Select payment method" },
                      ...activePaymentMethods.map((method) => ({ value: method.id, label: method.name }))
                    ]}
                  />
                  <Field label="Amount" type="number" value={initialPaymentAmount} onChange={setInitialPaymentAmount} placeholder="0.00" />
                  {selectedInitialMethod?.requiresReference && (
                    <Field
                      label="Reference"
                      value={initialPaymentReference}
                      onChange={setInitialPaymentReference}
                      placeholder="e.g. M-Pesa code"
                      className="col-span-2"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-4 space-y-1 border-t border-line pt-4 text-sm">
            <div className="flex justify-between text-muted">
              <span className="font-semibold">Subtotal</span>
              <span className="font-bold tabular-nums">{formatCents(createTotals.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span className="font-semibold">Discount</span>
              <span className="font-bold tabular-nums">-{formatCents(createTotals.discountAmountCents)}</span>
            </div>
            {createTotals.serviceChargesFeeCents > 0 && (
              <div className="flex justify-between text-muted">
                <span className="font-semibold">Service Charges</span>
                <span className="font-bold tabular-nums">{formatCents(createTotals.serviceChargesFeeCents)}</span>
              </div>
            )}
            {createTotals.deliveryFeeCents > 0 && (
              <div className="flex justify-between text-muted">
                <span className="font-semibold">Delivery Fee</span>
                <span className="font-bold tabular-nums">{formatCents(createTotals.deliveryFeeCents)}</span>
              </div>
            )}
            {createIncludeTaxBreakdown && createTotals.addedTaxCents > 0 && (
              <div className="flex justify-between text-muted">
                <span className="font-semibold">Total Tax</span>
                <span className="font-bold tabular-nums">{formatCents(createTotals.addedTaxCents)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-extrabold text-ink">
              <span>Total</span>
              <span>{formatCents(createTotals.grandTotalCents)}</span>
            </div>
            {includeInitialPayment && initialPaymentCents > 0 && (
              <>
                <div className="flex justify-between text-muted">
                  <span className="font-semibold">Initial Payment</span>
                  <span className="font-bold tabular-nums">{formatCents(initialPaymentCents)}</span>
                </div>
                <div className="flex justify-between text-base font-extrabold text-danger">
                  <span>Balance Due</span>
                  <span>{formatCents(Math.max(createTotals.grandTotalCents - initialPaymentCents, 0))}</span>
                </div>
              </>
            )}
          </div>

          <TaxBreakdownTable
            breakdown={computeTaxBreakdown(
              createLinePricing.map((entry) => ({
                unitPriceCents: entry.pricing.unitPriceCents,
                quantity: entry.line.quantity,
                discountAmountCents: entry.pricing.discountAmountCents,
                taxType: entry.product.taxType,
                taxAmountCents: entry.pricing.taxCents,
                lineTotalCents: entry.pricing.lineTotalCents
              }))
            )}
            tenantTaxConfig={{ vatRatePercent: tenantContext?.vatRatePercent ?? 16, pricesTaxInclusive: tenantContext?.pricesTaxInclusive ?? true }}
          />

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createSaving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
              {createSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {editingInvoiceId ? (createSaving ? "Saving..." : "Save Changes") : createSaving ? "Creating..." : "Create Invoice"}
            </Button>
          </div>
        </form>
      </Modal>

      <QuickCreateCustomerModal
        open={quickCreateCustomerOpen}
        onClose={() => setQuickCreateCustomerOpen(false)}
        onCreated={(customer) => {
          setCustomers((prev) => [...prev, customer]);
          setCreateCustomerId(customer.id);
          setCustomerSearch("");
          setQuickCreateCustomerOpen(false);
        }}
      />

      <QuickCreateProductModal
        open={quickCreateProductOpen}
        onClose={() => setQuickCreateProductOpen(false)}
        storefrontId={session?.branch ? session.branch.id : createStorefrontId || null}
        onCreated={(product) => {
          setProducts((prev) => [...prev, { ...product, categoryName: null, categoryColor: null, totalStock: 0 }]);
          addCreateLine({ ...product, categoryName: null, categoryColor: null, totalStock: 0 });
          setQuickCreateProductOpen(false);
        }}
      />
    </motion.div>
  );
}
