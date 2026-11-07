import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { normalizeEmail, guestMayReceive, updateMessage, jobsAuthorised, resendSender, subscribeDinner, verifySubscription, unsubscribe, runJobs, joinWaitlist } from '../src/lib/notifications';
import type { Dinner, Guest } from '../src/lib/model';

function sampleDinner(): Dinner {
  const guest: Guest = { id: 'guest-1', name: 'Example guest', claimHash: 'test-claim', reply: { attending: true, availability: [], diets: [], otherDiet: '', cuisines: {} } };
  return { id: randomUUID(), title: 'Synthetic dinner', hostName: 'Example host', hostHash: 'test-host', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), mode: 'fixed', dateStart: '2027-06-01', dateEnd: '2027-06-01', deadline: '2027-05-30T18:00:00Z', duration: 120, fixedStart: '2027-06-01T18:00:00Z', selectedStart: '2027-06-01T18:00:00Z', stage: 'collecting', guests: [guest], includedIds: null, areas: [], restaurants: [], votesClosed: false, version: 1, dataMode: 'fixture' };
}

test('email values are normalized and invalid or header-like values are rejected', () => {
  assert.equal(normalizeEmail('  Guest@Example.test  '), 'guest@example.test');
  assert.throws(() => normalizeEmail('person@example.test\r\nBcc:other@example.test'));
  assert.throws(() => normalizeEmail('not an address'));
});

test('delivery requires the active attending claim and included group', () => {
  const dinner = sampleDinner();
  assert.equal(guestMayReceive(dinner, 'guest-1', 'test-claim'), true);
  assert.equal(guestMayReceive(dinner, 'guest-1', 'old-claim'), false);
  dinner.includedIds = [];
  assert.equal(guestMayReceive(dinner, 'guest-1', 'test-claim'), false);
  dinner.includedIds = ['guest-1'];
  dinner.guests[0].reply!.attending = false;
  assert.equal(guestMayReceive(dinner, 'guest-1', 'test-claim'), false);
  dinner.guests[0].reply!.attending = true;
  dinner.expiresAt = '2000-01-01T00:00:00Z';
  assert.equal(guestMayReceive(dinner, 'guest-1', 'test-claim'), false);
});

test('update messages use the shared link but no guest contact or location details', () => {
  process.env.APP_URL = 'http://localhost:3000';
  const dinner = sampleDinner();
  dinner.guests[0].reply!.location = { label: 'PRIVATE POSTCODE', lat: 51.5, lon: 0, source: 'test' };
  dinner.restaurant = { id: 'test-venue', name: 'Synthetic venue', address: 'Example address', mapUrl: '', sourceUrl: '', cuisines: [], price: 'medium', dietaryEvidence: [], hours: 'Unknown' };
  for (const kind of ['area-voting', 'confirmed'] as const) {
    const message = updateMessage(dinner, kind, 'guest@example.test');
    assert.ok(message.text.includes('/d/' + dinner.id));
    assert.ok(!message.text.includes('PRIVATE POSTCODE'));
    assert.ok(!message.text.includes(dinner.guests[0].name));
    assert.ok(!message.text.includes('guest@example.test'));
  }
  assert.match(updateMessage(dinner, 'confirmed', 'guest@example.test').text, /19:00/);
});

test('jobs endpoint authentication fails closed and fixture transport makes no network call', async () => {
  process.env.CRON_SECRET = 'synthetic-secret-with-at-least-24-characters'; // gitleaks:allow -- synthetic test credential, never used by a service
  assert.equal(jobsAuthorised(null), false);
  assert.equal(jobsAuthorised('Bearer incorrect'), false);
  assert.equal(jobsAuthorised('Bearer ' + process.env.CRON_SECRET), true);
  process.env.EMAIL_MODE = 'fixture';
  assert.equal(await resendSender({ to: 'example@example.test', subject: 'Synthetic', text: 'Synthetic' }, 'test-id'), 'fixture');
});

test('database outbox verifies consent, sends each event once and drops reset or unsubscribed recipients', { skip: !process.env.DATABASE_URL }, async () => {
  process.env.APP_URL = 'http://localhost:3000';
  process.env.EMAIL_MODE = 'fixture';
  const dinner = sampleDinner();
  const staleDinner = sampleDinner();
  const sql = db();
  let waitlistId: string | undefined;
  try {
    await sql`INSERT INTO dinners (id, document, expires_at) VALUES (${dinner.id}, ${sql.json(dinner)}, ${dinner.expiresAt})`;
    const signup = await subscribeDinner({ dinner, guest: dinner.guests[0] }, 'dinner-' + dinner.id + '@example.test');
    assert.ok('verificationUrl' in signup && typeof signup.verificationUrl === 'string');
    const rawToken = new URL(signup.verificationUrl as string).searchParams.get('token');
    assert.equal(await verifySubscription(rawToken), true);
    assert.equal(await verifySubscription(rawToken), false);
    dinner.stage = 'area-voting';
    dinner.includedIds = ['guest-1'];
    await sql`UPDATE dinners SET document = ${sql.json(dinner)} WHERE id = ${dinner.id}`;
    // A full batch of invalidated historical recipients must not block a later
    // valid update. These subscriptions predate a declined/reset guest claim.
    staleDinner.guests[0].reply!.attending = false;
    await sql`INSERT INTO dinners (id, document, expires_at) VALUES (${staleDinner.id}, ${sql.json(staleDinner)}, ${staleDinner.expiresAt})`;
    const staleSubscription = randomUUID();
    await sql`INSERT INTO email_subscriptions
      (id, scope, dinner_id, guest_id, guest_claim_hash, email, verification_hash, verification_expires_at, unsubscribe_hash, verified_at)
      VALUES (${staleSubscription}, 'dinner', ${staleDinner.id}, 'guest-1', 'old-claim', 'stale@example.test', ${randomUUID()}, now() + interval '1 day', ${randomUUID()}, now() - interval '2 minutes')`;
    await sql`INSERT INTO dinner_events (id,dinner_id,kind,created_at)
      SELECT ${staleDinner.id} || ':' || n, ${staleDinner.id}, 'area-voting', now() - interval '1 minute' FROM generate_series(1,100) n`;
    await sql`INSERT INTO dinner_events (id,dinner_id,kind) VALUES (${dinner.id + ':vote'}, ${dinner.id}, 'area-voting')`;
    const messages: string[] = [];
    const send = async (message: { text: string }) => { messages.push(message.text); return 'sent' as const; };
    await runJobs({ send });
    await runJobs({ send });
    const staleRows = await sql`SELECT status,payload FROM email_outbox WHERE subscription_id = ${staleSubscription}`;
    assert.equal(staleRows.length, 100);
    assert.ok(staleRows.every(row => row.status === 'suppressed' && Object.keys(row.payload).length === 0));
    assert.equal(messages.length, 1);
    assert.ok(messages[0].includes('/d/' + dinner.id));
    const signupRows = await sql`SELECT id FROM email_subscriptions WHERE dinner_id = ${dinner.id}`;
    const verificationRows = await sql`SELECT payload FROM email_outbox WHERE subscription_id = ${signupRows[0].id} AND kind = 'verification'`;
    const unsubscribeToken = new URL(verificationRows[0].payload.unsubscribeUrl).searchParams.get('token');
    await unsubscribe(unsubscribeToken);
    assert.equal((await sql`SELECT id FROM email_subscriptions WHERE dinner_id = ${dinner.id}`).length, 0);
    assert.equal((await sql`SELECT id FROM email_outbox WHERE subscription_id = ${signupRows[0].id}`).length, 0);

    // An accepted verification can be reset before a queued update is retried.
    const second = await subscribeDinner({ dinner, guest: dinner.guests[0] }, 'dinner-' + dinner.id + '@example.test');
    assert.ok('verificationUrl' in second);
    await verifySubscription(new URL(second.verificationUrl as string).searchParams.get('token'));
    dinner.stage = 'confirmed';
    await sql`UPDATE dinners SET document = ${sql.json(dinner)} WHERE id = ${dinner.id}`;
    await sql`INSERT INTO dinner_events (id,dinner_id,kind) VALUES (${dinner.id + ':confirmed'}, ${dinner.id}, 'confirmed')`;
    await runJobs({ send: async () => { throw new Error('Simulated transport failure'); } });
    dinner.guests[0].claimHash = 'reset-claim';
    await sql`UPDATE dinners SET document = ${sql.json(dinner)} WHERE id = ${dinner.id}`;
    await sql`UPDATE email_outbox SET available_at = now() WHERE status = 'pending' AND subscription_id IN (SELECT id FROM email_subscriptions WHERE dinner_id = ${dinner.id})`;
    const afterReset = await runJobs({ send });
    assert.ok(afterReset.suppressed >= 1);
    assert.equal(messages.length, 1);
    await sql`DELETE FROM email_subscriptions WHERE dinner_id = ${dinner.id}`;

    // A verification request does not subscribe someone to the separate creator waitlist.
    assert.equal((await sql`SELECT id FROM email_subscriptions WHERE scope = 'waitlist' AND email = ${'dinner-' + dinner.id + '@example.test'}`).length, 0);
    const waitlist = await joinWaitlist('waitlist-' + dinner.id + '@example.test', dinner.id);
    assert.ok('verificationUrl' in waitlist);
    const waitlistRows = await sql`SELECT id FROM email_subscriptions WHERE scope = 'waitlist' AND email = ${'waitlist-' + dinner.id + '@example.test'}`;
    waitlistId = waitlistRows[0].id;
    assert.equal((await sql`SELECT id FROM email_subscriptions WHERE dinner_id = ${dinner.id}`).length, 0);
  } finally {
    if (waitlistId) await sql`DELETE FROM email_subscriptions WHERE id = ${waitlistId}`;
    await sql`DELETE FROM dinners WHERE id = ${dinner.id}`;
    await sql`DELETE FROM dinners WHERE id = ${staleDinner.id}`;
    await sql.end();
  }
});
