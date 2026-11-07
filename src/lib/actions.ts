'use server';

import { cookies } from 'next/headers';
import { after } from 'next/server';
import { z } from 'zod';
import { actorFor, credentials, hasPilotAccess } from './access';
import { applyCommand, applyReply, ensureReplyOpen, insist, newDinner, parseReply, UserError } from './domain';
import { readDinner, insertDinner, changeDinner } from './store';
import { token, digest, matches, cookieOptions, guestCookie, hostCookie } from './security';
import { db } from './db';
import { sharedSlots } from './time';
import { googleCalendarUrl } from './calendar';
import { resolveLocation } from './providers';
import { planDinner } from './planning';
import { runJobs } from './notifications';
import type { ActionResult, DinnerView } from './model';
import { compatibleBudgetBands, restaurantRecommendation, effectiveBudgetBand } from './v2-restaurants';
import { accountCookie, accountCookieOptions, currentAccount, requireAccount, normaliseEmail, providerRequest, verifiedIdentity, disableAccountAccess, issueInvitation, revokeInvitation, acceptOrResumeInvitation } from './accounts';

function failure(error: unknown): ActionResult {
  if (error instanceof UserError) return { ok: false, error: error.message };
  // External adapter failures can be exposed only after the adapter sanitises them.
  if (error instanceof Error && error.name === 'ProviderError') return { ok: false, error: error.message };
  console.error('Dinner operation failed', error instanceof Error ? error.name : 'unknown');
  return { ok: false, error: 'Unable to complete this action. Check the service configuration and try again.' };
}
function scheduleProgress(id: string, deadline: number) {
  after(async () => {
    try {
      let dinner = await readDinner(id);
      if (Date.now() + 25_000 <= deadline && dinner?.stage === 'recommending' && (dinner.experience !== 'v2' || effectiveBudgetBand(dinner))) {
        await planDinner(id, 'areas');
      }
      dinner = await readDinner(id);
      if (Date.now() + 25_000 <= deadline && dinner?.stage === 'choosing-restaurant' && !dinner.restaurants.length && !dinner.restaurant) {
        await planDinner(id, 'restaurants');
      }
    } catch {
      // The state remains recoverable through the organiser's explicit retry.
      console.error('Recommendation deferred. The organiser can retry.');
    }
    try { await runJobs({ deadline }); } catch { console.error('Email delivery deferred.'); }
  });
}
export async function homeContext() {
  return { canCreate: await hasPilotAccess(), fixtureMode: process.env.DATA_MODE !== 'live', v2Enabled: process.env.ENABLE_V2 === 'true', account: (await currentAccount()) ? { signedIn: true } : null };
}
export async function createDinner(input: unknown): Promise<ActionResult> {
  try {
    insist(await hasPilotAccess(), 'V1 hosting is invite-only. Join the creator waitlist to request access.');
    const raw = token(); const dinner = newDinner(input, digest(raw));
    let invitationLinks: ActionResult['invitationLinks'];
    if (dinner.identityMode === 'account') {
      insist(process.env.ENABLE_V2 === 'true', 'New account dinners are not enabled.');
      dinner.organiserAccountId = (await requireAccount()).id;
      invitationLinks = dinner.guests.map(g => issueInvitation(dinner, g.id));
    }
    await insertDinner(dinner);
    (await cookies()).set(hostCookie(dinner.id), raw, cookieOptions);
    return { ok: true, url: '/d/' + dinner.id, invitationLinks };
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
  const recommendation = dinner.stage === 'choosing-restaurant' ? restaurantRecommendation(dinner) : {};
  const { hostHash: _hostHash, guests: _guests, organiserAccountId: _accountId, ...publicDinner } = dinner;
  void _hostHash; void _guests; void _accountId;
  return { ...publicDinner, recommendation: recommendation.recommendation, recommendationFallback: recommendation.fallbackReason, commonBudgetBands: compatibleBudgetBands(dinner), accountRequired: dinner.identityMode === 'account' && !mine && !actor.organiser, guests: dinner.guests.map(g => ({ id: g.id, name: g.name, taken: !!g.claimHash, status: !g.reply ? 'waiting' : g.reply.attending ? 'replied' : 'declined', voted: !!g.ballot })), organiser: actor.organiser, guest: mine ? { id: mine.id, name: mine.name, reply: mine.reply, ballot: mine.ballot } : null, slots: dinner.stage === 'choosing-time' ? sharedSlots(dinner) : [], canReply: ['collecting', 'choosing-time', 'recommending'].includes(dinner.stage) && Date.now() < Date.parse(dinner.deadline) && (!dinner.includedIds || !!mine && dinner.includedIds.includes(mine.id)), googleCalendarUrl: dinner.stage === 'confirmed' ? googleCalendarUrl(dinner) : undefined };
}
export async function dinnerAction(id: string, input: unknown): Promise<ActionResult> {
  // The page's 60-second function limit includes its after() callbacks. Keep a
  // shared budget from request entry rather than restarting it after planning.
  const deadline = Date.now() + 45_000;
  try {
    const p = z.object({ type: z.string() }).passthrough().safeParse(input); insist(p.success, 'Unknown action.');
    const c = p.data; const raw = await credentials(id); let issued: string | undefined;
    let invitationLinks: ActionResult['invitationLinks'];
    if (c.type === 'reminder-preference') {
      await changeDinner(id, d => {
        const actor = actorFor(d, raw); const guest = d.guests.find(g => g.id === actor.guestId);
        insist(d.identityMode === 'account' && raw.account && guest && typeof c.allowed === 'boolean', 'Sign in as this invited guest to change reminders.');
        guest.remindersAllowed = c.allowed;
      });
    } else if (c.type === 'issue-invite' || c.type === 'revoke-invite') {
      await changeDinner(id, d => {
        insist(actorFor(d, raw).organiser && d.identityMode === 'account', 'Only the account organiser can manage personal invitations.');
        insist(typeof c.guestId === 'string', 'Choose a guest.');
        if (c.type === 'issue-invite') invitationLinks = [issueInvitation(d, c.guestId)];
        else revokeInvitation(d, c.guestId);
      });
    } else if (c.type === 'claim') {
      issued = token(); const claim = issued;
      await changeDinner(id, d => {
        insist(d.identityMode !== 'account', 'Use your personal invitation and verified email for this dinner.');
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
      await changeDinner(id, d => applyReply(d, actorFor(d, raw), reply, location), { expectedVersion: snapshot.version, unsubscribeGuestId: !reply.attending ? actor.guestId : undefined });
    } else if (c.type === 'recommend') {
      const snapshot = await readDinner(id); insist(snapshot, 'Dinner not found.'); insist(actorFor(snapshot, raw).organiser, 'Only the organiser can get recommendations.');
      await planDinner(id, 'areas');
    } else if (c.type === 'restaurants') {
      const snapshot = await readDinner(id); insist(snapshot, 'Dinner not found.'); insist(actorFor(snapshot, raw).organiser, 'Only the organiser can get restaurants.');
      await planDinner(id, 'restaurants');
    } else {
      await changeDinner(id, d => { applyCommand(d, actorFor(d, raw), c); if (c.type === 'reset' && d.identityMode === 'account' && typeof c.guestId === 'string') { const g = d.guests.find(g => g.id === c.guestId); if (g) { g.accountId = undefined; g.remindersAllowed = false; revokeInvitation(d, g.id); } } }, c.type === 'reset' && typeof c.guestId === 'string' ? { unsubscribeGuestId: c.guestId } : undefined);
    }
    scheduleProgress(id, deadline);
    return { ok: true, invitationLinks };
  } catch (error) { return failure(error); }
}

export async function accountStatus() {
  const account = await currentAccount();
  return { signedIn: !!account, email: account?.email, configured: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY };
}
export async function requestSignIn(email: string): Promise<ActionResult> {
  try {
    const contact = normaliseEmail(email);
    const key = 'account-otp:' + digest(contact);
    const rows = await db()`INSERT INTO email_request_limits(key) VALUES (${key}) ON CONFLICT(key) DO UPDATE SET requests=CASE WHEN email_request_limits.window_start<now()-interval '1 hour' THEN 1 ELSE email_request_limits.requests+1 END,window_start=CASE WHEN email_request_limits.window_start<now()-interval '1 hour' THEN now() ELSE email_request_limits.window_start END RETURNING requests`;
    insist(rows[0].requests <= 5, 'Please wait before requesting another verification code.');
    await providerRequest('otp', { email: contact, create_user: true });
    return { ok: true, message: 'Check your email for your verification code.' };
  } catch (error) { return failure(error); }
}
export async function verifySignIn(email: string, code: string): Promise<ActionResult> {
  try {
    const contact = normaliseEmail(email);
    insist(typeof code === 'string' && /^\d{6,10}$/.test(code), 'Enter the verification code from your email.');
    const session = await providerRequest('verify', { email: contact, token: code, type: 'email' });
    insist(typeof session.access_token === 'string', 'Email verification failed.');
    const account = verifiedIdentity(await providerRequest('user', undefined, session.access_token));
    insist(account.email === contact, 'Email verification did not match.');
    const seconds = Math.min(Number(session.expires_in) || 3600, 3600);
    insist(seconds > 0, 'Your session expired. Request a fresh code.');
    const raw = token();
    await db().begin(async tx => {
      await tx`INSERT INTO accounts(id,email) VALUES (${account.id},${account.email}) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email WHERE accounts.disabled_at IS NULL`;
      const active = await tx`SELECT id FROM accounts WHERE id=${account.id} AND disabled_at IS NULL FOR UPDATE`;
      insist(active.length, 'This account is disabled.');
      await tx`INSERT INTO account_sessions(hash,account_id,access_token,expires_at) VALUES (${digest(raw)},${account.id},${session.access_token},${new Date(Date.now()+seconds*1000).toISOString()})`;
    });
    (await cookies()).set(accountCookie, raw, { ...accountCookieOptions, maxAge: seconds });
    return { ok: true, message: 'Signed in with your verified email.' };
  } catch (error) { return failure(error); }
}
export async function signOut(): Promise<ActionResult> {
  try {
    const jar = await cookies(), raw = jar.get(accountCookie)?.value;
    if (raw) await db()`DELETE FROM account_sessions WHERE hash=${digest(raw)}`;
    jar.set(accountCookie, '', { ...accountCookieOptions, maxAge: 0 });
    return { ok: true };
  } catch (error) { return failure(error); }
}
export async function disableAccount(): Promise<ActionResult> {
  try {
    const account = await requireAccount();
    await disableAccountAccess(account);
    (await cookies()).set(accountCookie, '', { ...accountCookieOptions, maxAge: 0 });
    return { ok: true, message: 'Account disabled on every device. Existing dinner contributions remain until dinner expiry.' };
  } catch (error) { return failure(error); }
}
export async function redeemPersonalInvitation(dinnerId: string, raw: string, remindersAllowed = false): Promise<ActionResult> {
  try {
    const account = await requireAccount();
    insist(typeof remindersAllowed === 'boolean', 'Choose whether to receive reply reminders.');
    await changeDinner(dinnerId, d => {
      const existing = d.guests.some(guest => guest.accountId === account.id);
      const id = acceptOrResumeInvitation(d, raw, account);
      if (!existing) d.guests.find(guest => guest.id === id)!.remindersAllowed = remindersAllowed;
    });
    return { ok: true, url: '/d/' + dinnerId };
  } catch (error) { return failure(error); }
}

export async function accountReminderPreference(dinnerId: string) {
  const dinner = await readDinner(dinnerId);
  if (!dinner || dinner.identityMode !== 'account') return null;
  const actor = actorFor(dinner, await credentials(dinnerId));
  const guest = dinner.guests.find(g => g.id === actor.guestId);
  return guest ? { allowed: guest.remindersAllowed === true, enabled: dinner.remindersEnabled === true } : null;
}
