import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { newDinner } from '../src/lib/domain';
import { digest, token } from '../src/lib/security';
import { runJobs, dispatchOutbox } from '../src/lib/notifications';
import { runReminders } from '../src/lib/reminders';

test('one delivery budget covers both queues and time is rechecked before each reminder', { skip: !process.env.DATABASE_URL }, async () => {
  const sql = db();
  const dinners: string[] = [], accounts: string[] = [], subscriptions: string[] = [];
  async function seed(deadline: number, created: number) {
    const id = randomUUID();
    const dinner = newDinner({ title: 'Synthetic worker regression', hostName: 'Host', names: ['Guest'], mode: 'fixed', fixedStart: new Date(Date.now() + 7 * 86400000).toISOString(), deadline: new Date(Date.now() + 86400000).toISOString(), duration: 120 }, 'synthetic-hash');
    dinner.identityMode = 'account'; dinner.experience = 'v2'; dinner.remindersEnabled = true;
    dinner.createdAt = new Date(created).toISOString(); dinner.deadline = new Date(deadline).toISOString();
    Object.assign(dinner.guests[0], { accountId: id, invitationEmail: id + '@example.test', claimHash: 'synthetic-claim', remindersAllowed: true });
    await sql`INSERT INTO accounts(id,email) VALUES (${id},${id + '@example.test'})`;
    await sql`INSERT INTO dinners(id,document,expires_at) VALUES (${dinner.id},${sql.json(dinner)},${dinner.expiresAt})`;
    dinners.push(dinner.id); accounts.push(id);
    return dinner;
  }
  try {
    const now = Date.now();
    const reminderDinner = await seed(now + 3600000, now - 2 * 86400000);
    const subscription = randomUUID(); subscriptions.push(subscription);
    await sql`INSERT INTO email_subscriptions(id,scope,email,verification_hash,verification_expires_at,unsubscribe_hash)
      VALUES (${subscription},'waitlist',${subscription + '@example.test'},${digest(token())},now()+interval '1 day',${digest(token())})`;
    const pendingJob = randomUUID();
    await sql`INSERT INTO email_outbox(id,subscription_id,event_key,kind,payload)
      VALUES (${pendingJob},${subscription},${subscription},'verification',${sql.json({ to: subscription + '@example.test', subject: 'Synthetic test', text: 'Fixture only' })})`;
    let sent = 0;
    const sender = async () => { sent++; return 'sent' as const; };
    await dispatchOutbox(1, sender, Date.now());
    assert.equal(sent, 0, 'an exhausted time budget cannot start a send');

    const updateDinner = await seed(now + 3600000, now - 2 * 86400000);
    updateDinner.stage = 'area-voting';
    updateDinner.guests[0].reply = { attending: true, availability: [], diets: [], otherDiet: '', cuisines: {} };
    await sql`UPDATE dinners SET document=${sql.json(updateDinner)} WHERE id=${updateDinner.id}`;
    const updateSubscription = randomUUID();
    await sql`INSERT INTO email_subscriptions(id,scope,dinner_id,guest_id,guest_claim_hash,email,verification_hash,verification_expires_at,unsubscribe_hash,verified_at)
      VALUES (${updateSubscription},'dinner',${updateDinner.id},${updateDinner.guests[0].id},'synthetic-claim',${updateDinner.guests[0].invitationEmail!},${digest(token())},now()+interval '1 day',${digest(token())},now()-interval '1 minute')`;
    const event = randomUUID();
    await sql`INSERT INTO dinner_events(id,dinner_id,kind) VALUES (${event},${updateDinner.id},'area-voting')`;
    const expiredDinner = await seed(now + 3600000, now - 2 * 86400000);
    await sql`UPDATE dinners SET expires_at=now()-interval '1 second' WHERE id=${expiredDinner.id}`;
    const expiredSession = digest(token());
    await sql`INSERT INTO account_sessions(hash,account_id,access_token,expires_at)
      VALUES (${expiredSession},${reminderDinner.guests[0].accountId!},'synthetic-provider-token',now()-interval '1 second')`;

    const exhausted = await runJobs({ send: sender, deadline: Date.now() - 1 });
    assert.deepEqual(exhausted, { sent: 0, fixture: 0, suppressed: 0, retried: 0, reminders: { sent: 0, fixture: 0, suppressed: 0, retried: 0 } });
    assert.equal(sent, 0);
    assert.equal((await sql`SELECT status FROM email_outbox WHERE id=${pendingJob}`)[0].status, 'pending');
    assert.equal((await sql`SELECT id FROM email_outbox WHERE event_key=${event + ':' + updateSubscription}`).length, 0, 'expired callers leave durable events unmaterialized');
    assert.equal((await sql`SELECT id FROM dinner_events WHERE id=${event}`).length, 1);
    assert.equal((await sql`SELECT id FROM reminder_jobs WHERE dinner_id=${reminderDinner.id}`).length, 0, 'expired callers skip reminder materialization too');
    assert.equal((await sql`SELECT id FROM dinners WHERE id=${expiredDinner.id}`).length, 0, 'expiry cleanup still runs');
    assert.equal((await sql`SELECT hash FROM account_sessions WHERE hash=${expiredSession}`).length, 0);
    await sql`DELETE FROM dinners WHERE id=${updateDinner.id}`;
    await runJobs({ limit: 1, send: sender });
    assert.equal(sent, 1, 'outbox and reminders share one delivery limit');
    await sql`DELETE FROM dinners WHERE id IN ${sql(dinners)}`;

    let clock = Date.now();
    const first = await seed(clock + 5000, clock - 2 * 86400000);
    const second = await seed(clock + 5000, clock - 2 * 86400000);
    const targets = new Set([first.guests[0].invitationEmail, second.guests[0].invitationEmail]);
    const delivered: string[] = [];
    const counts = await runReminders(async message => {
      if (targets.has(message.to)) { delivered.push(message.to); clock += 6000; }
      return 'sent';
    }, 'https://example.test', 10, () => clock);
    assert.equal(delivered.length, 1, 'the second reminder is past its deadline after the first slow send');
    assert.ok(counts.suppressed >= 1);
  } finally {
    await sql`DELETE FROM email_subscriptions WHERE id IN ${sql(subscriptions)}`;
    await sql`DELETE FROM dinners WHERE id IN ${sql(dinners)}`;
    await sql`DELETE FROM accounts WHERE id IN ${sql(accounts)}`;
    await sql.end();
  }
});
