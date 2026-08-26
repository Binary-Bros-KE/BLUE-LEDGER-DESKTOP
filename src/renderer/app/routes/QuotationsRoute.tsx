import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  Loader2,
  Package,
  PackagePlus,
  Plus,
  Printer,
  Receipt,
  Search,
  Send,
  Share2,
  ShoppingCart,
  Trash2,
  XCircle
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
import { formatCents, fromCents, toCents } from "@renderer/shared/lib/money";
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
import { formatDocumentDate } from "@shared/lib/date";
import type { Customer } from "@shared/types/customer";
import type { ExportListRequest } from "@shared/types/export";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { PaymentMethod } from "@shared/types/payment-method";
import type { ProductListItem } from "@shared/types/product";
import type { SaleDelivery } from "@shared/types/sale";
import type { Supplier } from "@shared/types/supplier";
import {
  QUOTATION_STATUS_OPTIONS,
  type Quotation,
  type QuotationListItem,
  type QuotationStatus,
  type QuotationStockCheckItem,
  type QuotationSummary
} from "@shared/types/quotation";

type FilterTab = "all" | QuotationStatus;

const FILTER_TABS: Array<{ value: FilterTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "expired", label: "Expired" },
  { value: "rejected", label: "Rejected" },
  { value: "converted", label: "Converted" }
];

type CartLine = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  discountAmountCents: number;
  /** Cashier-entered price override for this line only (e.g. product is 450, cashier quotes 600) —
   * never written back to the product's own selling price. Empty string means "use the normal/
   * wholesale price". Raw text on purpose (see money.ts's own fromCents/toCents split) — converting
   * on every keystroke like discountAmountCents does would fight the user mid-type. */
  priceOverride: string;
  isLocallySourced: boolean;
  localCost: string;
  localSupplierId: string | null;
};

function statusTone(status: QuotationStatus): "success" | "warning" | "danger" | "neutral" | "accent" {
  if (status === "accepted" || status === "converted") return "success";
  if (status === "expired" || status === "rejected") return "danger";
  if (status === "sent") return "warning";
  return "neutral";
}

function statusLabel(status: QuotationStatus): string {
  return QUOTATION_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function formatDate(value: string | null): string {
  return value ? formatDocumentDate(value) : "—";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

export function QuotationsRoute(): React.JSX.Element {
  const currency = useAppStore((state) => state.context?.tenant.currency ?? "");
  const tenantContext = useAppStore((state) => state.context?.tenant ?? null);
  const { can, session } = usePermissions();
  const showStorefrontFilter = session?.branch == null;
  const canCreate = can("quotations", "create");
  const canEdit = can("quotations", "edit");
  const canDelete = can("quotations", "delete");
  const canExport = can("quotations", "export");
  const confirm = useConfirm();

  const [summary, setSummary] = useState<QuotationSummary | null>(null);
  const [quotations, setQuotations] = useState<QuotationListItem[] | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear()));
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterLocations, setFilterLocations] = useState<Location[]>([]);
  const [locationFilter, setLocationFilter] = useState("");

  const [viewingQuotation, setViewingQuotation] = useState<Quotation | null>(null);
  const [sharing, setSharing] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [printingThermal, setPrintingThermal] = useState(false);

  const [viewingDelivery, setViewingDelivery] = useState<{
    delivery: SaleDelivery;
    sourceNumber: string | null;
    locationId: string;
    quotationId: string;
  } | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [attachingDeliveryQuotation, setAttachingDeliveryQuotation] = useState<{
    id: string;
    customerName: string | null;
  } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  // Non-null while the create modal is actually editing an existing draft in place — see
  // InvoicesRoute.tsx's identical pattern for the same reasoning (one form, not two near-duplicates).
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [createCustomerId, setCreateCustomerId] = useState<string | null>(null);
  // createCustomerId alone can't distinguish "hasn't picked yet" (show the search box) from
  // "explicitly chose Walk-in Customer" (both are null) — this tracks whether ANY choice (a real
  // customer OR Walk-in) has been made, so the picker collapses into a summary card either way.
  const [createCustomerChosen, setCreateCustomerChosen] = useState(false);
  // Only ever consulted when session.branch is null (see StorefrontPicker/requireActiveSession).
  const [createStorefrontId, setCreateStorefrontId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [quickCreateCustomerOpen, setQuickCreateCustomerOpen] = useState(false);
  const [quickCreateProductOpen, setQuickCreateProductOpen] = useState(false);
  const [createValidUntil, setCreateValidUntil] = useState(addDaysIso(7));
  const [createNotes, setCreateNotes] = useState("");
  const [createIncludeTaxBreakdown, setCreateIncludeTaxBreakdown] = useState(true);
  const [createIncludeBusinessInfo, setCreateIncludeBusinessInfo] = useState(true);
  // Kept in sync by the effect below — openCreateModal() reads this synchronously, same pattern as
  // CheckoutRoute's/InvoicesRoute's own identical ref.
  const defaultIncludeBusinessInfoRef = useRef(true);
  const [createItems, setCreateItems] = useState<CartLine[]>([]);
  const [createServiceCharges, setCreateServiceCharges] = useState<ServiceChargeDraft[]>([]);
  const [createDelivery, setCreateDelivery] = useState<DeliveryDraft | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [convertSaleOpen, setConvertSaleOpen] = useState(false);
  const [convertInvoiceOpen, setConvertInvoiceOpen] = useState(false);
  const [stockCheck, setStockCheck] = useState<QuotationStockCheckItem[] | null>(null);
  const [stockCheckLoading, setStockCheckLoading] = useState(false);
  const [quantityEdits, setQuantityEdits] = useState<Record<string, number>>({});
  const [convertPaymentMethodId, setConvertPaymentMethodId] = useState("");
  const [convertPaymentReference, setConvertPaymentReference] = useState("");
  const [convertAmountReceived, setConvertAmountReceived] = useState("");
  const [convertDueDate, setConvertDueDate] = useState(addDaysIso(30));
  const [convertSaving, setConvertSaving] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [summaryResult, quotationList, customerList, productList, methodList, supplierList] = await Promise.all([
        window.blueLedger.quotation.summary(),
        window.blueLedger.quotation.list(),
        window.blueLedger.customer.list(),
        window.blueLedger.product.list(),
        window.blueLedger.paymentMethod.list(),
        window.blueLedger.supplier.list()
      ]);
      setSummary(summaryResult);
      setQuotations(quotationList);
      setCustomers(customerList);
      setProducts(productList);
      setPaymentMethods(methodList);
      setSuppliers(supplierList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load quotations"));
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
  const selectedConvertMethod = activePaymentMethods.find((method) => method.id === convertPaymentMethodId) ?? null;

  const availableYears = useMemo(
    () => buildAvailableYears((quotations ?? []).map((quotation) => quotation.createdAt)),
    [quotations]
  );

  const filteredQuotations = useMemo(() => {
    if (!quotations) return null;
    let list = quotations;

    if (activeTab !== "all") {
      list = list.filter((quotation) => quotation.status === activeTab);
    }

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((quotation) => {
        const haystack =
          `${quotation.quotationNumber} ${quotation.customerName ?? "Walk-in Customer"} ${quotation.employeeName} ${quotation.createdAt}`.toLowerCase();
        return haystack.includes(term);
      });
    }

    if (dateFrom || dateTo) {
      list = list.filter((quotation) => {
        const quotationDate = quotation.createdAt.slice(0, 10);
        if (dateFrom && quotationDate < dateFrom) return false;
        if (dateTo && quotationDate > dateTo) return false;
        return true;
      });
    }

    list = list.filter((quotation) => matchesYearFilter(quotation.createdAt, yearFilter));

    if (locationFilter) {
      list = list.filter((quotation) => quotation.locationId === locationFilter);
    }

    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [quotations, activeTab, searchTerm, dateFrom, dateTo, yearFilter, locationFilter]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredQuotations) return null;
    const filterParts: string[] = [];
    if (activeTab !== "all") filterParts.push(`Filter: ${FILTER_TABS.find((tab) => tab.value === activeTab)?.label}`);
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);
    if (yearFilter !== ALL_YEARS_VALUE) filterParts.push(`Year: ${yearFilter}`);
    if (locationFilter) {
      filterParts.push(`Storefront: ${filterLocations.find((l) => l.id === locationFilter)?.locationName ?? locationFilter}`);
    }
    if (dateFrom || dateTo) filterParts.push(`Date: ${dateFrom || "…"} to ${dateTo || "…"}`);

    return {
      module: "quotations",
      title: "Quotations",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "All quotations",
      columns: [
        { key: "quotationNumber", header: "Quotation #" },
        { key: "customer", header: "Customer" },
        { key: "storefront", header: "Storefront" },
        { key: "salesperson", header: "Salesperson" },
        { key: "created", header: "Created" },
        { key: "validUntil", header: "Valid Until" },
        { key: "total", header: "Total Amount", align: "right" },
        { key: "status", header: "Status" }
      ],
      rows: filteredQuotations.map((quotation) => ({
        quotationNumber: quotation.quotationNumber,
        customer: quotation.customerName ?? "Walk-in Customer",
        storefront: quotation.locationName,
        salesperson: quotation.employeeName,
        created: formatDate(quotation.createdAt),
        validUntil: formatDate(quotation.validUntil),
        total: `${currency} ${formatCents(quotation.grandTotalCents)}`,
        status: statusLabel(quotation.status)
      })),
      stats: summary
        ? [
          { label: "Total Quotations", value: String(summary.totalQuotations) },
          { label: "Draft", value: String(summary.draftCount) },
          { label: "Sent", value: String(summary.sentCount) },
          { label: "Accepted", value: String(summary.acceptedCount) },
          { label: "Expired", value: String(summary.expiredCount) },
          { label: "Converted", value: String(summary.convertedCount) }
        ]
        : [],
      fileBaseName: `Quotations_${new Date().toISOString().slice(0, 10)}`
    };
  }, [filteredQuotations, summary, activeTab, searchTerm, yearFilter, locationFilter, filterLocations, dateFrom, dateTo, currency]);

  async function openView(id: string): Promise<void> {
    setViewLoading(true);
    setActionError(null);
    try {
      const quotation = await window.blueLedger.quotation.get(id);
      setViewingQuotation(quotation);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load quotation"));
    } finally {
      setViewLoading(false);
    }
  }

  function closeView(): void {
    setViewingQuotation(null);
    setNotice(null);
  }

  async function openDeliveryNote(quotation: { id: string; quotationNumber: string; locationId: string }): Promise<void> {
    setDeliveryLoading(true);
    setActionError(null);
    try {
      const delivery = await window.blueLedger.deliveryNote.getForQuotation(quotation.id);
      if (delivery) {
        setViewingDelivery({
          delivery,
          sourceNumber: quotation.quotationNumber,
          locationId: quotation.locationId,
          quotationId: quotation.id
        });
      }
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load delivery note"));
    } finally {
      setDeliveryLoading(false);
    }
  }

  async function refreshViewing(id: string): Promise<void> {
    const quotation = await window.blueLedger.quotation.get(id);
    setViewingQuotation(quotation);
  }

  async function handleSetStatus(status: QuotationStatus): Promise<void> {
    if (!viewingQuotation) return;
    setActionError(null);
    try {
      await window.blueLedger.quotation.setStatus(viewingQuotation.id, status);
      await refreshViewing(viewingQuotation.id);
      await loadAll();
      showSuccessToast(`Quotation marked as ${status}`);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to update status");
      setActionError(message);
      showErrorToast(message);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!viewingQuotation) return;
    const confirmed = await confirm({
      title: "Delete this draft?",
      message: `Delete draft quotation ${viewingQuotation.quotationNumber}? This can't be undone.`,
      tone: "danger",
      confirmLabel: "Delete"
    });
    if (!confirmed) return;
    setActionError(null);
    try {
      await window.blueLedger.quotation.delete(viewingQuotation.id);
      closeView();
      await loadAll();
      showSuccessToast("Draft quotation deleted");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to delete quotation");
      setActionError(message);
      showErrorToast(message);
    }
  }

  async function handlePrint(): Promise<void> {
    if (!viewingQuotation) return;
    setActionError(null);
    try {
      const result = await window.blueLedger.printer.printQuotationDocument(viewingQuotation.id);
      if (!result.success) setActionError(result.message);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to print quotation"));
    }
  }

  async function handlePreview(): Promise<void> {
    if (!viewingQuotation) return;
    setActionError(null);
    try {
      await window.blueLedger.printer.previewQuotationPdf(viewingQuotation.id);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to open preview"));
    }
  }

  async function handleToggleTaxBreakdown(next: boolean): Promise<void> {
    if (!viewingQuotation) return;
    try {
      const updated = await window.blueLedger.quotation.setIncludeTaxBreakdown(viewingQuotation.id, next);
      setViewingQuotation(updated);
      showSuccessToast(next ? "Tax breakdown will now show on this quotation" : "Tax breakdown hidden on this quotation");
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to update the tax breakdown setting"));
    }
  }

  async function handleToggleBusinessInfo(next: boolean): Promise<void> {
    if (!viewingQuotation) return;
    try {
      const updated = await window.blueLedger.quotation.setIncludeBusinessInfo(viewingQuotation.id, next);
      setViewingQuotation(updated);
      showSuccessToast(next ? "Storefront information will now show on this quotation" : "Storefront information hidden on this quotation");
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to update the storefront information setting"));
    }
  }

  async function handlePrintThermal(): Promise<void> {
    if (!viewingQuotation) return;
    setPrintingThermal(true);
    setActionError(null);
    try {
      const result = await window.blueLedger.printer.printQuotationThermal(viewingQuotation.id);
      if (!result.success) setActionError(result.message);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to print quotation"));
    } finally {
      setPrintingThermal(false);
    }
  }

  async function openConvert(kind: "sale" | "invoice"): Promise<void> {
    if (!viewingQuotation) return;
    setConvertError(null);
    setConvertPaymentMethodId("");
    setConvertPaymentReference("");
    setConvertAmountReceived("");
    setConvertDueDate(addDaysIso(30));
    setQuantityEdits({});
    setStockCheck(null);
    if (kind === "sale") setConvertSaleOpen(true);
    else setConvertInvoiceOpen(true);

    setStockCheckLoading(true);
    try {
      const result = await window.blueLedger.quotation.checkStock(viewingQuotation.id);
      setStockCheck(result);
      const edits: Record<string, number> = {};
      for (const item of result) {
        if (!item.sufficient) edits[item.productId] = item.availableQuantity;
      }
      setQuantityEdits(edits);
    } catch (err) {
      setConvertError(getErrorMessage(err, "Failed to check stock"));
    } finally {
      setStockCheckLoading(false);
    }
  }

  function closeConvert(): void {
    setConvertSaleOpen(false);
    setConvertInvoiceOpen(false);
  }

  function buildQuantityOverrides(): Array<{ productId: string; quantity: number }> {
    if (!viewingQuotation) return [];
    return Object.entries(quantityEdits)
      .map(([productId, quantity]) => ({ productId, quantity }))
      .filter(({ productId, quantity }) => {
        const original = viewingQuotation.items.find((item) => item.productId === productId);
        return original && quantity > 0 && quantity !== original.quantity;
      });
  }

  const hasInsufficientStock = stockCheck?.some((item) => item.sufficient === false && (quantityEdits[item.productId] ?? item.requestedQuantity) > item.availableQuantity) ?? false;

  async function submitConvertToSale(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!viewingQuotation) return;
    setConvertSaving(true);
    setConvertError(null);
    try {
      const sale = await window.blueLedger.quotation.convertToSale(viewingQuotation.id, {
        paymentMethodId: convertPaymentMethodId,
        paymentReference: convertPaymentReference,
        amountReceivedCents: convertAmountReceived.trim() !== "" ? toCents(convertAmountReceived) : null,
        quantityOverrides: buildQuantityOverrides()
      });
      closeConvert();
      await refreshViewing(viewingQuotation.id);
      await loadAll();
      const message = `Converted to Sale — receipt ${sale.receiptNumber ?? sale.id}`;
      setNotice(message);
      showSuccessToast(message);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to convert to sale");
      setConvertError(message);
      showErrorToast(message);
    } finally {
      setConvertSaving(false);
    }
  }

  async function submitConvertToInvoice(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!viewingQuotation) return;
    setConvertSaving(true);
    setConvertError(null);
    try {
      const sale = await window.blueLedger.quotation.convertToInvoice(viewingQuotation.id, {
        dueDate: convertDueDate,
        quantityOverrides: buildQuantityOverrides()
      });
      closeConvert();
      await refreshViewing(viewingQuotation.id);
      await loadAll();
      const message = `Converted to Invoice ${sale.invoiceNumber ?? ""}`;
      setNotice(message);
      showSuccessToast(message);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to convert to invoice");
      setConvertError(message);
      showErrorToast(message);
    } finally {
      setConvertSaving(false);
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
              line.discountAmountCents,
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
    setEditingQuotationId(null);
    setCreateCustomerId(null);
    setCreateCustomerChosen(false);
    setCreateStorefrontId("");
    setCustomerSearch("");
    setCreateValidUntil(addDaysIso(7));
    setCreateNotes("");
    setCreateIncludeTaxBreakdown(true);
    setCreateIncludeBusinessInfo(defaultIncludeBusinessInfoRef.current);
    setCreateItems([]);
    setCreateServiceCharges([]);
    setCreateDelivery(null);
    setProductSearch("");
    setCreateError(null);
    setCreateOpen(true);
  }

  /** Prefills the same create-quotation form/state in place of a blank one — only reachable while
   * status is "draft" (see updateQuotation's own requireEditableDraft). The storefront section stays
   * hidden in this mode — a quotation's storefront is fixed at creation. */
  function openEditQuotation(quotation: Quotation): void {
    setEditingQuotationId(quotation.id);
    setCreateCustomerId(quotation.customerId);
    setCreateCustomerChosen(true);
    setCreateStorefrontId(quotation.locationId);
    setCustomerSearch("");
    setCreateValidUntil(quotation.validUntil);
    setCreateNotes(quotation.notes ?? "");
    setCreateIncludeTaxBreakdown(quotation.includeTaxBreakdown);
    setCreateIncludeBusinessInfo(quotation.includeBusinessInfo);
    setCreateItems(
      quotation.items.map((item) => ({
        productId: item.productId,
        name: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        discountAmountCents: item.discountAmountCents,
        // Pre-filled with the item's own current price so re-submitting without touching this line
        // keeps its price exactly as it was — same reasoning as InvoicesRoute's openEditInvoice.
        priceOverride: fromCents(item.unitPriceCents),
        isLocallySourced: item.isLocallySourced,
        localCost: item.localCostCents !== null ? fromCents(item.localCostCents) : "",
        localSupplierId: item.localSupplierId
      }))
    );
    setCreateServiceCharges(
      quotation.serviceCharges.map((charge) => ({
        key: crypto.randomUUID(),
        name: charge.name,
        fee: fromCents(charge.feeCents),
        cost: fromCents(charge.costCents)
      }))
    );
    setCreateDelivery(
      quotation.delivery
        ? {
          riderId: quotation.delivery.riderId,
          recipientName: quotation.delivery.recipientName,
          country: quotation.delivery.country ?? "",
          town: quotation.delivery.town ?? "",
          physicalAddress: quotation.delivery.physicalAddress,
          notes: quotation.delivery.notes ?? "",
          fee: fromCents(quotation.delivery.feeCents),
          cost: fromCents(quotation.delivery.costCents)
        }
        : null
    );
    setProductSearch("");
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
          discountAmountCents: 0,
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
    const cents = toCents(value);
    setCreateItems((prev) =>
      prev.map((line) => (line.productId === productId ? { ...line, discountAmountCents: cents } : line))
    );
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

  async function submitCreateQuotation(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setCreateSaving(true);
    setCreateError(null);

    // No "select a customer" guard — a quotation is non-binding, so Walk-in Customer (createCustomerId
    // left null) is a valid, intentional choice here, unlike invoice creation.
    if (createItems.length === 0 && createServiceCharges.length === 0) {
      setCreateError("Add at least one product or service charge");
      setCreateSaving(false);
      return;
    }
    if (!editingQuotationId && session && !session.branch && !createStorefrontId) {
      setCreateError("Choose a storefront for this quotation");
      setCreateSaving(false);
      return;
    }

    const payload = {
      customerId: createCustomerId,
      validUntil: createValidUntil,
      notes: createNotes,
      includeTaxBreakdown: createIncludeTaxBreakdown,
      includeBusinessInfo: createIncludeBusinessInfo,
      locationId: session && !session.branch ? createStorefrontId : undefined,
      items: createItems.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discountAmountCents: line.discountAmountCents,
        unitPriceCents: line.priceOverride.trim() ? toCents(line.priceOverride) : undefined,
        isLocallySourced: line.isLocallySourced,
        localCostCents: line.isLocallySourced && line.localCost.trim() ? toCents(line.localCost) : undefined,
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
        : null
    };

    try {
      if (editingQuotationId) {
        const updated = await window.blueLedger.quotation.update(editingQuotationId, payload);
        setCreateOpen(false);
        await loadAll();
        if (viewingQuotation?.id === editingQuotationId) setViewingQuotation(updated);
        showSuccessToast("Quotation updated");
      } else {
        await window.blueLedger.quotation.create(payload);
        setCreateOpen(false);
        await loadAll();
        showSuccessToast("Quotation created");
      }
    } catch (err) {
      const message = getErrorMessage(err, editingQuotationId ? "Failed to update quotation" : "Failed to create quotation");
      setCreateError(message);
      showErrorToast(message);
    } finally {
      setCreateSaving(false);
    }
  }

  const canConvert = viewingQuotation?.status === "accepted" && canEdit;

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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Quotations</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <ClipboardList className="size-5 text-primary" aria-hidden="true" />
              Price Offers
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Prepare quotes for customers. 
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            {canCreate && (
              <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Quotation
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
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile icon={ClipboardList} label="Total Quotations" value={String(summary.totalQuotations)} tone="primary" />
            <StatTile icon={FileText} label="Draft" value={String(summary.draftCount)} tone="warning" />
            <StatTile icon={Send} label="Sent" value={String(summary.sentCount)} tone="accent" />
            <StatTile icon={CheckCircle2} label="Accepted" value={String(summary.acceptedCount)} tone="success" />
            <StatTile icon={AlertTriangle} label="Expired" value={String(summary.expiredCount)} tone="danger" />
            <StatTile icon={ShoppingCart} label="Converted" value={String(summary.convertedCount)} tone="accent" />
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
                placeholder="Search by quotation #, customer, or salesperson"
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
            <button
              type="button"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="h-10 rounded-lg border border-line bg-white px-3 text-xs font-bold text-ink shadow-none transition hover:bg-soft cursor-pointer"
            >
              Clear dates
            </button>
          )}
        </div>

        <div className="mt-5">
          {quotations === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : filteredQuotations && filteredQuotations.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <ClipboardList className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No quotations found</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                {quotations.length === 0
                  ? "Create your first quotation to start offering prices to customers."
                  : "Try a different filter or search term."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                  <col className="w-[5%]" />
                  <col className="w-[5%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Quotation #</Th>
                    <Th>Salesperson</Th> 
                    <Th>Created</Th>
                    <Th className="text-right">Total Amount</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredQuotations ?? []).map((quotation) => (
                    <tr
                      key={quotation.id}
                      onClick={() => void openView(quotation.id)}
                      className="cursor-pointer border-t border-line odd:bg-white even:bg-soft/50 hover:bg-soft"
                    >
                      <td className="truncate px-3 py-2.5 text-xs font-bold tabular-nums text-ink">
                        <div className="flex flex-col">
                          <span className="text-muted">{quotation.quotationNumber}</span>
                          <span>{quotation.customerName ?? "Walk-in Customer"}</span>
                        </div>
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        <div className="flex flex-col">
                          <span>{quotation.employeeName}</span>
                          <span className="text-xs font-bold text-primary">{quotation.locationName}</span>
                        </div>
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        <div className="flex flex-col">
                          <span>CREATED: {formatDate(quotation.createdAt)}</span>
                          <span>VALID: {formatDate(quotation.validUntil)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-ink">
                        {formatCents(quotation.grandTotalCents)}
                      </td>
                      <td className="px-3 py-2.5">
                        <DashedPill tone={statusTone(quotation.status)}>{statusLabel(quotation.status)}</DashedPill>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openView(quotation.id);
                            }}
                            aria-label="View quotation"
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                          >
                            <Eye className="size-3.5" aria-hidden="true" />
                          </button>
                          {quotation.hasDeliveryNote && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void openDeliveryNote(quotation);
                              }}
                              aria-label="View delivery note"
                              title="View Delivery Note"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-primary cursor-pointer"
                            >
                              <Package className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {!quotation.hasDeliveryNote && canEdit && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAttachingDeliveryQuotation(quotation);
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
        open={viewingQuotation !== null || viewLoading}
        onClose={closeView}
        title={viewingQuotation?.quotationNumber ?? "Quotation"}
        description="Customer, products, totals, and validity for this price offer."
        widthClassName="max-w-2xl"
      >
        {viewLoading ? (
          <div className="flex min-h-[220px] items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : viewingQuotation ? (
          <div>
            {notice && (
              <div className="mb-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-bold text-success">
                {notice}
              </div>
            )}
            {actionError && (
              <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
                {actionError}
              </div>
            )}

            <DashedPill tone={statusTone(viewingQuotation.status)}>{statusLabel(viewingQuotation.status)}</DashedPill>

            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Customer</p>
                <p className="mt-0.5 truncate text-sm font-bold text-ink">{viewingQuotation.customerName ?? "Walk-in Customer"}</p>
              </div>
              <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Storefront</p>
                <p className="mt-0.5 truncate text-sm font-bold text-ink">{viewingQuotation.locationName}</p>
              </div>
              <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Prepared By</p>
                <p className="mt-0.5 truncate text-sm font-bold text-ink">{viewingQuotation.employeeName}</p>
              </div>
              <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Prepared On</p>
                <p className="mt-0.5 text-sm font-bold text-ink">{formatDate(viewingQuotation.createdAt)}</p>
              </div>
              <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Valid Until</p>
                <p className="mt-0.5 text-sm font-bold text-ink">{formatDate(viewingQuotation.validUntil)}</p>
              </div>
            </div>

            <div className="mt-4">
              <CheckboxField
                label="Include tax information"
                description="Shows the Tax Breakdown section on this quotation's print, download, and share"
                checked={viewingQuotation.includeTaxBreakdown}
                onChange={(checked) => void handleToggleTaxBreakdown(checked)}
              />
            </div>

            <div className="mt-4">
              <CheckboxField
                label="Include storefront information"
                description="Shows the shop name, logo, address, contacts and header/footer text on this quotation. Turn off for a fully anonymous quotation."
                checked={viewingQuotation.includeBusinessInfo}
                onChange={(checked) => void handleToggleBusinessInfo(checked)}
              />
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Products</p>
              <div className="mt-2 space-y-1.5">
                {viewingQuotation.items.map((item) => (
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

            {viewingQuotation.items.some((item) => item.isLocallySourced) && (
              <div className="mt-4 rounded-lg border border-line bg-soft px-3.5 py-3">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">
                  Sourced From Another Shop
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-muted">
                  Internal record only — never shown on the printed/shared quotation.
                </p>
                <div className="mt-2 space-y-1.5">
                  {viewingQuotation.items
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
                          Cost {item.localCostCents !== null ? formatCents(item.localCostCents) : "—"}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {viewingQuotation.serviceCharges.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Service Charges</p>
                <div className="mt-2 space-y-1.5">
                  {viewingQuotation.serviceCharges.map((charge) => (
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

            {viewingQuotation.delivery && (
              <div className="mt-4 rounded-lg border border-dashed border-line bg-soft/50 p-3">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Delivery</p>
                <div className="mt-2 grid grid-cols-2 gap-2.5 text-sm">
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Recipient</p>
                    <p className="font-bold text-ink">{viewingQuotation.delivery.recipientName}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Fee</p>
                    <p className="font-bold text-ink">{formatCents(viewingQuotation.delivery.feeCents)}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Address</p>
                    <p className="font-semibold text-ink">
                      {[viewingQuotation.delivery.physicalAddress, viewingQuotation.delivery.town, viewingQuotation.delivery.country]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                  {viewingQuotation.delivery.riderName && (
                    <div className="col-span-2">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Rider</p>
                      <p className="font-semibold text-ink">
                        {viewingQuotation.delivery.riderName}
                        {viewingQuotation.delivery.riderPhone ? ` · ${viewingQuotation.delivery.riderPhone}` : ""}
                      </p>
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  onClick={() => void openDeliveryNote(viewingQuotation)}
                  className="mt-3 h-8 w-full border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                >
                  <Package className="mr-1.5 size-3.5" aria-hidden="true" />
                  View Delivery Note
                </Button>
              </div>
            )}

            {!viewingQuotation.delivery && canEdit && (
              <div className="mt-4">
                <Button
                  type="button"
                  onClick={() => setAttachingDeliveryQuotation(viewingQuotation)}
                  className="h-9 w-full border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                >
                  <PackagePlus className="mr-1.5 size-3.5" aria-hidden="true" />
                  Attach Delivery
                </Button>
              </div>
            )}

            {viewingQuotation.notes && (
              <div className="mt-4 rounded-lg border border-line bg-soft px-3.5 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Notes</p>
                <p className="mt-1 whitespace-pre-line text-sm font-semibold text-ink">{viewingQuotation.notes}</p>
              </div>
            )}

            <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between text-muted">
                <span className="font-semibold">Subtotal</span>
                <span className="font-bold tabular-nums">{formatCents(viewingQuotation.subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span className="font-semibold">Discount</span>
                <span className="font-bold tabular-nums">-{formatCents(viewingQuotation.discountAmountCents)}</span>
              </div>
              {viewingQuotation.serviceCharges.length > 0 && (
                <div className="flex justify-between text-muted">
                  <span className="font-semibold">Service Charges</span>
                  <span className="font-bold tabular-nums">
                    {formatCents(viewingQuotation.serviceCharges.reduce((sum, charge) => sum + charge.feeCents, 0))}
                  </span>
                </div>
              )}
              {viewingQuotation.delivery && viewingQuotation.delivery.feeCents > 0 && (
                <div className="flex justify-between text-muted">
                  <span className="font-semibold">Delivery Fee</span>
                  <span className="font-bold tabular-nums">{formatCents(viewingQuotation.delivery.feeCents)}</span>
                </div>
              )}
              {viewingQuotation.includeTaxBreakdown && computeAddedTaxCents(viewingQuotation.items) > 0 && (
                <div className="flex justify-between text-muted">
                  <span className="font-semibold">Total Tax</span>
                  <span className="font-bold tabular-nums">{formatCents(computeAddedTaxCents(viewingQuotation.items))}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-extrabold text-ink">
                <span>Total</span>
                <span>{formatCents(viewingQuotation.grandTotalCents)}</span>
              </div>
            </div>

            <TaxBreakdownTable
              breakdown={computeTaxBreakdown(viewingQuotation.items)}
              tenantTaxConfig={{ vatRatePercent: tenantContext?.vatRatePercent ?? 16, pricesTaxInclusive: tenantContext?.pricesTaxInclusive ?? true }}
            />

            <div className="mt-4 grid grid-cols-3 gap-2">
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
              entity="quotation"
              entityId={viewingQuotation.id}
              documentLabel={`Quotation ${viewingQuotation.quotationNumber}`}
              customerId={viewingQuotation.customerId}
              hasDeliveryNote={viewingQuotation.delivery !== null}
            />

            {canEdit && viewingQuotation.status === "draft" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  onClick={() => openEditQuotation(viewingQuotation)}
                  className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                >
                  <FileText className="mr-1.5 size-3.5" aria-hidden="true" />
                  Edit Quotation
                </Button>
                <Button type="button" onClick={() => void handleSetStatus("sent")} className="h-9 text-xs">
                  <Send className="mr-1.5 size-3.5" aria-hidden="true" />
                  Mark as Sent
                </Button>
              </div>
            )}

            {canEdit && (viewingQuotation.status === "sent" || viewingQuotation.status === "draft") && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  onClick={() => void handleSetStatus("accepted")}
                  className="h-9 border border-success/40 bg-white text-xs text-success shadow-none hover:bg-success/10"
                >
                  <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" />
                  Accepted
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSetStatus("rejected")}
                  className="h-9 border border-danger/30 bg-white text-xs text-danger shadow-none hover:bg-danger-soft"
                >
                  <XCircle className="mr-1.5 size-3.5" aria-hidden="true" />
                  Rejected
                </Button>
              </div>
            )}

            {canConvert && (
              <div className="mt-3 rounded-lg border border-line bg-soft p-3">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Convert Quotation</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button type="button" onClick={() => void openConvert("sale")} className="h-9 text-xs">
                    <ShoppingCart className="mr-1.5 size-3.5" aria-hidden="true" />
                    Convert to Sale
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void openConvert("invoice")}
                    className="h-9 border border-primary/40 bg-white text-xs text-primary shadow-none hover:bg-primary/10"
                  >
                    <FileText className="mr-1.5 size-3.5" aria-hidden="true" />
                    Convert to Invoice
                  </Button>
                </div>
              </div>
            )}

            {viewingQuotation.status === "converted" && viewingQuotation.convertedAt && (
              <div className="mt-3 rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-xs font-bold text-success">
                Converted on {formatDate(viewingQuotation.convertedAt)}.
              </div>
            )}

            {canDelete && viewingQuotation.status === "draft" && (
              <div className="mt-2">
                <Button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="h-9 w-full border border-danger/30 bg-white text-xs text-danger shadow-none hover:bg-danger-soft"
                >
                  <Trash2 className="mr-1.5 size-3.5" aria-hidden="true" />
                  Delete Draft
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
            sourceDocumentLabel="Quotation"
            sourceDocumentNumber={viewingDelivery.sourceNumber}
            parentEntity="quotation"
            parentEntityId={viewingDelivery.quotationId}
            onDeliveredChange={(next) => setViewingDelivery((prev) => (prev ? { ...prev, delivery: next } : prev))}
          />
        ) : null}
      </Modal>

      {attachingDeliveryQuotation && (
        <AttachDeliveryModal
          parentEntity="quotation"
          parentId={attachingDeliveryQuotation.id}
          customerName={attachingDeliveryQuotation.customerName}
          onClose={() => setAttachingDeliveryQuotation(null)}
          onAttached={() => {
            setAttachingDeliveryQuotation(null);
            showSuccessToast("Delivery attached");
            if (viewingQuotation?.id === attachingDeliveryQuotation.id) void refreshViewing(attachingDeliveryQuotation.id);
            void loadAll();
          }}
        />
      )}

      <Modal
        open={convertSaleOpen}
        onClose={closeConvert}
        title="Convert to Sale"
        description="Completes a retail sale now, using this quotation's quoted prices."
        widthClassName="max-w-lg"
      >
        <form onSubmit={submitConvertToSale}>
          {convertError && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {convertError}
            </div>
          )}

          {stockCheckLoading ? (
            <div className="flex min-h-[100px] items-center justify-center text-muted">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            </div>
          ) : (
            stockCheck && (
              <div className="space-y-2">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Live Stock Check</p>
                {stockCheck.map((item) => (
                  <div
                    key={item.productId}
                    className={cn(
                      "flex items-start justify-between gap-2 rounded-lg border px-3 py-2",
                      item.sufficient ? "border-line" : "border-danger/40 bg-danger-soft"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-bold leading-snug text-ink" title={item.productName}>
                        {item.productName}
                      </p>
                      <p className="text-[11px] font-semibold text-muted">
                        Requested {item.requestedQuantity} · Available {item.availableQuantity}
                        {!item.sufficient && " · Insufficient stock"}
                      </p>
                    </div>
                    {!item.sufficient && (
                      <input
                        type="number"
                        min={0}
                        max={item.availableQuantity}
                        value={quantityEdits[item.productId] ?? item.availableQuantity}
                        onChange={(event) =>
                          setQuantityEdits((prev) => ({ ...prev, [item.productId]: Number(event.target.value) }))
                        }
                        className="mt-0.5 h-8 w-16 flex-none rounded-md border border-danger/40 text-center text-xs font-bold outline-none focus:border-danger"
                      />
                    )}
                  </div>
                ))}
                {hasInsufficientStock && (
                  <p className="text-[11px] font-bold text-danger">
                    Adjust quantities to the available amount before completing the sale.
                  </p>
                )}
              </div>
            )
          )}

          <SelectField
            label="Payment Method"
            value={convertPaymentMethodId}
            onChange={setConvertPaymentMethodId}
            options={[
              { value: "", label: "Select payment method" },
              ...activePaymentMethods.map((method) => ({ value: method.id, label: method.name }))
            ]}
            className="mt-4"
          />
          {selectedConvertMethod?.requiresReference && (
            <Field
              label="Reference"
              value={convertPaymentReference}
              onChange={setConvertPaymentReference}
              placeholder="e.g. M-Pesa code, transaction ID"
              required
              className="mt-4"
            />
          )}
          <Field
            label="Amount Received (optional)"
            type="number"
            value={convertAmountReceived}
            onChange={setConvertAmountReceived}
            placeholder="0.00"
            className="mt-4"
          />

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button type="button" onClick={closeConvert} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={convertSaving || !convertPaymentMethodId || hasInsufficientStock}
              className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {convertSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {convertSaving ? "Converting..." : "Complete Sale"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={convertInvoiceOpen}
        onClose={closeConvert}
        title="Convert to Invoice"
        description="Creates an unpaid invoice using this quotation's quoted prices."
        widthClassName="max-w-lg"
      >
        <form onSubmit={submitConvertToInvoice}>
          {convertError && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {convertError}
            </div>
          )}

          {stockCheckLoading ? (
            <div className="flex min-h-[100px] items-center justify-center text-muted">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            </div>
          ) : (
            stockCheck && (
              <div className="space-y-2">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Live Stock Check</p>
                {stockCheck.map((item) => (
                  <div
                    key={item.productId}
                    className={cn(
                      "flex items-start justify-between gap-2 rounded-lg border px-3 py-2",
                      item.sufficient ? "border-line" : "border-danger/40 bg-danger-soft"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-bold leading-snug text-ink" title={item.productName}>
                        {item.productName}
                      </p>
                      <p className="text-[11px] font-semibold text-muted">
                        Requested {item.requestedQuantity} · Available {item.availableQuantity}
                        {!item.sufficient && " · Insufficient stock"}
                      </p>
                    </div>
                    {!item.sufficient && (
                      <input
                        type="number"
                        min={0}
                        max={item.availableQuantity}
                        value={quantityEdits[item.productId] ?? item.availableQuantity}
                        onChange={(event) =>
                          setQuantityEdits((prev) => ({ ...prev, [item.productId]: Number(event.target.value) }))
                        }
                        className="mt-0.5 h-8 w-16 flex-none rounded-md border border-danger/40 text-center text-xs font-bold outline-none focus:border-danger"
                      />
                    )}
                  </div>
                ))}
                {hasInsufficientStock && (
                  <p className="text-[11px] font-bold text-danger">
                    Adjust quantities to the available amount before completing the invoice.
                  </p>
                )}
              </div>
            )
          )}

          <Field label="Due Date" type="date" value={convertDueDate} onChange={setConvertDueDate} required className="mt-4" />

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button type="button" onClick={closeConvert} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={convertSaving || hasInsufficientStock}
              className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {convertSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {convertSaving ? "Converting..." : "Create Invoice"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={editingQuotationId ? "Edit Quotation" : "New Quotation"}
        description={
          editingQuotationId
            ? "Only available while this quotation is still a draft — items are re-priced from scratch on save."
            : "A price offer for a customer — nothing here affects stock or payments until it's converted."
        }
        widthClassName="max-w-2xl"
      >
        <form onSubmit={submitCreateQuotation}>
          {createError && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {createError}
            </div>
          )}

          {!editingQuotationId && session && !session.branch && (
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
            {createCustomerChosen ? (
              <div className="mt-1.5 flex items-center justify-between rounded-lg border border-line bg-soft px-3.5 py-2.5">
                <div>
                  <p className="text-sm font-extrabold text-ink">{selectedCreateCustomer ? selectedCreateCustomer.name : "Walk-in Customer"}</p>
                  {selectedCreateCustomer && <p className="text-[11px] font-semibold text-muted">{selectedCreateCustomer.phone}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCreateCustomerId(null);
                    setCreateCustomerChosen(false);
                  }}
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
                  placeholder="Search by name or phone — or keep it as a walk-in quotation."
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
                <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-line bg-white shadow-soft">
                  <button
                    type="button"
                    onClick={() => {
                      setCreateCustomerId(null);
                      setCreateCustomerChosen(true);
                      setCustomerSearch("");
                    }}
                    className="flex w-full items-center px-3.5 py-2 text-left text-sm font-extrabold text-teal hover:bg-teal/10 cursor-pointer"
                  >
                    Walk-in Customer
                  </button>
                  {filteredCustomers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => {
                        setCreateCustomerId(customer.id);
                        setCreateCustomerChosen(true);
                        setCustomerSearch("");
                      }}
                      className="flex w-full items-center justify-between border-t border-line px-3.5 py-2 text-left text-sm hover:bg-soft cursor-pointer"
                    >
                      <span className="font-bold text-ink">{customer.name}</span>
                      <span className="text-xs font-semibold text-muted">{customer.phone}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Field label="Valid Until" type="date" value={createValidUntil} onChange={setCreateValidUntil} required className="mt-4" />

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Products</span>
              <button
                type="button"
                onClick={() => {
                  // Without a storefront, the popup has nowhere to seed opening stock — its own
                  // Stock Quantity field just silently doesn't render (see
                  // QuickCreateProductModal's storefrontId prop). Same guard/message as
                  // submitting the quotation itself (below), just earlier.
                  if (session && !session.branch && !createStorefrontId) {
                    setCreateError("Choose a storefront above before adding a new product");
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
                        title="Override this line's unit price for this quotation only — the product's own price is never changed"
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
                          value={fromCents(line.discountAmountCents) || "0.00"}
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
                          Cost paid
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

          <TextAreaField label="Notes" value={createNotes} onChange={setCreateNotes} className="mt-4" rows={2} />

          <div className="mt-4">
            <CheckboxField
              label="Include tax information"
              description="Shows the Tax Breakdown section on this quotation's print, download, and share — can still be changed later from the quotation's own detail view"
              checked={createIncludeTaxBreakdown}
              onChange={setCreateIncludeTaxBreakdown}
            />
          </div>

          <div className="mt-4">
            <CheckboxField
              label="Include storefront information"
              description="Shows the shop name, logo, address, contacts and header/footer text on this quotation — can still be changed later from the quotation's own detail view"
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
            <Button type="button" onClick={() => setCreateOpen(false)} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
              Cancel
            </Button>
            <Button type="submit" disabled={createSaving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
              {createSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {editingQuotationId ? (createSaving ? "Saving..." : "Save Changes") : createSaving ? "Creating..." : "Create Quotation"}
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
          setCreateCustomerChosen(true);
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
