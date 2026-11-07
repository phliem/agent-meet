import { z } from 'zod';
import type { Dinner } from './model';
import { ensureReplyOpen, insist } from './domain';
import { digest, matches, token } from './security';

export type AccountIdentity = { id: string; email: string };
export const accountCookie = 'am_account';
export const accountCookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };
export function normaliseEmail(value: unknown) {
  const result = z.string().trim().toLowerCase().email().max(254).safeParse(value);
  insist(result.success, 'Enter a valid email address.');
  return result.data;
}
function providerConfig() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  insist(url && key, 'Email sign-in is not configured. Ask the organiser to contact the service owner.');
  insist(new URL(url).protocol === 'https:', 'Email sign-in requires a secure provider.');
  return { url: url.replace(/\/$/, ''), key };
}
export async function providerRequest(path: string, body?: unknown, accessToken?: string) {
  const { url, key } = providerConfig();
  const response = await fetch(url + '/auth/v1/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { apikey: key, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(10000) });
  insist(response.ok, 'Email verification failed or expired. Request a fresh code and try again.');
  return response.status === 204 ? {} : await response.json();
}
export function verifiedIdentity(user: unknown): AccountIdentity {
  const parsed = z.object({ id: z.string().min(1), email: z.string().email(), email_confirmed_at: z.string().min(1), is_anonymous: z.boolean().optional() }).safeParse(user);
  insist(parsed.success && !parsed.data.is_anonymous, 'A verified email account is required.');
  return { id: parsed.data.id, email: normaliseEmail(parsed.data.email) };
}
// Always consult the provider; a decoded JWT or browser cookie alone is not identity.
export async function currentAccount(): Promise<AccountIdentity | undefined> {
  const [{ cookies }, { db }] = await Promise.all([import('next/headers'), import('./db')]);
  const raw = (await cookies()).get(accountCookie)?.value;
  if (!raw || !process.env.DATABASE_URL) return undefined;
  const rows = await db()`SELECT s.access_token, a.id, a.email FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.hash=${digest(raw)} AND s.expires_at>now() AND a.disabled_at IS NULL`;
  if (!rows[0]) return undefined;
  try {
    const identity = verifiedIdentity(await providerRequest('user', undefined, rows[0].access_token));
    if (identity.id !== rows[0].id || identity.email !== rows[0].email) return undefined;
    return identity;
  } catch { return undefined; }
}
export async function requireAccount() {
  const account = await currentAccount(); insist(account, 'Sign in with your verified email to continue.'); return account;
}
export function accountActor(dinner: Dinner, account?: AccountIdentity) {
  return { organiser: !!account && account.id === dinner.organiserAccountId, guestId: account ? dinner.guests.find(g => g.accountId === account.id)?.id : undefined };
}
export function issueInvitation(dinner: Dinner, guestId: string, now = Date.now()) {
  insist(dinner.identityMode === 'account', 'Personal invitations are only available for account dinners.');
  ensureReplyOpen(dinner, now);
  const guest = dinner.guests.find(g => g.id === guestId);
  insist(guest && !guest.accountId, 'Reset the guest before replacing their invitation.');
  guest.invitationEmail = normaliseEmail(guest.invitationEmail);
  const raw = token();
  guest.invitationGeneration = (guest.invitationGeneration ?? 0) + 1;
  guest.invitationHash = digest(raw);
  guest.invitationExpiresAt = new Date(Math.min(now + 7 * 86400000, Date.parse(dinner.deadline), Date.parse(dinner.expiresAt))).toISOString();
  return { guestId: guest.id, name: guest.name, url: '/join/' + raw + '?dinner=' + encodeURIComponent(dinner.id) };
}
export function revokeInvitation(dinner: Dinner, guestId: string) {
  const guest = dinner.guests.find(g => g.id === guestId); insist(guest, 'Guest not found.');
  guest.invitationHash = undefined; guest.invitationExpiresAt = undefined;
  guest.invitationGeneration = (guest.invitationGeneration ?? 0) + 1;
}
export function claimInvitation(dinner: Dinner, raw: string, account: AccountIdentity, now = Date.now()) {
  insist(dinner.identityMode === 'account', 'This is not an account dinner.');
  ensureReplyOpen(dinner, now);
  insist(typeof raw === 'string' && raw.length >= 32 && raw.length <= 100, 'Invalid personal invitation.');
  const guest = dinner.guests.find(g => matches(raw, g.invitationHash));
  insist(guest && !guest.accountId && guest.invitationExpiresAt && Date.parse(guest.invitationExpiresAt) > now, 'This invitation is expired, revoked or already used.');
  insist(guest.invitationEmail === normaliseEmail(account.email), 'Sign in with the email address this personal invitation was sent to.');
  insist(!dinner.guests.some(g => g.accountId === account.id), 'This account already has a guest name for this dinner.');
  insist(!dinner.includedIds || dinner.includedIds.includes(guest.id), 'The organiser continued with other respondents.');
  guest.accountId = account.id; guest.claimHash = digest(token());
  revokeInvitation(dinner, guest.id);
  return guest.id;
}

/** A returning verified member can reopen the invitation after its token was consumed. */
export function acceptOrResumeInvitation(dinner: Dinner, raw: string, account: AccountIdentity, now = Date.now()) {
  insist(dinner.identityMode === 'account', 'This is not an account dinner.');
  const existing = dinner.guests.find(guest => guest.accountId === account.id);
  return existing ? existing.id : claimInvitation(dinner, raw, account, now);
}
