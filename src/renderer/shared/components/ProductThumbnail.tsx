import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";

/** Small square product image with a package-icon fallback — used anywhere a product is listed
 * (Products, Main Store) so the picture sits on the same row as the name/category text. */
export function ProductThumbnail({
  imagePath,
  className
}: {
  imagePath: string | null;
  className?: string;
}): React.JSX.Element {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imagePath) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    void window.blueLedger.product.readImagePreview(imagePath).then((url) => {
      if (!cancelled) setPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [imagePath]);

  return (
    <div
      className={cn(
        "relative grid size-10 flex-none place-items-center overflow-hidden rounded-lg border border-line bg-soft",
        className
      )}
    >
      {previewUrl ? (
        // Absolutely positioned (not size-full inside the grid) — a percentage height on a grid
        // item only resolves against the parent's own height when the item actually stretches to
        // fill it, and place-items-center turns that stretch off, so height:100% silently falls
        // back to the image's OWN intrinsic aspect ratio instead of this box's — a tall photo then
        // renders as a much taller (and, once overflow-hidden clips it, cropped) box than the
        // square frame implies. Absolute positioning resolves against the containing block's actual
        // size regardless of any alignment setting, so it can't hit that gotcha.
        <img src={previewUrl} alt="" className="absolute inset-0 size-full object-contain" />
      ) : (
        <Package className="size-4 text-muted" aria-hidden="true" />
      )}
    </div>
  );
}
