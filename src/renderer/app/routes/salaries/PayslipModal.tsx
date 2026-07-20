import { useState } from "react";
import { format } from "date-fns";
import { Ban, CheckCircle2, Download, Loader2, RotateCcw, Share2, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { useConfirm } from "@renderer/shared/components/ConfirmModal";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Salary } from "@shared/types/salary";

function formatPayPeriodLabel(payPeriod: string): string {
  try {
    const [year, month] = payPeriod.split("-").map(Number);
    return new Date(year ?? 0, (month ?? 1) - 1, 1).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric"
    });
  } catch {
    return payPeriod;
  }
}

function formatDate(value: string): string {
  try {
    return format(new Date(value), "MMM d, yyyy · HH:mm");
  } catch {
    return value;
  }
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-soft px-3 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

export function PayslipModal({
  salary,
  canVoid,
  canRestore,
  canComplete,
  onClose,
  onChanged,
  onCompleteRequested
}: {
  salary: Salary;
  canVoid: boolean;
  canRestore: boolean;
  canComplete: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  /** Opens the "Complete Payslip" form for this draft — owned by the parent route since it's the
   * same SalaryFormModal the "Process Salary" button uses, just pre-filled. */
  onCompleteRequested: (salary: Salary) => void;
}): React.JSX.Element {
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"download" | "share" | "void" | "restore" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(): Promise<void> {
    setBusy("download");
    setError(null);
    setNotice(null);
    try {
      const savedPath = await window.blueLedger.printer.generateSalaryPdf(salary.id);
      if (savedPath) setNotice(`Saved to ${savedPath}`);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to generate PDF"));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare(): Promise<void> {
    setBusy("share");
    setError(null);
    setNotice(null);
    try {
      const result = await window.blueLedger.printer.shareSalaryPayslip(salary.id);
      if (result.success) setNotice(result.message);
      else setError(result.message);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to prepare payslip for sharing"));
    } finally {
      setBusy(null);
    }
  }

  async function handleVoid(): Promise<void> {
    const confirmed = await confirm({
      title: "Void payslip?",
      message: `${salary.payslipNumber} will stay on record but be marked Voided.`,
      tone: "danger",
      confirmLabel: "Void Payslip"
    });
    if (!confirmed) return;

    setBusy("void");
    setError(null);
    try {
      await window.blueLedger.salary.void(salary.id);
      await onChanged();
      showSuccessToast("Payslip voided");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to void payslip");
      setError(message);
      showErrorToast(message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteDraft(): Promise<void> {
    const confirmed = await confirm({
      title: "Delete draft?",
      message: `This removes ${salary.payslipNumber} and the deductions recorded on it. This can't be undone.`,
      tone: "danger",
      confirmLabel: "Delete Draft"
    });
    if (!confirmed) return;

    setBusy("delete");
    setError(null);
    try {
      await window.blueLedger.salary.deleteAdvance(salary.id);
      showSuccessToast("Draft deleted");
      onClose();
      await onChanged();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to delete draft");
      setError(message);
      showErrorToast(message);
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore(): Promise<void> {
    setBusy("restore");
    setError(null);
    try {
      await window.blueLedger.salary.restore(salary.id);
      await onChanged();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to restore payslip"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={salary.payslipNumber}
      description={`${salary.employeeName} · ${formatPayPeriodLabel(salary.payPeriod)}`}
      widthClassName="max-w-lg"
    >
      {notice && (
        <div className="mb-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-bold text-success">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
          {error}
        </div>
      )}

      <DashedPill tone={salary.status === "active" ? "success" : salary.status === "draft" ? "warning" : "neutral"}>
        {salary.status === "active" ? "Complete" : salary.status === "draft" ? "Draft" : "Voided"}
      </DashedPill>
      {salary.status === "draft" && (
        <p className="mt-2 text-xs font-semibold text-muted">
          Nothing's been paid out yet — this is just the advance recorded so far. Complete the payslip at
          month-end to finish processing it.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <InfoRow label="Employee" value={salary.employeeName} />
        <InfoRow label="Employee Code" value={salary.employeeCode} />
        <InfoRow label="Pay Period" value={formatPayPeriodLabel(salary.payPeriod)} />
        <InfoRow label="Payment Method" value={salary.paymentMethodName ?? "—"} />
        <InfoRow label="Reference" value={salary.paymentReference ?? "—"} />
        <InfoRow label="Processed On" value={formatDate(salary.createdAt)} />
      </div>

      <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between text-muted">
          <span className="font-semibold">Basic Salary</span>
          <span className="font-bold tabular-nums">{formatCents(salary.basicSalaryCents)}</span>
        </div>
        {salary.allowances.map((item) => (
          <div key={`allowance-${item.name}`} className="flex justify-between text-muted">
            <span className="font-semibold">{item.name}</span>
            <span className="font-bold tabular-nums">{formatCents(item.amountCents)}</span>
          </div>
        ))}
        {salary.deductions.map((item) => (
          <div key={`deduction-${item.name}`} className="flex justify-between text-muted">
            <span className="font-semibold">{item.name}</span>
            <span className="font-bold tabular-nums">-{formatCents(item.amountCents)}</span>
          </div>
        ))}
        <div className="flex justify-between text-base font-extrabold text-ink">
          <span>Net Pay</span>
          <span>{formatCents(salary.netPayCents)}</span>
        </div>
      </div>

      {salary.notes && (
        <div className="mt-4 rounded-lg border border-line bg-soft px-3.5 py-2.5">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Notes</p>
          <p className="mt-1 whitespace-pre-line text-sm font-semibold text-ink">{salary.notes}</p>
        </div>
      )}

      {salary.status === "draft" ? (
        <div className="mt-5 border-t border-line pt-4">
          {canComplete && (
            <Button
              type="button"
              onClick={() => onCompleteRequested(salary)}
              disabled={busy !== null}
              className="h-9 w-full text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" />
              Complete Payslip
            </Button>
          )}
          {canVoid && (
            <Button
              type="button"
              onClick={() => void handleDeleteDraft()}
              disabled={busy !== null}
              className="mt-2 h-9 w-full border border-danger/30 bg-white text-xs text-danger shadow-none hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "delete" ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="mr-1.5 size-3.5" aria-hidden="true" />
              )}
              Delete Draft
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-2 border-t border-line pt-4">
          <Button
            type="button"
            onClick={() => void handleDownload()}
            disabled={busy !== null}
            className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "download" ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            Download PDF
          </Button>
          <Button
            type="button"
            onClick={() => void handleShare()}
            disabled={busy !== null}
            className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "share" ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            Share
          </Button>
        </div>
      )}

      {salary.status === "active" && canVoid && (
        <div className="mt-2">
          <Button
            type="button"
            onClick={() => void handleVoid()}
            disabled={busy !== null}
            className="h-9 w-full border border-danger/30 bg-white text-xs text-danger shadow-none hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "void" ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Ban className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            Void Payslip
          </Button>
        </div>
      )}
      {salary.status === "voided" && canRestore && (
        <div className="mt-2">
          <Button
            type="button"
            onClick={() => void handleRestore()}
            disabled={busy !== null}
            className="h-9 w-full border border-success/40 bg-white text-xs text-success shadow-none hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "restore" ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            Restore Payslip
          </Button>
        </div>
      )}
    </Modal>
  );
}
