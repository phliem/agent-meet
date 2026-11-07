import { db } from './db';
import type { Dinner, Guest } from './model';
import type { EmailSender } from './notifications';
import { digest } from './security';
export type ReminderAccount = { id: string; email: string; disabled_at?: Date | null };
export type ReminderJob = { id: string; dinner_id: string; guest_id: string; account_id: string; claim_hash: string; deadline: Date | string; attempts: number };
export function reminderDue(dinner: Dinner) {
  const created = Date.parse(dinner.createdAt), deadline = Date.parse(dinner.deadline);
  return new Date(deadline - created >= 86400000 ? deadline - 86400000 : created + (deadline - created) / 2);
}
export function reminderCandidate(dinner: Dinner, guest: Guest, now = Date.now()) {
  return dinner.experience === 'v2' && dinner.identityMode === 'account' && dinner.remindersEnabled === true && guest.remindersAllowed === true
    && !!guest.accountId && !!guest.claimHash && !!guest.invitationEmail && !guest.reply
    && ['collecting', 'choosing-time', 'recommending'].includes(dinner.stage)
    && Date.parse(dinner.expiresAt) > now && Date.parse(dinner.deadline) > now
    && (!dinner.includedIds || dinner.includedIds.includes(guest.id));
}
export function reminderKey(dinner: Dinner, guest: Guest) {
  return digest(JSON.stringify([dinner.id, guest.id, new Date(dinner.deadline).toISOString(), guest.claimHash]));
}
export function reminderEligible(dinner: Dinner | undefined, job: ReminderJob, account: ReminderAccount | undefined, now = Date.now()) {
  if (!dinner || !account || account.disabled_at || account.id !== job.account_id || Date.parse(dinner.deadline) !== new Date(job.deadline).getTime()) return false;
  const guest = dinner.guests.find(g => g.id === job.guest_id);
  return !!guest && reminderCandidate(dinner, guest, now) && guest.accountId === account.id && guest.claimHash === job.claim_hash && guest.invitationEmail === account.email;
}
export function reminderMessage(dinner: Dinner, email: string, origin: string) {
  const dinnerUrl = origin + '/d/' + encodeURIComponent(dinner.id);
  const preferencesUrl = origin + '/account?dinner=' + encodeURIComponent(dinner.id);
  return { to: email, subject: 'A reply is still needed for your dinner', text: 'Your organiser is waiting for your dinner reply. Reply before ' + new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(dinner.deadline)) + ' (London time).\n\nOpen your dinner (sign in with your invited email if prompted):\n' + dinnerUrl + '\n\nStop reply reminders for this dinner:\n' + preferencesUrl };
}
export async function runReminders(send: EmailSender, origin: string, limit = 10, clock: number | (() => number) = Date.now, deadline = Infinity) {
  const currentTime = typeof clock === 'function' ? clock : () => clock;
  const counts = { sent: 0, fixture: 0, suppressed: 0, retried: 0 };
  if (currentTime() >= deadline) return counts;
  const now = currentTime();
  const sql = db(), timestamp = new Date(now);
  const dinners = await sql`SELECT document FROM dinners WHERE expires_at>${timestamp} AND document->>'identityMode'='account' AND document->>'remindersEnabled'='true'`;
  for (const row of dinners) {
    if (currentTime() >= deadline) break;
    const dinner = row.document as Dinner;
    for (const guest of dinner.guests) {
      if (currentTime() >= deadline) break;
      if (!reminderCandidate(dinner, guest, now)) continue;
      const due = reminderDue(dinner);
      await sql`INSERT INTO reminder_jobs(id,dinner_id,guest_id,account_id,claim_hash,deadline,due_at,available_at)
        SELECT ${reminderKey(dinner,guest)},${dinner.id},${guest.id},${guest.accountId!},${guest.claimHash!},${dinner.deadline},${due},${due}
        WHERE EXISTS(SELECT 1 FROM accounts WHERE id=${guest.accountId!} AND email=${guest.invitationEmail!} AND disabled_at IS NULL)
        ON CONFLICT DO NOTHING`;
    }
  }
  if (currentTime() >= deadline) return counts;
  // Invalidated generations are retained as suppressed audit records, never rescheduled.
  await sql`UPDATE reminder_jobs j SET status='suppressed' FROM dinners d WHERE d.id=j.dinner_id AND j.status='pending' AND (j.deadline<> (d.document->>'deadline')::timestamptz OR d.expires_at<=${timestamp})`;
  for (let n = 0; n < Math.min(Math.max(limit, 0), 25); n++) {
    if (currentTime() + 10_000 > deadline) break;
    const handled = await sql.begin(async tx => {
      const candidates = await tx`SELECT id,dinner_id,account_id FROM reminder_jobs WHERE status='pending' AND available_at<=${new Date(currentTime())} ORDER BY available_at,id LIMIT 1`;
      const candidate = candidates[0]; if (!candidate) return false;
      // Match dinner mutation order; holds consent and account-disable state stable during delivery.
      const records = await tx`SELECT document FROM dinners WHERE id=${candidate.dinner_id} FOR SHARE`;
      const accounts = await tx`SELECT id,email,disabled_at FROM accounts WHERE id=${candidate.account_id} FOR SHARE`;
      const jobs = await tx`SELECT * FROM reminder_jobs WHERE id=${candidate.id} AND status='pending' FOR UPDATE SKIP LOCKED`;
      const job = jobs[0] as ReminderJob | undefined; if (!job) return true;
      const dinner = records[0]?.document as Dinner | undefined;
      const account = accounts[0] as ReminderAccount | undefined;
      if (!reminderEligible(dinner,job,account,currentTime())) {
        await tx`UPDATE reminder_jobs SET status='suppressed' WHERE id=${job.id}`; counts.suppressed++; return true;
      }
      if (currentTime() + 10_000 > deadline) return false;
      try {
        const status = await send(reminderMessage(dinner!,account!.email,origin), 'agent-meet/reminder/' + job.id);
        await tx`UPDATE reminder_jobs SET status=${status},sent_at=${new Date(currentTime())},attempts=attempts+1 WHERE id=${job.id}`;
        counts[status]++;
      } catch {
        const attempts = job.attempts + 1;
        await tx`UPDATE reminder_jobs SET status=${attempts>=6?'failed':'pending'},attempts=${attempts},available_at=${new Date(currentTime()+Math.min(3600000,60000*2**attempts))} WHERE id=${job.id}`;
        counts.retried++;
      }
      return true;
    });
    if (!handled) break;
  }
  return counts;
}
