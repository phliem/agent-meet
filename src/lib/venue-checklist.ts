import { CUISINES, DIETS, type Dinner } from './model';
import { attending } from './time';

/** Organiser-only structured group requirements. Free text and identities stay private. */
export function venueChecklist(dinner: Dinner, organiser: boolean) {
  if (!organiser || dinner.stage !== 'choosing-restaurant') return undefined;
  const people = attending(dinner);
  return {
    diets: DIETS.filter(diet => people.some(guest => guest.reply!.diets.includes(diet))),
    rejectedCuisines: CUISINES.filter(cuisine => people.some(guest => guest.reply!.cuisines[cuisine] === 'no')),
  };
}
