import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, PackageCheck } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { ExportListRequest } from "@shared/types/export";
import { BORROW_DIRECTION_OPTIONS, BORROW_STATUS_OPTIONS, type Borrow, type BorrowStatus } from "@shared/types/borrow";

function formatDate(value: string | null, pattern = "MMM d, yyyy · HH:mm"): string {
  if (!value) return "—";
  try {
    return format(new Date(value), pattern);
  } catch {
    return value;
  }
}

function statusLabel(status: BorrowStatus): string {
  return BORROW_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function statusTone(status: BorrowStatus): "success" | "warning" | "accent" {
  if (status === "returned") return "success";
  if (status === "partially_returned") return "accent";
  return "warning";
}

function directionLabel(direction: Borrow["direction"]): string {
  return BORROW_DIRECTION_OPTIONS.find((option) => option.value === direction)?.label ?? direction;
}

export function BorrowDetailModal({
  borrow,
  canEdit,
  onClose,
  onChanged
}: {
  borrow: Borrow;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const { can } = usePermissions();
  const canExport = can("borrows", "export");

  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [returnSaving, setReturnSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const canReturn = borrow.status === "open" || borrow.status === "partially_returned";

  /** Same "every session gets its own nested row" pattern as PurchaseDetailModal's sessionsByItem —
   * see that component's own doc comment for the full reasoning (a compressed before→after span
   * actively lies the moment something else touches stock between two return sessions). */
  const sessionsByItem = useMemo(() => {
    const map = new Map<
      string,
      { returnedAt: string; returnedByName: string; returnQuantity: number; previousQuantity: number; newQuantity: number }[]
    >();
    for (const event of borrow.returnEvents) {
      for (const item of event.items) {
        const list = map.get(item.borrowItemId) ?? [];
        list.push({
          returnedAt: event.returnedAt,
          returnedByName: event.returnedByName,
          returnQuantity: item.returnQuantity,
          previousQuantity: item.previousQuantity,
          newQuantity: item.newQuantity
        });
        map.set(item.borrowItemId, list);
      }
    }
    return map;
  }, [borrow.returnEvents]);

  const exportRequest = useMemo<ExportListRequest>(
    () => ({
      module: "borrows",
      title: `${borrow.borrowNumber}`,
      subtitle: `${directionLabel(borrow.direction)} · ${borrow.supplierName} · ${borrow.locationName} · ${statusLabel(borrow.status)}`,
      columns: [
        { key: "product", header: "Product" },
        { key: "sku", header: "SKU" },
        { key: "quantity", header: "Quantity", align: "right" },
        { key: "session", header: "Session" },
        { key: "returnedAt", header: "Returned At" },
        { key: "returnedBy", header: "Returned By" },
        { key: "sessionQty", header: "Qty This Session", align: "right" },
        { key: "stockBefore", header: "Stock Before", align: "right" },
        { key: "stockAfter", header: "Stock After", align: "right" }
      ],
      rows: borrow.items.flatMap((item) => {
        const sessions = sessionsByItem.get(item.id) ?? [];
        const base = { product: item.productName, sku: item.sku, quantity: String(item.quantity) };
        if (sessions.length === 0) {
          return [{ ...base, session: "—", returnedAt: "—", returnedBy: "—", sessionQty: "—", stockBefore: "—", stockAfter: "—" }];
        }
        return sessions.map((session, index) => ({
          ...base,
          session: `${index + 1} of ${sessions.length}`,
          returnedAt: formatDate(session.returnedAt),
          returnedBy: session.returnedByName,
          sessionQty: `${session.returnQuantity}`,
          stockBefore: String(session.previousQuantity),
          stockAfter: String(session.newQuantity)
        }));
      }),
      stats: [
        { label: "Direction", value: directionLabel(borrow.direction) },
        { label: "Shop", value: borrow.supplierName },
        { label: "Location", value: borrow.locationName },
        { label: "Status", value: statusLabel(borrow.status) },
        { label: "Created", value: formatDate(borrow.createdAt) }
      ],
      fileBaseName: `Borrow-${borrow.borrowNumber}`
    }),
    [borrow, sessionsByItem]
  );

  function updateReturnQuantity(itemId: string, value: string): void {
    setReturnQuantities((prev) => ({ ...prev, [itemId]: value }));
  }

  async function submitReturn(quantities: Record<string, string>): Promise<void> {
    setActionError(null);
    const entries = Object.entries(quantities)
      .map(([borrowItemId, value]) => ({ borrowItemId, returnQuantity: Math.floor(Number(value) || 0) }))
      .filter((entry) => entry.returnQuantity > 0);

    if (entries.length === 0) {
      setActionError("Enter at least one quantity to return");
      showErrorToast("Enter at least one quantity to return");
      return;
    }

    setReturnSaving(true);
    try {
      await window.blueLedger.borrow.recordReturn(borrow.id, { items: entries });
      showSuccessToast("Return recorded");
      setReturnQuantities({});
      await onChanged();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to record return");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setReturnSaving(false);
    }
  }

  async function handleRecordReturn(): Promise<void> {
    await submitReturn(returnQuantities);
  }

  /** Fills every still-outstanding line to its own full remaining quantity AND returns them
   * immediately — mirrors PurchaseDetailModal's own "Receive All". */
  async function handleReturnAll(): Promise<void> {
    const fullQuantities = { ...returnQuantities };
    for (const item of borrow.items) {
      if (item.remainingQuantity > 0) fullQuantities[item.id] = String(item.remainingQuantity);
    }
    setReturnQuantities(fullQuantities);
    await submitReturn(fullQuantities);
  }

  return (
    <Modal open onClose={onClose} title={borrow.borrowNumber} description={`${borrow.supplierName} · ${borrow.locationName}`} widthClassName="max-w-5xl">
      {actionError && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{actionError}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DashedPill tone={borrow.direction === "borrowed" ? "accent" : "neutral"}>{directionLabel(borrow.direction)}</DashedPill>
          <DashedPill tone={statusTone(borrow.status)}>{statusLabel(borrow.status)}</DashedPill>
        </div>
        {canExport && <ExportMenu request={exportRequest} selectableFields defaultCheckedKeys={["product", "sku", "quantity"]} />}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Shop</p>
          <p className="mt-0.5 truncate text-sm font-bold text-ink">{borrow.supplierName}</p>
        </div>
        <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Location</p>
          <p className="mt-0.5 truncate text-sm font-bold text-ink">{borrow.locationName}</p>
        </div>
        <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Created</p>
          <p className="mt-0.5 text-sm font-bold text-ink">{formatDate(borrow.createdAt)}</p>
        </div>
        <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Created By</p>
          <p className="mt-0.5 truncate text-sm font-bold text-ink">{borrow.createdByName ?? "—"}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Products</p>
          {canReturn && canEdit && (
            <button
              type="button"
              onClick={() => void handleReturnAll()}
              disabled={returnSaving}
              className="text-[11px] font-extrabold uppercase text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              Return All
            </button>
          )}
        </div>
        <div className="mt-2 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[680px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              {canReturn && <col className="w-[12%]" />}
            </colgroup>
            <thead>
              <tr className="bg-primary text-white">
                <th className="px-3 py-2 text-left text-xs font-extrabold uppercase tracking-wider">Product</th>
                <th className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">
                  {borrow.direction === "borrowed" ? "Borrowed" : "Lent"}
                </th>
                <th className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">Returned</th>
                <th className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">Remaining</th>
                {canReturn && <th className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">Return Today</th>}
              </tr>
            </thead>
            <tbody>
              {borrow.items.map((item) => {
                const sessions = sessionsByItem.get(item.id) ?? [];
                return (
                  <Fragment key={item.id}>
                    <tr className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="line-clamp-2 px-3 py-2 leading-snug font-bold text-ink" title={item.productName}>
                        {item.productName}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{item.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{item.returnedQuantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-ink">{item.remainingQuantity}</td>
                      {canReturn && (
                        <td className="px-3 py-2 text-right">
                          {item.remainingQuantity > 0 ? (
                            <input
                              type="number"
                              min={0}
                              max={item.remainingQuantity}
                              value={returnQuantities[item.id] ?? ""}
                              onChange={(event) => updateReturnQuantity(item.id, event.target.value)}
                              placeholder="0"
                              className="h-8 w-20 rounded-md border border-line px-1.5 text-right text-xs font-bold outline-none focus:border-accent"
                            />
                          ) : (
                            <span className="text-xs font-bold text-success">Complete</span>
                          )}
                        </td>
                      )}
                    </tr>
                    {sessions.map((session, index) => (
                      <tr key={`${item.id}-${index}`} className="border-t border-line/60 bg-soft/30">
                        <td colSpan={canReturn ? 5 : 4} className="px-3 py-2 pl-8 text-sm font-semibold text-muted">
                          <span className="font-extrabold text-ink">
                            {index === 0 ? "1st" : index === 1 ? "2nd" : index === 2 ? "3rd" : `${index + 1}th`} return
                          </span>{" "}
                          · {formatDate(session.returnedAt)} · {session.returnedByName} · {session.returnQuantity} ·
                          Stock Before ({borrow.locationName}): <span className="text-ink">{session.previousQuantity}</span> ·
                          Stock After ({borrow.locationName}): <span className="font-extrabold text-success">{session.newQuantity}</span>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {canReturn && canEdit && (
          <div className="mt-3 flex justify-end">
            <Button type="button" onClick={() => void handleRecordReturn()} disabled={returnSaving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
              {returnSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              <PackageCheck className="mr-1.5 size-3.5" aria-hidden="true" />
              Record Return
            </Button>
          </div>
        )}
      </div>

      {borrow.notes && (
        <div className="mt-4 rounded-lg border border-line bg-soft px-3.5 py-2.5">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Notes</p>
          <p className="mt-1 whitespace-pre-line text-sm font-semibold text-ink">{borrow.notes}</p>
        </div>
      )}
    </Modal>
  );
}
