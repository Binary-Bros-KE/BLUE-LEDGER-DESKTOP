import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  XCircle
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { useConfirm } from "@renderer/shared/components/ConfirmModal";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { buildAvailableYears, currentYear, matchesYearFilter, yearFilterOptions } from "@renderer/shared/lib/year-filter";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { ProductListItem } from "@shared/types/product";
import type { StockRequest, StockRequestListItem, StockRequestStatus } from "@shared/types/stock-request";

type FilterTab = "all" | StockRequestStatus;

const FILTER_TABS: Array<{ value: FilterTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" }
];

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

function statusTone(status: StockRequestStatus): "warning" | "success" | "danger" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  return "warning";
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

export function StockRequestsRoute(): React.JSX.Element {
  const { can, session } = usePermissions();
  const canCreate = can("stock_requests", "create");
  const canApprove = can("stock_requests", "approve");
  const confirm = useConfirm();

  const needsStorefrontPicker = session?.branch == null;

  const [requests, setRequests] = useState<StockRequestListItem[] | null>(null);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterTab>("all");
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear()));

  const [createOpen, setCreateOpen] = useState(false);
  const [createStorefrontId, setCreateStorefrontId] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createItems, setCreateItems] = useState<DraftItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [viewingRequest, setViewingRequest] = useState<StockRequest | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [rejectingRequest, setRejectingRequest] = useState<StockRequestListItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSaving, setRejectSaving] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await window.blueLedger.stockRequest.list();
      setRequests(list);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load stock requests"));
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (!canCreate) return;
    window.blueLedger.product
      .list()
      .then(setProducts)
      .catch(() => undefined);
    window.blueLedger.location
      .list()
      .then(setLocations)
      .catch(() => undefined);
  }, [canCreate]);

  const storefronts = useMemo(
    () => locations.filter((location) => isStorefrontType(location.locationType)),
    [locations]
  );

  const filteredPickerProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((product) => product.status === "active")
      .filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [products, productSearch]);

  const availableYears = useMemo(
    () => buildAvailableYears((requests ?? []).map((request) => request.requestedAt)),
    [requests]
  );

  const filteredRequests = useMemo(() => {
    if (!requests) return null;
    let list = requests;
    if (statusFilter !== "all") {
      list = list.filter((request) => request.status === statusFilter);
    }
    list = list.filter((request) => matchesYearFilter(request.requestedAt, yearFilter));
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((request) =>
        `${request.requestNumber} ${request.storefrontName} ${request.requestedByName}`.toLowerCase().includes(term)
      );
    }
    return list;
  }, [requests, statusFilter, searchTerm, yearFilter]);

  const counts = useMemo(() => {
    const source = requests ?? [];
    return {
      total: source.length,
      pending: source.filter((r) => r.status === "pending").length,
      approved: source.filter((r) => r.status === "approved").length,
      rejected: source.filter((r) => r.status === "rejected").length
    };
  }, [requests]);

  function openCreateModal(): void {
    setCreateStorefrontId("");
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
   * mid-edit (see the input's own value prop, which renders "" for 0) so clearing "1" to type "80"
   * isn't fought by an immediate re-clamp on every keystroke. updateDraftItemQuantity's own clamp
   * still applies on blur. */
  function updateDraftItemQuantityDraft(productId: string, raw: string): void {
    const parsed = raw === "" ? 0 : Math.floor(Number(raw));
    const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    setCreateItems((prev) => prev.map((item) => (item.productId === productId ? { ...item, quantity: next } : item)));
  }

  function removeDraftItem(productId: string): void {
    setCreateItems((prev) => prev.filter((item) => item.productId !== productId));
  }

  async function submitCreateRequest(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setCreateError(null);

    if (createItems.length === 0) {
      setCreateError("Add at least one product");
      return;
    }
    if (needsStorefrontPicker && !createStorefrontId) {
      setCreateError("Choose which storefront this request is for");
      return;
    }

    setCreateSaving(true);
    try {
      await window.blueLedger.stockRequest.create({
        storefrontId: needsStorefrontPicker ? createStorefrontId : null,
        notes: createNotes,
        items: createItems.map((item) => ({ productId: item.productId, quantity: item.quantity }))
      });
      setCreateOpen(false);
      await loadRequests();
      showSuccessToast("Stock request submitted");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to submit stock request");
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
      const request = await window.blueLedger.stockRequest.get(id);
      setViewingRequest(request);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load stock request"));
    } finally {
      setViewLoading(false);
    }
  }

  async function handleApprove(request: StockRequestListItem): Promise<void> {
    const confirmed = await confirm({
      title: "Approve stock request?",
      message: `This ships ${request.totalQuantityRequested} unit(s) across ${request.itemCount} product(s) from Main Store to ${request.storefrontName}, and records it in the stock ledger. This can't be undone.`,
      tone: "primary",
      confirmLabel: "Approve & Ship"
    });
    if (!confirmed) return;

    setApprovingId(request.id);
    setActionError(null);
    try {
      await window.blueLedger.stockRequest.approve(request.id);
      await loadRequests();
      showSuccessToast(`${request.requestNumber} approved and shipped`);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to approve stock request");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setApprovingId(null);
    }
  }

  function openRejectModal(request: StockRequestListItem): void {
    setRejectingRequest(request);
    setRejectReason("");
    setRejectError(null);
  }

  async function submitReject(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!rejectingRequest) return;
    setRejectSaving(true);
    setRejectError(null);
    try {
      await window.blueLedger.stockRequest.reject(rejectingRequest.id, { reason: rejectReason });
      setRejectingRequest(null);
      await loadRequests();
      showSuccessToast("Stock request rejected");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to reject stock request");
      setRejectError(message);
      showErrorToast(message);
    } finally {
      setRejectSaving(false);
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
              <PackagePlus className="size-5 text-primary" aria-hidden="true" />
              Stock Requests
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              {canApprove
                ? "Every storefront's request for stock from Main Store."
                : "Request stock from Main Store for your storefront."}
            </p>
          </div>
          {canCreate && (
            <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              New Request
            </Button>
          )}
        </div>

        {(loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? actionError}
          </div>
        )}

        {requests !== null && requests.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile icon={PackagePlus} label="Total Requests" value={String(counts.total)} tone="primary" />
              <StatTile icon={Clock} label="Pending" value={String(counts.pending)} tone="warning" />
              <StatTile icon={CheckCircle2} label="Approved" value={String(counts.approved)} tone="success" />
              <StatTile icon={XCircle} label="Rejected" value={String(counts.rejected)} tone="danger" />
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
                    placeholder="Search by request #, storefront, or requester"
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
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <Button type="button" onClick={() => void loadRequests()} className="h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : requests === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : requests.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <PackagePlus className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No stock requests yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                {canCreate
                  ? "Request stock from Main Store when your storefront is running low."
                  : "Requests from storefronts will show up here."}
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Request
                </Button>
              )}
            </div>
          ) : filteredRequests && filteredRequests.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <Search className="size-7 text-muted" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-extrabold">No requests match your filters</h3>
              <Button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
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
                  <col className="w-[18%]" /> 
                  <col className="w-[15%]" />
                  <col className="w-[18%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Request #</Th>
                    <Th>Storefront</Th>
                    <Th>Items</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredRequests ?? []).map((request) => (
                    <tr key={request.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        <div className="flex flex-col gap-0.5">
                          <span>
                            {request.requestNumber}
                          </span>
                          <span>
                            {formatDateTime(request.requestedAt)}
                          </span>
                        </div>
                      </td>
                      <td className="truncate px-4 py-3 font-extrabold">
                        <div className="flex flex-col gap-0.5">
                          <span>{request.requestedByName}</span>
                          <span>{request.storefrontName}</span>
                        </div>
                      </td>
          
                      <td className="px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        {request.itemCount} item{request.itemCount === 1 ? "" : "s"} ·{" "}
                        {request.totalQuantityRequested} unit{request.totalQuantityRequested === 1 ? "" : "s"}
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone={statusTone(request.status)}>{request.status}</DashedPill>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void openView(request.id)}
                            aria-label={`View ${request.requestNumber}`}
                            title="View details"
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                          >
                            <Eye className="size-3.5" aria-hidden="true" />
                          </button>
                          {canApprove && request.status === "pending" && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleApprove(request)}
                                disabled={approvingId === request.id}
                                aria-label={`Approve ${request.requestNumber}`}
                                title="Approve & ship"
                                className="grid size-8 place-items-center rounded-lg border border-success/30 text-success transition hover:bg-success/15 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {approvingId === request.id ? (
                                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => openRejectModal(request)}
                                disabled={approvingId === request.id}
                                aria-label={`Reject ${request.requestNumber}`}
                                title="Reject"
                                className="grid size-8 place-items-center rounded-lg border border-danger/30 text-danger transition hover:bg-danger-soft cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Ban className="size-3.5" aria-hidden="true" />
                              </button>
                            </>
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
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Stock Request"
        description="Ask Main Store to ship products to your storefront."
        widthClassName="max-w-lg"
      >
        <form onSubmit={submitCreateRequest}>
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
                { value: "", label: "Select a storefront..." },
                ...storefronts.map((location) => ({ value: location.id, label: location.locationName }))
              ]}
              className="mb-4"
            />
          )}

          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Products</span>
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
            <div className="mt-3 space-y-1.5">
              {createItems.map((item) => (
                <div
                  key={item.productId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-line bg-soft/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-extrabold text-ink">{item.productName}</p>
                    <p className="text-[10px] font-semibold text-muted">{item.sku}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={item.quantity === 0 ? "" : item.quantity}
                      onChange={(event) => updateDraftItemQuantityDraft(item.productId, event.target.value)}
                      onBlur={() => updateDraftItemQuantity(item.productId, item.quantity)}
                      aria-label={`Quantity for ${item.productName}`}
                      className="h-8 w-16 rounded-md border border-line px-2 text-center text-sm font-extrabold tabular-nums text-ink outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={() => removeDraftItem(item.productId)}
                      aria-label={`Remove ${item.productName}`}
                      className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <TextAreaField
            label="Notes"
            value={createNotes}
            onChange={setCreateNotes}
            placeholder="Optional context for whoever reviews this"
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
              {createSaving ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={viewingRequest !== null || viewLoading}
        onClose={() => setViewingRequest(null)}
        title={viewingRequest?.requestNumber ?? "Stock Request"}
        description="Full detail of this stock request."
        widthClassName="max-w-lg"
      >
        {viewLoading ? (
          <div className="flex min-h-[160px] items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : viewingRequest ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <DashedPill tone={statusTone(viewingRequest.status)}>{viewingRequest.status}</DashedPill>
              <span className="text-xs font-semibold text-muted">
                {viewingRequest.storefrontName} · Requested by {viewingRequest.requestedByName} ·{" "}
                {formatDateTime(viewingRequest.requestedAt)}
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
                      Quantity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {viewingRequest.items.map((item) => (
                    <tr key={item.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <p className="font-extrabold text-ink">{item.productName}</p>
                        <p className="text-[10px] font-semibold text-muted">{item.sku}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-extrabold tabular-nums">{item.quantityRequested}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {viewingRequest.notes && (
              <div className="rounded-lg border border-line bg-soft/40 p-3">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Notes</p>
                <p className="mt-1 text-sm font-semibold text-ink">{viewingRequest.notes}</p>
              </div>
            )}

            {viewingRequest.status === "rejected" && viewingRequest.rejectionReason && (
              <div className="rounded-lg border border-danger/30 bg-danger-soft p-3">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-danger">Rejection Reason</p>
                <p className="mt-1 text-sm font-bold text-danger">{viewingRequest.rejectionReason}</p>
              </div>
            )}

            {viewingRequest.reviewedByName && (
              <p className="text-[11px] font-semibold text-muted">
                Reviewed by {viewingRequest.reviewedByName} · {formatDateTime(viewingRequest.reviewedAt)}
              </p>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={rejectingRequest !== null}
        onClose={() => setRejectingRequest(null)}
        title="Reject Stock Request"
        description="Give a reason so the requester knows why."
        widthClassName="max-w-md"
      >
        {rejectingRequest && (
          <form onSubmit={submitReject}>
            {rejectError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                {rejectError}
              </div>
            )}

            <div className="rounded-lg border border-line bg-soft px-3.5 py-2.5">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Rejecting</p>
              <p className="mt-0.5 text-sm font-bold text-ink">
                {rejectingRequest.requestNumber} · {rejectingRequest.storefrontName}
              </p>
            </div>

            <TextAreaField
              label="Reason"
              value={rejectReason}
              onChange={setRejectReason}
              placeholder="e.g. Not enough stock at Main Store right now"
              className="mt-4"
              rows={3}
            />

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
              <Button
                type="button"
                onClick={() => setRejectingRequest(null)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={rejectSaving}
                className="h-9 border border-danger bg-danger text-xs text-white shadow-none hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rejectSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                {rejectSaving ? "Rejecting..." : "Reject Request"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </motion.div>
  );
}
