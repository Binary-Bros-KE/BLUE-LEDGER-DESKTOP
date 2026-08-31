import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast } from "@renderer/shared/lib/toast";
import type { ExportListRequest } from "@shared/types/export";
import { STOCK_MOVEMENT_TYPE_OPTIONS, type StockMovement, type StockMovementType } from "@shared/types/stock-movement";

const INCREASING_TYPES = new Set<StockMovementType>(["purchase", "transfer_in", "return", "opening_stock"]);

function movementTone(type: StockMovementType): "success" | "danger" | "neutral" {
  if (INCREASING_TYPES.has(type)) return "success";
  if (type === "adjustment") return "neutral";
  return "danger";
}

function movementTypeLabel(type: StockMovementType): string {
  return STOCK_MOVEMENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export function ProductHistoryModal({
  productId,
  productName,
  onClose
}: {
  productId: string;
  productName: string;
  onClose: () => void;
}): React.JSX.Element {
  const { can } = usePermissions();
  const canExport = can("inventory", "export");

  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Empty string on either end means "no bound" — the default view (most recent 150, any date).
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadMovements = useCallback(async () => {
    setError(null);
    try {
      const result = await window.blueLedger.stockMovement.list(productId, {
        limit: 500,
        ...(dateFrom ? { startDate: dateFrom } : {}),
        ...(dateTo ? { endDate: dateTo } : {})
      });
      setMovements(result);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load history");
      setError(message);
      showErrorToast(message);
    }
  }, [productId, dateFrom, dateTo]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!movements) return null;
    const filterParts: string[] = [];
    if (dateFrom || dateTo) {
      filterParts.push(`Date: ${dateFrom || "earliest"} to ${dateTo || "today"}`);
    }

    return {
      module: "inventory",
      title: `${productName} — Stock Movements`,
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
      fileBaseName: `${productName.replace(/\s+/g, "_")}_StockMovements`
    };
  }, [movements, dateFrom, dateTo, productName]);

  return (
    <Modal
      open
      onClose={onClose}
      title={productName}
      description="Every purchase, transfer, return, damage, and adjustment for this product."
      widthClassName="max-w-2xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1.5 h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1.5 h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </label>
          {(dateFrom || dateTo) && (
            <Button
              type="button"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="h-9 border border-line bg-white px-3 text-[11px] text-ink shadow-none hover:bg-soft"
            >
              Clear
            </Button>
          )}
        </div>
        {canExport && exportRequest && <ExportMenu request={exportRequest} />}
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
          {error}
        </div>
      ) : movements === null ? (
        <div className="flex min-h-[160px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      ) : movements.length === 0 ? (
        <p className="mt-4 p-4 text-sm font-semibold text-muted">
          {dateFrom || dateTo ? "No stock movements in this date range." : "No stock movements recorded yet."}
        </p>
      ) : (
        <div className="mt-4 max-h-[60vh] overflow-y-auto rounded-lg border border-line">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="sticky top-0">
              <tr className="bg-primary text-white">
                <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Date</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Location</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Type</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Change</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id} className="border-t border-line odd:bg-white even:bg-soft/50">
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
                  <td className="px-4 py-2.5 text-xs font-semibold text-muted">{movement.performedByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
