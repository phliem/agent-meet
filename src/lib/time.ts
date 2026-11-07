import type { Dinner, Guest } from './model';

export function londonDate(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
export const endTime = (start: string, minutes: number) => new Date(Date.parse(start) + minutes * 60000).toISOString();
export function sharedSlots(dinner: Dinner, now = Date.now()): string[] {
  if (dinner.mode === 'fixed') return dinner.fixedStart ? [dinner.fixedStart] : [];
  const guests = attending(dinner);
  if (!guests.length || guests.some(g => !g.reply)) return [];
  const first = guests[0].reply!.availability;
  const candidates = new Set<string>();
  for (const window of first) {
    const start = Math.ceil(Date.parse(window.start) / 1800000) * 1800000;
    const last = Date.parse(window.end) - dinner.duration * 60000;
    for (let time = start; time <= last; time += 1800000) {
      const iso = new Date(time).toISOString();
      if (time <= now || londonDate(iso) < dinner.dateStart || londonDate(iso) > dinner.dateEnd) continue;
      if (guests.every(g => g.reply!.availability.some(w => Date.parse(w.start) <= time && Date.parse(w.end) >= time + dinner.duration * 60000))) candidates.add(iso);
    }
  }
  return [...candidates].sort();
}
export function attending(dinner: Dinner): Guest[] {
  return dinner.guests.filter(g => (!dinner.includedIds || dinner.includedIds.includes(g.id)) && g.reply?.attending);
}
export function activeGuests(dinner: Dinner): Guest[] {
  return dinner.guests.filter(g => !dinner.includedIds || dinner.includedIds.includes(g.id));
}
