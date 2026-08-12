import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast } from "@renderer/shared/lib/toast";
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
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    window.blueLedger.stockMovement
      .list(productId, { limit: 150 })
      .then((result) => {
        if (!cancelled) setMovements(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = getErrorMessage(err, "Failed to load history");
          setError(message);
          showErrorToast(message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  return (
    <Modal
      open
      onClose={onClose}
      title={productName}
      description="Every purchase, transfer, return, damage, and adjustment for this product."
      widthClassName="max-w-2xl"
    >
      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
          {error}
        </div>
      ) : movements === null ? (
        <div className="flex min-h-[160px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      ) : movements.length === 0 ? (
        <p className="p-4 text-sm font-semibold text-muted">No stock movements recorded yet.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-line">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="sticky top-0">
              <tr className="bg-primary text-white">
                <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Date</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Location</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Type</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Change</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Notes</th>
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
                  <td className="px-4 py-2.5 text-xs font-semibold text-muted">{movement.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
