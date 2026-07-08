import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, LogOut, Store, UserRound } from "lucide-react";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { useAuthStore } from "@renderer/shared/stores/auth-store";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import { cn } from "@renderer/shared/lib/cn";
import { smallLogoBoxClassName } from "@renderer/shared/lib/logo";
import { navGroups, type NavItem } from "./navigation";

const EXPANDED_WIDTH = 272;
const COLLAPSED_WIDTH = 80;
const SIDEBAR_TRANSITION = { duration: 0.32, ease: [0.4, 0, 0.2, 1] as const };
const FADE_TRANSITION = { duration: 0.18 };

export function Sidebar(): React.JSX.Element {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const activeNavKey = useUiStore((state) => state.activeNavKey);
  const setActiveNavKey = useUiStore((state) => state.setActiveNavKey);
  const { can, session } = usePermissions();
  const logout = useAuthStore((state) => state.logout);

  const visibleGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => can(item.permissionModule, "view"))
        }))
        .filter((group) => group.items.length > 0),
    [can]
  );

  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const photoPath = session?.employee.photoPath;

  useEffect(() => {
    let cancelled = false;

    if (!photoPath) {
      setPhotoPreviewUrl(null);
      return;
    }

    void window.blueLedger.employee.readPhotoPreview(photoPath).then((dataUrl) => {
      if (!cancelled) setPhotoPreviewUrl(dataUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [photoPath]);

  const [branchLogoPreviewUrl, setBranchLogoPreviewUrl] = useState<string | null>(null);
  const branchLogoPath = session?.branch?.logoPath;

  useEffect(() => {
    let cancelled = false;

    if (!branchLogoPath) {
      setBranchLogoPreviewUrl(null);
      return;
    }

    void window.blueLedger.location.readLogoPreview(branchLogoPath).then((dataUrl) => {
      if (!cancelled) setBranchLogoPreviewUrl(dataUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [branchLogoPath]);

  return (
    <motion.aside
      animate={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      transition={SIDEBAR_TRANSITION}
      className="relative z-20 flex h-screen flex-none flex-col bg-primary py-5 shadow-[8px_0_32px_-12px_rgba(8,42,143,0.45)]"
    >
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-9 z-30 grid size-6 place-items-center rounded-full border border-line bg-white text-muted shadow-soft transition hover:text-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20 cursor-pointer"
      >
        {collapsed ? (
          <ChevronRight className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        )}
      </button>

      <div className={cn("flex items-center gap-2.5 px-4  border-b-2 border-white/65 pb-2", collapsed && "justify-center px-0")}>
        <div className="grid flex-none place-items-center rounded-xl text-white shadow-soft">
          <img src="/resources/icons/BLUE_LEDGER.png" alt="Logo" className="size-8 rounded-lg" />
        </div>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={FADE_TRANSITION}
              className="min-w-0 overflow-hidden whitespace-nowrap"
            >
              <p className="text-xs font-extrabold uppercase tracking-wide text-white">Blue Ledger</p>
              <p className="truncate text-[11px] font-semibold text-white/50">Track. Sell. Grow.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <nav className="mt-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pl-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleGroups.map((group) => (
          <div key={group.title}>
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={FADE_TRANSITION}
                  className="overflow-hidden px-2 text-[12px] font-extrabold uppercase tracking-wider text-white/70"
                >
                  {group.title}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="relative mt-1.5">
              {!collapsed && (
                <div
                  className="pointer-events-none absolute bottom-2 left-3 top-2 border-l-2 border-dashed border-white/15"
                  aria-hidden="true"
                />
              )}
              <div className={cn("space-y-0.5", !collapsed && "pl-6")}>
                {group.items.map((item) => (
                  <div key={item.key} className="relative">
                    {!collapsed && (
                      <span
                        className="pointer-events-none absolute -left-[15px] top-1/2 size-1.5 -translate-y-1/2 rounded-full border-2 border-white/25 bg-primary"
                        aria-hidden="true"
                      />
                    )}
                    <NavButton
                      item={item}
                      active={item.key === activeNavKey}
                      collapsed={collapsed}
                      onSelect={() => setActiveNavKey(item.key)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </nav>

      {session && (
        <div className={cn("mt-4 px-3", collapsed && "px-2")}>
          <div
            className={cn(
              "rounded-lg border border-line bg-white p-3.5 shadow-soft",
              collapsed && "flex justify-center p-2"
            )}
          >
            {collapsed ? (
              <div className="grid size-8 flex-none place-items-center overflow-hidden rounded-full border border-line">
                {photoPreviewUrl ? (
                  <img src={photoPreviewUrl} alt="" className="size-full object-cover" />
                ) : (
                  <UserRound className="size-4 text-muted" aria-hidden="true" />
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2.5">
                  <div className="grid size-9 flex-none place-items-center overflow-hidden rounded-full border border-line">
                    {photoPreviewUrl ? (
                      <img src={photoPreviewUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <UserRound className="size-4 text-muted" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-ink">
                      {session.employee.firstName} {session.employee.lastName}
                    </p>
                    <p className="truncate text-[11px] font-semibold text-muted">
                      {session.role?.roleName ?? "No role assigned"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    aria-label="Sign out"
                    title="Sign out"
                    className="grid size-7 flex-none place-items-center rounded-md text-muted transition hover:bg-soft hover:text-danger cursor-pointer"
                  >
                    <LogOut className="size-3.5" aria-hidden="true" />
                  </button>
                </div>

                <div className="relative mt-3 pt-3">
                  <div
                    className="pointer-events-none absolute inset-x-1 top-0 border-t-2 border-dashed border-line"
                    aria-hidden="true"
                  />
                  <span
                    className="pointer-events-none absolute -top-[5px] left-0 size-2.5 -translate-x-1/2 rounded-full border-2 border-line bg-white"
                    aria-hidden="true"
                  />
                  <span
                    className="pointer-events-none absolute -top-[5px] right-0 size-2.5 translate-x-1/2 rounded-full border-2 border-line bg-white"
                    aria-hidden="true"
                  />
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
                    <div
                      className={cn(
                        "grid flex-none place-items-center overflow-hidden rounded-sm",
                        smallLogoBoxClassName(session.branch?.logoRatio)
                      )}
                    >
                      {branchLogoPreviewUrl ? (
                        <img src={branchLogoPreviewUrl} alt="" className="size-full object-contain" />
                      ) : (
                        <Store className="size-3.5 text-primary" aria-hidden="true" />
                      )}
                    </div>
                    {session.branch?.locationName ?? "No branch assigned"}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </motion.aside>
  );
}

function NavButton({
  item,
  active,
  collapsed,
  onSelect
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        onMouseEnter={(event) => collapsed && setTooltipAnchor(event.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setTooltipAnchor(null)}
        className={cn(
          "relative flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20 cursor-pointer",
          collapsed && "justify-center px-0",
          active ? "text-white" : "text-white/65 hover:bg-white/10 hover:text-white"
        )}
      >
        {active && (
          <motion.span
            layoutId="active-nav-pill"
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="absolute inset-0 rounded-lg bg-accent shadow-soft"
          />
        )}
        <item.icon className="relative z-10 size-4 flex-none" aria-hidden="true" />
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={FADE_TRANSITION}
              className="relative z-10 overflow-hidden whitespace-nowrap text-left"
            >
              {item.label}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {tooltipAnchor &&
        createPortal(
          <motion.div
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={FADE_TRANSITION}
            style={{
              position: "fixed",
              top: tooltipAnchor.top + tooltipAnchor.height / 2,
              left: tooltipAnchor.right + 12,
              transform: "translateY(-50%)"
            }}
            className="pointer-events-none z-50 whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white shadow-soft"
          >
            {item.label}
            <span className="block text-[10px] font-semibold text-white/60">{item.description}</span>
          </motion.div>,
          document.body
        )}
    </div>
  );
}
