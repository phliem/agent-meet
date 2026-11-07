import type { Area, Dinner, Guest, Journey, Location, Restaurant, Station } from './model';
import { effectiveBudgetBand, matchesBudget } from './v2-restaurants';
import { boundedJson, PublicVenueCache } from './provider-cache';

type Fetcher = typeof fetch;
type DataMode = 'fixture' | 'live';
type JsonObject = Record<string, unknown>;
type DietStatus = 'yes' | 'no' | 'unknown';
type Venue = Restaurant & { dietStatus: Record<string, DietStatus> };

export class ProviderError extends Error {
  constructor(public readonly code: 'unavailable' | 'invalid-location' | 'unsupported-date' | 'invalid-data', message: string, public readonly service?: 'location' | 'transport' | 'restaurants') {
    super(message);
    this.name = 'ProviderError';
  }
}

/** This is a small pilot candidate set, not a claim to cover every London station. */
export const CANDIDATE_STATIONS: Station[] = [
  { id: '940GZZLUKSX', name: 'King’s Cross', lat: 51.5308, lon: -0.1238 },
  { id: '940GZZLUBNK', name: 'Bank', lat: 51.5133, lon: -0.0886 },
  { id: '940GZZLULNB', name: 'London Bridge', lat: 51.5055, lon: -0.0865 },
  { id: '940GZZLULVT', name: 'Liverpool Street', lat: 51.5178, lon: -0.0823 },
  { id: '940GZZLUWLO', name: 'Waterloo', lat: 51.5033, lon: -0.1147 },
  { id: '940GZZLUVIC', name: 'Victoria', lat: 51.4964, lon: -0.1439 },
  { id: '940GZZLUSTD', name: 'Stratford', lat: 51.5417, lon: -0.0033 },
  { id: '940GZZLUPAC', name: 'Paddington', lat: 51.5154, lon: -0.1755 },
];

const londonBounds = (lat: number, lon: number) => lat >= 51.28 && lat <= 51.7 && lon >= -0.52 && lon <= 0.34;
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
const normalise = (value: string) => {
  const cleaned = value.toLowerCase().replace(/[’']/g, '').replace(/\b(underground|rail|station)\b/g, '').replace(/[^a-z0-9]/g, '');
  return cleaned.startsWith('kingscross') ? cleaned.replace(/stpancras(?:international)?/, '') : cleaned;
};

function attending(dinner: Dinner): Guest[] {
  const guests = dinner.guests.filter(guest => dinner.includedIds?.includes(guest.id) && guest.reply?.attending);
  if (!guests.length) throw new ProviderError('invalid-data', 'There are no attending guests to plan for.');
  if (guests.length > 24) throw new ProviderError('invalid-data', 'This pilot supports up to 24 attending guests.');
  if (guests.some(guest => !guest.reply?.location || !londonBounds(guest.reply.location.lat, guest.reply.location.lon))) {
    throw new ProviderError('invalid-location', 'Every attending guest needs a supported London starting point.');
  }
  return guests;
}

function selectedTime(dinner: Dinner): Date {
  const date = new Date(dinner.selectedStart || dinner.fixedStart || '');
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(dinner.duration) || dinner.duration <= 0) {
    throw new ProviderError('invalid-data', 'Choose a valid dinner time before finding areas.');
  }
  return date;
}

export function londonJourneyParameters(date: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}${values.month}${values.day}`, time: `${values.hour}${values.minute}` };
}

function score(area: Area): [number, number, number, string] {
  const worst = area.journeys.map(journey => Math.max(journey.outbound, journey.homeward));
  return [Math.max(...worst), Math.max(...worst) - Math.min(...worst), area.journeys.reduce((sum, journey) => sum + journey.outbound + journey.homeward, 0), area.id];
}

export function rankAreas(areas: Area[]): Area[] {
  return [...areas].sort((left, right) => {
    const a = score(left), b = score(right);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3].localeCompare(b[3]);
  });
}

function preferenceScore(restaurant: Restaurant, guests: Guest[]): [number, number] {
  let preferred = 0, accepted = 0;
  for (const guest of guests) {
    const preferences = restaurant.cuisines.map(cuisine => guest.reply?.cuisines[cuisine]);
    if (preferences.includes('prefer')) preferred += 1;
    else if (preferences.includes('okay')) accepted += 1;
  }
  return [preferred, accepted];
}

export function rankRestaurants(restaurants: Venue[], guests: Guest[], dinner?: Dinner, allowUnverifiedPrice = false): Restaurant[] {
  return restaurants.filter(restaurant => (dinner ? matchesBudget(restaurant, dinner) || (allowUnverifiedPrice && dinner.experience === 'v2' && !!effectiveBudgetBand(dinner) && restaurant.price === 'unknown') : restaurant.price !== 'high') && !guests.some(guest => {
    const reply = guest.reply;
    return restaurant.cuisines.some(cuisine => reply?.cuisines[cuisine] === 'no') || reply?.diets.some(diet => restaurant.dietStatus[diet] === 'no');
  })).sort((left, right) => {
    const a = preferenceScore(left, guests), b = preferenceScore(right, guests);
    return b[0] - a[0] || b[1] - a[1] || left.id.localeCompare(right.id);
  }).slice(0, 5).map(venue => ({
    id: venue.id, name: venue.name, address: venue.address, mapUrl: venue.mapUrl, sourceUrl: venue.sourceUrl,
    cuisines: venue.cuisines, price: venue.price, dietaryEvidence: venue.dietaryEvidence, hours: venue.hours, station: venue.station, ...(venue.evidence ? { evidence: venue.evidence } : {}),
  }));
}

const dietKeys: Record<string, string> = {
  Vegetarian: 'diet:vegetarian', Vegan: 'diet:vegan', 'Gluten-free': 'diet:gluten_free', Halal: 'diet:halal', Kosher: 'diet:kosher',
  'Dairy-free': 'diet:dairy_free', 'Nut-free': 'diet:nut_free',
};
const cuisineTags: Record<string, string> = {
  chinese: 'Chinese', thai: 'Thai', indian: 'Indian', japanese: 'Japanese', sushi: 'Japanese', korean: 'Korean',
  italian: 'Italian', pizza: 'Italian', mexican: 'Mexican', vietnamese: 'Vietnamese', middle_eastern: 'Middle Eastern',
  lebanese: 'Middle Eastern', persian: 'Middle Eastern', arab: 'Middle Eastern',
};

export function restaurantFromOsm(value: unknown, station: Station, guests: Guest[]): Venue | null {
  const item = object(value), tags = object(item.tags), center = object(item.center);
  const name = text(tags.name), type = text(item.type), id = number(item.id);
  const lat = number(item.lat ?? center.lat), lon = number(item.lon ?? center.lon);
  if (!name || !['node', 'way', 'relation'].includes(type) || !Number.isSafeInteger(id) || !londonBounds(lat, lon)) return null;
  if (['off', 'closed'].includes(text(tags.opening_hours)) || tags.amenity !== 'restaurant') return null;
  const cuisines = [...new Set(text(tags.cuisine).split(';').map(tag => cuisineTags[tag.trim().toLowerCase()]).filter(Boolean))];
  const dietStatus: Record<string, DietStatus> = {};
  for (const [diet, key] of Object.entries(dietKeys)) {
    const tag = text(tags[key]);
    dietStatus[diet] = ['yes', 'only'].includes(tag) ? 'yes' : tag === 'no' ? 'no' : 'unknown';
  }
  if (dietStatus.Vegan === 'yes') dietStatus.Vegetarian = 'yes';
  const requirements = [...new Set(guests.flatMap(guest => guest.reply?.diets ?? []))];
  const dietaryEvidence = requirements.map(diet => dietStatus[diet] === 'yes'
    ? `${diet}: reported in OpenStreetMap; verify with the venue`
    : dietStatus[diet] === 'no' ? `${diet}: reported unavailable` : `${diet}: unknown; verify with the venue`);
  if (guests.some(guest => guest.reply?.otherDiet)) dietaryEvidence.push('Other food requirements: verify directly with the venue');
  const street = [text(tags['addr:housenumber']), text(tags['addr:street'])].filter(Boolean).join(' ');
  const address = text(tags['addr:full']) || [street, text(tags['addr:city']), text(tags['addr:postcode'])].filter(Boolean).join(', ');
  const sourceUrl = `https://www.openstreetmap.org/${type}/${id}`;
  return {
    id: `osm-${type}-${id}`, name: name.slice(0, 160), address, sourceUrl, mapUrl: sourceUrl, cuisines,
    price: 'unknown', dietStatus, dietaryEvidence, station: `Area station: ${station.name}`,
    hours: text(tags.opening_hours) ? `OSM hours: ${text(tags.opening_hours)}. Check your dinner date with the venue.` : 'Opening hours unknown; check with the venue.',
  };
}

const fixtureNames = ['Example Noodle House', 'Example Garden Kitchen', 'Example Rice Table', 'Example Mezze Room', 'Example Supper Club'];
const fixtureCuisines = [['Japanese', 'Korean'], ['Thai'], ['Indian'], ['Middle Eastern'], ['Italian']];
function fixtureVenues(station: Station, dinner?: Dinner, checkedAt = new Date()): Venue[] {
  const start = dinner?.selectedStart || dinner?.fixedStart;
  const price = dinner?.experience === 'v2' ? effectiveBudgetBand(dinner) ?? 'medium' : 'medium';
  return fixtureNames.map((name, index) => ({
    id: `fixture-${station.id}-${index}`, name, address: `${index + 1} Example Lane, ${station.name}, London (fictional)`,
    mapUrl: '', sourceUrl: '', cuisines: fixtureCuisines[index], price,
    ...(start && dinner?.experience === 'v2' ? { evidence: { source: 'fixture' as const, sourceUrl: '', checkedAt: checkedAt.toISOString(), priceBand: price, opening: { start, end: new Date(Date.parse(start) + dinner.duration * 60_000).toISOString() }, diets: Object.keys(dietKeys) } } : {}),
    dietaryEvidence: ['Synthetic menu data for testing. Confirm real requirements with a real venue.'],
    dietStatus: Object.fromEntries(Object.keys(dietKeys).map(diet => [diet, 'yes' as const])),
    hours: 'Example-only evening service. These are not real opening hours.', station: `Area station: ${station.name}`,
  }));
}

const fixturePostcodes: Record<string, [number, number]> = {
  'N19AL': [51.531, -0.122], 'SW1A1AA': [51.501, -0.142], 'E201EJ': [51.541, -0.003],
  'SE19SP': [51.505, -0.09], 'E16AN': [51.521, -0.075], 'W21HQ': [51.515, -0.175],
};

const publicVenueCache = new PublicVenueCache<unknown[]>();
export type ProviderOptions = { mode?: DataMode; fetch?: Fetcher; tflKey?: string; now?: () => Date; requestTimeoutMs?: number; operationTimeoutMs?: number; venueCache?: PublicVenueCache<unknown[]> };

/** Create a service per operation. Its network deadline and concurrency are bounded. */
export function createProviders(options: ProviderOptions = {}) {
  const mode = options.mode ?? (process.env.DATA_MODE === 'live' ? 'live' : 'fixture');
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const tflKey = options.tflKey ?? process.env.TFL_APP_KEY;
  // Custom transports remain isolated unless a test explicitly shares a cache.
  const venueCache = options.venueCache ?? (options.fetch ? undefined : publicVenueCache);
  const deadline = Date.now() + (options.operationTimeoutMs ?? 25_000);
  let activeRequests = 0;
  const waiting: Array<() => void> = [];
  // Private routes are deduplicated only within this operation, never globally.
  const journeyRequests = new Map<string, Promise<number | null>>();

  async function request(url: URL, init?: RequestInit): Promise<unknown> {
    while (activeRequests >= 4) await new Promise<void>(resolve => waiting.push(resolve));
    activeRequests += 1;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new ProviderError('unavailable', 'Live planning took too long. Please try again.');
        let response: Response;
        try {
          response = await fetcher(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, Math.min(options.requestTimeoutMs ?? 6_000, remaining))) });
        } catch {
          if (attempt === 0 && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 150));
            continue;
          }
          throw new ProviderError('unavailable', 'A live data service could not be reached. Please try again.');
        }
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          await response.body?.cancel().catch(() => undefined);
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          if (response.status === 404) return null;
          throw new ProviderError('unavailable', 'A live data service rejected the request. Check service configuration and try again.');
        }
        try {
          return await boundedJson(response);
        } catch {
          throw new ProviderError('invalid-data', 'A live data service returned an invalid response. Please try again.');
        }
      }
      throw new ProviderError('unavailable', 'A live data service is busy. Please try again.');
    } catch (error) {
      if (error instanceof ProviderError && !error.service) {
        const service = url.hostname === 'api.postcodes.io' ? 'location' : url.hostname === 'api.tfl.gov.uk' ? 'transport' : 'restaurants';
        throw new ProviderError(error.code, error.message, service);
      }
      throw error;
    } finally {
      activeRequests -= 1;
      waiting.shift()?.();
    }
  }

  function tflUrl(path: string, parameters: Record<string, string> = {}): URL {
    const url = new URL(path, 'https://api.tfl.gov.uk');
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    if (tflKey) url.searchParams.set('app_key', tflKey);
    return url;
  }

  async function resolveLocation(input: string): Promise<Location> {
    const query = input.trim();
    if (query.length < 2 || query.length > 80 || !/^[\p{L}\p{N}\s'’&().-]+$/u.test(query)) {
      throw new ProviderError('invalid-location', 'Enter a London station name or a full postcode.');
    }
    const postcode = query.toUpperCase().replace(/\s/g, '');
    const postcodeShape = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
    if (mode === 'fixture') {
      const fixturePoint = fixturePostcodes[postcode];
      const station = CANDIDATE_STATIONS.find(item => normalise(item.name) === normalise(query));
      if (fixturePoint) return { label: `${query.toUpperCase()} (example origin)`, lat: fixturePoint[0], lon: fixturePoint[1], source: 'fixture' };
      if (station) return { label: `${station.name} (example origin)`, lat: station.lat, lon: station.lon, source: 'fixture' };
      throw new ProviderError('invalid-location', 'Example mode supports the listed station areas or N1 9AL, SW1A 1AA, E20 1EJ, SE1 9SP, E1 6AN and W2 1HQ.');
    }
    if (postcodeShape.test(postcode)) {
      const data = object(await request(new URL(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`)));
      const result = object(data.result), lat = number(result.latitude), lon = number(result.longitude);
      if (data.status !== 200 || !londonBounds(lat, lon) || result.region !== 'London') {
        throw new ProviderError('invalid-location', 'That postcode is not a supported London starting point.');
      }
      return { label: text(result.postcode), lat, lon, source: 'Postcodes.io / ONS postcode data' };
    }
    const candidate = CANDIDATE_STATIONS.find(station => normalise(station.name) === normalise(query));
    if (candidate) {
      const station = (await liveStations()).find(station => station.id === candidate.id);
      if (!station) throw new ProviderError('invalid-location', 'That station could not be located. Try a full postcode instead.');
      return { label: station.name, lat: station.lat, lon: station.lon, source: 'Transport for London' };
    }
    const data = object(await request(tflUrl('/StopPoint/Search', { query, modes: 'tube,dlr,overground,elizabeth-line,national-rail' })));
    const matches = list(data.matches).map(object).filter(item => londonBounds(number(item.lat), number(item.lon)));
    const exact = matches.filter(item => normalise(text(item.name)) === normalise(query));
    const match = exact[0];
    if (!match) {
      const suggestions = [...new Set(matches.slice(0, 3).map(item => text(item.name)))].join(', ');
      throw new ProviderError('invalid-location', suggestions ? `Choose a more specific station name: ${suggestions}.` : 'No supported London station matched. Try its full station name or a postcode.');
    }
    return { label: text(match.name), lat: number(match.lat), lon: number(match.lon), source: 'Transport for London' };
  }

  async function liveStations(): Promise<Station[]> {
    const response = await request(tflUrl(`/StopPoint/${CANDIDATE_STATIONS.map(station => station.id).join(',')}`));
    const points = list(response).map(object);
    // TfL can return a parent interchange hub rather than the requested stop at
    // the top level. Resolve the exact requested child, never the hub centroid.
    for (let index = 0; index < points.length; index++) {
      if (points.length > 10_000) throw new ProviderError('invalid-data', 'London station data is unavailable. Please try again.');
      for (const child of list(points[index].children)) points.push(object(child));
    }
    const stations = CANDIDATE_STATIONS.flatMap(station => {
      const point = points.find(value => value.id === station.id);
      if (!point || !londonBounds(number(point.lat), number(point.lon))) return [];
      return [{ ...station, lat: number(point.lat), lon: number(point.lon) }];
    });
    if (!stations.length) throw new ProviderError('invalid-data', 'London station data is unavailable. Please try again.');
    return stations;
  }

  async function venues(station: Station, guests: Guest[], dinner: Dinner, allowUnverifiedPrice = false): Promise<Restaurant[]> {
    if (mode === 'fixture') return rankRestaurants(fixtureVenues(station, dinner, now()), guests, dinner, allowUnverifiedPrice);
    const query = `[out:json][timeout:8];nwr[amenity=restaurant](around:750,${station.lat},${station.lon});out center 60;`;
    const load = async (): Promise<unknown[]> => {
      const data = object(await request(new URL('https://overpass-api.de/api/interpreter'), {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AgentMeet/0.1 (London dinner planner)' },
        body: new URLSearchParams({ data: query }).toString(),
      }));
      if (data.remark) throw new ProviderError('unavailable', 'Restaurant search did not complete. Please try again.');
      if (!Array.isArray(data.elements)) throw new ProviderError('invalid-data', 'Restaurant data is unavailable. Please try again.');
      return data.elements;
    };
    // Only public raw station-area facts are shared. Apply each group's private filters afresh.
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ProviderError('unavailable', 'Live planning took too long. Please try again.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let elements: unknown[];
    try {
      elements = await Promise.race([
        venueCache ? venueCache.get(query, load) : load(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProviderError('unavailable', 'Live planning took too long. Please try again.')), remaining); }),
      ]);
    } finally { clearTimeout(timer); }
    const restaurants = elements.map(value => restaurantFromOsm(value, station, guests)).filter((value): value is Venue => value !== null);
    return rankRestaurants(restaurants, guests, dinner, allowUnverifiedPrice);
  }

  function journey(origin: Location | Station, destination: Location | Station, when: Date, direction: 'arriving' | 'departing'): Promise<number | null> {
    if (origin.lat === destination.lat && origin.lon === destination.lon) return Promise.resolve(0);
    const parameters = londonJourneyParameters(when);
    const url = tflUrl(`/Journey/JourneyResults/${origin.lat},${origin.lon}/to/${destination.lat},${destination.lon}`, {
      ...parameters, timeIs: direction, journeyPreference: 'leasttime', mode: 'bus,overground,national-rail,tube,dlr,elizabeth-line,tram,walking', nationalSearch: 'false',
    });
    const key = `${url.pathname}:${parameters.date}:${parameters.time}:${direction}`;
    let result = journeyRequests.get(key);
    if (!result) {
      result = readJourney(url);
      journeyRequests.set(key, result);
    }
    return result;
  }

  async function readJourney(url: URL): Promise<number | null> {
    const response = await request(url);
    if (response === null) throw new ProviderError('unavailable', 'Journey data is unavailable. Please try again.');
    const data = object(response);
    if (list(object(data.fromLocationDisambiguation).disambiguationOptions).length || list(object(data.toLocationDisambiguation).disambiguationOptions).length) {
      throw new ProviderError('invalid-data', 'A starting point could not be resolved for travel. Please check your location.');
    }
    if (!Array.isArray(data.journeys)) throw new ProviderError('invalid-data', 'Journey data is incomplete. Please try again.');
    const times = data.journeys.map(value => number(object(value).duration)).filter(value => value > 0 && value <= 720);
    if (data.journeys.length && !times.length) throw new ProviderError('invalid-data', 'Journey durations are missing. Please try again.');
    return times.length ? Math.min(...times) : null;
  }

  async function recommendAreas(dinner: Dinner): Promise<Area[]> {
    if (dinner.dataMode !== mode) throw new ProviderError('unavailable', 'This dinner was created in a different data mode. Restore its original mode or create a new dinner.');
    const guests = attending(dinner), start = selectedTime(dinner), end = new Date(start.getTime() + dinner.duration * 60_000);
    if (mode === 'live') {
      const daysAhead = (end.getTime() - now().getTime()) / 86_400_000;
      if (start < now() || daysAhead > 30) throw new ProviderError('unsupported-date', 'Live travel planning currently supports future dinners within 30 days. Choose a nearer date.');
    }
    const stations = mode === 'fixture' ? CANDIDATE_STATIONS.slice(0, 3) : await liveStations();
    const areas = await Promise.all(stations.map(async station => {
      const journeys = await Promise.all(guests.map(async guest => {
        const location = guest.reply!.location!;
        if (mode === 'fixture') {
          const distance = Math.hypot((location.lat - station.lat) * 111, (location.lon - station.lon) * 69);
          const outbound = Math.max(8, Math.round(10 + distance * 3.2));
          return { guestId: guest.id, outbound, homeward: outbound + 4 };
        }
        const outbound = await journey(location, station, start, 'arriving');
        if (outbound === null) return null;
        const homeward = await journey(station, location, end, 'departing');
        return homeward === null ? null : { guestId: guest.id, outbound, homeward };
      }));
      if (journeys.some(value => value === null)) return null;
      const complete = journeys as Journey[];
      const longest = Math.max(...complete.flatMap(value => [value.outbound, value.homeward]));
      return {
        ...station, journeys: complete, longest,
        explanation: mode === 'fixture' ? `Example travel data. Longest example journey: ${longest} minutes.`
          : `Longest estimated trip: ${longest} minutes. Ranked across outward and return journeys. Nearby restaurants need organiser verification. Transport for London / © OpenStreetMap contributors.`,
      };
    }));
    const ranked = rankAreas(areas.filter((value): value is Area => value !== null));
    const eligible: Area[] = [];
    // Check the fairest areas first to avoid querying restaurants for every candidate.
    for (let index = 0; index < ranked.length && eligible.length < 3; index += 3) {
      const batch = await Promise.all(ranked.slice(index, index + 3).map(async area => {
        const candidates = await venues(area, guests, dinner, true);
        if (!candidates.length) return null;
        if (dinner.experience === 'v2' && !candidates.some(venue => matchesBudget(venue, dinner))) {
          return { ...area, explanation: `${area.explanation} Nearby restaurant prices are unverified: no verified ${effectiveBudgetBand(dinner)} price match. Organiser verification or a manual venue is required.` };
        }
        return area;
      }));
      eligible.push(...batch.filter((value): value is Area => value !== null));
    }
    return eligible.slice(0, 3);
  }

  async function restaurantSuggestions(dinner: Dinner): Promise<Restaurant[]> {
    if (dinner.dataMode !== mode) throw new ProviderError('unavailable', 'This dinner was created in a different data mode. Restore its original mode or create a new dinner.');
    const guests = attending(dinner), station = dinner.areas.find(area => area.id === dinner.selectedAreaId);
    if (!station) throw new ProviderError('invalid-data', 'Choose a meeting area before finding restaurants.');
    return venues(station, guests, dinner);
  }

  return { resolveLocation, recommendAreas, restaurantSuggestions };
}

export const resolveLocation = (input: string): Promise<Location> => createProviders().resolveLocation(input);
export const recommendAreas = (dinner: Dinner): Promise<Area[]> => createProviders().recommendAreas(dinner);
export const restaurantSuggestions = (dinner: Dinner): Promise<Restaurant[]> => createProviders().restaurantSuggestions(dinner);
