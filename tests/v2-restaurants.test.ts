import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dinner, Guest, PriceBand, Restaurant } from '../src/lib/model';
import { createProviders, rankRestaurants } from '../src/lib/providers';
import { compatibleBudgetBands, effectiveBudgetBand, restaurantRecommendation } from '../src/lib/v2-restaurants';

const now = new Date('2026-11-07T12:00:00Z');
const start = '2026-11-20T19:00:00Z';
function guest(id: string, budgets?: PriceBand[]): Guest {
  return { id, name: id, reply: { attending: true, availability: [], location: { label: 'Example', lat: 51.53, lon: -0.12, source: 'fixture' }, cuisines: {}, diets: [], otherDiet: '', budgets } };
}
function dinner(guests = [guest('a'), guest('b')]): Dinner {
  return { id: 'd', title: 'Example', hostName: 'Host', hostHash: 'hash', createdAt: now.toISOString(), expiresAt: '2026-12-01T00:00:00Z', mode: 'fixed', dateStart: '2026-11-20', dateEnd: '2026-11-20', deadline: '2026-11-19T18:00:00Z', duration: 120, fixedStart: start, selectedStart: start, stage: 'recommending', guests, includedIds: guests.map(g => g.id), areas: [], restaurants: [], votesClosed: false, version: 1, dataMode: 'fixture', experience: 'v2' };
}
function venue(id = 'v', price: Restaurant['price'] = 'medium'): Restaurant & { dietStatus: Record<string, 'yes' | 'no' | 'unknown'> } {
  return { id, name: id, address: 'Example', sourceUrl: '', mapUrl: '', cuisines: ['Thai'], price, dietaryEvidence: [], hours: 'Synthetic', dietStatus: {}, evidence: { source: 'fixture', sourceUrl: '', checkedAt: now.toISOString(), priceBand: price === 'unknown' ? 'medium' : price, opening: { start, end: '2026-11-20T21:00:00Z' }, diets: [] } };
}

test('common budgets intersect included attendees only and old replies default to medium', () => {
  const d = dinner([guest('a', ['low', 'medium']), guest('b')]);
  d.guests.push(guest('excluded', ['high']));
  assert.deepEqual(compatibleBudgetBands(d), ['medium']);
  d.guests[1].reply!.attending = false;
  assert.deepEqual(compatibleBudgetBands(d), ['low', 'medium']);
  assert.equal(effectiveBudgetBand(d), undefined);
  d.budgetBand = 'low';
  assert.equal(effectiveBudgetBand(d), 'low');
  d.budgetBand = 'high';
  assert.equal(effectiveBudgetBand(d), undefined);
});

test('no common band needs an explicit organiser override; V1 has no budget change', () => {
  const d = dinner([guest('a', ['low']), guest('b', ['high'])]);
  assert.deepEqual(compatibleBudgetBands(d), []);
  assert.equal(effectiveBudgetBand(d), undefined);
  d.budgetBand = 'high';
  assert.equal(effectiveBudgetBand(d), 'high');
  delete d.experience;
  assert.deepEqual(compatibleBudgetBands(d), []);
  assert.deepEqual(rankRestaurants([venue('unknown', 'unknown'), venue('high', 'high')], d.guests, d).map(v => v.id), ['unknown']);
  assert.deepEqual(restaurantRecommendation(d, now), {});
});

test('V2 high budget includes high matches, excludes unknown and other bands, preserves vetoes', () => {
  const d = dinner([guest('a', ['high'])]);
  const restaurants = [venue('unknown', 'unknown'), venue('medium'), venue('high', 'high')];
  assert.deepEqual(rankRestaurants(restaurants, d.guests, d).map(v => v.id), ['high']);
  d.guests[0].reply!.cuisines.Thai = 'no';
  assert.deepEqual(rankRestaurants(restaurants, d.guests, d), []);
  d.guests[0].reply!.cuisines = {};
  d.guests[0].reply!.diets = ['Vegan'];
  restaurants[2].dietStatus.Vegan = 'no';
  assert.deepEqual(rankRestaurants(restaurants, d.guests, d), []);
});

test('one deterministic supported recommendation leaves confirmation separate', () => {
  const d = dinner(); d.restaurants = [venue('first'), venue('second')];
  const result = restaurantRecommendation(d, now);
  assert.equal(result.recommendation?.restaurantId, 'first');
  assert.match(result.recommendation!.reason, /Synthetic example evidence/);
  assert.equal(d.restaurant, undefined);
  assert.equal(d.confirmedAt, undefined);
  assert.equal(d.stage, 'recommending');
});

test('unknown, stale, incompatible and insufficient evidence falls back honestly', () => {
  for (const change of [
    (v: Restaurant) => { delete v.evidence; },
    (v: Restaurant) => { v.evidence!.checkedAt = '2026-10-01T00:00:00Z'; },
    (v: Restaurant) => { v.evidence!.checkedAt = '2027-01-01T00:00:00Z'; },
    (v: Restaurant) => { v.evidence!.opening.end = '2026-11-20T20:00:00Z'; },
    (v: Restaurant) => { v.evidence!.opening.start = 'invalid'; },
    (v: Restaurant) => { v.evidence!.priceBand = 'high'; },
    (v: Restaurant) => { v.price = 'unknown'; },
  ]) {
    const d = dinner(); const v = venue(); change(v); d.restaurants = [v];
    const result = restaurantRecommendation(d, now);
    assert.equal(result.recommendation, undefined);
    assert.match(result.fallbackReason!, /shortlist or enter a restaurant/);
  }
  const d = dinner(); d.restaurants = [venue()];
  d.guests[0].reply!.diets = ['Vegan'];
  assert.equal(restaurantRecommendation(d, now).recommendation, undefined);
  d.restaurants[0].evidence!.diets = ['Vegan'];
  assert.ok(restaurantRecommendation(d, now).recommendation);
  d.guests[0].reply!.otherDiet = 'Severe allergy';
  assert.equal(restaurantRecommendation(d, now).recommendation, undefined);
  d.guests[0].reply!.otherDiet = ''; d.dataMode = 'live';
  assert.equal(restaurantRecommendation(d, now).recommendation, undefined);
});

test('fixture area feasibility and suggestions use the selected band without changing fairness', async () => {
  const providers = createProviders({ mode: 'fixture', now: () => now, fetch: async () => { throw new Error('No network'); } });
  const d = dinner([guest('a', ['high'])]);
  d.budgetBand = 'high';
  d.areas = await providers.recommendAreas(d);
  assert.equal(d.areas.length, 3);
  d.selectedAreaId = d.areas[0].id;
  d.restaurants = await providers.restaurantSuggestions(d);
  assert.ok(d.restaurants.every(v => v.price === 'high'));
  assert.ok(restaurantRecommendation(d, now).recommendation);
  const v1 = { ...d, experience: undefined };
  assert.deepEqual((await providers.recommendAreas(v1)).map(v => v.id), d.areas.map(v => v.id));
  d.guests[0].reply!.budgets = ['low', 'high']; delete d.budgetBand;
  assert.deepEqual(await providers.recommendAreas(d), []);
});

test('live unknown-price venues support only caveated areas, never verified-price suggestions', async () => {
  const d = dinner(); d.dataMode = 'live'; d.selectedStart = '2026-11-08T19:00:00Z';
  const providers = createProviders({ mode: 'live', now: () => now, fetch: async input => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/StopPoint/')) return Response.json([{ id: '940GZZLUKSX', lat: 51.5308, lon: -0.1238 }]);
    if (url.hostname === 'overpass-api.de') return Response.json({ elements: [{ id: 1, type: 'node', lat: 51.53, lon: -0.12, tags: { amenity: 'restaurant', name: 'Unverified venue', cuisine: 'thai', opening_hours: 'Mo-Su 18:00-23:00' } }] });
    return Response.json({ journeys: [{ duration: 20 }] });
  } });
  d.areas = await providers.recommendAreas(d);
  assert.equal(d.areas.length, 1);
  assert.match(d.areas[0].explanation, /prices are unverified/);
  d.selectedAreaId = d.areas[0].id;
  d.restaurants = await providers.restaurantSuggestions(d);
  assert.deepEqual(d.restaurants, []);
  assert.equal(restaurantRecommendation(d, now).recommendation, undefined);
});
