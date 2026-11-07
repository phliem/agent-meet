import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Area, Ballot, Dinner, Restaurant } from './model';
import { CUISINES, DIETS } from './model';
import { activeGuests, attending, endTime, londonDate, sharedSlots } from './time';

export class UserError extends Error {}
export function insist(condition: unknown, message: string): asserts condition {
  if (!condition) throw new UserError(message);
}
const iso = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s);
const text = (max: number) => z.string().trim().min(1).max(max);
const createSchema = z.object({ title: text(100), hostName: text(80), names: z.array(text(80)).min(1).max(24), mode: z.enum(['fixed', 'flexible']), dateStart: day.optional(), dateEnd: day.optional(), fixedStart: iso.optional(), duration: z.coerce.number().int().min(30).max(720).refine(n => n % 30 === 0), deadline: iso });
export function newDinner(input: unknown, hostHash: string, now = new Date()): Dinner {
  const parsed = createSchema.safeParse(input);
  insist(parsed.success, 'Check the dinner title, guest names, date, deadline and duration.');
  const p = parsed.data;
  insist(new Set(p.names.map(n => n.toLocaleLowerCase())).size === p.names.length, 'Use a different display name for each guest.');
  let dateStart = p.dateStart, dateEnd = p.dateEnd;
  if (p.mode === 'fixed') {
    insist(p.fixedStart, 'Choose the agreed date and start time.');
    dateStart = dateEnd = londonDate(p.fixedStart);
    insist(Date.parse(p.fixedStart) > now.getTime(), 'The dinner must be in the future.');
    insist(Date.parse(p.deadline) < Date.parse(p.fixedStart), 'The reply deadline must be before dinner.');
  } else {
    insist(dateStart && dateEnd && dateStart <= dateEnd, 'Choose a valid date window.');
    insist(Date.parse(dateEnd) - Date.parse(dateStart) <= 180 * 86400000, 'Use a date window of at most six months.');
    insist(londonDate(p.deadline) < dateStart, 'Set the reply deadline before the first possible dinner date.');
  }
  insist(Date.parse(p.deadline) > now.getTime(), 'Set a future reply deadline.');
  return { id: randomUUID(), title: p.title, hostName: p.hostName, hostHash, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 90 * 86400000).toISOString(), mode: p.mode, dateStart: dateStart!, dateEnd: dateEnd!, deadline: p.deadline, duration: p.duration, fixedStart: p.fixedStart, stage: 'collecting', guests: p.names.map(name => ({ id: randomUUID(), name })), includedIds: null, areas: [], restaurants: [], votesClosed: false, version: 0, dataMode: process.env.DATA_MODE === 'live' ? 'live' : 'fixture' };
}
export type Actor = { organiser: boolean; guestId?: string };
export const preVote = (d: Dinner) => ['collecting', 'choosing-time', 'recommending'].includes(d.stage);
export function requireHost(actor: Actor) { insist(actor.organiser, 'Only this dinner’s organiser can do that.'); }
export function progress(d: Dinner) {
  if (d.stage !== 'collecting' || !activeGuests(d).every(g => g.reply)) return;
  const guests = attending(d);
  if (!guests.length) { d.notice = 'Nobody can attend these dates. The organiser can reopen the date window.'; return; }
  d.notice = undefined;
  if (d.mode === 'fixed') {
    d.includedIds = guests.map(g => g.id);
    d.selectedStart = d.fixedStart;
    d.stage = 'recommending';
  } else d.stage = 'choosing-time';
}
const replySchema = z.object({ attending: z.boolean(), origin: z.string().trim().max(120).optional(), availability: z.array(z.object({ start: iso, end: iso })).max(80).default([]), diets: z.array(z.enum(DIETS)).max(DIETS.length).default([]), otherDiet: z.string().trim().max(500).default(''), cuisines: z.partialRecord(z.enum(CUISINES), z.enum(['prefer', 'okay', 'no'])).default({}) });
export function parseReply(input: unknown, d: Dinner, now = Date.now()) {
  const p = replySchema.safeParse(input);
  insist(p.success, 'Check the reply fields.');
  if (!p.data.attending) return { ...p.data, origin: undefined, availability: [], diets: [], otherDiet: '', cuisines: {} };
  insist(p.data.origin && p.data.origin.length >= 2, 'Enter a London station or postcode.');
  if (d.mode === 'flexible') {
    insist(p.data.availability.length, 'Add at least one time you can attend.');
    for (const w of p.data.availability) {
      const start = Date.parse(w.start), end = Date.parse(w.end);
      insist(start > now && end > start && end - start <= 24 * 60 * 60000, 'Each availability window must be future, positive and at most 24 hours.');
      insist(start % 1800000 === 0 && end % 1800000 === 0, 'Choose half-hour availability times.');
      insist(londonDate(w.start) >= d.dateStart && londonDate(w.start) <= d.dateEnd, 'Availability must start inside the dinner date window.');
    }
  }
  return p.data;
}
export function ensureReplyOpen(d: Dinner, now = Date.now()) {
  insist(preVote(d), 'Replies are locked once area voting starts.');
  insist(now < Date.parse(d.deadline), 'The reply deadline passed. Ask the organiser to extend it.');
}
export function applyReply(d: Dinner, actor: Actor, reply: ReturnType<typeof parseReply>, location?: import('./model').Location) {
  ensureReplyOpen(d);
  const guest = d.guests.find(g => g.id === actor.guestId);
  insist(guest, 'Claim your guest name first.');
  insist(!d.includedIds || d.includedIds.includes(guest.id), 'The organiser already continued without this guest.');
  insist(!d.includedIds || guest.reply?.attending === reply.attending || !guest.reply, 'The included group is fixed. Ask the organiser to reset your reply.');
  guest.reply = { attending: reply.attending, availability: d.mode === 'fixed' ? [] : reply.availability, location: reply.attending ? location : undefined, diets: reply.diets, otherDiet: reply.otherDiet, cuisines: reply.cuisines };
  d.selectedStart = undefined;
  d.areas = [];
  d.restaurants = [];
  d.stage = 'collecting';
  progress(d);
}
export function voteResult(d: Dinner) {
  const people = attending(d);
  if (!people.length || people.some(g => !g.ballot)) return [];
  const eligible = d.areas.filter(a => people.every(g => g.ballot!.acceptable.includes(a.id) || g.ballot!.favourite === a.id));
  if (!eligible.length) return [];
  const counts = eligible.map(a => ({ id: a.id, n: people.filter(g => g.ballot!.favourite === a.id).length }));
  const max = Math.max(...counts.map(c => c.n));
  return counts.filter(c => c.n === max).map(c => c.id);
}
export function completeVote(d: Dinner, early: boolean) {
  d.votesClosed = true;
  const winners = early ? [] : voteResult(d);
  if (winners.length === 1) { d.selectedAreaId = winners[0]; d.stage = 'choosing-restaurant'; }
  else d.notice = early ? 'Voting closed early. The organiser must choose an area; missing votes are not acceptance.' : winners.length ? 'The organiser must break the tie.' : 'No area is accepted by everyone. The organiser must resolve the choice.';
}
export function applyCommand(d: Dinner, actor: Actor, input: unknown, now = Date.now()) {
  const p = z.object({ type: text(40) }).passthrough().safeParse(input);
  insist(p.success, 'Unknown action.');
  const c = p.data;
  insist(Date.parse(d.expiresAt) > now, 'This dinner link has expired.');
  if (c.type === 'slot') {
    requireHost(actor); insist(d.stage === 'choosing-time', 'Wait for the guest replies first.');
    insist(typeof c.start === 'string' && sharedSlots(d, now).includes(c.start), 'Choose a current shared time slot.');
    d.selectedStart = c.start; d.includedIds = attending(d).map(g => g.id); d.stage = 'recommending';
  } else if (c.type === 'vote') {
    insist(d.stage === 'area-voting' && !d.votesClosed, 'Area voting is closed.');
    const guest = attending(d).find(g => g.id === actor.guestId); insist(guest, 'Only an included guest can vote.');
    const b = z.object({ favourite: z.string().nullable(), acceptable: z.array(z.string()).max(3), none: z.boolean() }).safeParse(c.ballot);
    insist(b.success, 'Choose a favourite or no acceptable area.');
    const ballot: Ballot = b.data;
    if (ballot.none) insist(!ballot.favourite && !ballot.acceptable.length, 'No acceptable area cannot be combined with another choice.');
    else insist(ballot.favourite && d.areas.some(a => a.id === ballot.favourite), 'Choose a favourite area.');
    insist(ballot.acceptable.every(id => d.areas.some(a => a.id === id)), 'An area in this ballot is not available.');
    guest.ballot = ballot;
    if (attending(d).every(g => g.ballot)) completeVote(d, false);
  } else if (c.type === 'close-vote') {
    requireHost(actor); insist(d.stage === 'area-voting' && !d.votesClosed, 'Voting is already closed.'); completeVote(d, true);
  } else if (c.type === 'area') {
    requireHost(actor); insist(d.stage === 'area-voting' && d.votesClosed, 'Close voting before choosing an area.');
    insist(typeof c.areaId === 'string' && d.areas.some(a => a.id === c.areaId), 'Choose a suggested area.');
    const people = attending(d), winners = voteResult(d);
    if (people.every(g => g.ballot) && winners.length) insist(winners.includes(c.areaId), 'Choose one of the tied, unanimously accepted areas.');
    d.selectedAreaId = c.areaId; d.stage = 'choosing-restaurant'; d.notice = undefined;
  } else if (c.type === 'restaurant') {
    requireHost(actor); insist(d.stage === 'choosing-restaurant', 'Choose an area first.');
    const restaurant = d.restaurants.find(r => r.id === c.restaurantId); insist(restaurant, 'Choose a current suggestion.'); d.restaurant = restaurant;
  } else if (c.type === 'manual-restaurant') {
    requireHost(actor); insist(d.stage === 'choosing-restaurant', 'Choose an area first.');
    const r = z.object({ name: text(150), address: text(250), mapUrl: z.string().trim().max(1000).default('') }).safeParse(c);
    insist(r.success, 'Enter the restaurant name and street address.');
    if (r.data.mapUrl) { try { insist(new URL(r.data.mapUrl).protocol === 'https:', 'Use an HTTPS map link.'); } catch { throw new UserError('Use a valid HTTPS map link.'); } }
    const area = d.areas.find(a => a.id === d.selectedAreaId)!;
    d.restaurant = { id: randomUUID(), name: r.data.name, address: r.data.address, mapUrl: r.data.mapUrl, sourceUrl: '', cuisines: [], price: 'unknown', dietaryEvidence: [], hours: 'Unknown — verify with the venue', station: 'Area station: ' + area.name, manual: true };
  } else if (c.type === 'no-restaurant') {
    requireHost(actor); insist(d.stage === 'choosing-restaurant', 'Choose an area first.'); d.restaurant = undefined; d.notice = 'No suitable restaurant selected. Try another suggestion or enter a venue yourself.';
  } else if (c.type === 'confirm') {
    requireHost(actor); if (d.stage === 'confirmed') return;
    insist(d.stage === 'choosing-restaurant' && d.restaurant?.address && d.selectedStart, 'Choose a restaurant with a street address first.');
    insist(c.verified === true, 'Confirm you have checked the venue details yourself.');
    d.stage = 'confirmed'; d.confirmedAt = new Date(now).toISOString(); d.expiresAt = new Date(Date.parse(endTime(d.selectedStart, d.duration)) + 30 * 86400000).toISOString(); d.notice = undefined;
  } else if (c.type === 'continue') {
    requireHost(actor); insist(d.stage === 'collecting' && now >= Date.parse(d.deadline), 'Continue with respondents after the deadline.');
    const respondents = attending(d); insist(respondents.length, 'At least one guest must be attending.');
    d.includedIds = respondents.map(g => g.id); progress(d);
  } else if (c.type === 'extend' || c.type === 'reopen') {
    requireHost(actor); insist(preVote(d), 'The dinner is locked once voting starts.');
    const deadline = iso.safeParse(c.deadline); insist(deadline.success && Date.parse(deadline.data) > now, 'Choose a future reply deadline.');
    if (c.type === 'reopen') {
      insist(d.mode === 'flexible', 'The agreed date cannot be widened.');
      const start = day.safeParse(c.dateStart), end = day.safeParse(c.dateEnd);
      insist(start.success && end.success && start.data <= end.data && Date.parse(end.data) - Date.parse(start.data) <= 180 * 86400000, 'Choose a valid date window of at most six months.');
      d.dateStart = start.data; d.dateEnd = end.data;
    }
    insist(d.mode === 'fixed' ? Date.parse(deadline.data) < Date.parse(d.fixedStart!) : londonDate(deadline.data) < d.dateStart, 'The deadline must be before the dinner date window.');
    d.deadline = deadline.data; d.stage = 'collecting'; d.selectedStart = undefined; d.areas = []; d.restaurants = []; d.notice = 'Replies reopened. Existing replies are kept and can be updated.';
    // Deliberately stay in collection so guests can revise replies after reopening.
  } else if (c.type === 'reset') {
    requireHost(actor); insist(preVote(d), 'Resets are locked once voting starts.');
    const guest = d.guests.find(g => g.id === c.guestId); insist(guest, 'Guest not found.');
    guest.reply = undefined; guest.ballot = undefined; guest.claimHash = undefined;
    d.stage = 'collecting'; d.selectedStart = undefined; d.areas = []; d.restaurants = []; d.notice = 'Guest reply reset. They can claim their name again from the shared link.';
  } else throw new UserError('Unknown dinner action.');
}
export function installAreas(d: Dinner, areas: Area[]) {
  insist(d.stage === 'recommending', 'This dinner is not ready for area suggestions.');
  insist(areas.length, 'No supported meeting areas were found. Try another slot before voting.');
  d.areas = areas; d.stage = 'area-voting'; d.votesClosed = false; d.guests.forEach(g => { g.ballot = undefined; }); d.notice = undefined;
}
export function installRestaurants(d: Dinner, venues: Restaurant[]) {
  insist(d.stage === 'choosing-restaurant', 'Choose an area first.'); d.restaurants = venues;
}
