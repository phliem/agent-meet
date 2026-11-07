import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newDinner } from '../src/lib/domain';
import { venueChecklist } from '../src/lib/venue-checklist';

test('only the organiser receives structured requirements from included attendees, never private notes or identities', () => {
  const d = newDinner({ title: 'Synthetic venue check', hostName: 'Host', names: ['Included', 'Excluded', 'Declined'], mode: 'fixed', fixedStart: '2030-11-20T19:00:00Z', deadline: '2030-11-19T12:00:00Z', duration: 120 }, 'synthetic-hash', new Date('2030-11-01T12:00:00Z'));
  for (const guest of d.guests) guest.reply = { attending: true, availability: [], diets: [], otherDiet: 'Private allergy note', cuisines: {}, location: { label: 'Private postcode', lat: 51.5, lon: -0.1, source: 'fixture' } };
  d.guests[0].reply!.diets = ['Vegan'];
  d.guests[0].reply!.cuisines = { Mexican: 'no', Japanese: 'prefer' };
  d.guests[1].reply!.diets = ['Halal'];
  d.guests[1].reply!.cuisines = { Chinese: 'no' };
  d.guests[2].reply!.attending = false;
  d.guests[2].reply!.diets = ['Nut-free'];
  d.includedIds = [d.guests[0].id, d.guests[2].id];
  assert.equal(venueChecklist(d, true), undefined, 'not exposed while collecting');
  d.stage = 'choosing-restaurant';
  assert.equal(venueChecklist(d, false), undefined, 'not exposed to guests or anonymous viewers');
  const checklist = venueChecklist(d, true)!;
  assert.deepEqual(checklist, { diets: ['Vegan'], rejectedCuisines: ['Mexican'] });
  const encoded = JSON.stringify(checklist);
  for (const value of ['Private', 'Japanese', ...d.guests.map(guest => guest.id), ...d.guests.map(guest => guest.name)]) assert.ok(!encoded.includes(value));
});
