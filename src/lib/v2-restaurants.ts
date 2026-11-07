import type { Dinner, Guest, PriceBand, Restaurant } from './model';

export const PRICE_BANDS: readonly PriceBand[] = ['low', 'medium', 'high'];
export function includedAttendees(dinner: Dinner): Guest[] {
  return dinner.guests.filter(guest => guest.reply?.attending && (dinner.includedIds === null || dinner.includedIds.includes(guest.id)));
}

/** An omitted answer means medium; an explicitly empty answer accepts no band. */
export function compatibleBudgetBands(dinner: Dinner): PriceBand[] {
  const guests = includedAttendees(dinner);
  if (dinner.experience !== 'v2' || !guests.length) return [];
  return PRICE_BANDS.filter(band => guests.every(guest => (guest.reply!.budgets ?? ['medium']).includes(band)));
}

/** An explicitly chosen band may override an empty intersection, never a nonempty one. */
export function effectiveBudgetBand(dinner: Dinner): PriceBand | undefined {
  if (dinner.experience !== 'v2') return undefined;
  const common = compatibleBudgetBands(dinner);
  if (dinner.budgetBand && (!common.length || common.includes(dinner.budgetBand))) return dinner.budgetBand;
  return common.length === 1 ? common[0] : undefined;
}

export function matchesBudget(restaurant: Restaurant, dinner: Dinner): boolean {
  if (dinner.experience !== 'v2') return restaurant.price !== 'high';
  const band = effectiveBudgetBand(dinner);
  return band !== undefined && restaurant.price === band;
}

export type RecommendationResult = { recommendation?: { restaurantId: string; reason: string }; fallbackReason?: string };
const fallbackReason = 'There is not enough current evidence to recommend one venue. Choose from the shortlist or enter a restaurant, and check its price, opening times and food requirements with the venue.';

/** Operates on ranked suggestions only; choosing a suggestion never confirms the dinner. */
export function restaurantRecommendation(dinner: Dinner, now = new Date()): RecommendationResult {
  if (dinner.experience !== 'v2') return {};
  const guests = includedAttendees(dinner), band = effectiveBudgetBand(dinner);
  const start = Date.parse(dinner.selectedStart || dinner.fixedStart || '');
  const end = start + dinner.duration * 60_000;
  if (!guests.length || !band || !Number.isFinite(start) || !Number.isFinite(end) || dinner.duration <= 0 || !Number.isFinite(now.getTime())) return { fallbackReason };
  const requirements = [...new Set(guests.flatMap(guest => guest.reply!.diets))];
  // Free-text food requirements cannot safely be inferred from structured menu tags.
  if (guests.some(guest => guest.reply!.otherDiet.trim())) return { fallbackReason };
  const restaurant = dinner.restaurants.find(venue => {
    if (!matchesBudget(venue, dinner) || venue.manual || guests.some(guest => venue.cuisines.some(cuisine => guest.reply!.cuisines[cuisine] === 'no'))) return false;
    const evidence = venue.evidence;
    if (!evidence || evidence.priceBand !== band) return false;
    if (evidence.source !== (dinner.dataMode === 'fixture' ? 'fixture' : 'venue')) return false;
    if (evidence.source === 'venue' && !/^https:\/\//.test(evidence.sourceUrl)) return false;
    const checked = Date.parse(evidence.checkedAt), opens = Date.parse(evidence.opening.start), closes = Date.parse(evidence.opening.end);
    if (!Number.isFinite(checked) || checked > now.getTime() || now.getTime() - checked > 7 * 86_400_000) return false;
    return opens <= start && closes >= end && requirements.every(diet => evidence.diets.includes(diet));
  });
  if (!restaurant) return { fallbackReason };
  return { recommendation: { restaurantId: restaurant.id, reason: `${dinner.dataMode === 'fixture' ? 'Synthetic example evidence' : 'Current venue evidence'} supports the ${band} budget, opening throughout the selected dinner and ${requirements.length ? 'the recorded dietary requirements' : 'no recorded dietary requirements'}. Ranked by the group’s cuisine preferences; the organiser must still choose and confirm.` } };
}
