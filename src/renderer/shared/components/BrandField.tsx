import { useEffect, useId, useState } from "react";

/**
 * Free-text Brand input with suggestions from the brands already used on this tenant's products —
 * so "Samsung" doesn't drift into "samsung" / "SAMSUNG" and split the website's brand filter.
 */
export function BrandField({
  value,
  onChange,
  className
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}): React.JSX.Element {
  const listId = useId();
  const [brands, setBrands] = useState<string[]>([]);

  useEffect(() => {
    void window.blueLedger.product
      .brandList()
      .then(setBrands)
      .catch(() => setBrands([]));
  }, []);

  return (
    <label className={className ? `block ${className}` : "block"}>
      <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Brand</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={listId}
        maxLength={60}
        placeholder="e.g. Samsung, Hisense, Mika"
        className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
      />
      <datalist id={listId}>
        {brands.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
    </label>
  );
}
