import { fromCents, toCents } from "@renderer/shared/lib/money";
import { buyingFromSelling, sellingFromBuying } from "@shared/lib/mark-point";

/**
 * Strict Mark Point in a form with a buying and a selling price, both typed in the same unit. Typing one
 * fills the other when that other is empty or was filled this way ("following"); once someone types
 * over a filled price it's theirs and is left alone, so both stay editable.
 */
export type PriceFollowing = "buying" | "selling" | null;

/** Which price already follows the other (an existing product priced by the mark point). */
export function initialPriceFollowing(buying: string, selling: string, markPoint: number | null): PriceFollowing {
  if (markPoint === null) return null;
  const buyingCents = toCents(buying);
  const sellingCents = toCents(selling);
  if (buyingCents <= 0 || sellingCents <= 0) return null;
  if (sellingFromBuying(buyingCents, markPoint) === sellingCents) return "selling";
  if (buyingFromSelling(sellingCents, markPoint) === buyingCents) return "buying";
  return null;
}

export function markPointPriceChange(
  state: { buying: string; selling: string; following: PriceFollowing },
  edited: "buying" | "selling",
  value: string,
  markPoint: number | null
): { buying: string; selling: string; following: PriceFollowing } {
  const typed = { ...state, [edited]: value };
  if (markPoint === null) return typed;
  const other = edited === "buying" ? "selling" : "buying";
  const following = state.following === edited ? null : state.following;
  const cents = toCents(value);
  if (cents <= 0 || (following !== other && toCents(state[other]) > 0)) return { ...typed, following };
  const otherCents = edited === "buying" ? sellingFromBuying(cents, markPoint) : buyingFromSelling(cents, markPoint);
  return { ...typed, [other]: fromCents(otherCents), following: other };
}
