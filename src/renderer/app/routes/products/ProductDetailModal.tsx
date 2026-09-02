import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeftRight, Loader2, PackagePlus } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { ExportListRequest } from "@shared/types/export";
import type { InventoryBalance } from "@shared/types/inventory";
import type { Location } from "@shared/types/location";
import type { ProductListItem } from "@shared/types/product";
import {
  AUTO_DECREASE_MOVEMENT_TYPES,
  MANUAL_STOCK_MOVEMENT_TYPE_OPTIONS,
  STOCK_MOVEMENT_TYPE_OPTIONS,
  type StockMovement,
  type StockMovementType
} from "@shared/types/stock-movement";

const INCREASING_TYPES = new Set(["purchase", "transfer_in", "return", "opening_stock", "borrow_in", "loan_return_in"]);

function movementTone(type: StockMovementType): "success" | "danger" | "neutral" {
  if (INCREASING_TYPES.has(type)) return "success";
  if (type === "adjustment") return "neutral";
  return "danger";
}

function movementTypeLabel(type: StockMovementType): string {
  return STOCK_MOVEMENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

type MovementMode = "single" | "transfer";

type SingleFormState = {
  locationId: string;
  movementType: StockMovementType;
  quantity: string;
  notes: string;
};

type TransferFormState = {
  fromLocationId: string;
  toLocationId: string;
  quantity: string;
  notes: string;
};

// Deliberately never pre-picked from locations[0]/[1] — see updateTransferField's own comment for
// the exact bug that caused (both here and in the single-location form, for the same underlying
// reason: a stale-looking-valid default is worse than an honest blank one the disabled Record/
// Transfer button already guards against).
function emptySingleForm(): SingleFormState {
  return {
    locationId: "",
    movementType: "purchase",
    quantity: "",
    notes: ""
  };
}

function emptyTransferForm(): TransferFormState {
  return {
    fromLocationId: "",
    toLocationId: "",
    quantity: "",
    notes: ""
  };
}

export function ProductDetailModal({
  product,
  currency,
  locations,
  onClose
}: {
  product: ProductListItem;
  currency: string;
  locations: Location[];
  onClose: () => void;
}): React.JSX.Element {
  const { can } = usePermissions();
  const canRecordMovement = can("inventory", "edit");
  const canRecordTransfer = can("stock_transfers", "create");
  const canRecordAny = canRecordMovement || canRecordTransfer;
  const canExport = can("inventory", "export");

  const [overview, setOverview] = useState<InventoryBalance[] | null>(null);
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<MovementMode>(canRecordMovement ? "single" : "transfer");
  const [singleForm, setSingleForm] = useState<SingleFormState>(emptySingleForm);
  const [transferForm, setTransferForm] = useState<TransferFormState>(emptyTransferForm);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  // Empty string on either end means "no bound" — the default view (most recent 50, any date) most
  // people open this modal for; From/To below narrow it.
  const [movementDateFrom, setMovementDateFrom] = useState("");
  const [movementDateTo, setMovementDateTo] = useState("");

  const loadMovements = useCallback(async () => {
    try {
      const movementsResult = await window.blueLedger.stockMovement.list(product.id, {
        limit: 500,
        ...(movementDateFrom ? { startDate: movementDateFrom } : {}),
        ...(movementDateTo ? { endDate: movementDateTo } : {})
      });
      setMovements(movementsResult);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load stock movements");
      setLoadError(message);
      showErrorToast(message);
    }
  }, [product.id, movementDateFrom, movementDateTo]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  // Handles just the "Inventory by location" table — separate from loadMovements (its own effect,
  // below) so the date filter only ever re-fetches movements, not this too.
  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const overviewResult = await window.blueLedger.inventory.overview(product.id);
      setOverview(overviewResult);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load inventory data");
      setLoadError(message);
      showErrorToast(message);
    }
  }, [product.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function updateSingleField<K extends keyof SingleFormState>(key: K, value: SingleFormState[K]): void {
    setSingleForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateTransferField<K extends keyof TransferFormState>(
    key: K,
    value: TransferFormState[K]
  ): void {
    setTransferForm((prev) => {
      const next = { ...prev, [key]: value };
      // "To Location"'s own options list always filters out whatever "From" currently is (below) —
      // if changing "From" to this new value would make it match the CURRENTLY selected "To", that
      // option just vanished from the To dropdown. A real bug lived here: the browser then falls
      // back to visually showing a different option (whichever is now first in the filtered list),
      // while React's own `toLocationId` state silently stayed at the old, now-hidden value — which
      // is the SAME as the new `fromLocationId`. The two dropdowns LOOK like they show different
      // locations, but the state underneath secretly matches, so submitting throws "Choose two
      // different locations" no matter what's on screen. Clearing "To" here the moment this happens
      // forces a genuine, visible re-choice instead of a silently-stale one.
      if (key === "fromLocationId" && next.toLocationId === value) {
        next.toLocationId = "";
      }
      return next;
    });
  }

  async function handleRecordSingleMovement(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setRecording(true);
    setRecordError(null);

    const magnitude = Number(singleForm.quantity);
    if (!Number.isFinite(magnitude) || magnitude === 0) {
      setRecordError("Enter a quantity");
      showErrorToast("Enter a quantity");
      setRecording(false);
      return;
    }

    const quantityChange =
      singleForm.movementType === "adjustment"
        ? magnitude
        : AUTO_DECREASE_MOVEMENT_TYPES.has(singleForm.movementType)
          ? -Math.abs(magnitude)
          : Math.abs(magnitude);

    try {
      await window.blueLedger.stockMovement.create({
        productId: product.id,
        locationId: singleForm.locationId,
        movementType: singleForm.movementType,
        quantityChange,
        notes: singleForm.notes
      });
      showSuccessToast("Stock movement recorded");
      setSingleForm(emptySingleForm());
      await Promise.all([refresh(), loadMovements()]);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to record movement");
      setRecordError(message);
      showErrorToast(message);
    } finally {
      setRecording(false);
    }
  }

  async function handleRecordTransfer(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setRecording(true);
    setRecordError(null);

    const quantity = Number(transferForm.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setRecordError("Enter a quantity greater than 0");
      showErrorToast("Enter a quantity greater than 0");
      setRecording(false);
      return;
    }
    if (transferForm.fromLocationId === transferForm.toLocationId) {
      setRecordError("Choose two different locations");
      showErrorToast("Choose two different locations");
      setRecording(false);
      return;
    }

    try {
      await window.blueLedger.stockMovement.transfer({
        productId: product.id,
        fromLocationId: transferForm.fromLocationId,
        toLocationId: transferForm.toLocationId,
        quantity,
        notes: transferForm.notes
      });
      showSuccessToast("Stock transferred");
      setTransferForm(emptyTransferForm());
      await Promise.all([refresh(), loadMovements()]);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to record transfer");
      setRecordError(message);
      showErrorToast(message);
    } finally {
      setRecording(false);
    }
  }

  const movementExportRequest = useMemo<ExportListRequest | null>(() => {
    if (!movements) return null;
    const filterParts: string[] = [];
    if (movementDateFrom || movementDateTo) {
      filterParts.push(`Date: ${movementDateFrom || "earliest"} to ${movementDateTo || "today"}`);
    }

    return {
      module: "inventory",
      title: `${product.name} — Stock Movements`,
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "Every recorded movement",
      columns: [
        { key: "date", header: "Date" },
        { key: "location", header: "Location" },
        { key: "type", header: "Type" },
        { key: "change", header: "Change", align: "right" },
        { key: "recordedBy", header: "Recorded By" }
      ],
      rows: movements.map((movement) => ({
        date: format(new Date(movement.createdAt), "MMM d, yyyy · HH:mm"),
        location: movement.locationName,
        type: movementTypeLabel(movement.movementType),
        change: `${movement.quantityChange > 0 ? "+" : ""}${movement.quantityChange}`,
        recordedBy: movement.performedByName ?? "—"
      })),
      stats: [{ label: "Total Movements", value: String(movements.length) }],
      fileBaseName: `${product.sku}_StockMovements`
    };
  }, [movements, movementDateFrom, movementDateTo, product.name, product.sku]);

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      description={`SKU ${product.sku}${product.categoryName ? ` · ${product.categoryName}` : ""}`}
      widthClassName="max-w-3xl"
    >
      {loadError ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
          {loadError}
        </div>
      ) : overview === null || movements === null ? (
        <div className="flex min-h-[200px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
              Inventory by location
            </p>
            <div className="mt-2 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Location</Th>
                    <Th className="text-right">On Hand</Th>
                    <Th className="text-right">Reserved</Th>
                    <Th className="text-right">Available</Th>
                  </tr>
                </thead>
                <tbody>
                  {overview.map((row) => (
                    <tr
                      key={row.locationId}
                      className="border-t border-line odd:bg-white even:bg-soft/50"
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-bold">{row.locationName}</p>
                        <p className="text-xs tabular-nums text-muted">{row.locationCode}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span
                          className={cn(
                            "font-extrabold",
                            row.quantity <= product.reorderLevel && "text-warning"
                          )}
                        >
                          {row.quantity}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                        {row.reservedQuantity}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                        {row.availableQuantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {canRecordAny && (
          <section className="rounded-lg border border-line bg-soft/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Record a stock movement
              </p>
              <div className="flex gap-1.5 rounded-lg border border-line bg-white p-1">
                {canRecordMovement && (
                  <ModeTab
                    active={mode === "single"}
                    onClick={() => setMode("single")}
                    icon={<PackagePlus className="size-3.5" aria-hidden="true" />}
                    label="Add / Remove Stock"
                  />
                )}
                {canRecordTransfer && (
                  <ModeTab
                    active={mode === "transfer"}
                    onClick={() => setMode("transfer")}
                    disabled={locations.length < 2}
                    {...(locations.length < 2
                      ? { title: "Add another location first to enable transfers" }
                      : {})}
                    icon={<ArrowLeftRight className="size-3.5" aria-hidden="true" />}
                    label="Transfer Between Locations"
                  />
                )}
              </div>
            </div>

            {recordError && (
              <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
                {recordError}
              </div>
            )}

            {mode === "single" ? (
              <form onSubmit={handleRecordSingleMovement} className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <SelectField
                    label="Location"
                    value={singleForm.locationId}
                    onChange={(value) => updateSingleField("locationId", value)}
                    options={[
                      { value: "", label: "Choose location" },
                      ...locations.map((location) => ({ value: location.id, label: location.locationName }))
                    ]}
                  />
                  <SelectField
                    label="Action"
                    value={singleForm.movementType}
                    onChange={(value) => updateSingleField("movementType", value as StockMovementType)}
                    options={MANUAL_STOCK_MOVEMENT_TYPE_OPTIONS}
                  />
                  <Field
                    label={singleForm.movementType === "adjustment" ? "Quantity Change" : "Quantity"}
                    type="number"
                    value={singleForm.quantity}
                    onChange={(value) => updateSingleField("quantity", value)}
                    placeholder={singleForm.movementType === "adjustment" ? "e.g. 10 or -5" : "e.g. 10"}
                  />
                  <div className="flex items-end">
                    <Button
                      type="submit"
                      disabled={recording || !singleForm.locationId}
                      className="h-10 w-full text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {recording ? (
                        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {recording ? "Recording..." : "Record"}
                    </Button>
                  </div>
                </div>
                {singleForm.movementType === "adjustment" && (
                  <p className="text-[11px] font-semibold text-muted">
                    Enter a positive number to increase stock, or a negative number to decrease it.
                  </p>
                )}
                <TextAreaField
                  label="Notes"
                  value={singleForm.notes}
                  onChange={(value) => updateSingleField("notes", value)}
                  placeholder="e.g. Stock count correction after damage"
                  rows={2}
                />
              </form>
            ) : (
              <form onSubmit={handleRecordTransfer} className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <SelectField
                    label="From Location"
                    value={transferForm.fromLocationId}
                    onChange={(value) => updateTransferField("fromLocationId", value)}
                    options={[
                      { value: "", label: "Choose location" },
                      ...locations.map((location) => ({ value: location.id, label: location.locationName }))
                    ]}
                  />
                  <SelectField
                    label="To Location"
                    value={transferForm.toLocationId}
                    onChange={(value) => updateTransferField("toLocationId", value)}
                    options={[
                      { value: "", label: "Choose location" },
                      ...locations
                        .filter((location) => location.id !== transferForm.fromLocationId)
                        .map((location) => ({ value: location.id, label: location.locationName }))
                    ]}
                  />
                  <Field
                    label="Quantity"
                    type="number"
                    value={transferForm.quantity}
                    onChange={(value) => updateTransferField("quantity", value)}
                    placeholder="e.g. 10"
                  />
                  <div className="flex items-end">
                    <Button
                      type="submit"
                      disabled={recording || !transferForm.fromLocationId || !transferForm.toLocationId}
                      className="h-10 w-full text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {recording ? (
                        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {recording ? "Transferring..." : "Transfer"}
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] font-semibold text-muted">
                  This deducts stock from the source location and adds it to the destination in one step.
                </p>
                <TextAreaField
                  label="Notes"
                  value={transferForm.notes}
                  onChange={(value) => updateTransferField("notes", value)}
                  placeholder="e.g. Restocking downtown branch"
                  rows={2}
                />
              </form>
            )}
          </section>
          )}

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Recent movements
              </p>
              {canExport && movementExportRequest && <ExportMenu request={movementExportRequest} />}
            </div>

            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">From</span>
                <input
                  type="date"
                  value={movementDateFrom}
                  onChange={(event) => setMovementDateFrom(event.target.value)}
                  className="mt-1.5 h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">To</span>
                <input
                  type="date"
                  value={movementDateTo}
                  onChange={(event) => setMovementDateTo(event.target.value)}
                  className="mt-1.5 h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </label>
              {(movementDateFrom || movementDateTo) && (
                <Button
                  type="button"
                  onClick={() => {
                    setMovementDateFrom("");
                    setMovementDateTo("");
                  }}
                  className="h-9 border border-line bg-white px-3 text-[11px] text-ink shadow-none hover:bg-soft"
                >
                  Clear
                </Button>
              )}
            </div>

            <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-line">
              {movements.length === 0 ? (
                <p className="p-4 text-sm font-semibold text-muted">
                  {movementDateFrom || movementDateTo
                    ? "No stock movements in this date range."
                    : "No stock movements recorded yet."}
                </p>
              ) : (
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-primary text-white">
                      <Th>Date</Th>
                      <Th>Location</Th>
                      <Th>Type</Th>
                      <Th className="text-right">Change</Th>
                      <Th>Recorded By</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr
                        key={movement.id}
                        className="border-t border-line odd:bg-white even:bg-soft/50"
                      >
                        <td className="px-4 py-2.5 text-xs tabular-nums text-muted">
                          {format(new Date(movement.createdAt), "MMM d, yyyy · HH:mm")}
                        </td>
                        <td className="px-4 py-2.5 text-xs font-semibold">{movement.locationName}</td>
                        <td className="px-4 py-2.5">
                          <DashedPill tone={movementTone(movement.movementType)}>
                            {movementTypeLabel(movement.movementType)}
                          </DashedPill>
                        </td>
                        <td
                          className={cn(
                            "px-4 py-2.5 text-right font-extrabold tabular-nums",
                            movement.quantityChange > 0 ? "text-success" : "text-danger"
                          )}
                        >
                          {movement.quantityChange > 0 ? "+" : ""}
                          {movement.quantityChange}
                        </td>
                        <td className="px-4 py-2.5 text-xs font-semibold text-muted">
                          {movement.performedByName ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <div className="flex items-center justify-between border-t border-line pt-4 text-xs font-semibold text-muted">
            <span>
              Selling price: {currency} {formatCents(product.sellingPriceCents)}
            </span>
            <Button
              type="button"
              onClick={onClose}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
  disabled = false,
  title
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  title?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition",
        disabled
          ? "cursor-not-allowed text-muted/40"
          : active
            ? "bg-primary text-white"
            : "text-muted hover:bg-soft cursor-pointer"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
