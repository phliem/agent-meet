import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, applyReply, installAreas, newDinner, parseReply, voteResult } from '../src/lib/domain';
import { sharedSlots } from '../src/lib/time';
import { calendarFile, googleCalendarUrl } from '../src/lib/calendar';
import type { Area, Dinner } from '../src/lib/model';

const now = Date.parse('2026-11-07T12:00:00Z');
const host = { organiser: true };
function dinner(fixed = false): Dinner {
  return newDinner({ title: 'Friday dinner', hostName: 'Sam', names: ['Alex', 'Kim'], mode: fixed ? 'fixed' : 'flexible', dateStart: '2026-11-20', dateEnd: '2026-11-22', fixedStart: fixed ? '2026-11-20T19:30:00Z' : undefined, duration: 120, deadline: '2026-11-19T20:00:00Z' }, 'host-hash', new Date(now));
}
function reply(d: Dinner, id: string, start = '2026-11-20T19:00:00Z', end = '2026-11-20T23:00:00Z') {
  const r = parseReply({ attending: true, origin: 'Waterloo', availability: [{ start, end }], cuisines: { Japanese: 'prefer', Mexican: 'no' }, diets: [] }, d, now);
  applyReply(d, { organiser: false, guestId: id }, r, { label: 'Waterloo', lat: 51.5, lon: -0.1, source: 'fixture' }, now);
}
const areas: Area[] = ['a', 'b', 'c'].map((id, index) => ({ id, name: id, lat: 51.5, lon: -0.1, journeys: [], longest: 20 + index, explanation: 'Fixture' }));
function voting() {
  const d = dinner(); d.guests.forEach(g => reply(d, g.id));
  applyCommand(d, host, { type: 'slot', start: sharedSlots(d, now)[0] }, now);
  installAreas(d, areas); return d;
}
test('creation rejects duplicate names and invalid dates', () => {
  assert.throws(() => newDinner({ title: 'X', hostName: 'Y', names: ['A', 'a'], mode: 'fixed', fixedStart: '2026-11-20T19:00:00Z', duration: 120, deadline: '2026-11-19T20:00:00Z' }, 'h', new Date(now)), /different display name/);
});
test('shared slots fit the whole adjustable duration for every attendee', () => {
  const d = dinner(); reply(d, d.guests[0].id); reply(d, d.guests[1].id, '2026-11-20T20:00:00Z', '2026-11-20T22:30:00Z');
  assert.deepEqual(sharedSlots(d, now), ['2026-11-20T20:00:00.000Z', '2026-11-20T20:30:00.000Z']);
});
test('organiser duration changes recover a shorter overlap and invalidate a chosen slot', () => {
  const d = dinner();
  d.guests.forEach(g => reply(d, g.id, '2026-11-20T19:00:00Z', '2026-11-20T20:30:00Z'));
  assert.deepEqual(sharedSlots(d, now), []);
  const replies = structuredClone(d.guests);
  applyCommand(d, host, { type: 'duration', duration: 90 }, now);
  assert.equal(d.stage, 'choosing-time');
  assert.deepEqual(sharedSlots(d, now), ['2026-11-20T19:00:00.000Z']);
  assert.deepEqual(d.guests, replies);
  applyCommand(d, host, { type: 'slot', start: sharedSlots(d, now)[0] }, now);
  const includedIds = [...d.includedIds!];
  applyCommand(d, host, { type: 'duration', duration: 120 }, now);
  assert.equal(d.selectedStart, undefined);
  assert.equal(d.stage, 'choosing-time');
  assert.deepEqual(d.includedIds, includedIds);
  assert.deepEqual(sharedSlots(d, now), []);
  assert.match(d.notice!, /Shorten.*widen/);
});
test('fixed dinner duration replans ready attendees and preserves budgets and included group', () => {
  const d = dinner(true);
  d.guests.forEach(g => reply(d, g.id));
  d.guests.push({ id: 'excluded', name: 'Excluded' });
  const includedIds = [...d.includedIds!];
  d.budgetBand = 'medium';
  d.areas = areas;
  d.selectedAreaId = 'stale';
  d.restaurants = [{ id: 'stale', name: 'Stale', address: 'Example', mapUrl: '', sourceUrl: '', cuisines: [], price: 'medium', dietaryEvidence: [], hours: 'Unknown' }];
  d.restaurant = d.restaurants[0];
  d.recommendation = { restaurantId: 'stale', reason: 'Old interval' };
  applyCommand(d, host, { type: 'duration', duration: 150 }, now);
  assert.equal(d.stage, 'recommending');
  assert.equal(d.selectedStart, d.fixedStart);
  assert.deepEqual(d.includedIds, includedIds);
  assert.equal(d.budgetBand, 'medium');
  assert.deepEqual(d.areas, []); assert.deepEqual(d.restaurants, []);
  assert.equal(d.restaurant, undefined); assert.equal(d.selectedAreaId, undefined); assert.equal(d.recommendation, undefined);
  assert.match(d.notice!, /return time/);
});
test('duration changes keep incomplete collection and reject unauthorised, invalid and locked updates', () => {
  const d = dinner();
  reply(d, d.guests[0].id);
  applyCommand(d, host, { type: 'duration', duration: 30 }, now);
  assert.equal(d.stage, 'collecting');
  assert.ok(d.guests[0].reply); assert.equal(d.guests[1].reply, undefined);
  assert.throws(() => applyCommand(d, { organiser: false }, { type: 'duration', duration: 90 }, now), /organiser/);
  for (const duration of [0, -30, 45, 90.5, 750, 'invalid']) {
    assert.throws(() => applyCommand(d, host, { type: 'duration', duration }, now), /half-hour/);
    assert.equal(d.duration, 30);
  }
  for (const stage of ['area-voting', 'choosing-restaurant', 'confirmed'] as const) {
    d.stage = stage;
    assert.throws(() => applyCommand(d, host, { type: 'duration', duration: 90 }, now), /locked/);
  }
});
test('fixed date skips the overlap and slot choice', () => {
  const d = dinner(true); d.guests.forEach(g => reply(d, g.id));
  assert.equal(d.stage, 'recommending'); assert.equal(d.selectedStart, d.fixedStart); assert.equal(d.includedIds?.length, 2);
});
test('declining is a completed reply with no private input and excludes a guest', () => {
  const d = dinner(); reply(d, d.guests[0].id);
  applyReply(d, { organiser: false, guestId: d.guests[1].id }, parseReply({ attending: false }, d, now), undefined, now);
  assert.equal(d.stage, 'choosing-time'); assert.equal(d.guests[1].reply?.location, undefined);
  assert.equal(sharedSlots(d, now).length, 5);
});
test('all declines do not advance', () => {
  const d = dinner(); for (const g of d.guests) applyReply(d, { organiser: false, guestId: g.id }, parseReply({ attending: false }, d, now), undefined, now);
  assert.equal(d.stage, 'collecting'); assert.match(d.notice!, /Nobody can attend/);
});
test('reply validation uses the supplied clock and rejects the deadline boundary', () => {
  const d = dinner();
  const decline = parseReply({ attending: false }, d, now);
  applyReply(d, { organiser: false, guestId: d.guests[0].id }, decline, undefined, Date.parse(d.deadline) - 1);
  assert.throws(() => applyReply(d, { organiser: false, guestId: d.guests[1].id }, decline, undefined, Date.parse(d.deadline)), /deadline passed/);
  assert.equal(d.guests[1].reply, undefined);
});
test('no overlap can be reopened after deadline while replies stay intact', () => {
  const d = dinner(); reply(d, d.guests[0].id); reply(d, d.guests[1].id, '2026-11-21T19:00:00Z', '2026-11-21T21:00:00Z');
  assert.deepEqual(sharedSlots(d, now), []);
  applyCommand(d, host, { type: 'reopen', dateStart: '2026-11-22', dateEnd: '2026-11-24', deadline: '2026-11-21T20:00:00Z' }, Date.parse('2026-11-20T12:00:00Z'));
  assert.equal(d.stage, 'collecting'); assert.ok(d.guests[0].reply);
});
test('automatic winner requires unanimous acceptability, not majority preference', () => {
  const d = voting();
  applyCommand(d, { organiser: false, guestId: d.guests[0].id }, { type: 'vote', ballot: { favourite: 'a', acceptable: ['b'], none: false } }, now);
  applyCommand(d, { organiser: false, guestId: d.guests[1].id }, { type: 'vote', ballot: { favourite: 'b', acceptable: [], none: false } }, now);
  assert.equal(d.selectedAreaId, 'b'); assert.equal(d.stage, 'choosing-restaurant');
});
test('no acceptable area is a valid ballot that prevents unanimous winner', () => {
  const d = voting();
  applyCommand(d, { organiser: false, guestId: d.guests[0].id }, { type: 'vote', ballot: { favourite: null, acceptable: [], none: true } }, now);
  applyCommand(d, { organiser: false, guestId: d.guests[1].id }, { type: 'vote', ballot: { favourite: 'a', acceptable: [], none: false } }, now);
  assert.equal(d.votesClosed, true); assert.deepEqual(voteResult(d), []); assert.equal(d.selectedAreaId, undefined);
});
test('early close with zero votes leaves an explicit organiser choice', () => {
  const d = voting(); applyCommand(d, host, { type: 'close-vote' }, now);
  assert.equal(d.selectedAreaId, undefined); assert.equal(d.includedIds!.length, 2);
  applyCommand(d, host, { type: 'area', areaId: 'c' }, now); assert.equal(d.selectedAreaId, 'c');
});
test('guest cannot reset, close voting, or select a venue', () => {
  const d = voting(); for (const command of [{ type: 'reset', guestId: d.guests[0].id }, { type: 'close-vote' }, { type: 'manual-restaurant', name: 'X', address: 'Y' }]) assert.throws(() => applyCommand(d, { organiser: false }, command, now), /organiser/);
});
test('post-vote planning and reset locks are server enforced', () => {
  const d = voting(); assert.throws(() => applyReply(d, { organiser: false, guestId: d.guests[0].id }, parseReply({ attending: false }, d, now), undefined, now), /locked/);
  assert.throws(() => applyCommand(d, host, { type: 'reset', guestId: d.guests[0].id }, now), /locked/);
});
test('reset clears only target reply and claim and invalidates stale results', () => {
  const d = dinner(); d.guests.forEach(g => { g.claimHash = 'claimed'; reply(d, g.id); });
  applyCommand(d, host, { type: 'reset', guestId: d.guests[0].id }, now);
  assert.equal(d.guests[0].claimHash, undefined); assert.equal(d.guests[0].reply, undefined); assert.ok(d.guests[1].reply); assert.equal(d.stage, 'collecting');
});
test('reset lets an excluded guest reply again without admitting other excluded guests', () => {
  const d = dinner();
  d.guests.push({ id: 'still-excluded', name: 'Pat' });
  reply(d, d.guests[0].id);
  applyCommand(d, host, { type: 'continue' }, Date.parse(d.deadline));
  assert.deepEqual(d.includedIds, [d.guests[0].id]);
  applyCommand(d, host, { type: 'extend', deadline: '2026-11-19T22:00:00Z' }, Date.parse(d.deadline));
  applyCommand(d, host, { type: 'reset', guestId: d.guests[1].id }, now);
  reply(d, d.guests[1].id);
  assert.equal(d.stage, 'choosing-time');
  assert.deepEqual(d.includedIds, [d.guests[0].id, d.guests[1].id]);
  assert.throws(() => reply(d, 'still-excluded'), /continued without/);
});
test('manual venue needs organiser review and calendar export has no private data', () => {
  const d = voting(); applyCommand(d, host, { type: 'close-vote' }, now); applyCommand(d, host, { type: 'area', areaId: 'a' }, now);
  applyCommand(d, host, { type: 'manual-restaurant', name: 'Example; Café', address: '1 Example Street, London', mapUrl: 'https://example.com/map' }, now);
  assert.throws(() => applyCommand(d, host, { type: 'confirm' }, now), /checked/);
  applyCommand(d, host, { type: 'confirm', verified: true }, now);
  const file = calendarFile(d); assert.match(file, /BEGIN:VEVENT/); assert.match(file, /Café/); assert.ok(!file.includes('host-hash')); assert.ok(!file.includes('Waterloo')); assert.ok(!file.includes(d.guests[0].name));
  assert.match(googleCalendarUrl(d), /calendar\.google\.com/); assert.match(file, /DTEND:20261120T210000Z/);
});
test('calendar keeps correct UTC instant for summer and folds UTF8 lines', () => {
  const d = dinner(true); d.stage = 'confirmed'; d.selectedStart = '2027-07-01T18:30:00Z'; d.confirmedAt = '2026-11-07T12:00:00Z'; d.restaurant = { id: 'r', name: 'Café '.repeat(25), address: 'London', sourceUrl: '', mapUrl: '', cuisines: [], price: 'unknown', dietaryEvidence: [], hours: 'Unknown' };
  const file = calendarFile(d); assert.match(file, /DTSTART:20270701T183000Z/); assert.ok(file.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
});
