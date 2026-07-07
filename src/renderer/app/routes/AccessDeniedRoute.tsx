import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { useUiStore } from "@renderer/shared/stores/ui-store";

export function AccessDeniedRoute({ pageLabel }: { pageLabel: string }): React.JSX.Element {
  const setActiveNavKey = useUiStore((state) => state.setActiveNavKey);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-6"
    >
      <section className="flex flex-col items-center rounded-lg border border-line bg-white p-12 text-center shadow-soft">
        <div className="grid size-14 place-items-center rounded-2xl bg-danger-soft text-danger">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-lg font-extrabold">Access denied</h2>
        <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
          Your role doesn't have permission to view {pageLabel}. Contact an administrator if you
          believe this is a mistake.
        </p>
        <Button type="button" onClick={() => setActiveNavKey("dashboard")} className="mt-5 h-9 text-xs">
          Back to Dashboard
        </Button>
      </section>
    </motion.div>
  );
}
