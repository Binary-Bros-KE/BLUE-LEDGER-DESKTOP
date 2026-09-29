import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { CheckboxField, Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Category } from "@shared/types/category";
import { TRUST_ICON_OPTIONS, type ThemeBrandLogoRow, type ThemeTrustItemRow, type ThemeUpdatePatch, type TrustIconKey } from "@shared/types/online-store";
import { ImageSlot } from "./ThemePanel";

// Editor for the ADIA template's home page — themeJson.adia (+ the shared trustBar / brands lists
// the Adia home also shows). Only rendered for stores on the Adia template, so these controllers are
// template-specific. Cards follow the page top to bottom; each saves just its own section. Every text
// field shows Adia's default as its placeholder — leave it empty to keep the default.
// Mirrors NEXT/storefront templates/adia/content.ts (parse + defaults) and SERVER adiaThemeSchema.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const b = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
/** "" → null so the storefront falls back to its default */
const n = (v: string): string | null => (v.trim() ? v.trim() : null);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

// ------------------------------------------------------------------------------ small building blocks

function Section({
  title,
  hint,
  open,
  onToggle,
  saving,
  onSave,
  children
}: {
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  saving: boolean;
  onSave?: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-white shadow-soft">
      <button type="button" onClick={onToggle} className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left">
        <span>
          <span className="block text-sm font-extrabold uppercase tracking-wide text-ink">{title}</span>
          {hint ? <span className="mt-0.5 block text-xs font-semibold text-muted">{hint}</span> : null}
        </span>
        <ChevronDown className={cn("size-4 flex-none text-muted transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-4 border-t border-line px-5 py-5">
          {children}
          {onSave ? (
            <div className="flex justify-end border-t border-line pt-4">
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-4 text-xs font-extrabold uppercase tracking-wide text-white transition hover:bg-primary disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }): React.JSX.Element {
  return <div className={cn("grid grid-cols-1 gap-3", cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>{children}</div>;
}

/** Where a button goes: all products, a category, or a custom link — stored as the link itself. */
function LinkField({
  label,
  value,
  onChange,
  categories
}: {
  label: string;
  value: string;
  onChange: (href: string) => void;
  categories: Category[];
}): React.JSX.Element {
  const catByHref = useMemo(() => new Map(categories.map((c) => [`/products/${slugify(c.name)}`, c])), [categories]);
  const mode = value === "" ? "" : value === "/products" ? "all" : catByHref.has(value) ? "cat" : "custom";
  const [custom, setCustom] = useState(mode === "custom");
  const selectValue = custom ? "__custom" : mode === "cat" ? value : mode === "all" ? "/products" : "";
  return (
    <div>
      <SelectField
        label={label}
        value={selectValue}
        onChange={(v) => {
          if (v === "__custom") {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(v);
        }}
        options={[
          { value: "", label: "Default" },
          { value: "/products", label: "All products" },
          ...categories.map((c) => ({ value: `/products/${slugify(c.name)}`, label: `Category: ${c.name}` })),
          { value: "__custom", label: "Custom link…" }
        ]}
      />
      {custom ? <Field label="Custom link" value={value} onChange={onChange} placeholder="/products?brand=Samsung or https://…" /> : null}
    </div>
  );
}

function CategoryField({
  label,
  value,
  onChange,
  categories,
  emptyLabel
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  categories: Category[];
  emptyLabel: string;
}): React.JSX.Element {
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      options={[{ value: "", label: emptyLabel }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
    />
  );
}

/** Reorder/remove buttons for one list item. */
function ItemBar({
  label,
  index,
  count,
  onMove,
  onRemove
}: {
  label: string;
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const btn = "grid size-8 cursor-pointer place-items-center rounded-md border border-line text-muted transition hover:bg-soft disabled:opacity-30";
  return (
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-accent">{label}</p>
      <div className="flex gap-1.5">
        <button type="button" className={btn} disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
          <ArrowUp className="size-3.5" />
        </button>
        <button type="button" className={btn} disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
          <ArrowDown className="size-3.5" />
        </button>
        <button type="button" className={cn(btn, "text-danger hover:bg-danger-soft")} onClick={onRemove} aria-label="Remove">
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function AddButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-accent/60 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Plus className="size-3.5" /> {label}
    </button>
  );
}

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

const Item = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div className="space-y-3 rounded-lg border border-line bg-soft/50 p-4">{children}</div>
);

// ------------------------------------------------------------------------------------ draft shapes

type Row = { enabled: boolean; title: string; subtitle: string; categoryId: string; ctaLabel: string };
type Slide = { imageUrl: string; eyebrow: string; title: string; subtitle: string; body: string; ctaLabel: string; ctaHref: string; badgeLabel: string; badgeValue: string; note: string };
type Tile = { categoryId: string; title: string; subtitle: string; imageUrl: string };
type Promo = { title: string; subtitle: string; badge: string; imageUrl: string; ctaLabel: string; ctaHref: string; tone: "light" | "dark" | "brand" };
type Space = { title: string; subtitle: string; imageUrl: string; categoryId: string };
type Collection = { title: string; subtitle: string; badge: string; priceText: string; oldPriceText: string; imageUrl: string; ctaLabel: string; ctaHref: string };

const toRow = (v: unknown): Row => {
  const o = obj(v);
  return { enabled: b(o.enabled, true), title: s(o.title), subtitle: s(o.subtitle), categoryId: s(o.categoryId), ctaLabel: s(o.ctaLabel) };
};
const rowOut = (r: Row) => ({ enabled: r.enabled, title: n(r.title), subtitle: n(r.subtitle), categoryId: n(r.categoryId), ctaLabel: n(r.ctaLabel) });
const linkOut = (label: string, href: string) => (label.trim() || href.trim() ? { label: n(label), href: n(href) } : null);
const toPromo = (o: Json): Promo => ({
  title: s(o.title),
  subtitle: s(o.subtitle),
  badge: s(o.badge),
  imageUrl: s(o.imageUrl),
  ctaLabel: s(obj(o.cta).label),
  ctaHref: s(obj(o.cta).href),
  tone: o.tone === "dark" || o.tone === "brand" ? o.tone : "light"
});
const promoOut = (p: Promo[]) =>
  p
    .filter((x) => x.title.trim())
    .map((x) => ({ title: x.title.trim(), subtitle: n(x.subtitle), badge: n(x.badge), imageUrl: n(x.imageUrl), cta: linkOut(x.ctaLabel, x.ctaHref), tone: x.tone }));

const EMPTY_SLIDE: Slide = { imageUrl: "", eyebrow: "", title: "", subtitle: "", body: "", ctaLabel: "", ctaHref: "", badgeLabel: "", badgeValue: "", note: "" };
const EMPTY_PROMO: Promo = { title: "", subtitle: "", badge: "", imageUrl: "", ctaLabel: "", ctaHref: "", tone: "light" };

// ------------------------------------------------------------------------------------------ panel

export function AdiaHomePanel({
  themeJson,
  imageUploadsEnabled,
  onSaved
}: {
  themeJson: Record<string, unknown>;
  imageUploadsEnabled: boolean;
  onSaved: () => void;
}): React.JSX.Element {
  // Seeded once — a parent reload after one card saves must not wipe another card's unsaved edits.
  const [a] = useState(() => obj(themeJson.adia));
  const [categories, setCategories] = useState<Category[]>([]);
  const [openKey, setOpenKey] = useState<string | null>("hero");
  const [saving, setSaving] = useState<string | null>(null);

  const [top, setTop] = useState(() => {
    const o = obj(a.topStrip);
    return { enabled: b(o.enabled, true), label: s(o.label), highlight: s(o.highlight), ctaLabel: s(obj(o.cta).label), ctaHref: s(obj(o.cta).href) };
  });
  const [socials, setSocials] = useState(() => {
    const o = obj(a.socials);
    return { facebook: s(o.facebook), instagram: s(o.instagram), tiktok: s(o.tiktok), youtube: s(o.youtube), x: s(o.x), whatsapp: s(o.whatsapp) };
  });
  const [slides, setSlides] = useState<Slide[]>(() =>
    list(a.heroSlides).map((o) => ({
      imageUrl: s(o.imageUrl),
      eyebrow: s(o.eyebrow),
      title: s(o.title),
      subtitle: s(o.subtitle),
      body: s(o.body),
      ctaLabel: s(obj(o.cta).label),
      ctaHref: s(obj(o.cta).href),
      badgeLabel: s(o.badgeLabel),
      badgeValue: s(o.badgeValue),
      note: s(o.note)
    }))
  );
  const [trust, setTrust] = useState<ThemeTrustItemRow[]>(() =>
    list(themeJson.trustBar).map((o) => ({ icon: (s(o.icon) || "star") as TrustIconKey, title: s(o.title), subtitle: s(o.subtitle) }))
  );
  const [cats, setCats] = useState(() => {
    const o = obj(a.categories);
    return {
      enabled: b(o.enabled, true),
      title: s(o.title),
      subtitle: s(o.subtitle),
      ctaLabel: s(o.ctaLabel),
      tiles: list(o.tiles).map((t): Tile => ({ categoryId: s(t.categoryId), title: s(t.title), subtitle: s(t.subtitle), imageUrl: s(t.imageUrl) }))
    };
  });
  const [bestSellers, setBestSellers] = useState(() => toRow(a.bestSellers));
  const [promosA, setPromosA] = useState<Promo[]>(() => list(a.promosA).map(toPromo));
  const [hotDeals, setHotDeals] = useState(() => ({ ...toRow(a.hotDeals), endsAt: s(obj(a.hotDeals).endsAt).slice(0, 10) }));
  const [promosB, setPromosB] = useState<Promo[]>(() => list(a.promosB).map(toPromo));
  const [latest, setLatest] = useState(() => toRow(a.latestArrivals));
  const [spaces, setSpaces] = useState(() => {
    const o = obj(a.spaces);
    return {
      enabled: b(o.enabled, true),
      title: s(o.title),
      subtitle: s(o.subtitle),
      items: list(o.items).map((x): Space => ({ title: s(x.title), subtitle: s(x.subtitle), imageUrl: s(x.imageUrl), categoryId: s(x.categoryId) }))
    };
  });
  const [topDeals, setTopDeals] = useState(() => toRow(a.topDeals));
  const [collections, setCollections] = useState(() => {
    const o = obj(a.collections);
    return {
      enabled: b(o.enabled, true),
      title: s(o.title),
      subtitle: s(o.subtitle),
      ctaLabel: s(o.ctaLabel),
      ctaHref: s(o.ctaHref),
      items: list(o.items).map(
        (x): Collection => ({
          title: s(x.title),
          subtitle: s(x.subtitle),
          badge: s(x.badge),
          priceText: s(x.priceText),
          oldPriceText: s(x.oldPriceText),
          imageUrl: s(x.imageUrl),
          ctaLabel: s(obj(x.cta).label),
          ctaHref: s(obj(x.cta).href)
        })
      )
    };
  });
  const [brandsSec, setBrandsSec] = useState(() => {
    const o = obj(a.brands);
    return { enabled: b(o.enabled, true), title: s(o.title), subtitle: s(o.subtitle) };
  });
  const [brands, setBrands] = useState<ThemeBrandLogoRow[]>(() =>
    list(themeJson.brands).map((o) => ({ name: s(o.name), logoUrl: s(o.logoUrl), href: s(o.href) }))
  );
  const [news, setNews] = useState(() => {
    const o = obj(a.newsletter);
    return { enabled: b(o.enabled, true), title: s(o.title), body: s(o.body), placeholder: s(o.placeholder), buttonLabel: s(o.buttonLabel), whatsappLabel: s(o.whatsappLabel) };
  });
  const [footer, setFooter] = useState(() => {
    const o = obj(a.footer);
    return { tagline: s(o.tagline), about: s(o.about) };
  });

  useEffect(() => {
    void window.blueLedger.category
      .list()
      .then((c) => setCategories(c.filter((x) => x.status === "active").sort((p, q) => p.name.localeCompare(q.name))))
      .catch(() => setCategories([]));
  }, []);

  const save = useCallback(
    async (key: string, patch: Record<string, unknown>, label: string) => {
      setSaving(key);
      try {
        await window.blueLedger.onlineStore.themeUpdate(patch as ThemeUpdatePatch);
        showSuccessToast(`${label} saved`);
        onSaved();
      } catch (err) {
        showErrorToast(getErrorMessage(err, `Couldn't save ${label.toLowerCase()}`));
      } finally {
        setSaving(null);
      }
    },
    [onSaved]
  );
  const saveAdia = (key: string, section: string, value: unknown, label: string) => save(key, { adia: { [section]: value } }, label);

  const toggle = (k: string) => () => setOpenKey((cur) => (cur === k ? null : k));
  const sec = (k: string, title: string, hint?: string) => ({ title, ...(hint ? { hint } : {}), open: openKey === k, onToggle: toggle(k), saving: saving === k });

  // --- savers (each writes only its own section) --------------------------------------------------
  const slidesOut = (list: Slide[]) =>
    list
      .filter((x) => x.title.trim() || x.imageUrl)
      .map((x) => ({
        imageUrl: n(x.imageUrl),
        eyebrow: n(x.eyebrow),
        title: n(x.title),
        subtitle: n(x.subtitle),
        body: n(x.body),
        cta: linkOut(x.ctaLabel, x.ctaHref),
        badgeLabel: n(x.badgeLabel),
        badgeValue: n(x.badgeValue),
        note: n(x.note)
      }));
  const catsOut = (c: typeof cats) => ({
    enabled: c.enabled,
    title: n(c.title),
    subtitle: n(c.subtitle),
    ctaLabel: n(c.ctaLabel),
    tiles: c.tiles.filter((t) => t.categoryId).map((t) => ({ categoryId: t.categoryId, title: n(t.title), subtitle: n(t.subtitle), imageUrl: n(t.imageUrl) }))
  });
  const spacesOut = (sp: typeof spaces) => ({
    enabled: sp.enabled,
    title: n(sp.title),
    subtitle: n(sp.subtitle),
    items: sp.items.filter((x) => x.title.trim()).map((x) => ({ title: x.title.trim(), subtitle: n(x.subtitle), imageUrl: n(x.imageUrl), categoryId: n(x.categoryId) }))
  });
  const collectionsOut = (c: typeof collections) => ({
    enabled: c.enabled,
    title: n(c.title),
    subtitle: n(c.subtitle),
    ctaLabel: n(c.ctaLabel),
    ctaHref: n(c.ctaHref),
    items: c.items
      .filter((x) => x.title.trim())
      .map((x) => ({
        title: x.title.trim(),
        subtitle: n(x.subtitle),
        badge: n(x.badge),
        priceText: n(x.priceText),
        oldPriceText: n(x.oldPriceText),
        imageUrl: n(x.imageUrl),
        cta: linkOut(x.ctaLabel, x.ctaHref)
      }))
  });

  // Images persist the moment they're uploaded/removed — together with the rest of that section.
  const imageSlot = (label: string, slot: string, url: string, set: (url: string) => void, persist: (url: string) => void, aspect?: string) => (
    <ImageSlot
      label={label}
      url={url}
      slot={slot}
      enabled={imageUploadsEnabled}
      {...(aspect ? { aspect } : {})}
      onChange={(next) => {
        set(next ?? "");
        persist(next ?? "");
      }}
    />
  );

  const rowEditor = (row: Row, set: (r: Row) => void, autoLabel: string) => (
    <>
      <CheckboxField label="Show this section" checked={row.enabled} onChange={(v) => set({ ...row, enabled: v })} />
      <Grid>
        <Field label="Title" value={row.title} onChange={(v) => set({ ...row, title: v })} maxLength={60} placeholder="Default title" />
        <Field label="Subtitle" value={row.subtitle} onChange={(v) => set({ ...row, subtitle: v })} maxLength={120} placeholder="Default subtitle" />
        <CategoryField label="Products from" value={row.categoryId} onChange={(v) => set({ ...row, categoryId: v })} categories={categories} emptyLabel={autoLabel} />
        <Field label="“View all” button text" value={row.ctaLabel} onChange={(v) => set({ ...row, ctaLabel: v })} maxLength={30} placeholder="View all" />
      </Grid>
      <p className="text-xs font-semibold text-muted">
        Shows up to 12 products. Tip: create a category like “Best Sellers” and tag products into it from the Products list (website categories) to hand-pick them.
      </p>
    </>
  );

  const promoEditor = (items: Promo[], set: (p: Promo[]) => void, slotBase: string, persist: (p: Promo[]) => void) => (
    <>
      {items.map((p, i) => {
        const upd = (patch: Partial<Promo>) => set(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <Item key={i}>
            <ItemBar label={`Card ${i + 1}`} index={i} count={items.length} onMove={(d) => set(move(items, i, d))} onRemove={() => set(items.filter((_, j) => j !== i))} />
            <Grid>
              <Field label="Title *" value={p.title} onChange={(v) => upd({ title: v })} maxLength={60} placeholder="e.g. Jikoni Upgrade" />
              <Field label="Subtitle" value={p.subtitle} onChange={(v) => upd({ subtitle: v })} maxLength={120} placeholder="e.g. Cook better for less." />
              <Field label="Badge" value={p.badge} onChange={(v) => upd({ badge: v })} maxLength={40} placeholder="e.g. Up to 30% off" />
              <SelectField
                label="Colour"
                value={p.tone}
                onChange={(v) => upd({ tone: v as Promo["tone"] })}
                options={[
                  { value: "light", label: "Light (cream)" },
                  { value: "dark", label: "Dark (navy)" },
                  { value: "brand", label: "Brand colour" }
                ]}
              />
              <Field label="Button text" value={p.ctaLabel} onChange={(v) => upd({ ctaLabel: v })} maxLength={40} placeholder="Shop now" />
              <LinkField label="Button goes to" value={p.ctaHref} onChange={(v) => upd({ ctaHref: v })} categories={categories} />
            </Grid>
            {imageSlot("Image", `${slotBase}-${i + 1}`, p.imageUrl, (url) => upd({ imageUrl: url }), (url) => persist(items.map((x, j) => (j === i ? { ...x, imageUrl: url } : x))))}
          </Item>
        );
      })}
      <AddButton label="Add card" disabled={items.length >= 3} onClick={() => set([...items, { ...EMPTY_PROMO }])} />
      <p className="text-xs font-semibold text-muted">Up to 3 cards. With none, the website shows cards for your biggest categories.</p>
    </>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm font-semibold text-ink">
        Everything on your <span className="font-extrabold">Adia</span> home page, top to bottom. Leave any text empty to keep the default
        shown in grey. Each section saves on its own.
      </div>

      {/* 1 · top strip + socials */}
      <Section {...sec("top", "Top strip & social links", "The black strip above the header, on every page")} onSave={() =>
        void save("top", {
          adia: {
            topStrip: { enabled: top.enabled, label: n(top.label), highlight: n(top.highlight), cta: linkOut(top.ctaLabel, top.ctaHref) },
            socials: Object.fromEntries(Object.entries(socials).map(([k, v]) => [k, n(v)]))
          }
        }, "Top strip")
      }>
        <CheckboxField label="Show the Hot Deals message" checked={top.enabled} onChange={(v) => setTop({ ...top, enabled: v })} />
        <Grid cols={3}>
          <Field label="Label" value={top.label} onChange={(v) => setTop({ ...top, label: v })} maxLength={40} placeholder="Hot Deals" />
          <Field label="Message" value={top.highlight} onChange={(v) => setTop({ ...top, highlight: v })} maxLength={60} placeholder="Grab them now" />
          <Field label="Link text" value={top.ctaLabel} onChange={(v) => setTop({ ...top, ctaLabel: v })} maxLength={40} placeholder="Shop now" />
        </Grid>
        <LinkField label="Link goes to" value={top.ctaHref} onChange={(v) => setTop({ ...top, ctaHref: v })} categories={categories} />
        <p className="pt-2 text-[11px] font-extrabold uppercase tracking-wider text-muted">Social links (handle or full link)</p>
        <Grid cols={3}>
          {(["facebook", "instagram", "tiktok", "youtube", "x", "whatsapp"] as const).map((k) => (
            <Field
              key={k}
              label={k === "x" ? "X (Twitter)" : k === "whatsapp" ? "WhatsApp number" : k.charAt(0).toUpperCase() + k.slice(1)}
              value={socials[k]}
              onChange={(v) => setSocials({ ...socials, [k]: v })}
              maxLength={300}
              placeholder={k === "whatsapp" ? "07XX XXX XXX" : "@yourshop"}
            />
          ))}
        </Grid>
      </Section>

      {/* 2 · hero */}
      <Section {...sec("hero", "Hero slides", "Big edge-to-edge banner — up to 5 slides, 1920×800 photos work best")} onSave={() => void saveAdia("hero", "heroSlides", slidesOut(slides), "Hero slides")}>
        {slides.map((sl, i) => {
          const upd = (patch: Partial<Slide>) => setSlides(slides.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <Item key={i}>
              <ItemBar label={`Slide ${i + 1}`} index={i} count={slides.length} onMove={(d) => setSlides(move(slides, i, d))} onRemove={() => setSlides(slides.filter((_, j) => j !== i))} />
              {imageSlot(
                "Cover image",
                `adia-hero-${i + 1}`,
                sl.imageUrl,
                (url) => upd({ imageUrl: url }),
                (url) => void saveAdia("hero", "heroSlides", slidesOut(slides.map((x, j) => (j === i ? { ...x, imageUrl: url } : x))), "Hero slides"),
                "aspect-[12/5]"
              )}
              <Grid>
                <Field label="Small line above the title" value={sl.eyebrow} onChange={(v) => upd({ eyebrow: v })} maxLength={40} placeholder="e.g. Home upgrade" />
                <Field label="Title" value={sl.title} onChange={(v) => upd({ title: v })} maxLength={80} placeholder="e.g. SALE" />
                <Field label="Subtitle" value={sl.subtitle} onChange={(v) => upd({ subtitle: v })} maxLength={80} placeholder="e.g. Make Home Better." />
                <Field label="Text" value={sl.body} onChange={(v) => upd({ body: v })} maxLength={200} placeholder="e.g. Up to 35% off selected appliances." />
                <Field label="Button text" value={sl.ctaLabel} onChange={(v) => upd({ ctaLabel: v })} maxLength={40} placeholder="Shop now" />
                <LinkField label="Button goes to" value={sl.ctaHref} onChange={(v) => upd({ ctaHref: v })} categories={categories} />
                <Field label="Round badge — top line" value={sl.badgeLabel} onChange={(v) => upd({ badgeLabel: v })} maxLength={20} placeholder="e.g. Save up to" />
                <Field label="Round badge — big text" value={sl.badgeValue} onChange={(v) => upd({ badgeValue: v })} maxLength={12} placeholder="e.g. 35% (empty = no badge)" />
              </Grid>
              <Field label="Small note under the button" value={sl.note} onChange={(v) => upd({ note: v })} maxLength={80} placeholder="e.g. Ends Sunday · While stocks last" />
            </Item>
          );
        })}
        <AddButton label="Add slide" disabled={slides.length >= 5} onClick={() => setSlides([...slides, { ...EMPTY_SLIDE }])} />
      </Section>

      {/* 3 · features */}
      <Section {...sec("features", "Features band", "The 4 points that sit on the bottom edge of the hero")} onSave={() =>
        void save("features", { trustBar: trust.filter((t) => t.title.trim()).map((t) => ({ icon: t.icon, title: t.title.trim(), subtitle: t.subtitle?.trim() || null })) }, "Features")
      }>
        {trust.map((t, i) => {
          const upd = (patch: Partial<ThemeTrustItemRow>) => setTrust(trust.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <Item key={i}>
              <ItemBar label={`Point ${i + 1}`} index={i} count={trust.length} onMove={(d) => setTrust(move(trust, i, d))} onRemove={() => setTrust(trust.filter((_, j) => j !== i))} />
              <Grid cols={3}>
                <SelectField label="Icon" value={t.icon} onChange={(v) => upd({ icon: v as TrustIconKey })} options={[...TRUST_ICON_OPTIONS]} />
                <Field label="Title" value={t.title} onChange={(v) => upd({ title: v })} maxLength={40} placeholder="e.g. Fast Delivery" />
                <Field label="Subtitle" value={t.subtitle ?? ""} onChange={(v) => upd({ subtitle: v })} maxLength={60} placeholder="e.g. To your door, countrywide" />
              </Grid>
            </Item>
          );
        })}
        <AddButton label="Add point" disabled={trust.length >= 4} onClick={() => setTrust([...trust, { icon: "truck", title: "", subtitle: "" }])} />
        <p className="text-xs font-semibold text-muted">With none, the website shows Fast Delivery · Genuine Products · Pick Up or Delivery · Real Support.</p>
      </Section>

      {/* 4 · categories */}
      <Section {...sec("cats", "Shop Your Home (categories)", "2 large + 4 small category tiles")} onSave={() => void saveAdia("cats", "categories", catsOut(cats), "Categories")}>
        <CheckboxField label="Show this section" checked={cats.enabled} onChange={(v) => setCats({ ...cats, enabled: v })} />
        <Grid cols={3}>
          <Field label="Title" value={cats.title} onChange={(v) => setCats({ ...cats, title: v })} maxLength={60} placeholder="Shop Your Home" />
          <Field label="Subtitle" value={cats.subtitle} onChange={(v) => setCats({ ...cats, subtitle: v })} maxLength={120} placeholder="Find what you need, room by room." />
          <Field label="“View all” text" value={cats.ctaLabel} onChange={(v) => setCats({ ...cats, ctaLabel: v })} maxLength={30} placeholder="View all categories" />
        </Grid>
        {cats.tiles.map((t, i) => {
          const upd = (patch: Partial<Tile>) => setCats({ ...cats, tiles: cats.tiles.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <Item key={i}>
              <ItemBar
                label={i < 2 ? `Large tile ${i + 1}` : `Small tile ${i - 1}`}
                index={i}
                count={cats.tiles.length}
                onMove={(d) => setCats({ ...cats, tiles: move(cats.tiles, i, d) })}
                onRemove={() => setCats({ ...cats, tiles: cats.tiles.filter((_, j) => j !== i) })}
              />
              <Grid cols={3}>
                <CategoryField label="Category *" value={t.categoryId} onChange={(v) => upd({ categoryId: v })} categories={categories} emptyLabel="Choose…" />
                <Field label="Title" value={t.title} onChange={(v) => upd({ title: v })} maxLength={40} placeholder="Category name" />
                <Field label="Subtitle" value={t.subtitle} onChange={(v) => upd({ subtitle: v })} maxLength={60} placeholder="e.g. Upgrade your cooking" />
              </Grid>
              {imageSlot(
                "Tile image",
                `adia-cat-${i + 1}`,
                t.imageUrl,
                (url) => upd({ imageUrl: url }),
                (url) => void saveAdia("cats", "categories", catsOut({ ...cats, tiles: cats.tiles.map((x, j) => (j === i ? { ...x, imageUrl: url } : x)) }), "Categories")
              )}
            </Item>
          );
        })}
        <AddButton label="Add tile" disabled={cats.tiles.length >= 6} onClick={() => setCats({ ...cats, tiles: [...cats.tiles, { categoryId: "", title: "", subtitle: "", imageUrl: "" }] })} />
        <p className="text-xs font-semibold text-muted">With no tiles, the website shows your 6 biggest categories.</p>
      </Section>

      {/* 5 · best sellers */}
      <Section {...sec("best", "Best Sellers (12 products)")} onSave={() => void saveAdia("best", "bestSellers", rowOut(bestSellers), "Best Sellers")}>
        {rowEditor(bestSellers, setBestSellers, "Automatic (featured products)")}
      </Section>

      {/* 6 · feature cards A */}
      <Section {...sec("promosA", "Feature cards (after Best Sellers)")} onSave={() => void saveAdia("promosA", "promosA", promoOut(promosA), "Feature cards")}>
        {promoEditor(promosA, setPromosA, "adia-promo-a", (p) => void saveAdia("promosA", "promosA", promoOut(p), "Feature cards"))}
      </Section>

      {/* 7 · hot deals */}
      <Section {...sec("hot", "Hot Deals (red section, 12 products)")} onSave={() =>
        void saveAdia("hot", "hotDeals", { ...rowOut(hotDeals), endsAt: hotDeals.endsAt ? `${hotDeals.endsAt}T23:59:59` : null }, "Hot Deals")
      }>
        {rowEditor(hotDeals, (r) => setHotDeals({ ...hotDeals, ...r }), "Automatic (higher-priced picks)")}
        <label className="block">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Countdown ends on</span>
          <input
            type="date"
            value={hotDeals.endsAt}
            onChange={(e) => setHotDeals({ ...hotDeals, endsAt: e.target.value })}
            className="mt-1.5 h-10 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-accent"
          />
          <span className="mt-1 block text-xs font-semibold text-muted">Empty (or a past date) = counts down to this Sunday night, every week.</span>
        </label>
      </Section>

      {/* 8 · feature cards B */}
      <Section {...sec("promosB", "Feature cards (after Hot Deals)")} onSave={() => void saveAdia("promosB", "promosB", promoOut(promosB), "Feature cards")}>
        {promoEditor(promosB, setPromosB, "adia-promo-b", (p) => void saveAdia("promosB", "promosB", promoOut(p), "Feature cards"))}
      </Section>

      {/* 9 · latest */}
      <Section {...sec("latest", "Latest Arrivals (12 products)")} onSave={() => void saveAdia("latest", "latestArrivals", rowOut(latest), "Latest Arrivals")}>
        {rowEditor(latest, setLatest, "Automatic (newest products)")}
      </Section>

      {/* 10 · spaces */}
      <Section {...sec("spaces", "What's Your Space? (rooms)", "Up to 4 room cards, each opening a category")} onSave={() => void saveAdia("spaces", "spaces", spacesOut(spaces), "Rooms")}>
        <CheckboxField label="Show this section" checked={spaces.enabled} onChange={(v) => setSpaces({ ...spaces, enabled: v })} />
        <Grid>
          <Field label="Title" value={spaces.title} onChange={(v) => setSpaces({ ...spaces, title: v })} maxLength={60} placeholder="What's Your Space?" />
          <Field label="Subtitle" value={spaces.subtitle} onChange={(v) => setSpaces({ ...spaces, subtitle: v })} maxLength={120} placeholder="Explore appliances by room." />
        </Grid>
        {spaces.items.map((x, i) => {
          const upd = (patch: Partial<Space>) => setSpaces({ ...spaces, items: spaces.items.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
          return (
            <Item key={i}>
              <ItemBar
                label={`Room ${i + 1}`}
                index={i}
                count={spaces.items.length}
                onMove={(d) => setSpaces({ ...spaces, items: move(spaces.items, i, d) })}
                onRemove={() => setSpaces({ ...spaces, items: spaces.items.filter((_, j) => j !== i) })}
              />
              <Grid cols={3}>
                <Field label="Room name *" value={x.title} onChange={(v) => upd({ title: v })} maxLength={40} placeholder="e.g. Kitchen" />
                <Field label="What's in it" value={x.subtitle} onChange={(v) => upd({ subtitle: v })} maxLength={80} placeholder="e.g. Cookers · Microwaves · Fridges" />
                <CategoryField label="Opens category" value={x.categoryId} onChange={(v) => upd({ categoryId: v })} categories={categories} emptyLabel="All products" />
              </Grid>
              {imageSlot(
                "Room photo",
                `adia-space-${i + 1}`,
                x.imageUrl,
                (url) => upd({ imageUrl: url }),
                (url) => void saveAdia("spaces", "spaces", spacesOut({ ...spaces, items: spaces.items.map((y, j) => (j === i ? { ...y, imageUrl: url } : y)) }), "Rooms")
              )}
            </Item>
          );
        })}
        <AddButton label="Add room" disabled={spaces.items.length >= 4} onClick={() => setSpaces({ ...spaces, items: [...spaces.items, { title: "", subtitle: "", imageUrl: "", categoryId: "" }] })} />
      </Section>

      {/* 11 · top deals */}
      <Section {...sec("top-deals", "Top Deals (12 products)")} onSave={() => void saveAdia("top-deals", "topDeals", rowOut(topDeals), "Top Deals")}>
        {rowEditor(topDeals, setTopDeals, "Automatic (best-value picks)")}
      </Section>

      {/* 12 · collections */}
      <Section {...sec("collections", "Collection cards", "e.g. “Better Together” bundles — each card opens a category or link")} onSave={() => void saveAdia("collections", "collections", collectionsOut(collections), "Collection cards")}>
        <CheckboxField label="Show this section" checked={collections.enabled} onChange={(v) => setCollections({ ...collections, enabled: v })} />
        <Grid>
          <Field label="Title" value={collections.title} onChange={(v) => setCollections({ ...collections, title: v })} maxLength={60} placeholder="Better Together" />
          <Field label="Subtitle" value={collections.subtitle} onChange={(v) => setCollections({ ...collections, subtitle: v })} maxLength={120} placeholder="Save more when you shop the set." />
          <Field label="“View all” text" value={collections.ctaLabel} onChange={(v) => setCollections({ ...collections, ctaLabel: v })} maxLength={30} placeholder="(none)" />
          <LinkField label="“View all” goes to" value={collections.ctaHref} onChange={(v) => setCollections({ ...collections, ctaHref: v })} categories={categories} />
        </Grid>
        {collections.items.map((x, i) => {
          const upd = (patch: Partial<Collection>) => setCollections({ ...collections, items: collections.items.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
          return (
            <Item key={i}>
              <ItemBar
                label={`Card ${i + 1}`}
                index={i}
                count={collections.items.length}
                onMove={(d) => setCollections({ ...collections, items: move(collections.items, i, d) })}
                onRemove={() => setCollections({ ...collections, items: collections.items.filter((_, j) => j !== i) })}
              />
              <Grid cols={3}>
                <Field label="Title *" value={x.title} onChange={(v) => upd({ title: v })} maxLength={60} placeholder="e.g. New Kitchen Bundle" />
                <Field label="Subtitle" value={x.subtitle} onChange={(v) => upd({ subtitle: v })} maxLength={100} placeholder="e.g. Fridge + Cooker + Microwave" />
                <Field label="Badge" value={x.badge} onChange={(v) => upd({ badge: v })} maxLength={40} placeholder="e.g. SAVE KSh 18,000" />
                <Field label="Old price (crossed out)" value={x.oldPriceText} onChange={(v) => upd({ oldPriceText: v })} maxLength={30} placeholder="e.g. KSh 118,000" />
                <Field label="Price" value={x.priceText} onChange={(v) => upd({ priceText: v })} maxLength={30} placeholder="e.g. KSh 99,999" />
                <Field label="Button text" value={x.ctaLabel} onChange={(v) => upd({ ctaLabel: v })} maxLength={40} placeholder="View collection" />
              </Grid>
              <LinkField label="Card goes to" value={x.ctaHref} onChange={(v) => upd({ ctaHref: v })} categories={categories} />
              {imageSlot(
                "Image",
                `adia-collection-${i + 1}`,
                x.imageUrl,
                (url) => upd({ imageUrl: url }),
                (url) => void saveAdia("collections", "collections", collectionsOut({ ...collections, items: collections.items.map((y, j) => (j === i ? { ...y, imageUrl: url } : y)) }), "Collection cards"),
                "aspect-square"
              )}
            </Item>
          );
        })}
        <AddButton
          label="Add card"
          disabled={collections.items.length >= 3}
          onClick={() => setCollections({ ...collections, items: [...collections.items, { title: "", subtitle: "", badge: "", priceText: "", oldPriceText: "", imageUrl: "", ctaLabel: "", ctaHref: "" }] })}
        />
        <p className="text-xs font-semibold text-muted">Prices here are just text — write them exactly as you want them shown. The section is hidden until you add a card.</p>
      </Section>

      {/* 13 · brands */}
      <Section {...sec("brands", "Brands carousel")} onSave={() =>
        void save("brands", {
          adia: { brands: { enabled: brandsSec.enabled, title: n(brandsSec.title), subtitle: n(brandsSec.subtitle) } },
          brands: brands.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), logoUrl: x.logoUrl?.trim() || null, href: x.href?.trim() || null }))
        }, "Brands")
      }>
        <CheckboxField label="Show this section" checked={brandsSec.enabled} onChange={(v) => setBrandsSec({ ...brandsSec, enabled: v })} />
        <Grid>
          <Field label="Title" value={brandsSec.title} onChange={(v) => setBrandsSec({ ...brandsSec, title: v })} maxLength={60} placeholder="Brands You Know. Quality You Trust." />
          <Field label="Subtitle" value={brandsSec.subtitle} onChange={(v) => setBrandsSec({ ...brandsSec, subtitle: v })} maxLength={120} placeholder="(none)" />
        </Grid>
        {brands.map((x, i) => {
          const upd = (patch: Partial<ThemeBrandLogoRow>) => setBrands(brands.map((y, j) => (j === i ? { ...y, ...patch } : y)));
          return (
            <Item key={i}>
              <ItemBar label={`Brand ${i + 1}`} index={i} count={brands.length} onMove={(d) => setBrands(move(brands, i, d))} onRemove={() => setBrands(brands.filter((_, j) => j !== i))} />
              <Grid>
                <Field label="Brand name *" value={x.name} onChange={(v) => upd({ name: v })} maxLength={40} placeholder="e.g. Samsung" />
                <LinkField label="Opens (default: that brand's products)" value={x.href ?? ""} onChange={(v) => upd({ href: v })} categories={categories} />
              </Grid>
              {imageSlot(
                "Logo (optional — the name shows without one)",
                `adia-brand-${i + 1}`,
                x.logoUrl ?? "",
                (url) => upd({ logoUrl: url }),
                (url) =>
                  void save("brands", {
                    brands: brands
                      .map((y, j) => (j === i ? { ...y, logoUrl: url } : y))
                      .filter((y) => y.name.trim())
                      .map((y) => ({ name: y.name.trim(), logoUrl: y.logoUrl?.trim() || null, href: y.href?.trim() || null }))
                  }, "Brands"),
                "aspect-[3/1]"
              )}
            </Item>
          );
        })}
        <AddButton label="Add brand" disabled={brands.length >= 24} onClick={() => setBrands([...brands, { name: "", logoUrl: "", href: "" }])} />
      </Section>

      {/* 14 · newsletter */}
      <Section {...sec("news", "Newsletter", "Sign-ups appear in the Subscribers tab")} onSave={() =>
        void saveAdia("news", "newsletter", {
          enabled: news.enabled,
          title: n(news.title),
          body: n(news.body),
          placeholder: n(news.placeholder),
          buttonLabel: n(news.buttonLabel),
          whatsappLabel: n(news.whatsappLabel)
        }, "Newsletter")
      }>
        <CheckboxField label="Show the newsletter box" checked={news.enabled} onChange={(v) => setNews({ ...news, enabled: v })} />
        <Grid>
          <Field label="Title" value={news.title} onChange={(v) => setNews({ ...news, title: v })} maxLength={60} placeholder="Get the Latest Deals" />
          <Field label="Text" value={news.body} onChange={(v) => setNews({ ...news, body: v })} maxLength={160} placeholder="Be the first to know about new arrivals and exclusive offers." />
          <Field label="Email box hint" value={news.placeholder} onChange={(v) => setNews({ ...news, placeholder: v })} maxLength={40} placeholder="Enter your email address" />
          <Field label="Button text" value={news.buttonLabel} onChange={(v) => setNews({ ...news, buttonLabel: v })} maxLength={20} placeholder="Subscribe" />
          <Field label="WhatsApp button text" value={news.whatsappLabel} onChange={(v) => setNews({ ...news, whatsappLabel: v })} maxLength={40} placeholder="Chat with us on WhatsApp" />
        </Grid>
        <p className="text-xs font-semibold text-muted">The WhatsApp button uses the WhatsApp number from “Top strip & social links” (or your contact WhatsApp number).</p>
      </Section>

      {/* 15 · footer */}
      <Section {...sec("footer", "Footer text")} onSave={() => void saveAdia("footer", "footer", { tagline: n(footer.tagline), about: n(footer.about) }, "Footer")}>
        <Field label="Tagline (under the logo)" value={footer.tagline} onChange={(v) => setFooter({ ...footer, tagline: v })} maxLength={80} placeholder="e.g. Make Home Better." />
        <TextAreaField label="About text" value={footer.about} onChange={(v) => setFooter({ ...footer, about: v })} rows={3} placeholder="Genuine products, fair prices and reliable delivery — shop us online." />
      </Section>
    </div>
  );
}
