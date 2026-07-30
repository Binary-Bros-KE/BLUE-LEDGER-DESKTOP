import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, LogIn } from "lucide-react";
import { Field } from "@renderer/shared/components/form-fields";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { useAuthStore } from "@renderer/shared/stores/auth-store";
import { computeGraceStatus } from "@shared/lib/grace-period";

const PUNCH_COUNT = 3;

export function LoginRoute(): React.JSX.Element {
  const context = useAppStore((state) => state.context);
  const hydrate = useAppStore((state) => state.hydrate);
  const login = useAuthStore((state) => state.login);
  const error = useAuthStore((state) => state.error);

  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Every time this screen is reached — first launch or a logout — re-check the license live
    // instead of waiting for the boot/4-hour timer. Non-blocking: the form renders immediately;
    // if this reveals a suspension, App.tsx's context change swaps this screen out for
    // LicenseBlockedRoute on its own. checkInWithServer() never throws, so this is always safe
    // to fire and forget even with no internet.
    void window.blueLedger.activation.heartbeat().then(() => hydrate());
  }, [hydrate]);

  const grace = context
    ? computeGraceStatus(context.tenant.nextDueDate, context.tenant.subscriptionType, context.tenant.licenseStatus)
    : { state: "current" as const };

  // The exact overdue-period count, for a specific "you have N overdue invoices" message instead
  // of a vague day-countdown — same schedule data PayNowModal/LicenseBlockedRoute already use, so
  // this can never disagree with what those show. Best-effort: falls back to a generic message
  // below if this hasn't loaded yet or the device is offline (this screen must still work offline).
  const [owedCount, setOwedCount] = useState<number | null>(null);

  useEffect(() => {
    if (grace.state !== "grace") {
      setOwedCount(null);
      return;
    }
    let cancelled = false;
    void window.blueLedger.activation
      .paymentSchedule()
      .then((result) => {
        if (cancelled || !result) return;
        const owed = result.periods.filter((entry) => entry.status === "overdue" || entry.status === "due").length;
        setOwedCount(owed);
      })
      .catch(() => {
        // Offline or transient failure — the generic fallback message below covers this.
      });
    return () => {
      cancelled = true;
    };
  }, [grace.state]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    await login(employeeCode, pin);
    setSubmitting(false);
  }

  return (
    <div
      className="relative flex h-screen w-full items-center overflow-hidden bg-sidebar px-12 lg:px-24"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
        backgroundSize: "42px 42px"
      }}
    >
      <div className="absolute left-25 top-7 flex items-center gap-2">
        <img src="./resources/icons/BLUE_LEDGER.png" alt="" className="size-6 rounded-md" />
        <span className="text-xs font-extrabold uppercase tracking-wide text-white">Blue Ledger</span>
      </div>
      <div className="absolute right-25 top-7 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.2em] text-white/45">
        Point of Sale <span className="text-white/20">·</span> POS
      </div>

      {/* max-w caps the gap this justify-between row leaves between the headline and the card —
          uncapped, that gap just kept growing on a monitor much wider than the ~1440px this was
          designed around, which is what actually made the screen look sparse/off on a large
          landscape display (nothing was broken, it just had nothing to stop stretching). */}
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-16">
        <div className="flex flex-1 flex-col items-start text-left">
          <h2 className="text-[56px] font-extrabold uppercase leading-[0.95] text-white lg:text-[72px]">
            Track
            <br />
            Sell
            <br />
            Grow.
          </h2>
        </div>

        <div className="relative flex-none">
          <div
            className="absolute -left-4 -top-4 size-16 rounded-md bg-warning"
            style={{ transform: "rotate(-18deg)" }}
            aria-hidden="true"
          />

          <span
            className="pointer-events-none absolute -left-[103px] top-8 z-10 size-3 rounded-full border-2 border-white/25 bg-sidebar"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -left-[97px] bottom-8 top-8 z-10 border-l-2 border-dashed border-white/20"
            aria-hidden="true"
          />
          <span
            className="pointer-events-none absolute -left-[103px] bottom-8 z-10 size-3 rounded-full border-2 border-white/25 bg-sidebar"
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="relative z-[1] w-[380px] overflow-hidden rounded-2xl bg-white p-8 shadow-soft"
          >
            {Array.from({ length: PUNCH_COUNT }).map((_, i) => (
              <span
                key={`punch-l-${i}`}
                className="pointer-events-none absolute -left-2.5 size-5 rounded-full bg-sidebar"
                style={{ top: `${i * 150 + 30}px` }}
                aria-hidden="true"
              />
            ))}
            {Array.from({ length: PUNCH_COUNT }).map((_, i) => (
              <span
                key={`punch-r-${i}`}
                className="pointer-events-none absolute -right-2.5 size-5 rounded-full bg-sidebar"
                style={{ top: `${i * 150 + 30}px` }}
                aria-hidden="true"
              />
            ))}

            <p className="text-[11px] font-extrabold uppercase tracking-widest text-teal">
              Employee Sign-In
            </p>
            <h1 className="mt-1 text-2xl font-extrabold leading-tight">
              Sign in to {context?.tenant.businessName ?? "Blue Ledger"}
            </h1>
            <p className="mt-1 text-xs font-semibold text-muted">
              Enter your employee code and 6-digit PIN.
            </p>

            {grace.state === "grace" && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs font-bold text-warning">
                <AlertTriangle className="mt-0.5 size-4 flex-none" aria-hidden="true" />
                <span>
                  {owedCount !== null && owedCount > 0 ? (
                    <>
                      You have {owedCount} overdue invoice{owedCount === 1 ? "" : "s"}. Please settle{" "}
                      {owedCount === 1 ? "it" : "them"} to avoid any inconvenience.
                    </>
                  ) : (
                    <>Your subscription payment is overdue. Please settle it to avoid any inconvenience.</>
                  )}
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {error && (
                <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs font-bold text-danger">
                  {error}
                </div>
              )}

              <Field
                label="Employee Code"
                value={employeeCode}
                onChange={setEmployeeCode}
                placeholder="e.g. EMP-001"
                required
              />
              <Field
                label="PIN"
                type="password"
                maxLength={20}
                value={pin}
                onChange={setPin}
                placeholder="6-digit PIN"
                required
              />

              <button
                type="submit"
                disabled={submitting || !employeeCode || !pin}
                className="mt-2 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary text-sm font-extrabold uppercase tracking-wide text-white shadow-[4px_4px_0_0_rgba(6,30,100,0.35)] transition active:translate-x-[3px] active:translate-y-[3px] active:shadow-[1px_1px_0_0_rgba(6,30,100,0.35)] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-x-0 disabled:active:translate-y-0"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn className="size-4" aria-hidden="true" />
                )}
                {submitting ? "Signing in..." : "Sign In"}
              </button>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
