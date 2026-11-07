import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountActor, acceptOrResumeInvitation, claimInvitation, issueInvitation, normaliseEmail, revokeInvitation, verifiedIdentity } from '../src/lib/accounts';
import { newDinner } from '../src/lib/domain';
import { digest } from '../src/lib/security';
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
