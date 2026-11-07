import { db } from './db';
import { digest, token } from './security';
import { readDinner, changeDinner } from './store';
import { installAreas, installRestaurants } from './domain';
import { effectiveBudgetBand } from './v2-restaurants';
import { recommendAreas, restaurantSuggestions } from './providers';
import type { Area, Dinner, Restaurant } from './model';

type Planner = {
  areas: (dinner: Dinner) => Promise<Area[]>;
  restaurants: (dinner: Dinner) => Promise<Restaurant[]>;
};
const livePlanner: Planner = { areas: recommendAreas, restaurants: restaurantSuggestions };

/** One provider operation per dinner, including simultaneous clicks and background callbacks. */
export async function planDinner(id: string, kind: 'areas' | 'restaurants', planner = livePlanner) {
  const sql = db();
  const owner = digest(token());
  const lease = await sql`INSERT INTO planning_leases(dinner_id,owner_hash,expires_at)
    VALUES (${id},${owner},now()+interval '60 seconds')
    ON CONFLICT(dinner_id) DO UPDATE SET owner_hash=EXCLUDED.owner_hash,expires_at=EXCLUDED.expires_at
    WHERE planning_leases.expires_at < now() RETURNING dinner_id`;
  if (!lease.length) return false;
  try {
    const dinner = await readDinner(id);
    if (!dinner) return false;
    if (kind === 'areas') {
      if (dinner.stage !== 'recommending' || (dinner.experience === 'v2' && !effectiveBudgetBand(dinner))) return false;
      const areas = await planner.areas(dinner);
      await changeDinner(id, current => installAreas(current, areas), { expectedVersion: dinner.version });
    } else {
      if (dinner.stage !== 'choosing-restaurant') return false;
      const restaurants = await planner.restaurants(dinner);
      await changeDinner(id, current => installRestaurants(current, restaurants), { expectedVersion: dinner.version });
    }
    return true;
  } finally {
    await sql`DELETE FROM planning_leases WHERE dinner_id=${id} AND owner_hash=${owner}`;
  }
}
