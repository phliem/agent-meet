'use server';

import { cookies } from 'next/headers';
import { after } from 'next/server';
import { z } from 'zod';
import { actorFor, credentials, hasPilotAccess } from './access';
import { applyCommand, applyReply, ensureReplyOpen, insist, installAreas, installRestaurants, newDinner, parseReply, UserError } from './domain';
import { readDinner, insertDinner, changeDinner } from './store';
import { token, digest, matches, cookieOptions, guestCookie, hostCookie } from './security';
import { db } from './db';
import { sharedSlots } from './time';
import { googleCalendarUrl } from './calendar';
import { recommendAreas, resolveLocation, restaurantSuggestions } from './providers';
import { runJobs } from './notifications';
import type { ActionResult, DinnerView } from './model';

function failure(error: unknown): ActionResult {
  if (error instanceof UserError) return { ok: false, error: error.message };
  // External adapter failures can be exposed only after the adapter sanitises them.
  if (error instanceof Error && error.name === 'ProviderError') return { ok: false, error: error.message };
  console.error('Dinner operation failed', error instanceof Error ? error.name : 'unknown');
  return { ok: false, error: 'Unable to complete this action. Check the service configuration and try again.' };
}
function scheduleProgress(id: string) {
  after(async () => {
    try {
      let dinner = await readDinner(id);
      if (dinner?.stage === 'recommending') {
        const version = dinner.version;
        const areas = await recommendAreas(dinner);
        await changeDinner(id, d => installAreas(d, areas), { expectedVersion: version });
      }
      dinner = await readDinner(id);
      if (dinner?.stage === 'choosing-restaurant' && !dinner.restaurants.length && !dinner.restaurant) {
        const version = dinner.version;
        const venues = await restaurantSuggestions(dinner);
        await changeDinner(id, d => installRestaurants(d, venues), { expectedVersion: version });
      }
    } catch {
      // The state remains recoverable through the organiser's explicit retry.
      console.error('Recommendation deferred. The organiser can retry.');
    }
    try { await runJobs(); } catch { console.error('Email delivery deferred.'); }
  });
}
export async function homeContext() {
  return { canCreate: await hasPilotAccess(), fixtureMode: process.env.DATA_MODE !== 'live' };
}
export async function createDinner(input: unknown): Promise<ActionResult> {
  try {
    insist(await hasPilotAccess(), 'V1 hosting is invite-only. Join the creator waitlist to request access.');
    const raw = token(); const dinner = newDinner(input, digest(raw)); await insertDinner(dinner);
    (await cookies()).set(hostCookie(dinner.id), raw, cookieOptions);
    return { ok: true, url: '/d/' + dinner.id };
  } catch (error) { return failure(error); }
}
export async function redeemPilot(raw: string): Promise<ActionResult> {
  try {
    insist(typeof raw === 'string' && raw.length >= 32 && raw.length <= 100, 'Invalid organiser invitation.');
    const access = token();
    await db().begin(async tx => {
      const rows = await tx`UPDATE pilot_invites SET redeemed_at = now() WHERE hash = ${digest(raw)} AND redeemed_at IS NULL AND expires_at > now() RETURNING hash`;
      insist(rows.length, 'That invitation is invalid, expired or already used.');
      await tx`INSERT INTO pilot_access (hash, expires_at) VALUES (${digest(access)}, now() + interval '90 days')`;
    });
    (await cookies()).set('am_pilot', access, cookieOptions);
    return { ok: true, url: '/', message: 'Organiser access activated in this browser.' };
  } catch (error) { return failure(error); }
}
export async function loadDinner(id: string): Promise<DinnerView | null> {
  const dinner = await readDinner(id); if (!dinner) return null;
  const actor = actorFor(dinner, await credentials(id));
  const mine = dinner.guests.find(g => g.id === actor.guestId);
  const { hostHash: _hostHash, guests: _guests, ...publicDinner } = dinner;
  void _hostHash; void _guests;
  return { ...publicDinner, guests: dinner.guests.map(g => ({ id: g.id, name: g.name, taken: !!g.claimHash, status: !g.reply ? 'waiting' : g.reply.attending ? 'replied' : 'declined', voted: !!g.ballot })), organiser: actor.organiser, guest: mine ? { id: mine.id, name: mine.name, reply: mine.reply, ballot: mine.ballot } : null, slots: dinner.stage === 'choosing-time' ? sharedSlots(dinner) : [], canReply: ['collecting', 'choosing-time', 'recommending'].includes(dinner.stage) && Date.now() < Date.parse(dinner.deadline) && (!dinner.includedIds || !!mine && dinner.includedIds.includes(mine.id)), googleCalendarUrl: dinner.stage === 'confirmed' ? googleCalendarUrl(dinner) : undefined };
}
export async function dinnerAction(id: string, input: unknown): Promise<ActionResult> {
  try {
    const p = z.object({ type: z.string() }).passthrough().safeParse(input); insist(p.success, 'Unknown action.');
    const c = p.data; const raw = await credentials(id); let issued: string | undefined;
    if (c.type === 'claim') {
      issued = token(); const claim = issued;
      await changeDinner(id, d => {
        ensureReplyOpen(d); insist(!d.includedIds || d.includedIds.includes(String(c.guestId)), 'The organiser continued with other respondents.');
        insist(!d.guests.some(g => matches(raw.guest, g.claimHash)), 'This browser already has a guest name for this dinner.');
        const guest = d.guests.find(g => g.id === c.guestId); insist(guest && !guest.claimHash, 'That name is already taken.'); guest.claimHash = digest(claim);
      });
      (await cookies()).set(guestCookie(id), issued, cookieOptions);
    } else if (c.type === 'reply') {
      const snapshot = await readDinner(id); insist(snapshot, 'Dinner not found.');
      const actor = actorFor(snapshot, raw); insist(actor.guestId, 'Claim your guest name first.'); ensureReplyOpen(snapshot);
      insist(snapshot.dataMode === (process.env.DATA_MODE === 'live' ? 'live' : 'fixture'), 'This dinner uses a different data mode. Restore that mode before changing its reply.');
      const reply = parseReply(c.reply, snapshot);
      const location = reply.attending ? await resolveLocation(reply.origin!) : undefined;
      await changeDinner(id, d => applyReply(d, actorFor(d, raw), reply, location), { expectedVersion: snapshot.version });
      if (!reply.attending) await db()`DELETE FROM email_subscriptions WHERE dinner_id = ${id} AND guest_id = ${actor.guestId}`;
    } else if (c.type === 'recommend') {
      const snapshot = await readDinner(id); insist(snapshot, 'Dinner not found.'); insist(actorFor(snapshot, raw).organiser, 'Only the organiser can get recommendations.');
      const areas = await recommendAreas(snapshot);
      await changeDinner(id, d => { insist(actorFor(d, raw).organiser, 'Organiser access is required.'); installAreas(d, areas); }, { expectedVersion: snapshot.version });
    } else if (c.type === 'restaurants') {
      const snapshot = await readDinner(id); insist(snapshot, 'Dinner not found.'); insist(actorFor(snapshot, raw).organiser, 'Only the organiser can get restaurants.');
      const venues = await restaurantSuggestions(snapshot);
      await changeDinner(id, d => { insist(actorFor(d, raw).organiser, 'Organiser access is required.'); installRestaurants(d, venues); }, { expectedVersion: snapshot.version });
    } else {
      await changeDinner(id, d => applyCommand(d, actorFor(d, raw), c), c.type === 'reset' && typeof c.guestId === 'string' ? { resetGuestId: c.guestId } : undefined);
    }
    scheduleProgress(id);
    return { ok: true };
  } catch (error) { return failure(error); }
}
