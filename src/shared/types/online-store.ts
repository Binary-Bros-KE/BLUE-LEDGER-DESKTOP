/**
 * Types for the "Online Store" tab — the tenant-facing e-commerce management surface.
 * See ECOMMERCE-ARCHITECTURE.md. The store's technical setup (provisioning, custom domain, DNS)
 * is done by Blue Ledger staff in the admin dashboard; everything here is what the shop owner
 * controls themselves from their POS.
 */

import type { ProductOnlineContent } from "./product";

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
  onlineCategoryIds?: string[];
  onlineContent?: ProductOnlineContent;
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

export type ThemeProductSectionRow = {
  title?: string | undefined;
  categoryId?: string | undefined;
  ctaLabel?: string | undefined;
};

/** Hero right-rail tile 1 (red). "Deal of the week" is a static label, not part of this config —
 * only the fields below are editable. priceCents/offerPriceCents drive an auto-calculated discount
 * badge storefront-side; the percentage itself is never stored (see NEXT/storefront DealTile.tsx). */
export type ThemeDealTile = {
  title?: string | undefined;
  priceCents?: number | undefined;
  offerPriceCents?: number | undefined;
  ctaLabel?: string | undefined;
  ctaHref?: string | undefined;
  imageUrl?: string | undefined;
};

/** Hero right-rail tile 2 (cream). A single featured category highlight — categoryLabel is free
 * text (like every other theme copy field), not a live category id/filter. */
export type ThemeTradeTile = {
  categoryLabel?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  ctaLabel?: string | undefined;
  ctaHref?: string | undefined;
  imageUrl?: string | undefined;
};

export type ThemeBrand = { logoImageUrl: string; nameLine1: string; nameLine2: string };
export type ThemeTopBar = { announcement: string };
export type ThemeContact = {
  whatsappSalesLabel: string;
  whatsappSalesNumber: string;
  whatsappSupportLabel: string;
  whatsappSupportNumber: string;
  email: string;
  instagram: string;
  facebook: string;
};

/** Fully-resolved theme (every field present) — what the editor works with. */
export type TrylistThemeConfig = {
  brand: ThemeBrand;
  topBar: ThemeTopBar;
  contact: ThemeContact;
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
  productSections: ThemeProductSectionRow[];
  dealTile: ThemeDealTile;
  tradeTile: ThemeTradeTile;
};

/** Partial patch sent to POST /shop-admin/theme/update. `null` clears a field; `story` /
 * `productSections` replace the whole array; `categoryImages` merges by key (a `null` value
 * deletes that key). */
export type ThemeUpdatePatch = {
  name?: "trylist";
  brand?: { logoImageUrl?: string | null; nameLine1?: string | null; nameLine2?: string | null };
  topBar?: { announcement?: string | null };
  contact?: {
    whatsappSalesLabel?: string | null;
    whatsappSalesNumber?: string | null;
    whatsappSupportLabel?: string | null;
    whatsappSupportNumber?: string | null;
    email?: string | null;
    instagram?: string | null;
    facebook?: string | null;
  };
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
  productSections?: ThemeProductSectionRow[];
  dealTile?: {
    title?: string | null;
    priceCents?: number | null;
    offerPriceCents?: number | null;
    ctaLabel?: string | null;
    ctaHref?: string | null;
    imageUrl?: string | null;
  };
  tradeTile?: {
    categoryLabel?: string | null;
    title?: string | null;
    description?: string | null;
    ctaLabel?: string | null;
    ctaHref?: string | null;
    imageUrl?: string | null;
  };
};

// --- Delivery methods (storefront checkout options) -------------------------------------------

export type WebDeliveryMethod = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  sortOrder: number;
  active: boolean;
};

export type DeliveryMethodInput = {
  name: string;
  description?: string | null;
  priceCents: number;
  active?: boolean;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
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
  const sectionsRaw = Array.isArray(o.productSections) ? o.productSections : [];
  const catRaw = (o.categoryImages && typeof o.categoryImages === "object" ? o.categoryImages : {}) as Record<
    string,
    unknown
  >;
  const dealTileRaw = (o.dealTile && typeof o.dealTile === "object" ? o.dealTile : {}) as Record<string, unknown>;
  const tradeTileRaw = (o.tradeTile && typeof o.tradeTile === "object" ? o.tradeTile : {}) as Record<string, unknown>;
  const brandRaw = (o.brand && typeof o.brand === "object" ? o.brand : {}) as Record<string, unknown>;
  const topBarRaw = (o.topBar && typeof o.topBar === "object" ? o.topBar : {}) as Record<string, unknown>;
  const contactRaw = (o.contact && typeof o.contact === "object" ? o.contact : {}) as Record<string, unknown>;
  return {
    brand: {
      logoImageUrl: str(brandRaw.logoImageUrl),
      nameLine1: str(brandRaw.nameLine1),
      nameLine2: str(brandRaw.nameLine2)
    },
    topBar: { announcement: str(topBarRaw.announcement) },
    contact: {
      whatsappSalesLabel: str(contactRaw.whatsappSalesLabel),
      whatsappSalesNumber: str(contactRaw.whatsappSalesNumber),
      whatsappSupportLabel: str(contactRaw.whatsappSupportLabel),
      whatsappSupportNumber: str(contactRaw.whatsappSupportNumber),
      email: str(contactRaw.email),
      instagram: str(contactRaw.instagram),
      facebook: str(contactRaw.facebook)
    },
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
    ),
    productSections: sectionsRaw.slice(0, 6).map((s) => {
      const ss = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return {
        title: str(ss.title) || undefined,
        categoryId: str(ss.categoryId) || undefined,
        ctaLabel: str(ss.ctaLabel) || undefined
      };
    }),
    dealTile: {
      title: str(dealTileRaw.title) || undefined,
      priceCents: num(dealTileRaw.priceCents),
      offerPriceCents: num(dealTileRaw.offerPriceCents),
      ctaLabel: str(dealTileRaw.ctaLabel) || undefined,
      ctaHref: str(dealTileRaw.ctaHref) || undefined,
      imageUrl: str(dealTileRaw.imageUrl) || undefined
    },
    tradeTile: {
      categoryLabel: str(tradeTileRaw.categoryLabel) || undefined,
      title: str(tradeTileRaw.title) || undefined,
      description: str(tradeTileRaw.description) || undefined,
      ctaLabel: str(tradeTileRaw.ctaLabel) || undefined,
      ctaHref: str(tradeTileRaw.ctaHref) || undefined,
      imageUrl: str(tradeTileRaw.imageUrl) || undefined
    }
  };
}
