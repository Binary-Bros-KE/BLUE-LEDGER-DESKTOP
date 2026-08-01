import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  Minus,
  Package,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Smartphone,
  Store,
  Trash2,
  UserRound,
  XCircle
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { useConfirm } from "@renderer/shared/components/ConfirmModal";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { DeliveryNotePreview } from "@renderer/shared/components/DeliveryNotePreview";
import {
  ExtraChargesSection,
  type DeliveryDraft,
  type ServiceChargeDraft
} from "@renderer/shared/components/ExtraChargesSection";
import { Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { ProductInfoModal } from "@renderer/shared/components/ProductInfoModal";
import { QuickCreateCustomerModal } from "@renderer/shared/components/QuickCreateCustomerModal";
import { ReceiptPreview } from "@renderer/shared/components/ReceiptPreview";
import { StampBadge } from "@renderer/shared/components/StampBadge";
import { StorefrontPicker } from "@renderer/shared/components/StorefrontPicker";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { computeLinePricing, type LinePricing } from "@renderer/shared/lib/cart-pricing";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { useAppStore } from "@renderer/shared/stores/app-store";
import type { Customer } from "@shared/types/customer";
import type { LocationStockLevel } from "@shared/types/inventory";
import type { MpesaTransactionStatus } from "@shared/types/mpesa";
import type { PaymentMethod } from "@shared/types/payment-method";
import type { ProductListItem } from "@shared/types/product";
import type { Sale } from "@shared/types/sale";

type CartLine = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  /** Raw text the cashier typed (currency units, e.g. "250.00"), not cents — converted only at the
   * pricing/submission boundary, so the input never fights the user mid-type. */
  discount: string;
};

type DraftStatus = "draft" | "suspended";

type OpenSaleDraft = {
  key: string;
  dbSaleId: string | null;
  displayNumber: number;
  status: DraftStatus;
  customerId: string | null;
  notes: string;
  items: CartLine[];
  serviceCharges: ServiceChargeDraft[];
  delivery: DeliveryDraft | null;
  createdAt: number;
};

/** SERVER's own `message` field is a short, stable label (used elsewhere/kept simple on purpose) —
 * this screen shows the cashier something more actionable instead. Frontend-only by design; SERVER's
 * wording is untouched. */
const MPESA_FRIENDLY_MESSAGES: Record<MpesaTransactionStatus, string> = {
  pending: "Waiting for the customer to enter their M-Pesa PIN...",
  success: "Payment completed successfully.",
  insufficient: "The customer has insufficient M-Pesa balance to complete this transaction.",
  cancelled: "The customer cancelled the payment request on their phone.",
  wrong_pin: "The customer entered an incorrect M-Pesa PIN. Please try again.",
  timeout: "Request timed out — please re-initiate the STK push and ask the customer to respond quicker.",
  failed: "The payment could not be completed. Please try again."
};

function mpesaFriendlyMessage(status: MpesaTransactionStatus): string {
  return MPESA_FRIENDLY_MESSAGES[status];
}

const BARCODE_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(90deg, var(--color-ink) 0px, var(--color-ink) 2px, transparent 2px, transparent 5px)"
};

export function CheckoutRoute(): React.JSX.Element {
  const currency = useAppStore((state) => state.context?.tenant.currency ?? "");
  const tenantContext = useAppStore((state) => state.context?.tenant ?? null);
  const { can, session } = usePermissions();
  const canDeletePending = can("sales", "delete");
  const confirm = useConfirm();

  const [products, setProducts] = useState<ProductListItem[] | null>(null);
  const [stockLevels, setStockLevels] = useState<LocationStockLevel[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [autoPrintOnSale, setAutoPrintOnSale] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");

  const [openSales, setOpenSales] = useState<OpenSaleDraft[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const ticketCounterRef = useRef(Math.floor(1000 + Math.random() * 8999));

  const [suspending, setSuspending] = useState(false);
  const [completing, setCompleting] = useState(false);

  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [amountReceived, setAmountReceived] = useState("");

  const [mpesaConfigured, setMpesaConfigured] = useState(false);
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [mpesaState, setMpesaState] = useState<"idle" | "sending" | "awaiting" | "success" | "error">("idle");
  const [mpesaMessage, setMpesaMessage] = useState<string | null>(null);
  const [mpesaCheckoutRequestId, setMpesaCheckoutRequestId] = useState<string | null>(null);
  const [mpesaManualChecking, setMpesaManualChecking] = useState(false);

  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [quickCreateCustomerOpen, setQuickCreateCustomerOpen] = useState(false);

  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [showDeliveryNote, setShowDeliveryNote] = useState(false);
  // Only ever consulted when session.branch is null (see StorefrontPicker/requireActiveSession) —
  // otherwise the backend always uses the assigned branch regardless of this value.
  const [storefrontId, setStorefrontId] = useState("");

  const branchId = session?.branch?.id ?? null;
  // Same fallback the rest of checkout already uses for a session with no assigned branch — the
  // cashier's StorefrontPicker choice below stands in for it.
  const effectiveLocationId = branchId ?? (storefrontId || null);

  useEffect(() => {
    void (async () => {
      setLoadError(null);
      try {
        const [productList, customerList, methodList, pendingList, printerSettings] = await Promise.all([
          window.blueLedger.product.list(),
          window.blueLedger.customer.list(),
          window.blueLedger.paymentMethod.list(),
          window.blueLedger.sale.listPending(),
          window.blueLedger.printer.getSettings().catch(() => null)
        ]);
        setProducts(productList);
        setCustomers(customerList);
        setPaymentMethods(methodList);
        setAutoPrintOnSale(printerSettings?.enabled === true && printerSettings.autoPrintOnSale === true);

        const drafts = await Promise.all(
          pendingList.map(async (pending) => {
            const full = await window.blueLedger.sale.get(pending.id);
            const draft: OpenSaleDraft = {
              key: `db_${full.id}`,
              dbSaleId: full.id,
              displayNumber: ticketCounterRef.current++,
              status: "suspended",
              customerId: full.customerId,
              notes: full.notes ?? "",
              items: full.items.map((item) => ({
                productId: item.productId,
                name: item.productName,
                sku: item.sku,
                quantity: item.quantity,
                discount: fromCents(item.discountAmountCents)
              })),
              serviceCharges: full.serviceCharges.map((charge) => ({
                key: charge.id,
                name: charge.name,
                fee: fromCents(charge.feeCents),
                cost: fromCents(charge.costCents)
              })),
              delivery: full.delivery
                ? {
                    riderId: full.delivery.riderId,
                    recipientName: full.delivery.recipientName,
                    country: full.delivery.country ?? "",
                    town: full.delivery.town ?? "",
                    physicalAddress: full.delivery.physicalAddress,
                    notes: full.delivery.notes ?? "",
                    fee: fromCents(full.delivery.feeCents),
                    cost: fromCents(full.delivery.costCents)
                  }
                : null,
              createdAt: new Date(full.createdAt).getTime()
            };
            return draft;
          })
        );
        setOpenSales(drafts);
      } catch (err) {
        setLoadError(getErrorMessage(err, "Failed to load the POS screen"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!effectiveLocationId) {
      setStockLevels([]);
      return;
    }
    void window.blueLedger.inventory.listForLocation(effectiveLocationId).then(setStockLevels);
  }, [effectiveLocationId]);

  // Cheap, secret-free check — decides whether the STK push flow even appears for this storefront's
  // payment section. Re-checked whenever the effective storefront changes (assigned branch, or the
  // one chosen via StorefrontPicker for a session with none).
  useEffect(() => {
    if (!effectiveLocationId) {
      setMpesaConfigured(false);
      return;
    }
    let cancelled = false;
    void window.blueLedger.mpesa
      .isConfigured(effectiveLocationId)
      .then((result) => {
        if (!cancelled) setMpesaConfigured(result.configured);
      })
      .catch(() => {
        if (!cancelled) setMpesaConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveLocationId]);

  useEffect(() => {
    setPaymentMethodId("");
    setPaymentReference("");
    setAmountReceived("");
  }, [activeKey]);

  const stockByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const level of stockLevels) map.set(level.productId, level.quantity);
    return map;
  }, [stockLevels]);

  const productById = useMemo(() => {
    const map = new Map<string, ProductListItem>();
    for (const product of products ?? []) map.set(product.id, product);
    return map;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const active = (products ?? []).filter((product) => product.status === "active");
    const term = searchTerm.trim().toLowerCase();
    if (!term) return active;
    return active.filter((product) => {
      const haystack = `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [products, searchTerm]);

  function computeDraftTotals(
    items: CartLine[],
    serviceCharges: ServiceChargeDraft[],
    delivery: DeliveryDraft | null
  ): {
    lines: Array<{ line: CartLine; product: ProductListItem; pricing: LinePricing }>;
    subtotalCents: number;
    discountAmountCents: number;
    taxAmountCents: number;
    serviceChargesFeeCents: number;
    deliveryFeeCents: number;
    grandTotalCents: number;
  } {
    let subtotalCents = 0;
    let discountAmountCents = 0;
    let taxAmountCents = 0;
    const lines: Array<{ line: CartLine; product: ProductListItem; pricing: LinePricing }> = [];

    for (const line of items) {
      const product = productById.get(line.productId);
      if (!product) continue;
      const pricing = computeLinePricing(product, line.quantity, toCents(line.discount));
      subtotalCents += pricing.lineSubtotalCents;
      discountAmountCents += pricing.discountAmountCents;
      taxAmountCents += pricing.taxCents;
      lines.push({ line, product, pricing });
    }

    const serviceChargesFeeCents = serviceCharges.reduce((sum, charge) => sum + toCents(charge.fee), 0);
    const deliveryFeeCents = delivery ? toCents(delivery.fee) : 0;

    return {
      lines,
      subtotalCents,
      discountAmountCents,
      taxAmountCents,
      serviceChargesFeeCents,
      deliveryFeeCents,
      grandTotalCents: subtotalCents - discountAmountCents + taxAmountCents + serviceChargesFeeCents + deliveryFeeCents
    };
  }

  const sortedOpenSales = useMemo(() => [...openSales].sort((a, b) => b.createdAt - a.createdAt), [openSales]);
  const activeDraft = openSales.find((draft) => draft.key === activeKey) ?? null;
  const activeTotals = activeDraft
    ? computeDraftTotals(activeDraft.items, activeDraft.serviceCharges, activeDraft.delivery)
    : null;

  const activePaymentMethods = useMemo(
    () => paymentMethods.filter((method) => method.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [paymentMethods]
  );
  const selectedPaymentMethod = activePaymentMethods.find((method) => method.id === paymentMethodId) ?? null;

  // Resets the STK flow every time the payment method (or active draft) changes, so switching away
  // from M-Pesa and back never carries over a stale checkoutRequestId from a previous attempt.
  // Prefills the phone from the selected customer's own record as a convenience, same spirit as
  // customerLabel defaulting to "Walk-in Customer".
  useEffect(() => {
    setMpesaState("idle");
    setMpesaMessage(null);
    setMpesaCheckoutRequestId(null);
    setMpesaManualChecking(false);
    if (selectedPaymentMethod?.code === "MPESA" && activeDraft?.customerId) {
      setMpesaPhone(customers.find((customer) => customer.id === activeDraft.customerId)?.phone ?? "");
    } else {
      setMpesaPhone("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethodId, activeKey]);

  // Passive auto-poll while showing "waiting for customer to enter PIN" — reads ONLY the
  // transaction's own current status as already written by SERVER's Safaricom callback. Deliberately
  // NEVER triggers an active Safaricom query itself (that's the separate, explicit "Check Status Now"
  // action below) — the callback is the source of truth; this just watches for it to land. Runs
  // indefinitely while awaiting since a passive DB read is cheap and harmless to keep polling.
  useEffect(() => {
    if (mpesaState !== "awaiting" || !mpesaCheckoutRequestId) return;
    const POLL_INTERVAL_MS = 3_000;
    let cancelled = false;
    const checkoutRequestId = mpesaCheckoutRequestId;
    const interval = setInterval(() => {
      void window.blueLedger.mpesa
        .getStkStatus(checkoutRequestId)
        .then((result) => {
          if (cancelled || result.status === "pending") return;
          if (result.status === "success") {
            setMpesaState("success");
            setMpesaMessage(mpesaFriendlyMessage(result.status));
            if (result.mpesaReceiptNumber) setPaymentReference(result.mpesaReceiptNumber);
          } else {
            setMpesaState("error");
            setMpesaMessage(mpesaFriendlyMessage(result.status));
          }
        })
        .catch(() => {
          // A transient network hiccup between this device and SERVER — try again next tick rather
          // than ending the flow on one failed poll (the customer may still be entering their PIN).
        });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mpesaState, mpesaCheckoutRequestId]);

  /** The explicit "STK is taking a while" recovery action — actively asks SERVER to re-query
   * Safaricom directly (throttled server-side), rather than just waiting on the callback. Only ever
   * called from a deliberate cashier click, never automatically. */
  async function handleCheckStatusNow(): Promise<void> {
    if (!mpesaCheckoutRequestId) return;
    setMpesaManualChecking(true);
    try {
      const result = await window.blueLedger.mpesa.checkStkStatus(mpesaCheckoutRequestId);
      if (result.status === "success") {
        setMpesaState("success");
        setMpesaMessage(mpesaFriendlyMessage(result.status));
        if (result.mpesaReceiptNumber) setPaymentReference(result.mpesaReceiptNumber);
      } else if (result.status !== "pending") {
        setMpesaState("error");
        setMpesaMessage(mpesaFriendlyMessage(result.status));
      }
      // Still "pending" — stay in "awaiting", nothing to change; the passive poll keeps watching.
    } catch (err) {
      setMpesaMessage(getErrorMessage(err, "Failed to check payment status"));
    } finally {
      setMpesaManualChecking(false);
    }
  }

  async function handleSendStkPush(): Promise<void> {
    if (!effectiveLocationId || !activeTotals) return;
    const phone = mpesaPhone.trim();
    if (phone.length < 9) {
      setMpesaState("error");
      setMpesaMessage("Enter a valid phone number");
      return;
    }
    setMpesaState("sending");
    setMpesaMessage(null);
    try {
      const result = await window.blueLedger.mpesa.sendStkPush({
        locationId: effectiveLocationId,
        phone,
        amountCents: activeTotals.grandTotalCents
      });
      setMpesaCheckoutRequestId(result.checkoutRequestId);
      setMpesaState("awaiting");
      setMpesaMessage("STK push sent — waiting for the customer to enter their PIN...");
    } catch (err) {
      setMpesaState("error");
      setMpesaMessage(getErrorMessage(err, "Failed to send STK push"));
    }
  }

  const filteredCustomerResults = useMemo(() => {
    const active = customers.filter((customer) => customer.status === "active");
    const term = customerSearch.trim().toLowerCase();
    if (!term) return active.slice(0, 30);
    return active
      .filter((customer) => `${customer.name} ${customer.phone} ${customer.customerCode}`.toLowerCase().includes(term))
      .slice(0, 30);
  }, [customers, customerSearch]);

  function customerLabel(customerId: string | null): string {
    if (!customerId) return "Walk-in Customer";
    return customers.find((customer) => customer.id === customerId)?.name ?? "Walk-in Customer";
  }

  function createDraft(): OpenSaleDraft {
    const displayNumber = ticketCounterRef.current;
    ticketCounterRef.current += 1;
    return {
      key: `draft_${crypto.randomUUID()}`,
      dbSaleId: null,
      displayNumber,
      status: "draft",
      customerId: null,
      notes: "",
      items: [],
      serviceCharges: [],
      delivery: null,
      createdAt: Date.now()
    };
  }

  function withProductAdded(draft: OpenSaleDraft, product: ProductListItem): OpenSaleDraft {
    const existing = draft.items.find((line) => line.productId === product.id);
    const items = existing
      ? draft.items.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line
        )
      : [
          ...draft.items,
          { productId: product.id, name: product.name, sku: product.sku, quantity: 1, discount: "0.00" }
        ];
    return { ...draft, items };
  }

  function addToCart(product: ProductListItem): void {
    const existingDraft = openSales.find((draft) => draft.key === activeKey);
    if (existingDraft) {
      setOpenSales((prev) =>
        prev.map((draft) => (draft.key === activeKey ? withProductAdded(draft, product) : draft))
      );
      return;
    }
    const draft = withProductAdded(createDraft(), product);
    setOpenSales((prev) => [draft, ...prev]);
    setActiveKey(draft.key);
  }

  /** A barcode scanner is just a keyboard that types fast and finishes with Enter — no special
   * detection is needed as long as this field stays focused (it already auto-focuses). Enter either
   * resolves an exact SKU/barcode match or, for a typed search narrowed to one product, adds that —
   * then clears the field so the next scan lands on a clean input. */
  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const term = searchTerm.trim().toLowerCase();
    if (!term) return;

    const exactMatch = filteredProducts.find(
      (product) => product.sku.toLowerCase() === term || (product.barcode ?? "").toLowerCase() === term
    );
    const target = exactMatch ?? (filteredProducts.length === 1 ? filteredProducts[0] : null);

    if (!target) {
      showErrorToast(`No product found for "${searchTerm.trim()}"`);
      return;
    }
    addToCart(target);
    setSearchTerm("");
  }

  function updateActiveItems(updater: (items: CartLine[]) => CartLine[]): void {
    if (!activeKey) return;
    setOpenSales((prev) =>
      prev.map((draft) => (draft.key === activeKey ? { ...draft, items: updater(draft.items) } : draft))
    );
  }

  function updateQuantity(productId: string, quantity: number): void {
    const nextQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
    updateActiveItems((items) =>
      items.map((line) => (line.productId === productId ? { ...line, quantity: nextQuantity } : line))
    );
  }

  function updateDiscount(productId: string, value: string): void {
    updateActiveItems((items) =>
      items.map((line) => (line.productId === productId ? { ...line, discount: value } : line))
    );
  }

  function removeLine(productId: string): void {
    updateActiveItems((items) => items.filter((line) => line.productId !== productId));
  }

  function updateActiveNotes(value: string): void {
    if (!activeKey) return;
    setOpenSales((prev) => prev.map((draft) => (draft.key === activeKey ? { ...draft, notes: value } : draft)));
  }

  function updateActiveServiceCharges(next: ServiceChargeDraft[]): void {
    if (!activeKey) return;
    setOpenSales((prev) =>
      prev.map((draft) => (draft.key === activeKey ? { ...draft, serviceCharges: next } : draft))
    );
  }

  function updateActiveDelivery(next: DeliveryDraft | null): void {
    if (!activeKey) return;
    setOpenSales((prev) => prev.map((draft) => (draft.key === activeKey ? { ...draft, delivery: next } : draft)));
  }

  function selectCustomerForActiveDraft(customerId: string | null): void {
    if (!activeKey) return;
    setOpenSales((prev) => prev.map((draft) => (draft.key === activeKey ? { ...draft, customerId } : draft)));
    setCustomerPickerOpen(false);
    setCustomerSearch("");
  }

  function buildExtrasPayload(draft: OpenSaleDraft): {
    serviceCharges: Array<{ name: string; feeCents: number; costCents: number }>;
    delivery: {
      riderId: string | null;
      recipientName: string;
      country: string;
      town: string;
      physicalAddress: string;
      notes: string;
      feeCents: number;
      costCents: number;
    } | null;
  } {
    return {
      serviceCharges: draft.serviceCharges.map((charge) => ({
        name: charge.name,
        feeCents: toCents(charge.fee),
        costCents: toCents(charge.cost)
      })),
      delivery: draft.delivery
        ? {
            riderId: draft.delivery.riderId,
            recipientName: draft.delivery.recipientName,
            country: draft.delivery.country,
            town: draft.delivery.town,
            physicalAddress: draft.delivery.physicalAddress,
            notes: draft.delivery.notes,
            feeCents: toCents(draft.delivery.fee),
            costCents: toCents(draft.delivery.cost)
          }
        : null
    };
  }

  function handleNewSale(): void {
    const draft = createDraft();
    setOpenSales((prev) => [draft, ...prev]);
    setActiveKey(draft.key);
  }

  async function handleDeleteDraft(draft: OpenSaleDraft): Promise<void> {
    const confirmed = await confirm({
      title: "Delete this sale?",
      message: "This can't be undone.",
      tone: "danger",
      confirmLabel: "Delete"
    });
    if (!confirmed) return;
    setActionError(null);
    try {
      if (draft.dbSaleId) {
        await window.blueLedger.sale.deletePending(draft.dbSaleId);
      }
      setOpenSales((prev) => prev.filter((entry) => entry.key !== draft.key));
      if (activeKey === draft.key) setActiveKey(null);
      showSuccessToast("Sale deleted");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to delete sale");
      setActionError(message);
      showErrorToast(message);
    }
  }

  async function handleSuspend(): Promise<void> {
    if (!activeDraft || activeDraft.items.length === 0) return;
    if (session && !session.branch && !storefrontId) {
      setActionError("Choose a storefront before holding this sale.");
      return;
    }
    setSuspending(true);
    setActionError(null);
    try {
      const result = await window.blueLedger.sale.suspend({
        resumeSaleId: activeDraft.dbSaleId,
        customerId: activeDraft.customerId,
        notes: activeDraft.notes,
        items: activeDraft.items.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          discountAmountCents: toCents(line.discount)
        })),
        ...buildExtrasPayload(activeDraft),
        locationId: session && !session.branch ? storefrontId : undefined
      });
      const suspendedKey = activeDraft.key;
      setOpenSales((prev) =>
        prev.map((draft) =>
          draft.key === suspendedKey ? { ...draft, key: `db_${result.id}`, dbSaleId: result.id, status: "suspended" } : draft
        )
      );
      setActiveKey(null);
      showSuccessToast("Sale held");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to suspend sale");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setSuspending(false);
    }
  }

  async function handleComplete(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!activeDraft) return;
    if (session && !session.branch && !storefrontId) {
      setActionError("Choose a storefront before completing this sale.");
      return;
    }
    setCompleting(true);
    setActionError(null);
    try {
      const sale = await window.blueLedger.sale.complete({
        resumeSaleId: activeDraft.dbSaleId,
        customerId: activeDraft.customerId,
        notes: activeDraft.notes,
        items: activeDraft.items.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          discountAmountCents: toCents(line.discount)
        })),
        ...buildExtrasPayload(activeDraft),
        paymentMethodId,
        paymentReference,
        amountReceivedCents: amountReceived.trim() === "" ? null : toCents(amountReceived),
        locationId: session && !session.branch ? storefrontId : undefined
      });
      const completedKey = activeDraft.key;
      setOpenSales((prev) => prev.filter((draft) => draft.key !== completedKey));
      setActiveKey(null);
      setCompletedSale(sale);
      setShowDeliveryNote(false);
      if (effectiveLocationId) void window.blueLedger.inventory.listForLocation(effectiveLocationId).then(setStockLevels);
      showSuccessToast(`Sale completed — ${sale.receiptNumber ?? formatCents(sale.grandTotalCents)}`);
      if (autoPrintOnSale) {
        void window.blueLedger.printer.printReceipt(sale.id).then((result) => {
          if (!result.success) showErrorToast(`Auto-print failed: ${result.message}`);
        });
      }
    } catch (err) {
      const message = getErrorMessage(err, "Failed to complete sale");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setCompleting(false);
    }
  }

  const amountReceivedCents = amountReceived.trim() === "" ? null : toCents(amountReceived);
  const changeDueCents =
    activeTotals && amountReceivedCents !== null ? amountReceivedCents - activeTotals.grandTotalCents : null;

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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Checkout</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <ShoppingCart className="size-5 text-primary" aria-hidden="true" />
              Point of Sale
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-muted">
              <span className="inline-flex items-center gap-1">
                <Store className="size-3.5 text-primary" aria-hidden="true" />
                {session?.branch?.locationName ?? "No branch assigned"}
              </span>
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3.5 text-primary" aria-hidden="true" />
                {session?.employee.firstName} {session?.employee.lastName}
              </span>
            </p>
          </div>
        </div>

        {session && !session.branch && (
          <div className="mt-4">
            <StorefrontPicker value={storefrontId} onChange={setStorefrontId} />
          </div>
        )}

        {(loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? actionError}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_420px]">
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <label className="block">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
              Search Products
            </span>
            <div className="relative mt-1.5">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="text"
                autoFocus
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Scan a barcode, or search by SKU / name"
                className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>
          </label>

          <div className="mt-4 grid max-h-[640px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
            {products === null ? (
              <div className="col-span-full flex min-h-[200px] items-center justify-center text-muted">
                <Loader2 className="size-6 animate-spin" aria-hidden="true" />
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="col-span-full flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-8 text-center">
                <Search className="size-6 text-muted" aria-hidden="true" />
                <p className="mt-3 text-sm font-bold text-ink">No products match your search</p>
              </div>
            ) : (
              filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  currency={currency}
                  stock={stockByProductId.get(product.id) ?? 0}
                  onAdd={() => addToCart(product)}
                />
              ))
            )}
          </div>
        </section>

        <div className="space-y-3">
          <Button type="button" onClick={handleNewSale} className="h-10 w-full text-xs">
            <Plus className="mr-1.5 size-4" aria-hidden="true" />
            New Sale
          </Button>

          {sortedOpenSales.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-8 text-center">
              <ShoppingCart className="size-6 text-muted" aria-hidden="true" />
              <p className="mt-3 text-sm font-bold text-ink">No open sales</p>
              <p className="mt-1 text-xs font-semibold text-muted">
                Start a new sale, or add a product to begin one automatically.
              </p>
            </div>
          ) : (
            sortedOpenSales.map((draft) => {
              const isActive = draft.key === activeKey;
              const totals = isActive
                ? activeTotals!
                : computeDraftTotals(draft.items, draft.serviceCharges, draft.delivery);
              const canRemove = draft.status === "draft" || canDeletePending;

              if (!isActive) {
                return (
                  <div
                    key={draft.key}
                    onClick={() => setActiveKey(draft.key)}
                    className="cursor-pointer rounded-xl border border-line bg-white p-3.5 shadow-soft transition hover:border-accent"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-extrabold text-ink">
                          #{draft.displayNumber} · {customerLabel(draft.customerId)}
                        </p>
                        <p className="text-[11px] font-semibold text-muted">
                          {draft.items.length} item{draft.items.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        {draft.status === "suspended" && <DashedPill tone="warning">Held</DashedPill>}
                        <span className="text-sm font-extrabold tabular-nums text-ink">
                          {formatCents(totals.grandTotalCents)}
                        </span>
                        {canRemove && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteDraft(draft);
                            }}
                            aria-label="Delete sale"
                            className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <form
                  key={draft.key}
                  onSubmit={handleComplete}
                  className="rounded-xl border-2 border-primary bg-white p-4 shadow-soft"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">
                        Current Sale · #{draft.displayNumber}
                      </p>
                      <button
                        type="button"
                        onClick={() => setCustomerPickerOpen(true)}
                        className="mt-1 flex items-center gap-1.5 text-sm font-extrabold text-ink transition hover:text-primary cursor-pointer"
                      >
                        <UserRound className="size-4 text-primary" aria-hidden="true" />
                        {customerLabel(draft.customerId)}
                        <ChevronDown className="size-3.5 text-muted" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      <StampBadge
                        label={draft.status === "suspended" ? "Held" : "Open"}
                        sublabel="Sale"
                        tone={draft.status === "suspended" ? "warning" : "success"}
                        className="w-16"
                      />
                      {canRemove && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteDraft(draft)}
                          aria-label="Delete sale"
                          className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 max-h-[260px] space-y-2 overflow-y-auto pr-1">
                    {totals.lines.length === 0 ? (
                      <div className="flex min-h-[100px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-6 text-center">
                        <p className="text-xs font-bold text-muted">Search and add products to this sale</p>
                      </div>
                    ) : (
                      totals.lines.map(({ line, product, pricing }) => (
                        <div key={line.productId} className="rounded-lg border border-line p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-extrabold text-ink">{line.name}</p>
                              <p className="text-[11px] font-semibold tabular-nums text-muted">
                                {line.quantity} × {formatCents(pricing.unitPriceCents)}
                              </p>
                            </div>
                            <div className="flex-none text-right">
                              <p className="text-sm font-extrabold tabular-nums text-ink">
                                {formatCents(pricing.lineTotalCents)}
                              </p>
                              <DashedPill
                                tone={pricing.unitPriceCents === product.sellingPriceCents ? "neutral" : "accent"}
                                className="mt-0.5"
                              >
                                {pricing.unitPriceCents === product.sellingPriceCents ? "Unit Rate" : "Bulk Rate"}
                              </DashedPill>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => updateQuantity(line.productId, line.quantity - 1)}
                                disabled={line.quantity <= 1}
                                className="grid size-7 place-items-center rounded-md border border-line text-muted transition hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                              >
                                <Minus className="size-3" aria-hidden="true" />
                              </button>
                              <input
                                type="number"
                                min={1}
                                value={line.quantity}
                                onChange={(event) => updateQuantity(line.productId, Number(event.target.value))}
                                className="h-7 w-12 rounded-md border border-line text-center text-xs font-bold outline-none focus:border-accent"
                              />
                              <button
                                type="button"
                                onClick={() => updateQuantity(line.productId, line.quantity + 1)}
                                className="grid size-7 place-items-center rounded-md border border-line text-muted transition hover:bg-soft cursor-pointer"
                              >
                                <Plus className="size-3" aria-hidden="true" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 text-[10px] font-bold text-muted">
                                Disc.
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={line.discount}
                                  onChange={(event) => updateDiscount(line.productId, event.target.value)}
                                  className="h-7 w-16 rounded-md border border-line px-1.5 text-right text-xs font-semibold outline-none focus:border-accent"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => removeLine(line.productId)}
                                aria-label={`Remove ${line.name}`}
                                className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <TextAreaField
                    label="Notes"
                    value={draft.notes}
                    onChange={updateActiveNotes}
                    placeholder="Optional note for this sale"
                    rows={2}
                    className="mt-3"
                  />

                  {isActive && (
                    <ExtraChargesSection
                      serviceCharges={draft.serviceCharges}
                      onServiceChargesChange={updateActiveServiceCharges}
                      delivery={draft.delivery}
                      onDeliveryChange={updateActiveDelivery}
                      customerName={draft.customerId ? customerLabel(draft.customerId) : ""}
                    />
                  )}

                  <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                    <div className="flex items-center justify-between text-muted">
                      <span className="font-semibold">Subtotal</span>
                      <span className="font-bold tabular-nums">{formatCents(totals.subtotalCents)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted">
                      <span className="font-semibold">Discount</span>
                      <span className="font-bold tabular-nums">-{formatCents(totals.discountAmountCents)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted">
                      <span className="font-semibold">Tax</span>
                      <span className="font-bold tabular-nums">{formatCents(totals.taxAmountCents)}</span>
                    </div>
                    {totals.serviceChargesFeeCents > 0 && (
                      <div className="flex items-center justify-between text-muted">
                        <span className="font-semibold">Service Charges</span>
                        <span className="font-bold tabular-nums">{formatCents(totals.serviceChargesFeeCents)}</span>
                      </div>
                    )}
                    {totals.deliveryFeeCents > 0 && (
                      <div className="flex items-center justify-between text-muted">
                        <span className="font-semibold">Delivery Fee</span>
                        <span className="font-bold tabular-nums">{formatCents(totals.deliveryFeeCents)}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">
                      Payment Method
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {activePaymentMethods.map((method) => (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => setPaymentMethodId(method.id)}
                          className={cn(
                            "h-9 rounded-lg border px-3.5 text-xs font-extrabold transition cursor-pointer",
                            paymentMethodId === method.id
                              ? "border-teal bg-teal text-white"
                              : "border-line bg-white text-ink hover:bg-soft"
                          )}
                        >
                          {method.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedPaymentMethod?.code === "MPESA" && mpesaConfigured && (
                    <div className="mt-3 rounded-lg border border-line bg-soft/60 p-3">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">
                        M-Pesa STK Push
                      </p>
                      {(mpesaState === "idle" || mpesaState === "error") && (
                        <div className="mt-2 flex items-end gap-2">
                          <Field
                            label="Phone Number"
                            value={mpesaPhone}
                            onChange={setMpesaPhone}
                            placeholder="e.g. 0712 345 678"
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            onClick={() => void handleSendStkPush()}
                            disabled={!mpesaPhone.trim() || totals.lines.length === 0}
                            className="h-10 shrink-0 bg-teal text-xs hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Smartphone className="mr-1.5 size-3.5" aria-hidden="true" />
                            Send STK Push
                          </Button>
                        </div>
                      )}
                      {mpesaState === "sending" && (
                        <div className="mt-2 flex items-center gap-2 text-sm font-bold text-muted">
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          Sending STK push...
                        </div>
                      )}
                      {mpesaState === "awaiting" && (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center gap-2 text-sm font-bold text-teal">
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            Waiting for customer to enter PIN...
                          </div>
                          <Button
                            type="button"
                            onClick={() => void handleCheckStatusNow()}
                            disabled={mpesaManualChecking}
                            className="h-8 border border-line bg-white px-2.5 text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {mpesaManualChecking ? (
                              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                            )}
                            {mpesaManualChecking ? "Checking..." : "Taking long? Check Status Now"}
                          </Button>
                        </div>
                      )}
                      {mpesaState === "success" && (
                        <div className="mt-2 flex items-center gap-2 text-sm font-extrabold text-success">
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                          {mpesaMessage ?? "Payment successful"}
                        </div>
                      )}
                      {mpesaState === "error" && mpesaMessage && (
                        <div className="mt-2 flex items-center gap-2 text-sm font-bold text-danger">
                          <XCircle className="size-4 flex-none" aria-hidden="true" />
                          {mpesaMessage}
                        </div>
                      )}
                    </div>
                  )}

                  {selectedPaymentMethod?.requiresReference && (
                    <Field
                      label="Reference"
                      value={paymentReference}
                      onChange={setPaymentReference}
                      placeholder="e.g. M-Pesa code, transaction ID"
                      required
                      className="mt-3"
                    />
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field
                      label="Amount Received"
                      type="number"
                      value={amountReceived}
                      onChange={setAmountReceived}
                      placeholder={fromCents(totals.grandTotalCents)}
                    />
                    <div>
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                        Change Due
                      </span>
                      <div
                        className={cn(
                          "mt-1.5 flex h-10 items-center rounded-lg border border-line bg-soft px-3 text-sm font-bold",
                          changeDueCents !== null && changeDueCents < 0 ? "text-danger" : "text-ink"
                        )}
                      >
                        {changeDueCents === null ? "—" : formatCents(changeDueCents)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between rounded-lg bg-ink px-4 py-3">
                    <span className="text-xs font-extrabold uppercase tracking-wide text-white/70">
                      Total Due
                    </span>
                    <span className="text-xl font-extrabold text-white">
                      {formatCents(totals.grandTotalCents)}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      onClick={() => void handleSuspend()}
                      disabled={totals.lines.length === 0 || suspending}
                      className="h-10 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {suspending ? (
                        <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <PauseCircle className="mr-1.5 size-4" aria-hidden="true" />
                      )}
                      Suspend
                    </Button>
                    <Button
                      type="submit"
                      disabled={totals.lines.length === 0 || completing || !paymentMethodId}
                      className="h-10 bg-teal text-xs hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {completing ? (
                        <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        `Charge ${formatCents(totals.grandTotalCents)}`
                      )}
                    </Button>
                  </div>
                </form>
              );
            })
          )}
        </div>
      </div>

      <Modal
        open={customerPickerOpen}
        onClose={() => setCustomerPickerOpen(false)}
        title="Choose Customer"
        description="Search by name or phone — or keep it as a walk-in sale."
        widthClassName="max-w-md"
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setQuickCreateCustomerOpen(true)}
            className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
          >
            <Plus className="size-3" aria-hidden="true" />
            New Customer
          </button>
        </div>
        <div className="relative mt-1.5">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            autoFocus
            type="text"
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
            placeholder="Search customers..."
            className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
        </div>
        <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
          <button
            type="button"
            onClick={() => selectCustomerForActiveDraft(null)}
            className={cn(
              "flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition cursor-pointer",
              !activeDraft?.customerId ? "border-teal bg-teal/10" : "border-line hover:bg-soft"
            )}
          >
            <span className="text-sm font-extrabold text-ink">Walk-in Customer</span>
            <DashedPill tone="neutral">Default</DashedPill>
          </button>
          {filteredCustomerResults.map((customer) => (
            <button
              key={customer.id}
              type="button"
              onClick={() => selectCustomerForActiveDraft(customer.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition cursor-pointer",
                activeDraft?.customerId === customer.id ? "border-teal bg-teal/10" : "border-line hover:bg-soft"
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-ink">{customer.name}</p>
                <p className="text-[11px] font-semibold text-muted">{customer.phone}</p>
              </div>
              <DashedPill tone="accent">{customer.customerCode}</DashedPill>
            </button>
          ))}
          {filteredCustomerResults.length === 0 && (
            <p className="py-6 text-center text-xs font-semibold text-muted">No customers match your search</p>
          )}
        </div>
      </Modal>

      <QuickCreateCustomerModal
        open={quickCreateCustomerOpen}
        onClose={() => setQuickCreateCustomerOpen(false)}
        onCreated={(customer) => {
          setCustomers((prev) => [...prev, customer]);
          selectCustomerForActiveDraft(customer.id);
          setQuickCreateCustomerOpen(false);
        }}
      />

      <Modal
        open={completedSale !== null}
        onClose={() => setCompletedSale(null)}
        title="Sale Complete"
        widthClassName="max-w-sm"
      >
        {completedSale && (
          <div>
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-success/15 text-success">
              <CheckCircle2 className="size-7" aria-hidden="true" />
            </div>
            {tenantContext && (
              <div className="mt-4">
                <ReceiptPreview sale={completedSale} tenant={tenantContext} />
              </div>
            )}
            {completedSale.delivery && (
              <Button
                type="button"
                onClick={() => setShowDeliveryNote(true)}
                className="mt-3 h-9 w-full border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                <Package className="mr-1.5 size-3.5" aria-hidden="true" />
                View Delivery Note
              </Button>
            )}
            <Button type="button" onClick={() => setCompletedSale(null)} className="mt-2 h-9 w-full text-xs">
              Done
            </Button>
          </div>
        )}
      </Modal>

      <Modal
        open={showDeliveryNote && completedSale?.delivery !== null && completedSale?.delivery !== undefined}
        onClose={() => setShowDeliveryNote(false)}
        title={completedSale?.delivery?.deliveryNoteNumber ?? "Delivery Note"}
        description="Print, download, share, or mark this delivery as delivered."
        widthClassName="max-w-lg"
      >
        {completedSale?.delivery && tenantContext && (
          <DeliveryNotePreview
            delivery={completedSale.delivery}
            tenant={tenantContext}
            locationId={completedSale.locationId}
            sourceDocumentLabel="Receipt"
            sourceDocumentNumber={completedSale.receiptNumber}
            parentEntity="sale"
            parentEntityId={completedSale.id}
            onDeliveredChange={(next) =>
              setCompletedSale((prev) => (prev ? { ...prev, delivery: next } : prev))
            }
          />
        )}
      </Modal>
    </motion.div>
  );
}

function ProductCard({
  product,
  stock,
  currency,
  onAdd
}: {
  product: ProductListItem;
  stock: number;
  currency: string;
  onAdd: () => void;
}): React.JSX.Element {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!product.imagePath) {
      setImageUrl(null);
      return undefined;
    }
    void window.blueLedger.product.readImagePreview(product.imagePath).then((url) => {
      if (!cancelled) setImageUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [product.imagePath]);

  const outOfStock = product.trackStock && stock <= 0 && !product.allowNegativeStock;

  return (
    <div className="flex flex-col rounded-xl border border-line bg-white p-3 shadow-soft transition hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowInfo(true)}
          aria-label={`View details for ${product.name}`}
          className="grid size-6 flex-none place-items-center rounded-md text-muted transition hover:bg-soft hover:text-primary cursor-pointer"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
        <div className="h-4 flex-1 rounded-sm opacity-70" style={BARCODE_STYLE} aria-hidden="true" />
        <div
          className="grid size-9 flex-none place-items-center overflow-hidden rounded-lg"
          style={{ backgroundColor: imageUrl ? undefined : (product.categoryColor ?? "#83795f") }}
        >
          {imageUrl ? (
            <img src={imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <Package className="size-4 text-white/90" aria-hidden="true" />
          )}
        </div>
      </div>

      {showInfo && <ProductInfoModal product={product} onClose={() => setShowInfo(false)} />}

      <p className="mt-2.5 line-clamp-2 text-sm font-extrabold leading-snug text-ink">{product.name}</p>
      <p className="mt-1 text-lg font-extrabold tabular-nums text-ink">
        {currency} {formatCents(product.sellingPriceCents)}
      </p>
      {product.wholesalePriceCents !== null && product.wholesaleMinQuantity > 0 && (
        <p className="text-[10px] font-bold text-teal">
          Bulk {product.wholesaleMinQuantity}+ @ {currency} {formatCents(product.wholesalePriceCents)}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-muted">
        <span className="truncate">{product.sku}</span>
        {product.trackStock && <span className={cn(outOfStock && "text-danger")}>Stock: {stock}</span>}
      </div>

      <button
        type="button"
        onClick={onAdd}
        disabled={outOfStock}
        className={cn(
          "mt-2.5 flex h-8 items-center justify-center gap-1.5 rounded-lg text-[11px] font-extrabold uppercase tracking-wide transition",
          outOfStock ? "cursor-not-allowed bg-soft text-muted" : "cursor-pointer bg-teal text-white hover:brightness-110"
        )}
      >
        {outOfStock ? (
          "Out of Stock"
        ) : (
          <>
            <Plus className="size-3.5" aria-hidden="true" />
            Add to Cart
          </>
        )}
      </button>
    </div>
  );
}
