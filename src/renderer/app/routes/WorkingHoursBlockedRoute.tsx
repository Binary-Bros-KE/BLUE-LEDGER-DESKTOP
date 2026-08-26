import { motion } from "framer-motion";
import { Clock, LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { useAuthStore } from "@renderer/shared/stores/auth-store";

const COPY: Record<"manual" | "outside_hours", { title: string; body: string }> = {
  outside_hours: {
    title: "Outside Working Hours",
    body: "This storefront is closed right now. The system unlocks itself automatically once it reopens."
  },
  manual: {
    title: "System Locked",
    body: "Your Super Admin has locked the system. It'll unlock automatically once they turn it back on."
  }
};

/** Shown instead of the normal app for any employee whose current lock status
 * (window.blueLedger.workingHours.getMyLockStatus, checked every 60s from App.tsx) comes back
 * locked — either the storefront's configured hours say it's closed right now, or a Super Admin has
 * manually locked it. Mirrors LicenseBlockedRoute's shell/styling. A Super Admin's OWN session never
 * reaches this route at all (getMyLockStatus always returns unlocked for them), so the only way out
 * here is to sign out and hand the device to someone who isn't locked out. */
export function WorkingHoursBlockedRoute({ reason }: { reason: "manual" | "outside_hours" }): React.JSX.Element {
  const copy = COPY[reason];
  const logout = useAuthStore((state) => state.logout);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-sidebar px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-soft"
      >
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-danger-soft text-danger">
          {reason === "manual" ? <ShieldAlert className="size-7" aria-hidden="true" /> : <Clock className="size-7" aria-hidden="true" />}
        </div>
        <h1 className="mt-4 text-xl font-extrabold">{copy.title}</h1>
        <p className="mt-2 text-sm font-semibold text-muted">{copy.body}</p>

        <Button
          type="button"
          onClick={() => void logout()}
          className="mx-auto mt-5 cursor-pointer bg-white text-ink ring-1 ring-inset ring-line hover:bg-app hover:text-ink"
        >
          <LogOut className="mr-2 size-4" aria-hidden="true" />
          Sign Out
        </Button>
      </motion.div>
    </div>
  );
}
