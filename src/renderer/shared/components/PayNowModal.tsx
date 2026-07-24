import { useState } from "react";
import { CreditCard, Landmark, Smartphone, Wallet } from "lucide-react";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";

const PAYMENT_METHODS = [
  { key: "mpesa", label: "M-Pesa", icon: Smartphone },
  { key: "airtel", label: "Airtel Money", icon: Smartphone },
  { key: "card", label: "Card", icon: CreditCard },
  { key: "paypal", label: "PayPal", icon: Wallet },
  { key: "bank", label: "Bank Transfer", icon: Landmark }
] as const;

/** Payment-method picker shown wherever a tenant needs to pay their Blue Ledger bill — the
 * subscription is overdue (grace-period warning/lockout) or they're settling a specific pending
 * invoice from Business Profile. Every method is a placeholder for now: no online payment
 * processing exists yet, only the recording side (SubscriptionPayment on the cloud registry).
 * Selecting one just surfaces a "not wired up yet" note rather than doing anything, exactly as
 * requested — this is a preview of the flow, not a working checkout. */
export function PayNowModal({
  open,
  onClose,
  amountLabel
}: {
  open: boolean;
  onClose: () => void;
  amountLabel?: string | undefined;
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onClose={() => {
        setSelected(null);
        onClose();
      }}
      title="Pay Now"
      description={amountLabel ? `Settle ${amountLabel} with Blue Ledger.` : "Choose a payment method to settle your Blue Ledger account."}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PAYMENT_METHODS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelected(key)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border px-3 py-5 text-xs font-bold transition cursor-pointer",
              selected === key
                ? "border-accent bg-accent/10 text-accent"
                : "border-line bg-soft text-ink hover:border-accent/50 hover:bg-accent/5"
            )}
          >
            <Icon className="size-6" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {selected && (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3 text-xs font-semibold text-muted">
          Online payments through {PAYMENT_METHODS.find((m) => m.key === selected)?.label} aren't
          wired up yet — this is a preview of how you'll pay once it's live. Contact Blue Ledger
          support in the meantime to settle your account.
        </p>
      )}
    </Modal>
  );
}
