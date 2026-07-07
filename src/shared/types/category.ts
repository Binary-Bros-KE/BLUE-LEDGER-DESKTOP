export type CategoryId = string;

export type CategoryLevel = 1 | 2 | 3;

export type CategoryStatus = "active" | "inactive";

export type CategorySyncStatus = "pending" | "synced" | "syncing" | "error";

/** Preset color tags a category can be assigned, used for POS tile accents. */
export const CATEGORY_COLOR_SWATCHES = [
  { value: "#e11d48", label: "Rose" },
  { value: "#ea580c", label: "Orange" },
  { value: "#d97706", label: "Amber" },
  { value: "#65a30d", label: "Lime" },
  { value: "#059669", label: "Emerald" },
  { value: "#0d9488", label: "Teal" },
  { value: "#0891b2", label: "Cyan" },
  { value: "#2563eb", label: "Blue" },
  { value: "#4f46e5", label: "Indigo" },
  { value: "#7c3aed", label: "Violet" },
  { value: "#c026d3", label: "Fuchsia" },
  { value: "#57534e", label: "Stone" }
] as const;

export type CategoryInputFields = {
  name: string;
  description: string | null;
  color: string;
  sortOrder: number;
};

export type Category = CategoryInputFields & {
  id: CategoryId;
  tenantId: string;
  parentId: CategoryId | null;
  level: CategoryLevel;
  status: CategoryStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  syncStatus: CategorySyncStatus;
  lastSyncedAt: string | null;
};

export type CategoryTreeNode = Category & { children: CategoryTreeNode[] };
