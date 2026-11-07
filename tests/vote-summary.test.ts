import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newDinner, applyCommand } from '../src/lib/domain';
import { voteSummary } from '../src/lib/vote-summary';

const now = new Date('2030-11-01T12:00:00Z');
function dinner() {
  const d = newDinner({ title: 'Synthetic ballot', hostName: 'Host', names: ['One', 'Two', 'Excluded', 'Declined'], mode: 'fixed', fixedStart: '2030-11-20T19:00:00Z', deadline: '2030-11-19T12:00:00Z', duration: 120 }, 'synthetic-hash', now);
  for (const guest of d.guests) guest.reply = { attending: true, availability: [], diets: ['Vegan'], otherDiet: 'Sensitive food note', cuisines: {}, location: { label: 'Sensitive origin', lat: 51.5, lon: -0.1, source: 'fixture' } };
  d.guests[3].reply!.attending = false;
  d.includedIds = [d.guests[0].id, d.guests[1].id, d.guests[3].id];
  d.areas = ['a', 'b', 'c'].map(id => ({ id, name: id, lat: 51.5, lon: -0.1, longest: 20, explanation: '', journeys: [] }));
  d.stage = 'area-voting';
  return d;
}

test('closed vote aggregates exclude missing ballots and non-attendees without revealing individual replies', () => {
  const d = dinner();
  d.guests[0].ballot = { favourite: 'a', acceptable: ['a', 'a', 'b'], none: false };
  d.guests[2].ballot = { favourite: 'c', acceptable: ['c'], none: false };
  d.guests[3].ballot = { favourite: 'c', acceptable: ['c'], none: false };
  assert.equal(voteSummary(d), undefined, 'do not reveal running totals');
  d.votesClosed = true;
  const summary = voteSummary(d)!;
  assert.equal(summary.received, 1);
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.areas, [{ id: 'a', favourites: 1, acceptable: 1 }, { id: 'b', favourites: 0, acceptable: 1 }, { id: 'c', favourites: 0, acceptable: 0 }]);
  assert.deepEqual(summary.eligibleAreaIds, ['a', 'b', 'c']);
  const encoded = JSON.stringify(summary);
  for (const value of ['Sensitive', 'Vegan', ...d.guests.map(guest => guest.id)]) assert.ok(!encoded.includes(value));
});

test('tie choices in the read model match the server-enforced unanimous winners', () => {
  const d = dinner();
  d.votesClosed = true;
  d.guests[0].ballot = { favourite: 'a', acceptable: ['a', 'b', 'c'], none: false };
  d.guests[1].ballot = { favourite: 'b', acceptable: ['a', 'b', 'c'], none: false };
  assert.deepEqual(voteSummary(d)!.eligibleAreaIds, ['a', 'b']);
  assert.throws(() => applyCommand(d, { organiser: true }, { type: 'area', areaId: 'c' }, now.getTime()), /tied/);
  applyCommand(d, { organiser: true }, { type: 'area', areaId: 'a' }, now.getTime());
  assert.equal(d.selectedAreaId, 'a');
});

test('no unanimous acceptable area keeps every area available for explicit organiser resolution', () => {
  const d = dinner();
  d.votesClosed = true;
  for (const guest of d.guests) guest.ballot = { favourite: null, acceptable: [], none: true };
  const summary = voteSummary(d)!;
  assert.deepEqual(summary.eligibleAreaIds, ['a', 'b', 'c']);
  assert.equal(summary.received, 2);
  assert.ok(summary.areas.every(area => area.acceptable === 0 && area.favourites === 0));
});
