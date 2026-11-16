import { useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Loader2, PiggyBank, Plus } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { PayNowModal } from "@renderer/shared/components/PayNowModal";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { computeBalanceReminder } from "@shared/lib/balance-reminder";
import type { WalletEntry, WalletSummary } from "@shared/types/subscription-payment";

const KIND_LABEL: Record<string, string> = { TOPUP: "Top-up", DEDUCTION: "Paid", ADJUSTMENT: "Adjustment" };

function entryTitle(entry: WalletEntry): string {
  if (entry.kind === "DEDUCTION") return `Paid ${entry.billingPeriod ?? ""}`.trim();
  return entry.note && entry.note !== "Top-up" ? entry.note : (KIND_LABEL[entry.kind] ?? entry.kind);
}

/**
 * The prepaid balance (SERVER subscription-wallet-service.ts): top up any amount, and each period is
 * paid from it automatically when it falls due — before any overdue warning. Shows the balance, what
 * it covers, a reminder when the next payment isn't covered, Top Up, and the balance's own statement.
 */
export function BalanceSection({ onChanged }: { onChanged: () => void }): React.JSX.Element {
  const tenant = useAppStore((state) => state.context?.tenant ?? null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  function load(): void {
    void window.blueLedger.activation
      .wallet()
      .then(setWallet)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const reminder = wallet
    ? computeBalanceReminder({
        nextDueDate: wallet.nextDueDate,
        walletBalanceCents: wallet.balanceCents,
        pricePerPeriodCents: wallet.pricePerPeriodCents,
        licenseStatus: tenant?.licenseStatus
      })
    : null;
  const periodNoun = wallet?.billingCycle === "YEARLY" ? "year" : "month";
  const recurring = wallet !== null && wallet.pricePerPeriodCents !== null;
  const entries = wallet ? (showAll ? wallet.entries : wallet.entries.slice(0, 6)) : [];

  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Blue Ledger Management</p>
          <h2 className="mt-1 text-xl font-extrabold">Balance</h2>
          <p className="mt-1 text-xs font-semibold text-muted">
            Top up any amount — each {periodNoun}'s payment is taken from your balance automatically when it falls due.
          </p>
        </div>
        {recurring && (
          <Button type="button" onClick={() => setTopUpOpen(true)} className="h-9 text-xs">
            <Plus className="mr-1.5 size-4" aria-hidden="true" />
            Top Up
          </Button>
        )}
      </div>

      {loading ? (
        <div className="mt-5 flex items-center justify-center py-8 text-muted">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      ) : !wallet ? (
        <p className="mt-5 rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3 text-xs font-semibold text-muted">
          Unable to load your balance — check your internet connection and reopen this page.
        </p>
      ) : !recurring ? (
        <p className="mt-5 rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3 text-xs font-semibold text-muted">
          Your plan has no recurring payment, so there's nothing to top up.
        </p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 sm:col-span-1">
              <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-muted">
                <PiggyBank className="size-3.5" aria-hidden="true" />
                Balance
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-ink">
                {wallet.currency} {formatCents(wallet.balanceCents)}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-soft px-4 py-3">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Covers</p>
              <p className="mt-1 text-sm font-extrabold text-ink">
                {wallet.periodsCovered} {periodNoun}
                {wallet.periodsCovered === 1 ? "" : "s"}
              </p>
              <p className="text-[11px] font-semibold text-muted">
                at {wallet.currency} {formatCents(wallet.pricePerPeriodCents ?? 0)} a {periodNoun}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-soft px-4 py-3">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Next payment</p>
              <p className="mt-1 text-sm font-extrabold text-ink">
                {wallet.nextDueDate ? format(new Date(wallet.nextDueDate), "PP") : "—"}
              </p>
              <p className={cn("text-[11px] font-semibold", wallet.nextDueUncovered ? "text-warning" : "text-success")}>
                {wallet.nextDueUncovered ? "Not covered by your balance" : "Covered by your balance"}
              </p>
            </div>
          </div>

          {reminder && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs font-bold text-ink">
              <AlertTriangle className="mt-0.5 size-4 flex-none text-warning" aria-hidden="true" />
              Your balance ({wallet.currency} {formatCents(reminder.balanceCents)}) won't cover the {wallet.currency}{" "}
              {formatCents(reminder.priceCents)} due {format(new Date(reminder.dueDate), "PP")} — top up at least {wallet.currency}{" "}
              {formatCents(reminder.shortByCents)}.
            </div>
          )}

          <div className="mt-5">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Balance history</p>
            {wallet.entries.length === 0 ? (
              <p className="mt-2 text-xs font-semibold text-muted">No top-ups yet.</p>
            ) : (
              <div className="mt-2 divide-y divide-line rounded-lg border border-line">
                {entries.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{entryTitle(entry)}</p>
                      <p className="text-[11px] font-semibold text-muted">
                        {format(new Date(entry.createdAt), "PP p")}
                        {entry.paymentMethod && entry.kind !== "DEDUCTION" ? ` · ${entry.paymentMethod}` : ""}
                        {entry.reference ? ` · ${entry.reference}` : ""}
                      </p>
                    </div>
                    <div className="flex-none text-right">
                      <p className={cn("text-sm font-extrabold tabular-nums", entry.amountCents < 0 ? "text-ink" : "text-success")}>
                        {entry.amountCents < 0 ? "−" : "+"}
                        {formatCents(Math.abs(entry.amountCents))}
                      </p>
                      <p className="text-[11px] font-semibold tabular-nums text-muted">Balance {formatCents(entry.balanceAfterCents)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {wallet.entries.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="mt-2 text-[11px] font-extrabold uppercase tracking-wider text-accent hover:underline cursor-pointer"
              >
                {showAll ? "Show less" : `Show all ${wallet.entries.length}`}
              </button>
            )}
          </div>
        </>
      )}

      <PayNowModal
        open={topUpOpen}
        mode="topup"
        onClose={() => setTopUpOpen(false)}
        onPaymentSuccess={() => {
          load();
          onChanged();
        }}
      />
    </section>
  );
}
