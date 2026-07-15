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
        "grid size-10 flex-none place-items-center overflow-hidden rounded-lg border border-line bg-soft",
        className
      )}
    >
      {previewUrl ? (
        <img src={previewUrl} alt="" className="size-full object-cover" />
      ) : (
        <Package className="size-4 text-muted" aria-hidden="true" />
      )}
    </div>
  );
}
