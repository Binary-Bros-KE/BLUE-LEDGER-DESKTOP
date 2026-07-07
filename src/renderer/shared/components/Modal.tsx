import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";

export function Modal({
  open,
  onClose,
  title,
  description,
  widthClassName,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  widthClassName?: string;
  children: React.ReactNode;
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6"
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "max-h-[88vh] w-full overflow-y-auto rounded-lg border border-line bg-white p-6 shadow-soft",
              widthClassName ?? "max-w-lg"
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold">{title}</h2>
                {description && <p className="mt-1 text-xs font-semibold text-muted">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid size-8 flex-none place-items-center rounded-lg text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
