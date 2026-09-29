import { create } from "zustand";

type WebsiteStore = {
  /** The online store's website template ("classic", "adia", …) — null until first learned from
   * the store overview. Drives the template-only Website Manager entries (e.g. Adia's Home Page). */
  templateId: string | null;
  setTemplateId: (templateId: string | null) => void;
};

export const useWebsiteStore = create<WebsiteStore>((set) => ({
  templateId: null,
  setTemplateId: (templateId) => set({ templateId })
}));
