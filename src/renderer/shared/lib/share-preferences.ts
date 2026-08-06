/** Remembers the user's last "Include WhatsApp preview" / "Include delivery note" checkbox choices
 * across ShareModal opens, so they don't have to re-toggle the same preference every single time
 * they share a document. A device-local UI preference, not sensitive data — plain localStorage is
 * the right tool here, no need for a new IPC channel/SQLite table for something this small. */
const STORAGE_KEY = "blueledger.share.preferences";

export type SharePreferences = {
  includeWhatsappPreview: boolean;
  includeDelivery: boolean;
};

const DEFAULT_PREFERENCES: SharePreferences = { includeWhatsappPreview: false, includeDelivery: true };

export function getSharePreferences(): SharePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<SharePreferences>;
    return {
      includeWhatsappPreview: parsed.includeWhatsappPreview ?? DEFAULT_PREFERENCES.includeWhatsappPreview,
      includeDelivery: parsed.includeDelivery ?? DEFAULT_PREFERENCES.includeDelivery
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function setSharePreferences(preferences: SharePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Losing a remembered UI preference isn't worth crashing the share flow over.
  }
}
