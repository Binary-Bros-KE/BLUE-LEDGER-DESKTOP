import { useState } from "react";
import { AlertTriangle, ArrowLeftRight, Loader2, PackagePlus, Tag, Undo2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import type { MainStoreProductRow } from "@shared/types/main-store";

type Mode = "receive" | "distribute" | "return" | "reallocate" | "damage";

const MODE_TABS: Array<{ value: Mode; label: string; icon: typeof PackagePlus }> = [
  { value: "receive", label: "Receive", icon: PackagePlus },
  { value: "distribute", label: "Distribute", icon: ArrowLeftRight },
  { value: "return", label: "Return", icon: Undo2 },
  { value: "reallocate", label: "Allocate", icon: Tag },
  { value: "damage", label: "Damage", icon: AlertTriangle }
];

export function MainStoreStockModal({
  product,
  onClose,
  onChanged
}: {
  product: MainStoreProductRow;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("receive");
  const [receiveTarget, setReceiveTarget] = useState<"main_store" | "storefront">("main_store");

  const [storefrontId, setStorefrontId] = useState("");
  const [fromStorefrontId, setFromStorefrontId] = useState("");
  const [toStorefrontId, setToStorefrontId] = useState(product.storefronts[0]?.storefrontId ?? "");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function resetForm(): void {
    setReceiveTarget("main_store");
    setStorefrontId("");
    setFromStorefrontId("");
    setToStorefrontId(product.storefronts[0]?.storefrontId ?? "");
    setQuantity("");
    setNotes("");
    setActionError(null);
  }

  function switchMode(next: Mode): void {
    setMode(next);
    setNotice(null);
    resetForm();
  }

  const storefrontOptions = product.storefronts.map((entry) => ({
    value: entry.storefrontId,
    label: entry.storefrontName
  }));
  const bucketOptions = [{ value: "", label: "Unallocated" }, ...storefrontOptions];

  const modeCopy: Record<Mode, string> = {
    receive:
      receiveTarget === "storefront"
        ? "Records new stock straight onto that storefront's own shelf — skips Main Store entirely. Handy if you only run one storefront."
        : "Records new stock arriving at Main Store, earmarked for a storefront (or left unallocated).",
    distribute: "Ships stock from Main Store to a storefront — draws from what's earmarked for them first.",
    return: "Returns stock from a storefront back to Main Store, staying earmarked for them.",
    reallocate:
      "Marks Main Store stock as belonging to a specific storefront (or moves it back to Unallocated) — pure bookkeeping, nothing physically ships. This is how stock gets earmarked for a store before Distribute actually sends it there.",
    damage: "Records damaged or lost stock, reducing a specific bucket at Main Store."
  };

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setActionError(null);
    setNotice(null);

    const quantityNumber = Number(quantity);
    if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) {
      setActionError("Enter a quantity greater than 0");
      setSaving(false);
      return;
    }

    try {
      if (mode === "receive" && receiveTarget === "storefront") {
        if (!storefrontId) throw new Error("Choose a storefront");
        await window.blueLedger.stockMovement.create({
          productId: product.productId,
          locationId: storefrontId,
          movementType: "purchase",
          quantityChange: quantityNumber,
          notes
        });
      } else if (mode === "receive") {
        await window.blueLedger.mainStore.receive({
          productId: product.productId,
          storefrontId: storefrontId || null,
          quantity: quantityNumber,
          notes
        });
      } else if (mode === "distribute") {
        if (!storefrontId) throw new Error("Choose a storefront");
        await window.blueLedger.mainStore.distribute({
          productId: product.productId,
          storefrontId,
          quantity: quantityNumber,
          notes
        });
      } else if (mode === "return") {
        if (!storefrontId) throw new Error("Choose a storefront");
        await window.blueLedger.mainStore.returnStock({
          productId: product.productId,
          storefrontId,
          quantity: quantityNumber,
          notes
        });
      } else if (mode === "damage") {
        await window.blueLedger.mainStore.damage({
          productId: product.productId,
          storefrontId: storefrontId || null,
          quantity: quantityNumber,
          notes
        });
      } else {
        await window.blueLedger.mainStore.reallocate({
          productId: product.productId,
          fromStorefrontId: fromStorefrontId || null,
          toStorefrontId: toStorefrontId || null,
          quantity: quantityNumber
        });
      }
      onChanged();
      resetForm();
      setNotice("Saved.");
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to update stock"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={product.productName}
      description={`SKU ${product.sku} — Manage Main Store stock`}
      widthClassName="max-w-lg"
    >
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-soft p-1">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => switchMode(tab.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
              mode === tab.value ? "bg-primary text-white" : "text-muted hover:bg-white"
            )}
          >
            <tab.icon className="size-3.5" aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="mt-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-bold text-success">
          {notice}
        </div>
      )}
      {actionError && (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
          {actionError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <p className="text-[11px] font-semibold text-muted">{modeCopy[mode]}</p>

        {mode === "receive" && (
          <>
            <div className="flex gap-1.5 rounded-lg border border-line bg-white p-1">
              <button
                type="button"
                onClick={() => {
                  setReceiveTarget("main_store");
                  setStorefrontId("");
                }}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
                  receiveTarget === "main_store" ? "bg-primary text-white" : "text-muted hover:bg-soft"
                )}
              >
                Into Main Store
              </button>
              <button
                type="button"
                onClick={() => {
                  setReceiveTarget("storefront");
                  setStorefrontId(product.storefronts[0]?.storefrontId ?? "");
                }}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
                  receiveTarget === "storefront" ? "bg-primary text-white" : "text-muted hover:bg-soft"
                )}
              >
                Direct to Storefront
              </button>
            </div>
            {receiveTarget === "main_store" ? (
              <SelectField label="Destination" value={storefrontId} onChange={setStorefrontId} options={bucketOptions} />
            ) : (
              <SelectField label="Storefront" value={storefrontId} onChange={setStorefrontId} options={storefrontOptions} />
            )}
          </>
        )}
        {mode === "damage" && (
          <SelectField label="Which bucket" value={storefrontId} onChange={setStorefrontId} options={bucketOptions} />
        )}
        {(mode === "distribute" || mode === "return") && (
          <SelectField label="Storefront" value={storefrontId} onChange={setStorefrontId} options={storefrontOptions} />
        )}
        {mode === "reallocate" && (
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="From" value={fromStorefrontId} onChange={setFromStorefrontId} options={bucketOptions} />
            <SelectField label="To" value={toStorefrontId} onChange={setToStorefrontId} options={bucketOptions} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" type="number" value={quantity} onChange={setQuantity} placeholder="e.g. 10" required />
          <div className="flex items-end">
            <Button type="submit" disabled={saving} className="h-10 w-full text-xs disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {saving ? "Saving..." : "Confirm"}
            </Button>
          </div>
        </div>
        {mode !== "reallocate" && (
          <TextAreaField label="Notes" value={notes} onChange={setNotes} rows={2} placeholder="Optional" />
        )}
      </form>

      <div className="mt-5 flex justify-end border-t border-line pt-4">
        <Button type="button" onClick={onClose} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
          Close
        </Button>
      </div>
    </Modal>
  );
}
