import { newDinner } from '../src/lib/domain';
import { createProviders, ProviderError } from '../src/lib/providers';

// An explicit opt-in public-coordinate check. No database, email or participant input.
const args = process.argv.slice(2);
if (!args.includes('--live') || args.some(value => !['--live', '--full'].includes(value))) {
  console.error('Usage: pnpm providers:smoke --live [--full]');
  console.error('The default checks one public London origin. --full also requests outward/return travel and station-area restaurant candidates for one synthetic guest.');
  process.exitCode = 1;
} else {
  let stage = 'location';
  try {
    const location = await createProviders({ mode: 'live' }).resolveLocation('SW1A 1AA');
    console.log(JSON.stringify({ stage, status: 'ok', source: location.source }));
    if (args.includes('--full')) {
      const now = Date.now();
      const dinner = newDinner({
        title: 'Public provider smoke check', hostName: 'Synthetic organiser', names: ['Synthetic guest'], mode: 'fixed', duration: 120,
        fixedStart: new Date(now + 7 * 86_400_000).toISOString(), deadline: new Date(now + 86_400_000).toISOString(),
      }, 'smoke-only-no-access');
      dinner.dataMode = 'live';
      dinner.selectedStart = dinner.fixedStart;
      dinner.includedIds = [dinner.guests[0].id];
      dinner.guests[0].reply = { attending: true, location, availability: [], diets: [], otherDiet: '', cuisines: {} };
      stage = 'areas';
      dinner.areas = await createProviders({ mode: 'live' }).recommendAreas(dinner);
      console.log(JSON.stringify({ stage, status: dinner.areas.length ? 'ok' : 'no-eligible-areas', count: dinner.areas.length }));
      if (!dinner.areas.length) process.exitCode = 1;
      else {
        stage = 'restaurants';
        dinner.selectedAreaId = dinner.areas[0].id;
        const venues = await createProviders({ mode: 'live' }).restaurantSuggestions(dinner);
        console.log(JSON.stringify({ stage, status: venues.length ? 'manual-check-required' : 'no-candidates', count: venues.length, unknownPriceCount: venues.filter(venue => venue.price === 'unknown').length }));
        if (!venues.length) process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ stage, status: 'failed', code: error instanceof ProviderError ? error.code : 'unexpected-error', ...(error instanceof ProviderError ? { service: error.service, message: error.message } : {}) }));
    process.exitCode = 1;
  }
}
