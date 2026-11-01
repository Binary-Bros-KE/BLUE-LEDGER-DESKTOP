import { DashedPill } from "@renderer/shared/components/DashedPill";
import { useDropshipSource } from "@renderer/shared/hooks/use-dropship-source";

function formatAgo(iso: string | null): string {
  if (!iso) return "not yet seen online";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "live";
  if (minutes < 60) return `as of ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `as of ${hours} hr ago`;
  return `as of ${Math.floor(hours / 24)} day${hours < 48 ? "" : "s"} ago`;
}

/** Marks a product whose stock figure is its dropship supplier's — renders nothing for any other
 * product, and so nothing at all for a tenant without dropshipping. */
export function SupplierStockBadge({ productId }: { productId: string }): React.JSX.Element | null {
  const source = useDropshipSource(productId);
  if (!source) return null;
  return (
    <DashedPill tone="accent" className="px-2 py-0.5 text-[10px]">
      {source.supplierName} stock · {formatAgo(source.asOf)}
    </DashedPill>
  );
}
