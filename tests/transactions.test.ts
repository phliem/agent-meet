import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
import { changeDinner, insertDinner, readDinner } from '../src/lib/store';
import { newDinner, insist, applyCommand } from '../src/lib/domain';
import { digest, token } from '../src/lib/security';

test('guest claims, stale results and simultaneous vote closure remain atomic', { skip: !process.env.DATABASE_URL }, async () => {
  const sql = db();
  const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
  const dinner = newDinner({ title: 'Synthetic transaction test', hostName: 'Synthetic host', names: ['Guest'], mode: 'fixed', fixedStart: future(7), duration: 120, deadline: future(2) }, digest(token()));
  await insertDinner(dinner);
  try {
    const claim = () => changeDinner(dinner.id, current => {
      insist(!current.guests[0].claimHash, 'Taken');
      current.guests[0].claimHash = digest(token());
    });
    const claims = await Promise.allSettled([claim(), claim()]);
    assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(claims.filter(result => result.status === 'rejected').length, 1);
    const saved = (await readDinner(dinner.id))!;
    const guestId = saved.guests[0].id;
    const subscriptionId = token();
    await sql`INSERT INTO email_subscriptions (id,scope,dinner_id,guest_id,guest_claim_hash,email,verification_hash,verification_expires_at,unsubscribe_hash)
      VALUES (${subscriptionId},'dinner',${dinner.id},${guestId},${saved.guests[0].claimHash!},'guest@example.test',${digest(token())},${future(1)},${digest(token())})`;
    await assert.rejects(changeDinner(dinner.id, current => {
      current.title = 'Must roll back';
      throw new Error('Synthetic rejection');
    }, { unsubscribeGuestId: guestId }), /Synthetic rejection/);
    assert.equal((await sql`SELECT id FROM email_subscriptions WHERE id=${subscriptionId}`).length, 1);
    await changeDinner(dinner.id, current => {
      current.guests[0].reply = { attending: false, availability: [], diets: [], otherDiet: '', cuisines: {} };
    }, { unsubscribeGuestId: guestId });
    assert.equal((await readDinner(dinner.id))!.guests[0].reply?.attending, false);
    assert.equal((await sql`SELECT id FROM email_subscriptions WHERE id=${subscriptionId}`).length, 0);
    await assert.rejects(changeDinner(dinner.id, current => { current.title = 'Must not persist'; }, { expectedVersion: saved.version - 1 }), /updated/);
    assert.equal((await readDinner(dinner.id))!.title, dinner.title);
    await changeDinner(dinner.id, current => {
      current.stage = 'area-voting'; current.votesClosed = false; current.includedIds = [current.guests[0].id];
      current.guests[0].reply = { attending: true, availability: [], diets: [], otherDiet: '', cuisines: {} };
      current.areas = [{ id: 'a', name: 'Synthetic area', lat: 51.5, lon: -0.1, journeys: [], longest: 20, explanation: 'Fixture' }];
    });
    const endings = await Promise.allSettled([
      changeDinner(dinner.id, current => applyCommand(current, { organiser: true }, { type: 'close-vote' })),
      changeDinner(dinner.id, current => applyCommand(current, { organiser: false, guestId: current.guests[0].id }, { type: 'vote', ballot: { favourite: 'a', acceptable: [], none: false } })),
    ]);
    const closed = (await readDinner(dinner.id))!;
    assert.equal(closed.votesClosed, true);
    assert.ok(endings.some(result => result.status === 'fulfilled'));
    assert.ok(['area-voting', 'choosing-restaurant'].includes(closed.stage));
    assert.equal((await sql`SELECT id FROM dinner_events WHERE dinner_id = ${dinner.id} AND kind = 'area-voting'`).length, 1);
  } finally {
    await sql`DELETE FROM dinners WHERE id = ${dinner.id}`;
    await sql.end();
  }
});
