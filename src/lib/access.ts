import 'server-only';
import { cookies } from 'next/headers';
import type { Dinner } from './model';
import { readDinner } from './store';
import { insist } from './domain';
import { guestCookie, hostCookie, matches, digest } from './security';
import { db } from './db';
import { currentAccount, accountActor, type AccountIdentity } from './accounts';

export async function credentials(id: string) {
  const jar = await cookies();
  return { host: jar.get(hostCookie(id))?.value, guest: jar.get(guestCookie(id))?.value, account: await currentAccount() };
}
export function actorFor(dinner: Dinner, raw: { host?: string; guest?: string; account?: AccountIdentity }) {
  if (dinner.identityMode === 'account') return accountActor(dinner, raw.account);
  return { organiser: matches(raw.host, dinner.hostHash), guestId: dinner.guests.find(g => matches(raw.guest, g.claimHash))?.id };
}
export async function requireGuest(slug: string) {
  const dinner = await readDinner(slug); insist(dinner, 'Dinner not found or expired.');
  const actor = actorFor(dinner, await credentials(slug));
  const guest = dinner.guests.find(g => g.id === actor.guestId); insist(guest, 'Claim your guest name first.');
  return { dinner, guest };
}
export async function hasPilotAccess() {
  const raw = (await cookies()).get('am_pilot')?.value;
  if (!raw || !process.env.DATABASE_URL) return false;
  const rows = await db()`SELECT hash FROM pilot_access WHERE hash = ${digest(raw)} AND expires_at > now() AND revoked_at IS NULL`;
  return !!rows.length;
}
