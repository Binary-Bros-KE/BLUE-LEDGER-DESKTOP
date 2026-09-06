import { useCallback, useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { cn } from "@renderer/shared/lib/cn";
import type { Category } from "@shared/types/category";
import {
  parseThemeConfig,
  type ThemeDealTile,
  type ThemeProductSectionRow,
  type ThemeStoryRow,
  type ThemeTradeTile,
  type ThemeUpdatePatch,
  type TrylistThemeConfig
} from "@shared/types/online-store";

/** One image slot — preview (or empty state) + Upload/Replace + Remove. `slot` only names the
 * uploaded file. `onChange` receives the new URL (or null on remove). */
function ImageSlot({
  label,
  hint,
  url,
  slot,
  enabled,
  onChange,
  aspect = "aspect-[16/9]"
}: {
  label: string;
  hint?: string;
  url: string;
  slot: string;
  enabled: boolean;
  onChange: (url: string | null) => Promise<void> | void;
  aspect?: string;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);

  const pick = useCallback(async () => {
    if (!enabled || busy) return;
    setBusy(true);
    try {
      const res = await window.blueLedger.onlineStore.themeUpload(slot);
      if (res) await onChange(res.url);
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't upload that image"));
    } finally {
      setBusy(false);
    }
  }, [busy, enabled, onChange, slot]);

  const remove = useCallback(async () => {
    if (busy || !url) return;
    setBusy(true);
    try {
      await window.blueLedger.onlineStore.themeDeleteImage(url);
      await onChange(null);
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't remove that image"));
    } finally {
      setBusy(false);
    }
  }, [busy, onChange, url]);

  return (
    <div>
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
      <div className={cn("mt-2 flex items-stretch gap-3")}>
        <div className={cn("relative w-40 flex-none overflow-hidden border border-line bg-soft", aspect)}>
          {url ? (
            <img src={url} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-[10px] font-semibold uppercase tracking-wide text-muted">
              No image
            </span>
          )}
          {busy ? (
            <span className="absolute inset-0 grid place-items-center bg-white/60">
              <Loader2 className="size-4 animate-spin" />
            </span>
          ) : null}
        </div>
        <div className="flex flex-col justify-center gap-2">
          <button
            type="button"
            onClick={() => void pick()}
            disabled={!enabled || busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-xs font-extrabold uppercase tracking-wide text-ink transition hover:bg-soft disabled:opacity-50"
          >
            <ImagePlus className="size-3.5" /> {url ? "Replace" : "Upload"}
          </button>
          {url ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-xs font-extrabold uppercase tracking-wide text-danger transition hover:bg-danger-soft disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

export function ThemePanel({
  themeJson,
  imageUploadsEnabled,
  onSaved
}: {
  themeJson: Record<string, unknown>;
  imageUploadsEnabled: boolean;
  onSaved: () => void;
}): React.JSX.Element {
  const initial = useMemo(() => parseThemeConfig(themeJson), [themeJson]);

  // Hero + story are edited freely and persist only on their Save button, so they're seeded ONCE
  // (a later parent reload after e.g. a category upload must not wipe unsaved text).
  const [hero, setHero] = useState<TrylistThemeConfig["hero"]>(() => parseThemeConfig(themeJson).hero);
  const [story, setStory] = useState<ThemeStoryRow[]>(() => parseThemeConfig(themeJson).story);
  const [sections, setSections] = useState<ThemeProductSectionRow[]>(
    () => parseThemeConfig(themeJson).productSections
  );
  const [categories, setCategories] = useState<Category[]>([]);
  // Category + hero/story *images* persist immediately, so this stays in sync with the server.
  const [catImages, setCatImages] = useState<Record<string, string>>(initial.categoryImages);
  const [savingHero, setSavingHero] = useState(false);
  const [savingStory, setSavingStory] = useState(false);
  const [savingSections, setSavingSections] = useState(false);

  // Hero right-rail tiles — same "seeded once, images resync separately" split as hero/story above.
  const [dealTile, setDealTile] = useState<ThemeDealTile>(() => parseThemeConfig(themeJson).dealTile);
  // Money fields keep their own raw-text state per this app's own established convention (never
  // re-derive a price input's text from cents on every render — see DeliveryPanel.tsx's priceText).
  const [dealPriceText, setDealPriceText] = useState(() => fromCents(parseThemeConfig(themeJson).dealTile.priceCents ?? null));
  const [dealOfferPriceText, setDealOfferPriceText] = useState(() =>
    fromCents(parseThemeConfig(themeJson).dealTile.offerPriceCents ?? null)
  );
  const [savingDeal, setSavingDeal] = useState(false);
  const [tradeTile, setTradeTile] = useState<ThemeTradeTile>(() => parseThemeConfig(themeJson).tradeTile);
  const [savingTrade, setSavingTrade] = useState(false);

  useEffect(() => {
    setCatImages(initial.categoryImages);
    setHero((h) => ({
      ...h,
      shotImageUrl: initial.hero.shotImageUrl,
      backgroundImageUrl: initial.hero.backgroundImageUrl
    }));
    setDealTile((d) => ({ ...d, imageUrl: initial.dealTile.imageUrl }));
    setTradeTile((t) => ({ ...t, imageUrl: initial.tradeTile.imageUrl }));
  }, [initial]);

  // Client request: the price + offer price the shop owner types drive an auto-calculated discount
  // — never a separately-entered/stored percentage, so the badge can never drift out of sync with
  // the two prices it's supposedly describing.
  const dealDiscountPercent = useMemo(() => {
    const price = dealPriceText.trim() ? toCents(dealPriceText.trim()) : 0;
    const offer = dealOfferPriceText.trim() ? toCents(dealOfferPriceText.trim()) : 0;
    if (price <= 0 || offer <= 0 || offer >= price) return null;
    return Math.round((1 - offer / price) * 100);
  }, [dealPriceText, dealOfferPriceText]);

  useEffect(() => {
    void window.blueLedger.category.list().then(setCategories).catch(() => setCategories([]));
  }, []);

  const apply = useCallback(
    async (patch: ThemeUpdatePatch, okMsg?: string) => {
      await window.blueLedger.onlineStore.themeUpdate(patch);
      if (okMsg) showSuccessToast(okMsg);
      onSaved();
    },
    [onSaved]
  );

  const saveHeroText = useCallback(async () => {
    setSavingHero(true);
    try {
      await apply(
        {
          hero: {
            headline: hero.headline.trim() || null,
            sub: hero.sub.trim() || null,
            primaryCta:
              hero.primaryCta.label?.trim() || hero.primaryCta.href?.trim()
                ? { label: hero.primaryCta.label?.trim(), href: hero.primaryCta.href?.trim() }
                : null,
            secondaryCta:
              hero.secondaryCta.label?.trim() || hero.secondaryCta.href?.trim()
                ? { label: hero.secondaryCta.label?.trim(), href: hero.secondaryCta.href?.trim() }
                : null
          }
        },
        "Hero text saved"
      );
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't save"));
    } finally {
      setSavingHero(false);
    }
  }, [apply, hero]);

  const saveStory = useCallback(async () => {
    setSavingStory(true);
    try {
      const cleaned = story
        .map((r) => ({
          imageUrl: r.imageUrl || undefined,
          title: r.title?.trim() || undefined,
          body: r.body?.trim() || undefined,
          ctaLabel: r.ctaLabel?.trim() || undefined,
          ctaHref: r.ctaHref?.trim() || undefined
        }))
        .filter((r) => r.imageUrl || r.title || r.body);
      await apply({ story: cleaned }, "Story rows saved");
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't save"));
    } finally {
      setSavingStory(false);
    }
  }, [apply, story]);

  const saveSections = useCallback(async () => {
    setSavingSections(true);
    try {
      const cleaned = sections
        .map((s) => ({
          title: s.title?.trim() || undefined,
          categoryId: s.categoryId || undefined,
          ctaLabel: s.ctaLabel?.trim() || undefined
        }))
        .filter((s) => s.title && s.categoryId);
      await apply({ productSections: cleaned }, "Home sections saved");
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't save"));
    } finally {
      setSavingSections(false);
    }
  }, [apply, sections]);

  const saveDeal = useCallback(async () => {
    setSavingDeal(true);
    try {
      await apply(
        {
          dealTile: {
            title: dealTile.title?.trim() || null,
            priceCents: dealPriceText.trim() ? toCents(dealPriceText.trim()) : null,
            offerPriceCents: dealOfferPriceText.trim() ? toCents(dealOfferPriceText.trim()) : null,
            ctaLabel: dealTile.ctaLabel?.trim() || null,
            ctaHref: dealTile.ctaHref?.trim() || null
          }
        },
        "Deal tile saved"
      );
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't save"));
    } finally {
      setSavingDeal(false);
    }
  }, [apply, dealTile, dealPriceText, dealOfferPriceText]);

  const saveTrade = useCallback(async () => {
    setSavingTrade(true);
    try {
      await apply(
        {
          tradeTile: {
            categoryLabel: tradeTile.categoryLabel?.trim() || null,
            title: tradeTile.title?.trim() || null,
            description: tradeTile.description?.trim() || null,
            ctaLabel: tradeTile.ctaLabel?.trim() || null,
            ctaHref: tradeTile.ctaHref?.trim() || null
          }
        },
        "Trade tile saved"
      );
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't save"));
    } finally {
      setSavingTrade(false);
    }
  }, [apply, tradeTile]);

  const setStoryImage = useCallback(
    async (index: number, url: string | null) => {
      const next = story.map((r, i) => (i === index ? { ...r, imageUrl: url ?? undefined } : r));
      setStory(next);
      await apply({
        story: next
          .map((r) => ({
            imageUrl: r.imageUrl || undefined,
            title: r.title?.trim() || undefined,
            body: r.body?.trim() || undefined,
            ctaLabel: r.ctaLabel?.trim() || undefined,
            ctaHref: r.ctaHref?.trim() || undefined
          }))
          .filter((r) => r.imageUrl || r.title || r.body)
      });
    },
    [apply, story]
  );

  const setCategoryImage = useCallback(
    async (categoryId: string, url: string | null) => {
      setCatImages((prev) => {
        const next = { ...prev };
        if (url) next[categoryId] = url;
        else delete next[categoryId];
        return next;
      });
      await apply({ categoryImages: { [categoryId]: url } });
    },
    [apply]
  );

  const notice = imageUploadsEnabled ? null : (
    <div className="rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-semibold text-gold-text">
      Image uploads aren&apos;t switched on for your store yet — contact Blue Ledger. Text still saves.
    </div>
  );

  return (
    <div className="space-y-5">
      {notice}

      <Card title="Home hero">
        <TextAreaField
          label="Headline (blank = theme default)"
          value={hero.headline}
          onChange={(v) => setHero((h) => ({ ...h, headline: v }))}
          rows={3}
          placeholder={"BUILT FOR\nTHE SHOP\nFLOOR"}
        />
        <TextAreaField
          label="Sub-paragraph"
          value={hero.sub}
          onChange={(v) => setHero((h) => ({ ...h, sub: v }))}
          rows={3}
          placeholder="One or two lines under the headline"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Primary button — label"
            value={hero.primaryCta.label ?? ""}
            onChange={(v) => setHero((h) => ({ ...h, primaryCta: { ...h.primaryCta, label: v } }))}
            placeholder="Shop the catalogue"
          />
          <Field
            label="Primary button — link"
            value={hero.primaryCta.href ?? ""}
            onChange={(v) => setHero((h) => ({ ...h, primaryCta: { ...h.primaryCta, href: v } }))}
            placeholder="/products"
          />
          <Field
            label="Secondary button — label"
            value={hero.secondaryCta.label ?? ""}
            onChange={(v) => setHero((h) => ({ ...h, secondaryCta: { ...h.secondaryCta, label: v } }))}
            placeholder="Talk to sales"
          />
          <Field
            label="Secondary button — link"
            value={hero.secondaryCta.href ?? ""}
            onChange={(v) => setHero((h) => ({ ...h, secondaryCta: { ...h.secondaryCta, href: v } }))}
            placeholder="https://wa.me/…"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void saveHeroText()} disabled={savingHero}>
            {savingHero ? <Loader2 className="size-4 animate-spin" /> : "Save hero text"}
          </Button>
        </div>

        <div className="grid gap-5 border-t border-line pt-4 sm:grid-cols-2">
          <ImageSlot
            label="Hero shot"
            hint="The product image beside the headline."
            url={hero.shotImageUrl}
            slot="hero-shot"
            enabled={imageUploadsEnabled}
            aspect="aspect-[4/3]"
            onChange={(url) => {
              setHero((h) => ({ ...h, shotImageUrl: url ?? "" }));
              return apply({ hero: { shotImageUrl: url } });
            }}
          />
          <ImageSlot
            label="Hero background"
            hint="Full-width image behind the whole hero panel."
            url={hero.backgroundImageUrl}
            slot="hero-background"
            enabled={imageUploadsEnabled}
            onChange={(url) => {
              setHero((h) => ({ ...h, backgroundImageUrl: url ?? "" }));
              return apply({ hero: { backgroundImageUrl: url } });
            }}
          />
        </div>
      </Card>

      <Card title="Deal tile (hero, red)">
        <p className="text-xs text-muted">
          The &ldquo;Deal of the week&rdquo; label stays fixed — everything below it is yours to set.
          Enter both prices and the discount badge is calculated for you, so it can never drift out
          of sync with what you typed.
        </p>
        <TextAreaField
          label="Headline (blank = theme default)"
          value={dealTile.title ?? ""}
          onChange={(v) => setDealTile((d) => ({ ...d, title: v }))}
          rows={2}
          placeholder={"Thermal printers\n25% off"}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Price"
            type="number"
            value={dealPriceText}
            onChange={setDealPriceText}
            placeholder="0.00"
          />
          <Field
            label="Offer price"
            type="number"
            value={dealOfferPriceText}
            onChange={setDealOfferPriceText}
            placeholder="0.00"
          />
        </div>
        <p className="text-xs font-bold text-muted">
          {dealDiscountPercent !== null
            ? `Discount badge will show: ${dealDiscountPercent}% OFF`
            : "Enter a price and a lower offer price to preview the discount badge."}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Call to action — label"
            value={dealTile.ctaLabel ?? ""}
            onChange={(v) => setDealTile((d) => ({ ...d, ctaLabel: v }))}
            placeholder="Buy Now"
          />
          <Field
            label="Call to action — link"
            value={dealTile.ctaHref ?? ""}
            onChange={(v) => setDealTile((d) => ({ ...d, ctaHref: v }))}
            placeholder="/products/thermal-printer"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void saveDeal()} disabled={savingDeal}>
            {savingDeal ? <Loader2 className="size-4 animate-spin" /> : "Save deal tile"}
          </Button>
        </div>

        <div className="border-t border-line pt-4">
          <ImageSlot
            label="Featured product image"
            hint="Shown in the bottom-right corner of the deal tile."
            url={dealTile.imageUrl ?? ""}
            slot="deal-product"
            enabled={imageUploadsEnabled}
            aspect="aspect-square"
            onChange={(url) => {
              setDealTile((d) => ({ ...d, imageUrl: url ?? undefined }));
              return apply({ dealTile: { imageUrl: url } });
            }}
          />
        </div>
      </Card>

      <Card title="Trade tile (hero, cream)">
        <p className="text-xs text-muted">
          A single featured category highlight next to the deal tile above.
        </p>
        <Field
          label="Category label (blank = theme default)"
          value={tradeTile.categoryLabel ?? ""}
          onChange={(v) => setTradeTile((t) => ({ ...t, categoryLabel: v }))}
          placeholder="Trade accounts"
        />
        <Field
          label="Title"
          value={tradeTile.title ?? ""}
          onChange={(v) => setTradeTile((t) => ({ ...t, title: v }))}
          placeholder="Buying for a whole branch?"
        />
        <TextAreaField
          label="Description"
          value={tradeTile.description ?? ""}
          onChange={(v) => setTradeTile((t) => ({ ...t, description: v }))}
          rows={3}
          placeholder="Tiered pricing, 30-day terms and LPO invoicing for registered businesses."
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Call to action — label"
            value={tradeTile.ctaLabel ?? ""}
            onChange={(v) => setTradeTile((t) => ({ ...t, ctaLabel: v }))}
            placeholder="Apply for terms"
          />
          <Field
            label="Call to action — link"
            value={tradeTile.ctaHref ?? ""}
            onChange={(v) => setTradeTile((t) => ({ ...t, ctaHref: v }))}
            placeholder="/trade"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void saveTrade()} disabled={savingTrade}>
            {savingTrade ? <Loader2 className="size-4 animate-spin" /> : "Save trade tile"}
          </Button>
        </div>

        <div className="border-t border-line pt-4">
          <ImageSlot
            label="Featured category image"
            hint="Shown in the bottom-right corner of the trade tile."
            url={tradeTile.imageUrl ?? ""}
            slot="trade-category"
            enabled={imageUploadsEnabled}
            aspect="aspect-square"
            onChange={(url) => {
              setTradeTile((t) => ({ ...t, imageUrl: url ?? undefined }));
              return apply({ tradeTile: { imageUrl: url } });
            }}
          />
        </div>
      </Card>

      <Card title="Story blocks">
        <p className="text-xs text-muted">
          Up to 3 image + text blocks shown further down the home page. Leave empty to hide the
          section entirely.
        </p>
        {story.map((row, i) => (
          <div key={i} className="rounded-md border border-line p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Block {i + 1}
              </span>
              <button
                type="button"
                onClick={() => setStory((s) => s.filter((_, j) => j !== i))}
                className="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wide text-danger transition hover:opacity-70"
              >
                <Trash2 className="size-3.5" /> Remove
              </button>
            </div>
            <div className="mt-3 space-y-3">
              <ImageSlot
                label="Image"
                url={row.imageUrl ?? ""}
                slot={`story-${i + 1}`}
                enabled={imageUploadsEnabled}
                aspect="aspect-[4/3]"
                onChange={(url) => setStoryImage(i, url)}
              />
              <Field
                label="Title"
                value={row.title ?? ""}
                onChange={(v) => setStory((s) => s.map((r, j) => (j === i ? { ...r, title: v } : r)))}
              />
              <TextAreaField
                label="Body"
                value={row.body ?? ""}
                onChange={(v) => setStory((s) => s.map((r, j) => (j === i ? { ...r, body: v } : r)))}
                rows={3}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Link label (optional)"
                  value={row.ctaLabel ?? ""}
                  onChange={(v) => setStory((s) => s.map((r, j) => (j === i ? { ...r, ctaLabel: v } : r)))}
                />
                <Field
                  label="Link URL"
                  value={row.ctaHref ?? ""}
                  onChange={(v) => setStory((s) => s.map((r, j) => (j === i ? { ...r, ctaHref: v } : r)))}
                />
              </div>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStory((s) => (s.length >= 3 ? s : [...s, {}]))}
            disabled={story.length >= 3}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-xs font-extrabold uppercase tracking-wide text-ink transition hover:bg-soft disabled:opacity-50"
          >
            <Plus className="size-3.5" /> Add block
          </button>
          <Button onClick={() => void saveStory()} disabled={savingStory}>
            {savingStory ? <Loader2 className="size-4 animate-spin" /> : "Save story blocks"}
          </Button>
        </div>
      </Card>

      <Card title="Home product sections">
        <p className="text-xs text-muted">
          Curated rows on the home page — each shows one category&apos;s products with a heading and
          a &ldquo;see all&rdquo; link (e.g. Best Sellers, New Arrivals, Daily Deals). Up to 6. Leave
          empty for the default single product grid.
        </p>
        {sections.map((s, i) => (
          <div key={i} className="rounded-md border border-line p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Section {i + 1}
              </span>
              <button
                type="button"
                onClick={() => setSections((prev) => prev.filter((_, j) => j !== i))}
                className="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wide text-danger transition hover:opacity-70"
              >
                <Trash2 className="size-3.5" /> Remove
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Heading"
                value={s.title ?? ""}
                onChange={(v) => setSections((prev) => prev.map((r, j) => (j === i ? { ...r, title: v } : r)))}
                placeholder="Best Sellers"
              />
              <label className="block">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Category</span>
                <select
                  value={s.categoryId ?? ""}
                  onChange={(e) =>
                    setSections((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, categoryId: e.target.value || undefined } : r))
                    )
                  }
                  className="mt-1 h-10 w-full rounded-md border border-line bg-white px-2 text-sm font-semibold outline-none focus:ring-4 focus:ring-accent/20"
                >
                  <option value="">— choose a category —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="Link label (optional)"
                value={s.ctaLabel ?? ""}
                onChange={(v) =>
                  setSections((prev) => prev.map((r, j) => (j === i ? { ...r, ctaLabel: v } : r)))
                }
                placeholder="See all best sellers"
              />
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSections((prev) => (prev.length >= 6 ? prev : [...prev, {}]))}
            disabled={sections.length >= 6}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-xs font-extrabold uppercase tracking-wide text-ink transition hover:bg-soft disabled:opacity-50"
          >
            <Plus className="size-3.5" /> Add section
          </button>
          <Button onClick={() => void saveSections()} disabled={savingSections}>
            {savingSections ? <Loader2 className="size-4 animate-spin" /> : "Save home sections"}
          </Button>
        </div>
      </Card>

      <Card title="Category images">
        <p className="text-xs text-muted">
          One image per category — used on the home category grid and as the banner on that
          category&apos;s page. Saved as soon as you upload.
        </p>
        {categories.length === 0 ? (
          <p className="text-xs text-muted">No categories yet.</p>
        ) : (
          <div className="space-y-4">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <span className="text-sm font-bold">{c.name}</span>
                <ImageSlot
                  label=""
                  url={catImages[c.id] ?? ""}
                  slot={`category-${c.id}`}
                  enabled={imageUploadsEnabled}
                  onChange={(url) => setCategoryImage(c.id, url)}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
