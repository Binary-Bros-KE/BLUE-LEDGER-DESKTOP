import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { StampBadge } from "@renderer/shared/components/StampBadge";

const demoItems = [
  { name: "Premium Notebook", qty: 1, price: "KES 850" },
  { name: "Thermal Receipt Roll", qty: 2, price: "KES 400" },
  { name: "Barcode Label Pack", qty: 1, price: "KES 1,200" }
];

export function SalesTerminal(): React.JSX.Element {
  return (
    <section className="relative rounded-lg border border-line bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-teal">
            Point Of Sale
          </p>
          <h2 className="mt-1 text-lg font-extrabold">New Sale</h2>
        </div>
        <div className="flex items-center gap-3">
          <StampBadge label="Open" sublabel="Sale" tone="danger" rotate={-10} className="w-14" />
          <Button className="h-9 text-xs">Checkout</Button>
        </div>
      </div>

      <div className="mt-4 flex h-11 items-center gap-3 rounded-lg border border-line bg-soft px-3.5">
        <Search className="size-4 text-muted" aria-hidden="true" />
        <input
          className="h-full flex-1 bg-transparent text-sm font-semibold outline-none placeholder:font-normal placeholder:text-muted/60"
          placeholder="Search product, scan barcode, or enter custom item"
        />
      </div>

      <div className="mt-4 space-y-2.5">
        {demoItems.map((item) => (
          <div
            key={item.name}
            className="grid grid-cols-[1fr_120px_96px_36px] items-center gap-3.5 rounded-lg border border-line bg-white px-3.5 py-2.5"
          >
            <div>
              <p className="text-sm font-extrabold">{item.name}</p>
              <p className="text-xs font-semibold text-muted">Local inventory item</p>
            </div>
            <div className="flex h-9 items-center justify-between rounded-lg bg-soft px-2">
              <button className="grid size-7 place-items-center rounded-md hover:bg-white" type="button">
                <Minus className="size-3.5" aria-hidden="true" />
              </button>
              <span className="text-sm font-extrabold tabular-nums">{item.qty}</span>
              <button className="grid size-7 place-items-center rounded-md hover:bg-white" type="button">
                <Plus className="size-3.5" aria-hidden="true" />
              </button>
            </div>
            <p className="text-right text-sm font-extrabold tabular-nums">{item.price}</p>
            <button
              className="grid size-9 place-items-center rounded-lg text-danger hover:bg-danger-soft"
              type="button"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <Total label="Subtotal" value="KES 2,450" />
        <Total label="Tax" value="KES 0" />
        <Total label="Total" value="KES 2,450" strong />
      </div>
    </section>
  );
}

function Total({
  label,
  value,
  strong = false
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-lg bg-soft px-3.5 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p
        className={
          strong
            ? "mt-0.5 text-xl font-extrabold tabular-nums text-primary"
            : "mt-0.5 text-base font-extrabold tabular-nums"
        }
      >
        {value}
      </p>
    </div>
  );
}
