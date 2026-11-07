import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Area, Dinner, Guest } from '../src/lib/model';
import { CANDIDATE_STATIONS, ProviderError, createProviders, londonJourneyParameters, rankAreas, rankRestaurants, restaurantFromOsm } from '../src/lib/providers';
import { PublicVenueCache } from '../src/lib/provider-cache';

const start = '2026-11-07T19:00:00.000Z';
const now = () => new Date('2026-11-07T12:00:00.000Z');
function guest(id = 'alex'): Guest {
  return { id, name: id, reply: { attending: true, location: { label: 'Private origin', lat: 51.53, lon: -0.12, source: 'fixture' }, availability: [], diets: [], otherDiet: '', cuisines: {} } };
}
function dinner(guests = [guest()]): Dinner {
  return {
    id: 'example', title: 'Example dinner', hostName: 'Sam', hostHash: 'not-a-credential', createdAt: start, expiresAt: '2026-12-07T00:00:00.000Z',
    mode: 'fixed', dateStart: '2026-11-07', dateEnd: '2026-11-07', deadline: '2026-11-07T18:00:00.000Z', duration: 120, fixedStart: start,
    stage: 'recommending', guests, includedIds: guests.map(value => value.id), selectedStart: start, areas: [], restaurants: [], votesClosed: false, version: 1, dataMode: 'fixture',
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const noNetwork: typeof fetch = async () => { throw new Error('Fixture tried the network'); };

test('a short-lived caller times out without cancelling another caller sharing its venue load', async () => {
  const cache = new PublicVenueCache<unknown[]>();
  const plan = dinner();
  plan.dataMode = 'live';
  plan.areas = [{ ...CANDIDATE_STATIONS[0], journeys: [], longest: 0, explanation: '' }];
  plan.selectedAreaId = plan.areas[0].id;
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    await new Promise(resolve => setTimeout(resolve, 80));
    return json({ elements: [] });
  };
  const longer = createProviders({ mode: 'live', fetch: fetcher, venueCache: cache }).restaurantSuggestions(plan);
  await assert.rejects(createProviders({ mode: 'live', fetch: fetcher, venueCache: cache, operationTimeoutMs: 5 }).restaurantSuggestions(plan), /too long/);
  assert.deepEqual(await longer, []);
  assert.equal(requests, 1);
});

test('shared public venue cache reapplies private cuisine filters separately for each dinner', async () => {
  const cache = new PublicVenueCache<unknown[]>();
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    return json({ elements: ['japanese', 'thai'].map((cuisine, index) => ({ id: index + 1, type: 'node', lat: 51.53, lon: -0.12, tags: { amenity: 'restaurant', name: cuisine, cuisine } })) });
  };
  const first = dinner(), second = dinner();
  for (const plan of [first, second]) {
    plan.dataMode = 'live';
    plan.areas = [{ ...CANDIDATE_STATIONS[0], journeys: [], longest: 0, explanation: '' }];
    plan.selectedAreaId = plan.areas[0].id;
  }
  second.guests[0].reply!.cuisines = { Japanese: 'no' };
  second.guests[0].reply!.diets = ['Halal'];
  const [all, filtered] = await Promise.all([first, second].map(plan => createProviders({ mode: 'live', fetch: fetcher, venueCache: cache }).restaurantSuggestions(plan)));
  assert.equal(requests, 1);
  assert.equal(all.length, 2);
  assert.deepEqual(filtered.map(venue => venue.name), ['thai']);
  assert.ok(!all.some(venue => venue.dietaryEvidence.some(evidence => evidence.startsWith('Halal:'))));
  assert.match(filtered[0].dietaryEvidence.join(' '), /Halal: unknown/);
});

test('fixture location and complete recommendation flow are deterministic without network', async () => {
  const providers = createProviders({ mode: 'fixture', fetch: noNetwork });
  const location = await providers.resolveLocation("King's Cross");
  assert.equal(location.source, 'fixture');
  assert.match(location.label, /example origin/);
  const plan = dinner([guest('alex'), guest('bea')]);
  const areas = await providers.recommendAreas(plan);
  assert.equal(areas.length, 3);
  assert.deepEqual(areas, await providers.recommendAreas(plan));
  assert.ok(areas.every(area => area.journeys.length === 2 && area.explanation.startsWith('Example')));
  assert.ok(!JSON.stringify(areas).includes('Private origin'));
  plan.areas = areas;
  plan.selectedAreaId = areas[0].id;
  const restaurants = await providers.restaurantSuggestions(plan);
  assert.equal(restaurants.length, 5);
  assert.ok(restaurants.every(restaurant => restaurant.name.startsWith('Example') && restaurant.address.includes('fictional')));
});

test('fixture mode rejects unsupported origins instead of inventing an origin', async () => {
  const providers = createProviders({ mode: 'fixture', fetch: noNetwork });
  await assert.rejects(providers.resolveLocation('A private street somewhere'), /Example mode supports/);
  await assert.rejects(providers.resolveLocation('http://127.0.0.1'), /station name or a full postcode/);
});

test('fairness ranks the worst return journey before lower total travel', () => {
  const area = (id: string, outbound: number[], homeward = outbound): Area => ({
    id, name: id, lat: 51.5, lon: -0.1, longest: Math.max(...outbound, ...homeward), explanation: '',
    journeys: outbound.map((value, index) => ({ guestId: `g${index}`, outbound: value, homeward: homeward[index] })),
  });
  const fair = area('fair', [25, 25]), shortestTotal = area('shortest-total', [1, 30]), poorReturn = area('poor-return', [10, 10], [60, 12]);
  assert.deepEqual(rankAreas([shortestTotal, poorReturn, fair]).map(value => value.id), ['fair', 'shortest-total', 'poor-return']);
  assert.deepEqual(rankAreas([area('b', [25, 25]), area('a', [25, 25])]).map(value => value.id), ['a', 'b']);
});

test('London arrival/departure date parameters preserve winter, summer and midnight dates', () => {
  assert.deepEqual(londonJourneyParameters(new Date('2026-01-10T19:00:00Z')), { date: '20260110', time: '1900' });
  assert.deepEqual(londonJourneyParameters(new Date('2026-07-10T18:00:00Z')), { date: '20260710', time: '1900' });
  assert.deepEqual(londonJourneyParameters(new Date('2026-07-10T23:30:00Z')), { date: '20260711', time: '0030' });
});

function osmVenue(id: number, cuisine: string, tags: Record<string, string> = {}, guests = [guest()]) {
  return restaurantFromOsm({ id, type: 'node', lat: 51.53, lon: -0.12, tags: { amenity: 'restaurant', name: `Venue ${id}`, cuisine, ...tags } }, CANDIDATE_STATIONS[0], guests)!;
}

test('restaurant ranking respects cuisine vetoes and counts each person only at their strongest preference', () => {
  const alex = guest('alex'), bea = guest('bea');
  alex.reply!.cuisines = { Japanese: 'prefer', Korean: 'prefer', Thai: 'okay', Mexican: 'no' };
  bea.reply!.cuisines = { Thai: 'prefer' };
  const venues = [osmVenue(1, 'mexican'), osmVenue(2, 'japanese;korean'), osmVenue(3, 'thai'), osmVenue(4, '')];
  assert.deepEqual(rankRestaurants(venues, [alex, bea]).map(value => value.id), ['osm-node-3', 'osm-node-2', 'osm-node-4']);
});

test('OSM unknown facts remain unknown; known dietary contradictions are removed', () => {
  const alex = guest();
  alex.reply!.diets = ['Halal', 'Gluten-free'];
  const unknown = osmVenue(1, 'indian', {}, [alex]);
  assert.equal(unknown.price, 'unknown');
  assert.equal(unknown.address, '');
  assert.match(unknown.hours, /unknown/);
  assert.match(unknown.dietaryEvidence.join(' '), /Halal: unknown/);
  assert.match(unknown.sourceUrl, /^https:\/\/www.openstreetmap.org\/node\/1$/);
  const conflicting = osmVenue(2, 'indian', { 'diet:halal': 'no' }, [alex]);
  assert.deepEqual(rankRestaurants([unknown, conflicting], [alex]).map(value => value.id), ['osm-node-1']);
  assert.equal(restaurantFromOsm({ id: 3, type: 'node', lat: 0, lon: 0, tags: { name: 'Bad', amenity: 'restaurant' } }, CANDIDATE_STATIONS[0], [alex]), null);
});

test('live postcode lookup accepts a London result and rejects another region', async () => {
  const fetcher: typeof fetch = async input => {
    assert.match(String(input), /^https:\/\/api.postcodes.io\/postcodes\//);
    return json({ status: 200, result: { postcode: 'N1 9AL', latitude: 51.53, longitude: -0.12, region: 'London' } });
  };
  const location = await createProviders({ mode: 'live', fetch: fetcher }).resolveLocation('n1 9al');
  assert.equal(location.label, 'N1 9AL');
  await assert.rejects(createProviders({ mode: 'live', fetch: async () => json({ status: 200, result: { latitude: 51.53, longitude: -0.12, region: 'South East' } }) }).resolveLocation('N1 9AL'), /supported London/);
});

test('live station lookup requires an exact resolved station and does not leak provider failures', async () => {
  const fetcher: typeof fetch = async input => String(input).includes('/StopPoint/940') ? json(CANDIDATE_STATIONS) : json({ matches: [{ id: '940GZZLUBNK', name: 'Bank Underground Station', lat: 51.513, lon: -0.088 }] });
  assert.equal((await createProviders({ mode: 'live', fetch: fetcher }).resolveLocation('Bank')).source, 'Transport for London');
  await assert.rejects(createProviders({ mode: 'live', fetch: fetcher }).resolveLocation('Mile'), /more specific station/);
  await assert.rejects(createProviders({ mode: 'live', fetch: async () => { throw new Error('API_KEY=private-secret'); } }).resolveLocation('Bank'), error => error instanceof ProviderError && !error.message.includes('private-secret'));
});

test('TfL parent interchange responses resolve the exact station child rather than rejecting all live areas', async () => {
  const child = { ...CANDIDATE_STATIONS[0], lat: 51.5309, lon: -0.1239 };
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/StopPoint/')) return json([{ id: 'HUBKGX', lat: 51.531683, lon: -0.123538, children: [{ id: 'nested-interchange', children: [child] }] }]);
    if (url.hostname === 'overpass-api.de') return json({ elements: [{ id: 1, type: 'node', lat: child.lat, lon: child.lon, tags: { amenity: 'restaurant', name: 'Public example venue' } }] });
    assert.ok(url.pathname.includes(`${child.lat},${child.lon}`), 'use the exact child coordinates for journeys');
    return json({ journeys: [{ duration: 25 }] });
  };
  const providers = createProviders({ mode: 'live', fetch: fetcher, now });
  const origin = await providers.resolveLocation('King’s Cross');
  assert.equal(origin.lat, child.lat);
  assert.equal(origin.lon, child.lon);
  const areas = await providers.recommendAreas({ ...dinner(), dataMode: 'live' });
  assert.equal(areas.length, 1);
  assert.equal(areas[0].id, child.id);
});

test('live provider errors, malformed bodies and rate limits never fall back to fixtures', async () => {
  let attempts = 0;
  const providers = createProviders({ mode: 'live', fetch: async () => { attempts += 1; return json({}, 429); } });
  await assert.rejects(providers.resolveLocation('N1 9AL'), /rejected/);
  assert.equal(attempts, 2);
  await assert.rejects(createProviders({ mode: 'live', fetch: async () => new Response('{') }).resolveLocation('N1 9AL'), /invalid response/);
  await assert.rejects(createProviders({ mode: 'live', fetch: noNetwork, operationTimeoutMs: -1 }).resolveLocation('N1 9AL'), /too long/);
});

test('live travel and restaurant requests use bounded candidate data and correct return date', async () => {
  const plan = dinner();
  plan.dataMode = 'live';
  plan.selectedStart = '2026-11-07T23:30:00.000Z';
  const routeCalls: URL[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/StopPoint/')) return json(CANDIDATE_STATIONS.slice(0, 2));
    if (url.hostname === 'overpass-api.de') return json({ elements: [{ id: 1, type: 'node', lat: 51.53, lon: -0.12, tags: { amenity: 'restaurant', name: 'Test venue', cuisine: 'japanese' } }] });
    routeCalls.push(url);
    return json({ stopMessages: [], journeys: [{ duration: 25 }] });
  };
  const areas = await createProviders({ mode: 'live', fetch: fetcher, now }).recommendAreas(plan);
  assert.equal(areas.length, 2);
  assert.equal(routeCalls.length, 4);
  assert.ok(routeCalls.some(url => url.searchParams.get('timeIs') === 'arriving' && url.searchParams.get('date') === '20261107' && url.searchParams.get('time') === '2330'));
  assert.ok(routeCalls.some(url => url.searchParams.get('timeIs') === 'departing' && url.searchParams.get('date') === '20261108' && url.searchParams.get('time') === '0130'));
  assert.ok(!JSON.stringify(areas).includes('Private origin'));
});

test('a genuinely unavailable route excludes that area, while provider failures abort ranking', async () => {
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/StopPoint/')) return json(CANDIDATE_STATIONS.slice(0, 1));
    if (url.hostname === 'overpass-api.de') return json({ elements: [{ id: 1, type: 'node', lat: 51.53, lon: -0.12, tags: { amenity: 'restaurant', name: 'Test venue' } }] });
    return json({ journeys: [] });
  };
  assert.deepEqual(await createProviders({ mode: 'live', fetch: fetcher, now }).recommendAreas({ ...dinner(), dataMode: 'live' }), []);
  await assert.rejects(createProviders({ mode: 'live', now, fetch: async input => String(input).includes('JourneyResults') ? json({}, 503) : fetcher(input) }).recommendAreas({ ...dinner(), dataMode: 'live' }), /rejected/);
});

test('live future horizon is explicit and invalid groups do not trigger network requests', async () => {
  const plan = dinner();
  plan.dataMode = 'live';
  plan.selectedStart = '2027-02-01T19:00:00Z';
  await assert.rejects(createProviders({ mode: 'live', fetch: noNetwork, now }).recommendAreas(plan), error => error instanceof ProviderError && error.code === 'unsupported-date');
  await assert.rejects(createProviders({ mode: 'fixture', fetch: noNetwork }).recommendAreas(dinner([])), /no attending guests/);
});

test('stored dinner mode cannot silently change and all cuisine vetoes produce an honest empty list', async () => {
  await assert.rejects(createProviders({ mode: 'live', fetch: noNetwork }).recommendAreas(dinner()), /different data mode/);
  const plan = dinner();
  plan.areas = [{ ...CANDIDATE_STATIONS[0], journeys: [], longest: 0, explanation: '' }];
  plan.selectedAreaId = plan.areas[0].id;
  plan.guests[0].reply!.cuisines = Object.fromEntries(['Japanese', 'Korean', 'Thai', 'Indian', 'Middle Eastern', 'Italian'].map(cuisine => [cuisine, 'no']));
  assert.deepEqual(await createProviders({ mode: 'fixture', fetch: noNetwork }).restaurantSuggestions(plan), []);
});

test('live service calls remain within four concurrent requests', async () => {
  let active = 0, maximum = 0;
  const fetcher: typeof fetch = async input => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    const url = new URL(String(input));
    if (url.pathname.startsWith('/StopPoint/')) return json(CANDIDATE_STATIONS);
    if (url.hostname === 'overpass-api.de') return json({ elements: [{ id: 1, type: 'node', lat: 51.53, lon: -0.12, tags: { amenity: 'restaurant', name: 'Test venue' } }] });
    return json({ journeys: [{ duration: 25 }] });
  };
  const plan = { ...dinner([guest('alex'), guest('bea'), guest('cam')]), dataMode: 'live' as const };
  assert.equal((await createProviders({ mode: 'live', fetch: fetcher, now }).recommendAreas(plan)).length, 3);
  assert.equal(maximum, 4);
});
