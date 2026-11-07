import type { Dinner } from './model';
import { attending } from './time';
import { voteResult } from './domain';

/** Closed-ballot aggregates only; never serialize another guest's ballot. */
export function voteSummary(dinner: Dinner) {
  if (!dinner.votesClosed) return undefined;
  const people = attending(dinner);
  const winners = voteResult(dinner);
  return {
    received: people.filter(guest => guest.ballot).length,
    total: people.length,
    areas: dinner.areas.map(area => ({
      id: area.id,
      favourites: people.filter(guest => guest.ballot?.favourite === area.id).length,
      acceptable: people.filter(guest => guest.ballot?.favourite === area.id || guest.ballot?.acceptable.includes(area.id)).length,
    })),
    eligibleAreaIds: winners.length ? winners : dinner.areas.map(area => area.id),
  };
}
