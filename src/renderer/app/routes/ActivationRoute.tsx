import { useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, Loader2 } from "lucide-react";
import { Field } from "@renderer/shared/components/form-fields";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { useAppStore } from "@renderer/shared/stores/app-store";

const PUNCH_COUNT = 3;

/** Shown instead of the normal app (and instead of employee LoginRoute) whenever this install has
 * never been activated — see TenantContext.activated. A fresh install can't be used at all until
 * this succeeds; there's no offline path here (only an already-activated install works offline). */
export function ActivationRoute(): React.JSX.Element {
  const hydrate = useAppStore((state) => state.hydrate);

  const [licenseKey, setLicenseKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await window.blueLedger.activation.activate(licenseKey);
      await hydrate();
    } catch (err) {
      setError(getErrorMessage(err, "Activation failed"));
    } finally {
      setSubmitting(false);
    }
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

      {/* max-w caps the gap this justify-between row leaves between the headline and the card on a
          screen much wider than the ~1440px this was designed around. flex-wrap is the other half
          of the fix: on a screen NARROWER than that (a small monitor, an unusual resolution, or a
          window forced into a size the desktop couldn't fully control), the headline and the card
          no longer have room to sit side by side at their natural sizes — instead of one of them
          getting silently clipped off the visible screen, they now drop to their own stacked rows,
          exactly like a normal responsive webpage would. min-w-0 lets the headline's own box shrink
          instead of forcing the whole row wider than its container; the responsive text-size scale
          below (36px up to 72px only once there's room) is what stops the headline's own glyphs from
          demanding more width than a narrow window has to give in the first place. */}
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-16 gap-y-10">
        <div className="min-w-0 flex flex-1 flex-col items-start text-left">
          <h2 className="text-4xl font-extrabold uppercase leading-[0.95] text-white sm:text-5xl md:text-6xl lg:text-[72px]">
            Track
            <br />
            Sell
            <br />
            Grow.
          </h2>
        </div>

        <div className="relative w-full max-w-[380px] flex-shrink sm:max-w-none sm:flex-none sm:w-[380px]">
          <div
            className="absolute -left-4 -top-4 size-16 rounded-md bg-warning"
            style={{ transform: "rotate(-18deg)" }}
            aria-hidden="true"
          />

          <span
            className="pointer-events-none absolute -left-[103px] top-8 z-10 size-3 rounded-full border-2 border-white/25 bg-sidebar max-sm:hidden"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -left-[97px] bottom-8 top-8 z-10 border-l-2 border-dashed border-white/20 max-sm:hidden"
            aria-hidden="true"
          />
          <span
            className="pointer-events-none absolute -left-[103px] bottom-8 z-10 size-3 rounded-full border-2 border-white/25 bg-sidebar max-sm:hidden"
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="relative z-[1] w-full overflow-hidden rounded-2xl bg-white p-8 shadow-soft"
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

            <p className="text-[11px] font-extrabold uppercase tracking-widest text-teal">Activate This Installation</p>
            <h1 className="mt-1 text-2xl font-extrabold leading-tight">Welcome to Blue Ledger</h1>
            <p className="mt-1 text-xs font-semibold text-muted">
              Enter the license key you received from Blue Ledger to get started. This needs an internet connection —
              only once.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {error && (
                <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs font-bold text-danger">
                  {error}
                </div>
              )}

              <Field
                label="License Key"
                value={licenseKey}
                onChange={setLicenseKey}
                placeholder="Paste your license key"
                required
              />

              <button
                type="submit"
                disabled={submitting || !licenseKey.trim()}
                className="mt-2 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary text-sm font-extrabold uppercase tracking-wide text-white shadow-[4px_4px_0_0_rgba(6,30,100,0.35)] transition active:translate-x-[3px] active:translate-y-[3px] active:shadow-[1px_1px_0_0_rgba(6,30,100,0.35)] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-x-0 disabled:active:translate-y-0"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRound className="size-4" aria-hidden="true" />
                )}
                {submitting ? "Activating..." : "Activate"}
              </button>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
