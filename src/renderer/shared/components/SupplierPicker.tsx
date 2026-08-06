import { useMemo, useState } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { Modal } from "@renderer/shared/components/Modal";
import { QuickCreateSupplierModal } from "@renderer/shared/components/QuickCreateSupplierModal";
import { cn } from "@renderer/shared/lib/cn";
import type { Supplier } from "@shared/types/supplier";

/** A searchable supplier picker — a plain `<select>` falls apart once a tenant has more than a
 * handful of suppliers (a real one can have hundreds), forcing a scroll through the entire list to
 * find "+ New Supplier" sitting at the bottom. This instead mirrors the Customer picker's own
 * established pattern (see CheckoutRoute.tsx): a button that opens a modal with search-as-you-type
 * and an always-visible create button up top, never buried.
 *
 * Fully self-contained — owns its own quick-create modal internally, so each cart line can render
 * its own instance without the parent route needing to track "which line's picker is open." New
 * suppliers still need to flow back up to the parent's own list (so every OTHER line's picker also
 * sees it immediately) via onSupplierCreated. */
export function SupplierPicker({
  suppliers,
  value,
  onChange,
  onSupplierCreated
}: {
  suppliers: Supplier[];
  value: string | null;
  onChange: (supplierId: string) => void;
  onSupplierCreated: (supplier: Supplier) => void;
}): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = suppliers.find((supplier) => supplier.id === value) ?? null;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return suppliers;
    return suppliers.filter(
      (supplier) =>
        supplier.businessName.toLowerCase().includes(term) || (supplier.phone1 ?? "").toLowerCase().includes(term)
    );
  }, [suppliers, search]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSearch("");
          setPickerOpen(true);
        }}
        className="mt-1 flex h-10 w-full items-center justify-between rounded-md border border-line bg-white px-3 text-left text-sm font-semibold outline-none transition hover:bg-soft focus:border-accent cursor-pointer"
      >
        <span className={cn("truncate", selected ? "text-ink" : "text-muted")}>
          {selected ? selected.businessName : "Select supplier"}
        </span>
        <ChevronDown className="size-4 flex-none text-muted" aria-hidden="true" />
      </button>

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Choose Local Supplier"
        description="Search by name or phone — or add a new one."
        widthClassName="max-w-md"
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setPickerOpen(false);
              setQuickCreateOpen(true);
            }}
            className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
          >
            <Plus className="size-3" aria-hidden="true" />
            New Supplier
          </button>
        </div>
        <div className="relative mt-1.5">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search suppliers..."
            className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
        </div>
        <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
          {filtered.map((supplier) => (
            <button
              key={supplier.id}
              type="button"
              onClick={() => {
                onChange(supplier.id);
                setPickerOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition cursor-pointer",
                value === supplier.id ? "border-teal bg-teal/10" : "border-line hover:bg-soft"
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-ink">{supplier.businessName}</p>
                {supplier.phone1 && <p className="text-[11px] font-semibold text-muted">{supplier.phone1}</p>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-xs font-semibold text-muted">No suppliers match your search</p>
          )}
        </div>
      </Modal>

      <QuickCreateSupplierModal
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        onCreated={(supplier) => {
          onSupplierCreated(supplier);
          onChange(supplier.id);
          setQuickCreateOpen(false);
        }}
      />
    </>
  );
}
