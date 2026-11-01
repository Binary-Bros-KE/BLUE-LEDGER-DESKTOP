import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Radio } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { MpesaVerificationMode, MpesaVerificationState } from "@shared/types/mpesa";

const MODE_OPTIONS: Array<{ value: MpesaVerificationMode; label: string; description: string }> = [
  { value: "off", label: "Off", description: "No verification. M-Pesa codes are recorded as typed." },
  { value: "loose", label: "Loose", description: "Cashiers can check and verify payments, but a sale can complete without it." },
  { value: "strict", label: "Strict", description: "An M-Pesa code must verify before the sale can complete." }
];

/** Payment verification for one till. Only appears once till credentials are saved. Strict needs the
 * till connected first: without payment notifications almost nothing could ever verify. */
export function MpesaVerificationSettings({
  locationId,
  refreshKey
}: {
  locationId: string;
  /** Changes when the credentials above are saved, which is what makes this available. */
  refreshKey: number | null;
}): React.JSX.Element | null {
  const [state, setState] = useState<MpesaVerificationState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.blueLedger.mpesa
      .verificationState(locationId)
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locationId, refreshKey]);

  if (!state?.available) return null;

  async function run(action: () => Promise<MpesaVerificationState>, success: string, failure: string): Promise<void> {
    setBusy(true);
    try {
      const next = await action();
      setState(next);
      if (next.connectError) showErrorToast(next.connectError);
      else showSuccessToast(success);
    } catch (err) {
      showErrorToast(getErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-sm font-extrabold text-ink">Payment verification</p>
      <p className="mt-0.5 text-xs font-semibold text-muted">Check M-Pesa codes against real payments received on this till.</p>

      <div className="mt-3 space-y-1.5">
        {MODE_OPTIONS.map((option) => {
          const disabled = busy || (option.value === "strict" && !state.connected);
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() =>
                void run(
                  () => window.blueLedger.mpesa.saveVerificationMode(locationId, option.value),
                  `Verification set to ${option.label}`,
                  "Failed to save verification mode"
                )
              }
              className={cn(
                "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
                state.mode === option.value ? "border-primary bg-primary/5" : "border-line hover:border-accent"
              )}
            >
              <Radio className={cn("mt-0.5 size-3.5 flex-none", state.mode === option.value ? "text-primary" : "text-muted")} aria-hidden="true" />
              <span>
                <span className="block text-xs font-extrabold text-ink">{option.label}</span>
                <span className="block text-[11px] font-semibold text-muted">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-lg bg-soft/60 px-3 py-2">
        {state.connected ? (
          <p className="flex items-center gap-1.5 text-xs font-extrabold text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Receiving payment notifications from Safaricom
          </p>
        ) : (
          <>
            <p className="text-xs font-semibold text-muted">
              Connect this till so Safaricom notifies us of each payment. Until then only STK push payments can be verified, and Strict is unavailable.
            </p>
            {state.connectError && <p className="mt-1 text-[11px] font-bold text-danger">{state.connectError}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() => window.blueLedger.mpesa.connectVerification(locationId), "Till connected", "Failed to connect this till")
              }
              className="mt-2 flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11px] font-extrabold text-white disabled:opacity-50 cursor-pointer"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Connect Till
            </button>
          </>
        )}
      </div>
    </div>
  );
}
