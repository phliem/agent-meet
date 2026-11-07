import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { accountActor, acceptOrResumeInvitation, claimInvitation, disableAccountAccess, issueInvitation, normaliseEmail, revokeInvitation, verifiedIdentity } from '../src/lib/accounts';
import { newDinner } from '../src/lib/domain';
import { digest } from '../src/lib/security';
import { db } from '../src/lib/db';
import { dispatchOutbox, subscribeDinner } from '../src/lib/notifications';
const now = Date.parse('2026-11-07T12:00:00Z');
const alex = { id: 'provider-alex', email: 'alex@example.com' };
const kim = { id: 'provider-kim', email: 'kim@example.com' };
function setup() {
  const d = newDinner({ title: 'Dinner', hostName: 'Host', names: ['Alex', 'Kim'], mode: 'fixed', fixedStart: '2026-11-20T19:00:00Z', duration: 120, deadline: '2026-11-19T20:00:00Z' }, digest('old-browser-host'), new Date(now));
  d.identityMode = 'account'; d.experience = 'v2'; d.organiserAccountId = 'provider-host';
  d.guests[0].invitationEmail = alex.email; d.guests[1].invitationEmail = kim.email;
  return d;
}
function raw(url: string) { return url.split('/join/')[1].split('?')[0]; }
test('personal invitation rejects wrong verified email without consuming token', () => {
  const d = setup(), invitation = issueInvitation(d, d.guests[0].id, now);
  assert.throws(() => claimInvitation(d, raw(invitation.url), kim, now), /email address/);
  assert.equal(claimInvitation(d, raw(invitation.url), alex, now), d.guests[0].id);
  assert.ok(d.guests[0].claimHash, 'email delivery retains a private claim generation');
});
test('personal invitations expire, revoke, replace and are single use', () => {
  const d = setup(), guest = d.guests[0];
  const first = raw(issueInvitation(d, guest.id, now).url);
  assert.throws(() => claimInvitation(d, first, alex, now + 7 * 86400000), /expired/);
  revokeInvitation(d, guest.id);
  assert.throws(() => claimInvitation(d, first, alex, now), /expired/);
  const second = raw(issueInvitation(d, guest.id, now).url);
  const third = raw(issueInvitation(d, guest.id, now).url);
  assert.throws(() => claimInvitation(d, second, alex, now), /expired/);
  claimInvitation(d, third, alex, now);
  assert.throws(() => claimInvitation(d, third, alex, now), /already used/);
});
test('separate verified accounts stay isolated and identities work across devices', () => {
  const d = setup();
  claimInvitation(d, raw(issueInvitation(d, d.guests[0].id, now).url), alex, now);
  claimInvitation(d, raw(issueInvitation(d, d.guests[1].id, now).url), kim, now);
  assert.equal(accountActor(d, { ...alex }).guestId, d.guests[0].id);
  assert.equal(accountActor(d, { ...kim }).guestId, d.guests[1].id);
  assert.deepEqual(accountActor(d), { organiser: false, guestId: undefined });
  assert.equal(accountActor(d, alex).organiser, false);
  assert.equal(accountActor(d, { id: 'provider-host', email: 'host@example.com' }).organiser, true);
});
test('verified provider identity rejects anonymous, unverified and malformed contact', () => {
  assert.throws(() => verifiedIdentity({ id: alex.id, email: alex.email }), /verified/);
  assert.throws(() => verifiedIdentity({ ...alex, email_confirmed_at: '2026-11-07', is_anonymous: true }), /verified/);
  assert.throws(() => normaliseEmail('not-email'));
  assert.deepEqual(verifiedIdentity({ ...alex, email: 'Alex@Example.com', email_confirmed_at: '2026-11-07' }), alex);
});
test('account invitation redemption does not change V1 browser dinners', () => {
  const d = setup(); delete d.identityMode; delete d.experience;
  assert.throws(() => issueInvitation(d, d.guests[0].id, now), /account dinners/);
  assert.throws(() => claimInvitation(d, 'x'.repeat(43), alex, now), /not an account dinner/);
  assert.equal(d.hostHash, digest('old-browser-host'));
});

test('a verified returning guest can reopen their consumed link after the reply deadline', () => {
  const d = setup(), guest = d.guests[0];
  const invitation = raw(issueInvitation(d, guest.id, now).url);
  assert.equal(acceptOrResumeInvitation(d, invitation, alex, now), guest.id);
  const claim = guest.claimHash;
  d.stage = 'confirmed';
  assert.equal(acceptOrResumeInvitation(d, invitation, { ...alex }, Date.parse(d.deadline) + 1), guest.id);
  assert.equal(guest.claimHash, claim);
  assert.throws(() => acceptOrResumeInvitation(d, invitation, kim, now), /locked/);
});

test('disabling an account removes alternate-contact updates and blocks stale consent from sending or registering', { skip: !process.env.DATABASE_URL }, async () => {
  const sql = db(), dinner = setup();
  const account = { id: randomUUID(), email: randomUUID() + '@example.test' };
  const affected = randomUUID(), unrelated = randomUUID(), waitlist = randomUUID(), stale = randomUUID();
  const alternateEmail = randomUUID() + '@example.test';
  dinner.expiresAt = new Date(Date.now() + 86400000).toISOString();
  const guest = dinner.guests[0];
  guest.accountId = account.id;
  guest.claimHash = digest('synthetic-claim');
  guest.reply = { attending: true, availability: [], diets: [], otherDiet: '', cuisines: {} };
  async function subscription(id: string, guestId: string | null, email: string) {
    await sql`INSERT INTO email_subscriptions
      (id,scope,dinner_id,guest_id,guest_claim_hash,email,verification_hash,verification_expires_at,unsubscribe_hash)
      VALUES (${id},${guestId ? 'dinner' : 'waitlist'},${guestId ? dinner.id : null},${guestId},${guestId ? guest.claimHash! : null},${email},${randomUUID()},now()+interval '1 day',${randomUUID()})`;
  }
  try {
    await sql`INSERT INTO accounts(id,email) VALUES (${account.id},${account.email})`;
    await sql`INSERT INTO account_sessions(hash,account_id,access_token,expires_at) VALUES (${randomUUID()},${account.id},'synthetic-provider-token',now()+interval '1 hour')`;
    await sql`INSERT INTO dinners(id,document,expires_at) VALUES (${dinner.id},${sql.json(dinner)},${dinner.expiresAt})`;
    await subscription(affected, guest.id, alternateEmail);
    await subscription(unrelated, dinner.guests[1].id, 'other@example.test');
    await subscription(waitlist, null, account.email);
    await disableAccountAccess(account);
    assert.ok((await sql`SELECT disabled_at FROM accounts WHERE id=${account.id}`)[0].disabled_at);
    assert.equal((await sql`SELECT hash FROM account_sessions WHERE account_id=${account.id}`).length, 0);
    const remaining = await sql`SELECT id FROM email_subscriptions WHERE id IN ${sql([affected, unrelated, waitlist])}`;
    assert.deepEqual(remaining.map(row => row.id).sort(), [unrelated, waitlist].sort());

    // Even a stale in-flight registration must recheck account disable under lock.
    await assert.rejects(subscribeDinner({ dinner, guest }, alternateEmail), /cannot receive/);
    // Defence at delivery also suppresses a subscription retained by older code.
    await subscription(stale, guest.id, alternateEmail);
    await sql`INSERT INTO email_outbox(id,subscription_id,event_key,kind,payload)
      VALUES (${randomUUID()},${stale},${'verify:' + stale},'verification',${sql.json({ to: alternateEmail, subject: 'Synthetic', text: 'Synthetic' })})`;
    let sends = 0;
    const result = await dispatchOutbox(1, async () => { sends++; return 'sent'; });
    assert.equal(sends, 0);
    assert.equal(result.suppressed, 1);
  } finally {
    await sql`DELETE FROM email_subscriptions WHERE id=${waitlist}`;
    await sql`DELETE FROM dinners WHERE id=${dinner.id}`;
    await sql`DELETE FROM accounts WHERE id=${account.id}`;
    await sql.end();
  }
});
