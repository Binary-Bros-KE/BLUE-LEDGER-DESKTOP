/**
 * Types for the "Online Store" tab — the tenant-facing e-commerce management surface.
 * See ECOMMERCE-ARCHITECTURE.md. The store's technical setup (provisioning, custom domain, DNS)
 * is done by Blue Ledger staff in the admin dashboard; everything here is what the shop owner
 * controls themselves from their POS.
 */

export type OnlineStoreDomainStatus = "NONE" | "PENDING_DNS" | "VERIFYING_TLS" | "LIVE";
export type OnlineStoreStatus = "DRAFT" | "LIVE" | "SUSPENDED";

/** Mirror of the SERVER `StoreOwnerView` (services/shop-owner-service.ts) — what
 * POST /shop-admin/store returns. `store` is null until staff have provisioned the tenant's
 * web_stores row. */
export type StoreOwnerView = {
  store: {
    subdomain: string;
    customDomain: string | null;
    domainStatus: OnlineStoreDomainStatus;
    status: OnlineStoreStatus;
    currency: string;
    fulfilmentLocationId: string | null;
    /** Free-form config blobs owned by the storefront look/delivery/payment editors. */
    themeJson: Record<string, unknown>;
    deliveryJson: Record<string, unknown>;
    paymentOptionsJson: Record<string, unknown>;
  } | null;
  /** Always-works subdomain URL (preview + fallback); null if no store row yet. */
  previewUrl: string | null;
  /** The real custom domain, only once DNS is verified LIVE. */
  liveUrl: string | null;
  /** Whether product photos can be uploaded yet (server-side R2 credentials present). */
  imageUploadsEnabled: boolean;
  publishedCount: number;
  activeProductCount: number;
};

/** Patch for POST /shop-admin/store/update — only the keys present are written. */
export type StoreConfigPatch = {
  themeJson?: Record<string, unknown>;
  deliveryJson?: Record<string, unknown>;
  paymentOptionsJson?: Record<string, unknown>;
};

/** Patch for the per-product online overrides. Publish state + price/description are plain synced
 * Product columns written locally; this never hits the network. */
export type ProductOnlinePatch = {
  publishedOnline?: boolean;
  onlineDescription?: string | null;
  onlinePriceCents?: number | null;
};
