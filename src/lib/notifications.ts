import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { runReminders } from './reminders';
import type { Dinner, Guest } from './model';

export type EmailMessage = { to: string; subject: string; text: string };
export type EmailSender = (message: EmailMessage, key: string) => Promise<'sent' | 'fixture'>;
type Subscription = {
  id: string; scope: 'dinner' | 'waitlist'; dinner_id: string | null; guest_id: string | null;
  guest_claim_hash: string | null; email: string; verified_at: Date | null;
  created_at: Date; verification_expires_at: Date;
};
const accepted = { ok: true, message: 'If this address can be subscribed, a verification email will arrive shortly.' };
export const digestEmailToken = (token: string) => createHash('sha256').update(token).digest('hex');
const token = () => randomBytes(32).toString('base64url');

export function appUrl() {
  const origin = new URL(process.env.APP_URL || 'http://localhost:3000');
  const local = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1';
  if (origin.username || origin.password || origin.pathname !== '/' || (!local && origin.protocol !== 'https:')) throw new Error('Set APP_URL to your trusted HTTPS application origin.');
  if (process.env.NODE_ENV === 'production' && local) throw new Error('Set the deployed APP_URL before sending email.');
  return origin.origin;
}

function localEmailPreview() {
  const url = new URL(appUrl());
  return process.env.EMAIL_MODE === 'fixture' && process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname);
}

export function normalizeEmail(value: unknown) {
  return z.email().max(254).parse(typeof value === 'string' ? value.trim().toLowerCase() : value);
}

export function guestMayReceive(dinner: Dinner, guestId: string, claim: string, now = Date.now()) {
  const guest = dinner.guests.find(item => item.id === guestId);
  return new Date(dinner.expiresAt).getTime() > now && !!guest?.reply?.attending && guest.claimHash === claim
    && (!dinner.includedIds || dinner.includedIds.includes(guestId));
}

export function updateMessage(dinner: Dinner, kind: 'area-voting' | 'confirmed', email: string): EmailMessage {
  const link = appUrl() + '/d/' + encodeURIComponent(dinner.id);
  if (kind === 'area-voting') return { to: email, subject: 'Your dinner area vote is ready', text: 'Your group is ready to choose an area. Open your dinner link to vote for a favourite and any other areas you are happy with.\n\n' + link };
  const date = dinner.selectedStart ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(dinner.selectedStart)) : '';
  return { to: email, subject: 'Your dinner is confirmed', text: ['Your dinner is confirmed.', date ? date + ' (London time)' : '', dinner.restaurant?.name || '', dinner.restaurant?.address || '', '', 'See the confirmed details:', link].filter(Boolean).join('\n') };
}

async function requestLimit(key: string, max: number) {
  const result = await db()`INSERT INTO email_request_limits (key) VALUES (${digestEmailToken(key)})
    ON CONFLICT (key) DO UPDATE SET
      requests = CASE WHEN email_request_limits.window_start < now() - interval '1 hour' THEN 1 ELSE email_request_limits.requests + 1 END,
      window_start = CASE WHEN email_request_limits.window_start < now() - interval '1 hour' THEN now() ELSE email_request_limits.window_start END
    RETURNING requests`;
  if (result[0].requests > max) throw new Error('Please wait before trying again.');
}

async function register(scope: 'dinner' | 'waitlist', email: string, context?: { dinner: Dinner; guest: Guest }) {
  const sql = db();
  const identity = scope === 'dinner' ? context!.dinner.id + ':' + context!.guest.id : email;
  await requestLimit(scope + ':' + identity, 3);
  await requestLimit('address:' + email, 5);
  const verification = token();
  const unsubscribe = token();
  const verificationUrl = appUrl() + '/api/email/verify?token=' + verification;
  const unsubscribeUrl = appUrl() + '/api/email/unsubscribe?token=' + unsubscribe;
  let created = false;
  await sql.begin(async tx => {
    // Serialise competing registration requests for the same guest/address.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${scope + ':' + identity}, 0))`;
    if (context) {
      const rows = await tx`SELECT document FROM dinners WHERE id = ${context.dinner.id} FOR SHARE`;
      const current = rows[0]?.document as Dinner | undefined;
      if (!current || !guestMayReceive(current, context.guest.id, context.guest.claimHash || '')) throw new Error('Submit an attending reply before requesting dinner updates.');
    }
    const prior = scope === 'dinner'
      ? await tx<Subscription[]>`SELECT * FROM email_subscriptions WHERE dinner_id = ${context!.dinner.id} AND guest_id = ${context!.guest.id} FOR UPDATE`
      : await tx<Subscription[]>`SELECT * FROM email_subscriptions WHERE scope = 'waitlist' AND email = ${email} FOR UPDATE`;
    if (prior[0] && ((prior[0].email === email && (prior[0].verified_at || new Date(prior[0].verification_expires_at).getTime() > Date.now())) || Date.now() - new Date(prior[0].created_at).getTime() < 600_000)) return;
    if (prior[0]) await tx`DELETE FROM email_subscriptions WHERE id = ${prior[0].id}`;
    const id = randomUUID();
    await tx`INSERT INTO email_subscriptions
      (id, scope, dinner_id, guest_id, guest_claim_hash, email, verification_hash, verification_expires_at, unsubscribe_hash)
      VALUES (${id}, ${scope}, ${context?.dinner.id || null}, ${context?.guest.id || null}, ${context?.guest.claimHash || null}, ${email}, ${digestEmailToken(verification)}, ${new Date(Date.now() + 24 * 60 * 60_000)}, ${digestEmailToken(unsubscribe)})`;
    const message: EmailMessage = {
      to: email,
      subject: scope === 'dinner' ? 'Confirm your Agent Meet dinner updates' : 'Confirm your Agent Meet creator waitlist signup',
      text: (scope === 'dinner' ? 'Confirm this address to receive an update when area voting opens and when this dinner is confirmed.' : 'Confirm this address to join the creator waitlist. This records your interest and does not grant organiser access.') + '\n\n' + verificationUrl + '\n\nRemove this signup: ' + unsubscribeUrl
    };
    await tx`INSERT INTO email_outbox (id, subscription_id, event_key, kind, payload)
      VALUES (${randomUUID()}, ${id}, ${'verify:' + id}, 'verification', ${tx.json({ ...message, unsubscribeUrl })})`;
    created = true;
  });
  if (created) await dispatchOutbox(1);
  return { ...accepted, ...(created && localEmailPreview() ? { verificationUrl, message: 'Local email preview only. Open the verification link to test signup; no email was sent.' } : {}) };
}

export async function subscribeDinner(context: { dinner: Dinner; guest: Guest }, value: unknown) {
  if (!context.guest.claimHash || !guestMayReceive(context.dinner, context.guest.id, context.guest.claimHash)) throw new Error('Submit an attending reply before requesting dinner updates.');
  return register('dinner', normalizeEmail(value), context);
}

export async function joinWaitlist(value: unknown, requestKey = 'unknown') {
  await requestLimit('waitlist-client:' + requestKey, 10);
  return register('waitlist', normalizeEmail(value));
}

export async function verifySubscription(value: unknown) {
  const input = z.string().min(32).max(128).parse(value);
  const sql = db();
  return sql.begin(async tx => {
    const initial = await tx<Subscription[]>`SELECT * FROM email_subscriptions WHERE verification_hash = ${digestEmailToken(input)}`;
    if (initial[0]?.dinner_id) await tx`SELECT id FROM dinners WHERE id = ${initial[0].dinner_id} FOR SHARE`;
    const rows = await tx<Subscription[]>`SELECT * FROM email_subscriptions WHERE verification_hash = ${digestEmailToken(input)} FOR UPDATE`;
    const subscription = rows[0];
    if (!subscription || subscription.verified_at || new Date(subscription.verification_expires_at).getTime() <= Date.now()) return false;
    if (subscription.scope === 'dinner') {
      const dinner = await tx`SELECT document FROM dinners WHERE id = ${subscription.dinner_id!} FOR SHARE`;
      if (!dinner[0] || !guestMayReceive(dinner[0].document as Dinner, subscription.guest_id!, subscription.guest_claim_hash!)) return false;
    }
    await tx`UPDATE email_subscriptions SET verified_at = now() WHERE id = ${subscription.id}`;
    return true;
  });
}

export async function unsubscribe(value: unknown) {
  const input = z.string().min(32).max(128).parse(value);
  // Delete rather than retaining private email data after withdrawal.
  await db()`DELETE FROM email_subscriptions WHERE unsubscribe_hash = ${digestEmailToken(input)}`;
}

export const resendSender: EmailSender = async (message, key) => {
  if (process.env.EMAIL_MODE === 'fixture') return 'fixture';
  if (process.env.EMAIL_MODE !== 'live' || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('Email delivery is not configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, ...message }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error('Email provider rejected delivery.');
  const payload = await response.json();
  if (typeof payload.id !== 'string') throw new Error('Email provider returned an invalid response.');
  return 'sent';
};

async function materializeUpdates() {
  const sql = db();
  const pending = await sql`SELECT e.id AS event_id, e.kind, e.created_at AS event_at, s.id AS subscription_id, s.email, s.guest_id, s.guest_claim_hash, d.document
    FROM dinner_events e JOIN email_subscriptions s ON s.dinner_id = e.dinner_id
    JOIN dinners d ON d.id = e.dinner_id
    WHERE s.verified_at IS NOT NULL AND s.verified_at <= e.created_at
    AND NOT EXISTS (SELECT 1 FROM email_outbox o WHERE o.event_key = e.id || ':' || s.id)
    ORDER BY e.created_at LIMIT 100`;
  for (const row of pending) {
    const dinner = row.document as Dinner;
    if (!guestMayReceive(dinner, row.guest_id, row.guest_claim_hash)) continue;
    const kind = row.kind as 'area-voting' | 'confirmed';
    const message = updateMessage(dinner, kind, row.email);
    // Unsubscribe token is only known in the verification outbox. Reuse that URL without putting it in a public read model.
    const verification = await sql`SELECT payload FROM email_outbox WHERE subscription_id = ${row.subscription_id} AND kind = 'verification' LIMIT 1`;
    const unsubscribeUrl = verification[0]?.payload?.unsubscribeUrl;
    if (typeof unsubscribeUrl !== 'string') continue;
    await sql`INSERT INTO email_outbox (id, subscription_id, event_key, kind, payload)
      VALUES (${randomUUID()}, ${row.subscription_id}, ${row.event_id + ':' + row.subscription_id}, ${kind}, ${sql.json({ ...message, text: message.text + '\n\nStop these updates: ' + unsubscribeUrl })}) ON CONFLICT (event_key) DO NOTHING`;
  }
}

export async function dispatchOutbox(limit = 10, send: EmailSender = resendSender, deadline = Infinity) {
  const sql = db();
  const counts = { sent: 0, fixture: 0, suppressed: 0, retried: 0 };
  for (let n = 0; n < limit; n++) {
    if (Date.now() + 10_000 > deadline) break;
    const handled = await sql.begin(async tx => {
      const candidates = await tx`SELECT o.id, o.subscription_id, s.dinner_id FROM email_outbox o JOIN email_subscriptions s ON s.id = o.subscription_id WHERE o.status = 'pending' AND o.available_at <= now() ORDER BY o.created_at LIMIT 1`;
      const candidate = candidates[0];
      if (!candidate) return false;
      // Match reset's lock order: dinner, subscription, then outbox.
      const records = candidate.dinner_id ? await tx`SELECT document FROM dinners WHERE id = ${candidate.dinner_id} FOR SHARE` : [];
      const subscriptions = await tx<Subscription[]>`SELECT * FROM email_subscriptions WHERE id = ${candidate.subscription_id} FOR SHARE`;
      const subscription = subscriptions[0];
      const jobs = await tx`SELECT * FROM email_outbox WHERE id = ${candidate.id} AND status = 'pending' FOR UPDATE SKIP LOCKED`;
      const job = jobs[0];
      if (!job) return true;
      let eligible = !!subscription;
      if (subscription?.scope === 'dinner') {
        const dinner = records[0]?.document as Dinner | undefined;
        eligible = !!dinner && guestMayReceive(dinner, subscription.guest_id!, subscription.guest_claim_hash!);
        if (eligible && job.kind !== 'verification') {
          eligible = !!subscription.verified_at && dinner!.stage === job.kind;
          if (job.kind === 'area-voting' && dinner!.guests.find(guest => guest.id === subscription.guest_id)?.ballot) eligible = false;
        }
      }
      if (subscription && job.kind === 'verification') eligible = eligible && !subscription.verified_at && new Date(subscription.verification_expires_at).getTime() > Date.now();
      const tooOld = Date.now() - new Date(job.created_at).getTime() > 12 * 60 * 60_000;
      if (!eligible || tooOld) {
        const retained = job.kind === 'verification' && typeof job.payload.unsubscribeUrl === 'string' ? { unsubscribeUrl: job.payload.unsubscribeUrl } : {};
        await tx`UPDATE email_outbox SET status = 'suppressed', payload = ${tx.json(retained)} WHERE id = ${job.id}`;
        counts.suppressed++;
        return true;
      }
      const message = job.payload as EmailMessage;
      if (Date.now() + 10_000 > deadline) return false;
      try {
        const status = await send({ to: message.to, subject: message.subject, text: message.text }, 'agent-meet/' + job.id);
        // Keep verification's unsubscribe link for subsequent updates; retain no message body in delivery records.
        const retained = job.kind === 'verification' ? { unsubscribeUrl: job.payload.unsubscribeUrl } : {};
        await tx`UPDATE email_outbox SET status = ${status}, sent_at = now(), payload = ${tx.json(retained)}, attempts = attempts + 1 WHERE id = ${job.id}`;
        counts[status]++;
      } catch {
        const attempts = job.attempts + 1;
        await tx`UPDATE email_outbox SET status = ${attempts >= 6 ? 'failed' : 'pending'}, attempts = ${attempts}, available_at = ${new Date(Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** attempts))} WHERE id = ${job.id}`;
        counts.retried++;
      }
      return true;
    });
    if (!handled) break;
  }
  return counts;
}

export async function runJobs(options: { send?: EmailSender; limit?: number } = {}) {
  const limit = Math.max(0, Math.min(options.limit ?? 4, 4));
  const deadline = Date.now() + 45_000;
  await materializeUpdates();
  const result = await dispatchOutbox(limit, options.send, deadline);
  const used = Object.values(result).reduce((sum, count) => sum + count, 0);
  const reminders = await runReminders(options.send ?? resendSender, appUrl(), Math.max(0, limit - used), Date.now, deadline);
  await db()`DELETE FROM account_sessions WHERE expires_at <= now()`;
  await db()`DELETE FROM dinners WHERE expires_at <= now()`;
  await db()`DELETE FROM email_subscriptions WHERE scope = 'waitlist' AND verified_at IS NULL AND verification_expires_at <= now()`;
  await db()`DELETE FROM email_request_limits WHERE window_start < now() - interval '1 day'`;
  return { ...result, reminders };
}

export function jobsAuthorised(authorization: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24 || !authorization) return false;
  const expected = Buffer.from('Bearer ' + secret);
  const supplied = Buffer.from(authorization);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
