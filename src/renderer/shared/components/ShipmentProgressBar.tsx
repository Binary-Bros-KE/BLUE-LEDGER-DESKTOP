import { format } from "date-fns";
import { computeShipmentStage, type ShipmentStage } from "@shared/lib/purchase";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { cn } from "@renderer/shared/lib/cn";

const STAGE_LABEL: Record<ShipmentStage, string> = {
  ordered: "Ordered",
  shipped: "In Transit",
  received: "Delivered",
  overdue: "Overdue"
};

const STAGE_TONE: Record<ShipmentStage, "success" | "warning" | "danger" | "neutral"> = {
  ordered: "neutral",
  shipped: "warning",
  received: "success",
  overdue: "danger"
};

const FILL_TONE: Record<ShipmentStage, string> = {
  ordered: "bg-line",
  shipped: "bg-warning",
  received: "bg-success",
  overdue: "bg-danger"
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return format(new Date(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

/** A purchase's shipment journey (ordered → shipped → received, with an overdue override once the
 * ETA passes) — see computeShipmentStage (shared/lib/purchase.ts) for the underlying logic. Rendered
 * only where at least shipmentDepartedAt is set; callers gate that themselves. */
export function ShipmentProgressBar({
  shipmentDepartedAt,
  shipmentEta,
  isFullyReceived,
  compact = false
}: {
  shipmentDepartedAt: string | null;
  shipmentEta: string | null;
  isFullyReceived: boolean;
  compact?: boolean;
}): React.JSX.Element {
  const { stage, fillPercent } = computeShipmentStage({ shipmentDepartedAt, shipmentEta, isFullyReceived });

  if (compact) {
    return <DashedPill tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</DashedPill>;
  }

  return (
    <div className="rounded-lg border border-line bg-soft p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Shipment Progress</p>
        <DashedPill tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</DashedPill>
      </div>
      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-white">
        <div
          className={cn("h-full rounded-full transition-all", FILL_TONE[stage])}
          style={{ width: `${fillPercent ?? (stage === "ordered" ? 0 : 50)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-muted">
        <span>Departed {formatDate(shipmentDepartedAt)}</span>
        <span>
          {stage === "overdue" ? "Was due" : "ETA"} {formatDate(shipmentEta)}
        </span>
      </div>
    </div>
  );
}
