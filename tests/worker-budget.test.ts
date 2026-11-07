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
    await seed(now + 3600000, now - 2 * 86400000);
    const subscription = randomUUID(); subscriptions.push(subscription);
    await sql`INSERT INTO email_subscriptions(id,scope,email,verification_hash,verification_expires_at,unsubscribe_hash)
      VALUES (${subscription},'waitlist',${subscription + '@example.test'},${digest(token())},now()+interval '1 day',${digest(token())})`;
    await sql`INSERT INTO email_outbox(id,subscription_id,event_key,kind,payload)
      VALUES (${randomUUID()},${subscription},${subscription},'verification',${sql.json({ to: subscription + '@example.test', subject: 'Synthetic test', text: 'Fixture only' })})`;
    let sent = 0;
    const sender = async () => { sent++; return 'sent' as const; };
    await dispatchOutbox(1, sender, Date.now());
    assert.equal(sent, 0, 'an exhausted time budget cannot start a send');
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
