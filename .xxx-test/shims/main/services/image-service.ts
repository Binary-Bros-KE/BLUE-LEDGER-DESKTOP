// Harness stub — no Electron dialog/BrowserWindow available under plain Node. Nothing in the
// opening-balance-invoice scenario picks/deletes any image or attachment, so every export here is a
// harmless no-op just to satisfy imports deep in the invoice/sale-service dependency chain.
export async function readLocalImagePreview(_filePath: string): Promise<string | null> {
  return null;
}
export async function pickAndStoreProductImage(): Promise<string | null> {
  return null;
}
export async function readManagedProductImagePreview(): Promise<string | null> {
  return null;
}
export function deleteManagedProductImage(_path: string | null): void {}
export function finalizeProductImagePath(path: string | null): string | null {
  return path;
}
export async function pickAndStoreEmployeePhoto(): Promise<string | null> {
  return null;
}
export async function readManagedEmployeePhotoPreview(): Promise<string | null> {
  return null;
}
export function deleteManagedEmployeePhoto(_path: string | null): void {}
export function finalizeEmployeePhotoPath(path: string | null): string | null {
  return path;
}
export async function pickAndStoreBusinessLogo(): Promise<string | null> {
  return null;
}
export async function readManagedBusinessLogoPreview(): Promise<string | null> {
  return null;
}
export function deleteManagedBusinessLogo(_path: string | null): void {}
export async function pickAndStoreLocationLogo(): Promise<string | null> {
  return null;
}
export async function readManagedLocationLogoPreview(): Promise<string | null> {
  return null;
}
export function deleteManagedLocationLogo(_path: string | null): void {}
export function finalizeLocationLogoPath(path: string | null): string | null {
  return path;
}
export async function pickAndStorePurchaseAttachment(): Promise<string | null> {
  return null;
}
export async function openManagedPurchaseAttachment(): Promise<void> {}
export function deleteManagedPurchaseAttachment(_path: string | null): void {}
export async function pickAndStoreExpenseAttachment(): Promise<string | null> {
  return null;
}
export async function openManagedExpenseAttachment(): Promise<void> {}
export function deleteManagedExpenseAttachment(_path: string | null): void {}
