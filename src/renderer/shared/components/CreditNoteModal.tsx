import { useEffect, useState } from "react";
import { Eye, Loader2, Share2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { ShareModal } from "@renderer/shared/components/ShareModal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast } from "@renderer/shared/lib/toast";
import type { CreditNoteDocument } from "@shared/types/sale-return";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A credit note as a document: preview here, then PDF (print or save) or Share. Opening it issues the
 * CN number the first time for a receipt return (an invoice credit note already has one). Display only:
 * the stock and money were settled when the return was approved.
 */
export function CreditNoteModal({ returnId, onClose }: { returnId: string | null; onClose: () => void }): React.JSX.Element {
  const [doc, setDoc] = useState<CreditNoteDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!returnId) return;
    let cancelled = false;
    setDoc(null);
    setError(null);
    window.blueLedger.saleReturn
      .issueCreditNote(returnId)
      .then((result) => {
        if (!cancelled) setDoc(result);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, "Couldn't open this credit note"));
      });
    return () => {
      cancelled = true;
    };
  }, [returnId]);

  async function previewPdf(): Promise<void> {
    if (!returnId) return;
    setPreviewing(true);
    try {
      await window.blueLedger.printer.previewCreditNotePdf(returnId);
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't create the PDF"));
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <Modal open={returnId !== null} onClose={onClose} title={doc ? `Credit Note ${doc.creditNoteNumber}` : "Credit Note"} widthClassName="max-w-xl">
      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
      ) : !doc ? (
        <div className="flex min-h-[160px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-line p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-extrabold text-ink">{doc.businessName}</p>
                <p className="text-xs font-semibold text-muted">{doc.locationName}</p>
                {doc.locationPhone && <p className="text-xs font-semibold text-muted">{doc.locationPhone}</p>}
              </div>
              <div className="text-right">
                <p className="text-lg font-extrabold tracking-wide text-danger">CREDIT NOTE</p>
                <p className="text-xs font-bold tabular-nums text-ink">{doc.creditNoteNumber}</p>
                <p className="text-[11px] font-semibold text-muted">{formatDate(doc.issuedAt)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-soft px-2.5 py-1.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Customer</p>
                <p className="font-bold text-ink">{doc.customerName ?? "Walk-in customer"}</p>
              </div>
              <div className="rounded-md bg-soft px-2.5 py-1.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Against {doc.againstKind}</p>
                <p className="font-bold tabular-nums text-ink">{doc.againstNumber ?? "—"}</p>
              </div>
            </div>
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] font-extrabold uppercase tracking-wider text-muted">
                  <th className="py-1.5">Product</th>
                  <th className="py-1.5 text-right">Qty</th>
                  <th className="py-1.5 text-right">Unit Price</th>
                  <th className="py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item, index) => (
                  <tr key={index} className="border-b border-line/60">
                    <td className="py-1.5 font-bold text-ink">{item.productName}</td>
                    <td className="py-1.5 text-right tabular-nums">{item.quantity}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatCents(item.unitPriceCents)}</td>
                    <td className="py-1.5 text-right font-bold tabular-nums">{formatCents(item.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 space-y-1 text-xs">
              <div className="flex justify-between font-extrabold text-ink">
                <span>Total credited</span>
                <span className="tabular-nums">{formatCents(doc.totalCents)}</span>
              </div>
              {doc.againstKind === "invoice" && (
                <div className="flex justify-between font-semibold text-muted">
                  <span>Taken off the amount owed</span>
                  <span className="tabular-nums">{formatCents(doc.balanceReductionCents)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-muted">
                <span>Refunded to customer</span>
                <span className="tabular-nums">{formatCents(doc.refundCents)}</span>
              </div>
              {doc.invoiceBalanceCents !== null && (
                <div className="flex justify-between font-bold text-ink">
                  <span>Invoice balance now</span>
                  <span className="tabular-nums">{formatCents(doc.invoiceBalanceCents)}</span>
                </div>
              )}
            </div>
            <p className="mt-3 text-[11px] font-semibold text-muted">
              Reason: <span className="text-ink">{doc.reason}</span>
              {doc.approvedByName ? ` · Approved by ${doc.approvedByName}` : ""}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={() => void previewPdf()} disabled={previewing} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
              {previewing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" /> : <Eye className="mr-1.5 size-3.5" aria-hidden="true" />}
              PDF / Print
            </Button>
            <Button type="button" onClick={() => setSharing(true)} className="h-9 text-xs">
              <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
              Share
            </Button>
          </div>

          <ShareModal
            open={sharing}
            onClose={() => setSharing(false)}
            entity="credit_note"
            entityId={doc.returnId}
            documentLabel={`Credit Note ${doc.creditNoteNumber}`}
            customerId={doc.customerId}
          />
        </div>
      )}
    </Modal>
  );
}
