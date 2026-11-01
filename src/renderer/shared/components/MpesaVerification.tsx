import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { mpesaCodeKey, mpesaStatusForCode } from "@shared/lib/mpesa-verification";
import type {
  MpesaPaymentMatch,
  MpesaVerificationRecord,
  MpesaVerificationState,
  MpesaVerificationSummary,
  MpesaVerifications
} from "@shared/types/mpesa";

/** This storefront's verification state. Null until known, or when the server can't be reached: the
 * controls then simply don't show, and the main process still enforces strict from its cached mode. */
export function useMpesaVerificationState(locationId: string | null | undefined): MpesaVerificationState | null {
  const [state, setState] = useState<MpesaVerificationState | null>(null);
  useEffect(() => {
    let cancelled = false;
    setState(null);
    if (!locationId) return undefined;
    window.blueLedger.mpesa
      .verificationState(locationId)
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locationId]);
  return state;
}

export function mpesaVerificationActive(state: MpesaVerificationState | null): boolean {
  return Boolean(state?.available && state.mode !== "off");
}

/** The small Verified / Not verified indicator. Null (verification wasn't in play) shows nothing. */
export function MpesaStatusPill({ status }: { status: MpesaVerificationSummary | undefined }): React.JSX.Element | null {
  if (!status) return null;
  return status === "verified" ? (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-success/50 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wide text-success">
      <ShieldCheck className="size-2.5" aria-hidden="true" />
      Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-warning/60 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wide text-warning">
      <ShieldAlert className="size-2.5" aria-hidden="true" />
      Not verified
    </span>
  );
}

/**
 * Checkout / payment forms: Check Payment lists unclaimed payments on this till for the amount, and
 * the cashier taps the right one to confirm it. Verify checks a typed code. Either way the code is
 * reserved for this sale (`claimKey`) so it can't be used twice. Strict just means the form won't
 * submit without a verified code; this control behaves the same in both modes.
 */
export function MpesaVerifyControl({
  locationId,
  state,
  amountCents,
  code,
  claimKey,
  verifications,
  onUseCode,
  onVerified
}: {
  locationId: string;
  state: MpesaVerificationState;
  /** What this payment should be for; null skips the amount check (e.g. a split row not filled in yet). */
  amountCents: number | null;
  code: string;
  claimKey: string;
  verifications: MpesaVerifications;
  onUseCode: (code: string) => void;
  onVerified: (code: string, record: MpesaVerificationRecord) => void;
}): React.JSX.Element {
  const [matches, setMatches] = useState<MpesaPaymentMatch[] | null>(null);
  const [busy, setBusy] = useState<"check" | "verify" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const record = code.trim() ? verifications[mpesaCodeKey(code)] : undefined;
  const verified = record?.status === "verified";

  async function checkPayment(): Promise<void> {
    if (!amountCents) {
      setMessage("Enter the amount first.");
      return;
    }
    setBusy("check");
    setMessage(null);
    try {
      const found = await window.blueLedger.mpesa.checkPayment({ locationId, amountCents, claimKey });
      setMatches(found);
      if (found.length === 0) setMessage(`No unclaimed payment of ${formatCents(amountCents)} has reached this till yet.`);
    } catch (err) {
      setMessage(getErrorMessage(err, "Couldn't reach the server to check payments."));
    } finally {
      setBusy(null);
    }
  }

  async function verify(target: string): Promise<void> {
    setBusy("verify");
    setMessage(null);
    try {
      const result = await window.blueLedger.mpesa.verifyCode({ locationId, code: target, amountCents, claimKey });
      if (result.outcome === "verified" && result.record) {
        onUseCode(result.code);
        onVerified(result.code, result.record);
        setMatches(null);
      } else {
        setMessage(result.message);
      }
    } catch (err) {
      setMessage(getErrorMessage(err, "Couldn't reach the server to verify this code."));
    } finally {
      setBusy(null);
    }
  }

  if (verified) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-extrabold text-success">
        <CheckCircle2 className="size-4 flex-none" aria-hidden="true" />
        Verified{record?.payerName ? ` — ${record.payerName}` : ""}
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-line bg-soft/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void checkPayment()}
          disabled={busy !== null}
          className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11px] font-extrabold text-white transition hover:brightness-110 disabled:opacity-50 cursor-pointer"
        >
          {busy === "check" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Search className="size-3.5" aria-hidden="true" />}
          Check Payment
        </button>
        <button
          type="button"
          onClick={() => void verify(code)}
          disabled={busy !== null || !code.trim()}
          className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[11px] font-extrabold text-ink transition hover:bg-soft disabled:opacity-50 cursor-pointer"
        >
          {busy === "verify" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-3.5" aria-hidden="true" />}
          Verify Code
        </button>
        <span className="text-[10px] font-bold text-muted">
          {state.mode === "strict" ? "Required for this storefront" : "Optional"}
        </span>
      </div>

      {matches && matches.length > 0 && (
        <div className="mt-2 space-y-1">
          {matches.map((match) => (
            <button
              key={match.code}
              type="button"
              onClick={() => void verify(match.code)}
              disabled={busy !== null}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-white px-2.5 py-1.5 text-left text-xs transition hover:border-accent cursor-pointer"
            >
              <span className="min-w-0 truncate font-extrabold text-ink">{match.payerName ?? "Name not shared"}</span>
              <span className="flex-none text-[11px] font-bold tabular-nums text-muted">
                {match.code} · {formatCents(match.amountCents)}
              </span>
            </button>
          ))}
        </div>
      )}
      {message && <p className="mt-2 text-[11px] font-bold text-danger">{message}</p>}
    </div>
  );
}

/**
 * Receipt / invoice detail: the indicator for one recorded code, Verify, and (admin only) Try Different
 * Code. A different code replaces the old one only if it verifies and isn't on any other sale; on
 * failure nothing changes and the old code stays.
 */
export function MpesaSaleCodeActions({
  saleId,
  code,
  verifications,
  onChanged
}: {
  saleId: string;
  code: string;
  verifications: MpesaVerifications | null;
  onChanged: () => void | Promise<void>;
}): React.JSX.Element | null {
  const { can } = usePermissions();
  const status = mpesaStatusForCode(verifications, code);
  const [correcting, setCorrecting] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!status) return null;

  async function submit(target: string, replacesCode: string | null): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.blueLedger.mpesa.verifySaleCode({ saleId, code: target, replacesCode });
      if (result.outcome === "verified") {
        showSuccessToast(replacesCode ? `Code changed to ${result.code} and verified` : `${result.code} verified`);
        setCorrecting(false);
        setNewCode("");
        await onChanged();
      } else {
        setMessage(replacesCode ? `${result.message} The sale keeps ${code}.` : result.message);
      }
    } catch (err) {
      const text = getErrorMessage(err, "Couldn't verify this code.");
      setMessage(text);
      showErrorToast(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2">
        <MpesaStatusPill status={status} />
        {status === "unverified" && (
          <button
            type="button"
            onClick={() => void submit(code, null)}
            disabled={busy}
            className="flex items-center gap-1 text-[10px] font-extrabold uppercase text-accent hover:underline disabled:opacity-50 cursor-pointer"
          >
            {busy ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3" aria-hidden="true" />}
            Verify
          </button>
        )}
        {status === "unverified" && can("approvals", "approve") && (
          <button
            type="button"
            onClick={() => setCorrecting((value) => !value)}
            className="text-[10px] font-extrabold uppercase text-muted hover:underline cursor-pointer"
          >
            Try different code
          </button>
        )}
      </div>
      {correcting && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            value={newCode}
            onChange={(event) => setNewCode(event.target.value.toUpperCase())}
            placeholder="Correct M-Pesa code"
            className="h-8 w-40 rounded-md border border-line px-2 text-xs font-bold outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void submit(newCode, code)}
            disabled={busy || !newCode.trim()}
            className="h-8 rounded-md bg-primary px-2.5 text-[11px] font-extrabold text-white disabled:opacity-50 cursor-pointer"
          >
            Verify &amp; Replace
          </button>
        </div>
      )}
      {message && <p className="mt-1 text-[11px] font-bold text-danger">{message}</p>}
    </div>
  );
}
