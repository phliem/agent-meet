import type { Dinner } from './model';
import { db } from './db';
import { insist } from './domain';

export async function readDinner(id: string): Promise<Dinner | null> {
  const rows = await db()`SELECT document FROM dinners WHERE id = ${id} AND expires_at > now()`;
  return rows[0]?.document as Dinner | undefined ?? null;
}
export async function insertDinner(dinner: Dinner) {
  await db()`INSERT INTO dinners (id, document, expires_at) VALUES (${dinner.id}, ${db().json(dinner)}, ${dinner.expiresAt})`;
}
export async function changeDinner<T>(id: string, update: (dinner: Dinner) => T, options?: { expectedVersion?: number; unsubscribeGuestId?: string }): Promise<{ dinner: Dinner; result: T }> {
  return await db().begin(async tx => {
    const rows = await tx`SELECT document FROM dinners WHERE id = ${id} AND expires_at > now() FOR UPDATE`;
    insist(rows[0], 'This dinner was not found or has expired.');
    const dinner = rows[0].document as Dinner;
    const stage = dinner.stage;
    if (options?.expectedVersion !== undefined) insist(dinner.version === options.expectedVersion, 'Someone updated this dinner. Refresh and try again.');
    const result = update(dinner);
    dinner.version += 1;
    await tx`UPDATE dinners SET document = ${tx.json(dinner)}, expires_at = ${dinner.expiresAt} WHERE id = ${id}`;
    if (stage !== dinner.stage && ['area-voting', 'confirmed'].includes(dinner.stage)) {
      await tx`INSERT INTO dinner_events (id, dinner_id, kind) VALUES (${id + ':' + dinner.stage}, ${id}, ${dinner.stage}) ON CONFLICT DO NOTHING`;
    }
    if (options?.unsubscribeGuestId) {
      await tx`DELETE FROM email_subscriptions WHERE dinner_id = ${id} AND guest_id = ${options.unsubscribeGuestId}`;
    }
    return { dinner, result };
  }) as unknown as { dinner: Dinner; result: T };
}
