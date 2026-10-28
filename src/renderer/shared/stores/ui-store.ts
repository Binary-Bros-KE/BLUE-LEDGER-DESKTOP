import { create } from "zustand";
import type { CheckoutLayout } from "@shared/types/checkout-layout";

const SIDEBAR_COLLAPSED_KEY = "blue-ledger:sidebar-collapsed";

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

type UiStore = {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  activeNavKey: string;
  setActiveNavKey: (key: string) => void;
  /** This machine's chosen Checkout layout, loaded once from app_settings by AppShell (main process
   * is the source of truth — see preferences-service.ts). null until that first load finishes, so
   * Checkout can wait instead of flashing the wrong layout. */
  checkoutLayout: CheckoutLayout | null;
  setCheckoutLayout: (layout: CheckoutLayout) => void;
};

export const useUiStore = create<UiStore>((set, get) => ({
  sidebarCollapsed: readStoredCollapsed(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // localStorage unavailable; collapsed state simply won't persist across restarts.
    }
    set({ sidebarCollapsed: next });
  },
  activeNavKey: "dashboard",
  setActiveNavKey: (key) => set({ activeNavKey: key }),
  checkoutLayout: null,
  setCheckoutLayout: (layout) => set({ checkoutLayout: layout })
}));
