import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" (red, for delete/void/cancel-style actions) or "primary" (default brand color). */
  tone?: "danger" | "primary";
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Mounted once at the app root (see main.tsx) — replaces window.confirm()'s native, unthemed dialog
 * with one matching the app's own Modal styling. Usage: const confirm = useConfirm(); const ok = await
 * confirm({ title, message, tone: "danger" }); if (!ok) return;
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((nextOptions) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOptions(nextOptions);
    });
  }, []);

  function settle(value: boolean): void {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setOptions(null);
  }

  const danger = options?.tone !== "primary";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={options !== null} onClose={() => settle(false)} title={options?.title ?? ""} widthClassName="max-w-sm">
        {options && (
          <div>
            <div
              className={cn(
                "mx-auto grid size-12 place-items-center rounded-2xl",
                danger ? "bg-danger-soft text-danger" : "bg-accent/10 text-accent"
              )}
            >
              <AlertTriangle className="size-6" aria-hidden="true" />
            </div>
            <p className="mt-4 text-center text-sm font-semibold text-ink">{options.message}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button
                type="button"
                onClick={() => settle(false)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                {options.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                type="button"
                onClick={() => settle(true)}
                className={cn(
                  "h-9 text-xs",
                  danger && "border border-danger bg-danger text-white shadow-none hover:brightness-110"
                )}
              >
                {options.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return ctx;
}
