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

// --- Trylist theme (storefront look) ------------------------------------------------------------
// Mirror of SERVER lib/trylist-theme.ts + NEXT/storefront lib/theme.ts. Keep the three in sync.

export type ThemeCta = { label?: string | undefined; href?: string | undefined };

export type ThemeStoryRow = {
  imageUrl?: string | undefined;
  title?: string | undefined;
  body?: string | undefined;
  ctaLabel?: string | undefined;
  ctaHref?: string | undefined;
};

/** Fully-resolved theme (every field present) — what the editor works with. */
export type TrylistThemeConfig = {
  hero: {
    headline: string;
    sub: string;
    primaryCta: ThemeCta;
    secondaryCta: ThemeCta;
    shotImageUrl: string;
    backgroundImageUrl: string;
  };
  story: ThemeStoryRow[];
  categoryImages: Record<string, string>;
};

/** Partial patch sent to POST /shop-admin/theme/update. `null` clears a field; `story` replaces
 * the whole array; `categoryImages` merges by key (a `null` value deletes that key). */
export type ThemeUpdatePatch = {
  name?: "trylist";
  hero?: {
    headline?: string | null;
    sub?: string | null;
    primaryCta?: ThemeCta | null;
    secondaryCta?: ThemeCta | null;
    shotImageUrl?: string | null;
    backgroundImageUrl?: string | null;
  };
  story?: ThemeStoryRow[];
  categoryImages?: Record<string, string | null>;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function cta(v: unknown): ThemeCta {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  return { label: str(o.label) || undefined, href: str(o.href) || undefined };
}

/** Coerces the raw themeJson blob into a fully-populated TrylistThemeConfig for the editor. */
export function parseThemeConfig(raw: Record<string, unknown> | null | undefined): TrylistThemeConfig {
  const o = raw && typeof raw === "object" ? raw : {};
  const heroRaw = (o.hero && typeof o.hero === "object" ? o.hero : {}) as Record<string, unknown>;
  const storyRaw = Array.isArray(o.story) ? o.story : [];
  const catRaw = (o.categoryImages && typeof o.categoryImages === "object" ? o.categoryImages : {}) as Record<
    string,
    unknown
  >;
  return {
    hero: {
      headline: str(heroRaw.headline),
      sub: str(heroRaw.sub),
      primaryCta: cta(heroRaw.primaryCta),
      secondaryCta: cta(heroRaw.secondaryCta),
      shotImageUrl: str(heroRaw.shotImageUrl),
      backgroundImageUrl: str(heroRaw.backgroundImageUrl)
    },
    story: storyRaw.slice(0, 3).map((r) => {
      const rr = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      return {
        imageUrl: str(rr.imageUrl) || undefined,
        title: str(rr.title) || undefined,
        body: str(rr.body) || undefined,
        ctaLabel: str(rr.ctaLabel) || undefined,
        ctaHref: str(rr.ctaHref) || undefined
      };
    }),
    categoryImages: Object.fromEntries(
      Object.entries(catRaw).flatMap(([k, v]) => (str(v) ? [[k, str(v)] as const] : []))
    )
  };
}
