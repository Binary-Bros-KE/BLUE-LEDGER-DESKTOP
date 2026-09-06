import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { useConfirm } from "@renderer/shared/components/ConfirmModal";
import { Modal } from "@renderer/shared/components/Modal";
import { Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { WebDeliveryMethod } from "@shared/types/online-store";

export function DeliveryPanel(): React.JSX.Element {
  const currency = useAppStore((state) => state.context?.tenant.currency ?? "");
  const confirm = useConfirm();
  const [methods, setMethods] = useState<WebDeliveryMethod[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WebDeliveryMethod | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setMethods(await window.blueLedger.onlineStore.deliveryList());
    } catch (err) {
      setLoadError(getErrorMessage(err, "Couldn't load delivery options"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = useCallback(async (m: WebDeliveryMethod) => {
    setBusyId(m.id);
    try {
      setMethods(await window.blueLedger.onlineStore.deliveryUpdate(m.id, { active: !m.active }));
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't update that option"));
    } finally {
      setBusyId(null);
    }
  }, []);

  const remove = useCallback(
    async (m: WebDeliveryMethod) => {
      const ok = await confirm({
        title: "Remove delivery option?",
        message: `"${m.name}" will no longer be offered at checkout.`,
        confirmLabel: "Remove",
        tone: "danger"
      });
      if (!ok) return;
      try {
        setMethods(await window.blueLedger.onlineStore.deliveryDelete(m.id));
        showSuccessToast(`Removed "${m.name}"`);
      } catch (err) {
        showErrorToast(getErrorMessage(err, "Couldn't remove that option"));
      }
    },
    [confirm]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-sm font-semibold text-muted">
          The choices a shopper sees under &ldquo;Delivery&rdquo; at checkout — a name, an optional
          note (areas covered, timeframe), and a fee added to their total.
        </p>
        <Button onClick={() => setEditing("new")} className="flex-none">
          <Plus className="mr-1.5 size-4" /> Add option
        </Button>
      </div>

      {loadError ? (
        <p className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          {loadError}
        </p>
      ) : !methods ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-white p-6 text-sm font-semibold text-muted shadow-soft">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : methods.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-white p-8 text-center shadow-soft">
          <Truck className="mx-auto size-6 text-muted" />
          <p className="mt-2 text-sm font-bold">No delivery options yet</p>
          <p className="mt-1 text-xs font-semibold text-muted">
            Add at least one so shoppers can check out.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white shadow-soft">
          {methods.map((m) => (
            <li key={m.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-bold", !m.active && "text-muted line-through")}>
                  {m.name}
                </p>
                {m.description ? (
                  <p className="truncate text-[11px] font-semibold text-muted">{m.description}</p>
                ) : null}
              </div>
              <span className="flex-none text-sm font-extrabold tabular-nums">
                {m.priceCents === 0 ? "FREE" : formatCents(m.priceCents)}
              </span>
              <button
                type="button"
                disabled={busyId === m.id}
                onClick={() => void toggleActive(m)}
                className={cn(
                  "relative inline-flex h-6 w-11 flex-none items-center rounded-full border transition",
                  m.active ? "border-success bg-success" : "border-line bg-soft",
                  busyId === m.id && "opacity-50"
                )}
                aria-pressed={m.active}
                aria-label={m.active ? "Hide from checkout" : "Show at checkout"}
              >
                <span
                  className={cn(
                    "inline-block size-4 rounded-full bg-white shadow-soft transition",
                    m.active ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
              <button
                type="button"
                onClick={() => setEditing(m)}
                aria-label={`Edit ${m.name}`}
                className="grid size-8 flex-none place-items-center rounded-md border border-line text-muted transition hover:bg-soft hover:text-ink"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void remove(m)}
                aria-label={`Remove ${m.name}`}
                className="grid size-8 flex-none place-items-center rounded-md border border-line text-danger transition hover:bg-danger-soft"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <DeliveryMethodModal
          method={editing === "new" ? null : editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={(list) => {
            setMethods(list);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DeliveryMethodModal({
  method,
  currency,
  onClose,
  onSaved
}: {
  method: WebDeliveryMethod | null;
  currency: string;
  onClose: () => void;
  onSaved: (list: WebDeliveryMethod[]) => void;
}): React.JSX.Element {
  const [name, setName] = useState(method?.name ?? "");
  const [description, setDescription] = useState(method?.description ?? "");
  const [priceText, setPriceText] = useState(method ? fromCents(method.priceCents) : "");
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!name.trim()) {
      showErrorToast("Give the option a name");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        priceCents: priceText.trim() ? toCents(priceText.trim()) : 0
      };
      const list = method
        ? await window.blueLedger.onlineStore.deliveryUpdate(method.id, payload)
        : await window.blueLedger.onlineStore.deliveryCreate(payload);
      showSuccessToast(method ? "Delivery option saved" : "Delivery option added");
      onSaved(list);
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't save"));
    } finally {
      setSaving(false);
    }
  }, [description, method, name, onSaved, priceText]);

  return (
    <Modal
      open
      onClose={onClose}
      title={method ? "Edit delivery option" : "Add delivery option"}
      widthClassName="max-w-md"
    >
      <div className="space-y-4">
        <Field label="Name" value={name} onChange={setName} placeholder="Within Nairobi CBD" required />
        <TextAreaField
          label="Note (optional) — areas covered / timeframe"
          value={description}
          onChange={setDescription}
          rows={2}
          placeholder="Core CBD · same-day delivery"
        />
        <Field
          label={`Fee (${currency}) — blank or 0 for free`}
          type="text"
          value={priceText}
          onChange={setPriceText}
          placeholder="300.00"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-md border border-line px-4 text-xs font-extrabold uppercase tracking-wide text-muted transition hover:bg-soft hover:text-ink"
          >
            Cancel
          </button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
