import { test, expect } from '@playwright/test';
import postgres from 'postgres';

// Each spec owns its fixture connection; Playwright may reuse a worker across files.
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
import { newDinner } from '../src/lib/domain';
import { digest, guestCookie, hostCookie, token } from '../src/lib/security';

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test.afterAll(async () => { await sql.end(); });

test('signup keeps entered details after a network error and supports retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/waitlist', async route => {
    attempts++;
    if (attempts === 1) await route.abort('failed');
    else await route.fulfill({ json: { ok: true, message: 'Check your email to verify your address.' } });
  });
  await page.goto('/');
  const form = page.locator('#waitlist form');
  await form.getByLabel('Your email address').fill('recovery@example.invalid');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: /Join the creator waitlist/ }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByRole('alert')).toBeFocused();
  await expect(form.getByLabel('Your email address')).toHaveValue('recovery@example.invalid');
  await expect(form.getByRole('checkbox')).toBeChecked();
  await form.getByRole('button', { name: /Join the creator waitlist/ }).click();
  await expect(form.getByRole('status')).toHaveText('Check your email to verify your address.');
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(form.getByLabel('Your email address')).toBeEmpty();
  expect(attempts).toBe(2);
});

test('availability controls have distinct names and keep entered times after removing a window', async ({ page, context, baseURL }) => {
  const raw = token();
  const dinner = newDinner({ title: 'Availability recovery', hostName: 'Host', names: ['Alex', 'Sam'], mode: 'flexible', dateStart: day(7), dateEnd: day(8), duration: 120, deadline: day(1) + 'T12:00:00Z' }, digest(token()));
  dinner.guests[0].claimHash = digest(raw);
  await sql`INSERT INTO dinners (id, document, expires_at) VALUES (${dinner.id}, ${sql.json(dinner)}, ${dinner.expiresAt})`;
  await context.addCookies([{ name: guestCookie(dinner.id), value: raw, url: baseURL! }]);
  await page.goto('/d/' + dinner.id);
  await page.getByLabel('From · time 1', { exact: true }).fill(day(7) + 'T18:00');
  await page.getByLabel('Until · time 1', { exact: true }).fill(day(7) + 'T20:00');
  await page.getByRole('button', { name: '+ Add another time', exact: true }).click();
  await page.getByLabel('From · time 2', { exact: true }).fill(day(8) + 'T18:30');
  await page.getByLabel('Until · time 2', { exact: true }).fill(day(8) + 'T21:00');
  await page.getByRole('button', { name: 'Remove time 1', exact: true }).click();
  await expect(page.getByLabel('From · time 1', { exact: true })).toHaveValue(day(8) + 'T18:30');
  await expect(page.getByLabel('Until · time 1', { exact: true })).toHaveValue(day(8) + 'T21:00');
  await page.getByLabel('Your starting station or postcode').fill('Waterloo');
  await page.getByRole('button', { name: 'Save my reply', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your dinner details' })).toBeVisible();
  const [row] = await sql`SELECT document FROM dinners WHERE id=${dinner.id}`;
  expect(row.document.guests[0].reply.availability).toHaveLength(1);
  expect(row.document.guests[0].reply.availability[0].start.slice(0, 10)).toBe(day(8));
  // Returning guests must be able to edit other answers without retyping their
  // origin: the provider's example label is presentation, not valid input.
  await page.reload();
  await expect(page.getByLabel('Your starting station or postcode')).toHaveValue('Waterloo');
  await page.getByLabel('Until · time 1', { exact: true }).fill(day(8) + 'T21:30');
  await page.getByRole('button', { name: 'Save my changes', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => {
    const [updated] = await sql`SELECT document FROM dinners WHERE id=${dinner.id}`;
    return updated.document.guests[0].reply.availability[0].end.slice(11, 16);
  }).toBe('21:30');
});

test('flexible dinner recovers from no overlap and closes voting with an explicit organiser choice', async ({ browser }) => {
  const raw = token();
  await sql`INSERT INTO pilot_invites (hash, expires_at) VALUES (${digest(raw)}, now() + interval '1 hour')`;
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [host, guest, declined] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  for (const page of [host, guest, declined]) page.on('pageerror', error => errors.push(error.message));
  async function availability(page: typeof host, date: string, start: string, end: string, save: string) {
    await page.getByLabel('From · time 1', { exact: true }).fill(date + 'T' + start);
    await page.getByLabel('Until · time 1', { exact: true }).fill(date + 'T' + end);
    await page.getByLabel('Your starting station or postcode').fill('Waterloo');
    await page.getByRole('button', { name: save, exact: true }).click();
  }
  try {
    await host.goto('/invite/' + raw);
    await host.getByRole('button', { name: 'Activate my invitation' }).click();
    await host.getByLabel('Give your dinner a name').fill('Flexible dinner recovery');
    await host.getByLabel('Your name', { exact: true }).fill('Sam');
    await host.getByLabel('Who’s coming?').fill('Sam\nPriya\nRory');
    await host.getByLabel('First possible date', { exact: true }).fill(day(7));
    await host.getByLabel('Last possible date', { exact: true }).fill(day(8));
    await host.getByLabel('Reply by · London time').fill(day(1) + 'T12:00');
    await host.getByRole('button', { name: /Create & get the invite link/ }).click();
    await expect(host).toHaveURL(/\/d\/[\w-]+/);
    const path = new URL(host.url()).pathname;
    await host.getByRole('button', { name: /Sam.*That’s me/ }).click();
    await availability(host, day(7), '17:00', '19:00', 'Save my reply');
    await expect(host.getByRole('heading', { name: 'Your dinner details' })).toBeVisible();
    await guest.goto(path);
    await guest.getByRole('button', { name: /Priya.*That’s me/ }).click();
    await guest.getByLabel('Vegan', { exact: true }).check();
    await guest.getByLabel('Mexican', { exact: true }).selectOption('no');
    await guest.getByLabel('Anything else?', { exact: true }).fill('Synthetic private food note');
    await availability(guest, day(8), '19:00', '21:00', 'Save my reply');
    await expect(guest.getByRole('heading', { name: 'Your dinner details' })).toBeVisible();
    await declined.goto(path);
    await declined.getByRole('button', { name: /Rory.*That’s me/ }).click();
    await declined.getByRole('radio', { name: 'I can’t attend', exact: true }).check();
    await declined.getByRole('button', { name: 'I can’t attend', exact: true }).click();
    await expect(declined.getByRole('heading', { name: 'No shared time yet' })).toBeVisible();
    await host.reload();
    await expect(host.getByRole('heading', { name: 'No shared time yet' })).toBeVisible();
    await host.getByText('Manage replies', { exact: true }).click();
    await host.getByLabel('Dinner duration · minutes', { exact: true }).fill('90');
    await host.getByRole('button', { name: 'Update dinner duration', exact: true }).click();
    await expect(host.locator('.dinner-meta')).toContainText('1.5 hours');
    await expect(host.getByRole('heading', { name: 'No shared time yet' })).toBeVisible();
    await host.getByText('Widen the date window', { exact: true }).click();
    await host.getByLabel('First possible date', { exact: true }).fill(day(7));
    await host.getByLabel('Last possible date', { exact: true }).fill(day(9));
    await host.getByLabel('New deadline · London time', { exact: true }).fill(day(2) + 'T12:00');
    await host.getByRole('button', { name: 'Reopen replies', exact: true }).click();
    await expect(host.getByText('Replies reopened. Existing replies are kept and can be updated.')).toBeVisible();
    await availability(host, day(9), '18:00', '21:00', 'Save my changes');
    await expect(host.getByRole('heading', { name: 'No shared time yet' })).toBeVisible();
    await guest.reload();
    await availability(guest, day(9), '18:00', '21:00', 'Save my changes');
    await expect(guest.getByRole('heading', { name: 'Here’s the overlap' })).toBeVisible();
    await host.reload();
    await host.locator('.slot-list button').first().click();
    await expect(host.getByRole('heading', { name: 'Where shall we meet?' })).toBeVisible({ timeout: 45000 });
    await host.locator('.area-card').first().getByRole('radio', { name: 'My favourite' }).check();
    await host.getByRole('button', { name: 'Save my vote', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Update my vote', exact: true })).toBeVisible();
    await expect(host.getByRole('note', { name: 'Vote results' })).toHaveCount(0);
    host.once('dialog', dialog => dialog.accept());
    await host.getByRole('button', { name: 'Close voting', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'The votes are in' })).toBeVisible();
    await expect(host.getByRole('note', { name: 'Vote results' })).toContainText('1 of 2 votes received · 1 missing.');
    await expect(host.locator('.area-card').first()).toContainText('1 favourite · Accepted by 1 of 2 guests');
    await expect(host.locator('.area-card').nth(1)).toContainText('0 favourites · Accepted by 0 of 2 guests');
    await expect(host.locator('.organiser-vote button')).toHaveCount(await host.locator('.area-card').count());
    await guest.reload();
    await expect(guest.getByRole('note', { name: 'Vote results' })).toContainText('1 of 2 votes received · 1 missing.');
    await expect(guest.locator('.organiser-vote button')).toHaveCount(0);
    await expect(host.getByRole('heading', { name: 'Find your dinner spot' })).toHaveCount(0);
    await host.locator('.organiser-vote button').first().click();
    await expect(host.getByRole('heading', { name: 'Find your dinner spot' })).toBeVisible({ timeout: 45000 });
    await expect(host.getByRole('region', { name: 'Group food checklist' })).toContainText('Vegan');
    await expect(host.getByRole('region', { name: 'Group food checklist' })).toContainText('Mexican');
    await expect(host.locator('body')).not.toContainText('Synthetic private food note');
    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'The area is chosen' })).toBeVisible();
    await expect(guest.getByRole('region', { name: 'Group food checklist' })).toHaveCount(0);
    await expect(host.getByText('Anything entered under Other stays private. Before confirming, check any other dietary requirements and cuisine choices directly with your group.')).toBeVisible();
    await host.getByText('Have somewhere in mind? Enter a restaurant').click();
    await host.getByLabel('Restaurant name', { exact: true }).fill('Recovery Example Kitchen');
    await host.getByLabel('Street address').fill('9 Example Street, London');
    await host.getByRole('button', { name: 'Save this restaurant' }).click();
    await host.getByLabel('I checked the venue details and suitability.').check();
    host.once('dialog', dialog => dialog.accept());
    await host.getByRole('button', { name: /Confirm dinner/ }).click();
    await expect(host.getByText('See you there', { exact: true })).toBeVisible();
    await expect(host.locator('.confirmation-facts')).toContainText('Sam, Priya');
    await expect(host.locator('.confirmation-facts')).not.toContainText('Rory');
    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'Recovery Example Kitchen', exact: true })).toBeVisible();
    const id = path.split('/').at(-1)!;
    const [row] = await sql`SELECT document FROM dinners WHERE id=${id}`;
    expect(row.document.stage).toBe('confirmed');
    expect(row.document.duration).toBe(90);
    expect(row.document.guests[1].ballot).toBeUndefined();
    expect(row.document.guests[2].reply.attending).toBe(false);
    expect(row.document.includedIds).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});


test('closed voting shows aggregate totals and limits tie choices to eligible areas', async ({ page, context, baseURL }) => {
  const raw = token();
  const dinner = newDinner({ title: 'Closed vote resolution', hostName: 'Host', names: ['Alex', 'Sam'], mode: 'fixed', fixedStart: day(7) + 'T19:00:00Z', duration: 120, deadline: day(1) + 'T12:00:00Z' }, digest(raw));
  dinner.stage = 'area-voting';
  dinner.votesClosed = true;
  dinner.includedIds = dinner.guests.map(guest => guest.id);
  dinner.selectedStart = dinner.fixedStart;
  dinner.areas = ['North', 'Central', 'South'].map((name, index) => ({ id: `area-${index}`, name, lat: 51.5, lon: -0.1, journeys: [], longest: 20, explanation: 'Synthetic journey comparison.' }));
  for (const guest of dinner.guests) guest.reply = { attending: true, availability: [], diets: [], otherDiet: '', cuisines: {} };
  dinner.guests[0].ballot = { favourite: 'area-0', acceptable: ['area-1'], none: false };
  dinner.guests[1].ballot = { favourite: 'area-1', acceptable: ['area-0'], none: false };
  await sql`INSERT INTO dinners (id, document, expires_at) VALUES (${dinner.id}, ${sql.json(dinner)}, ${dinner.expiresAt})`;
  await context.addCookies([{ name: hostCookie(dinner.id), value: raw, url: baseURL! }]);
  await page.goto('/d/' + dinner.id);
  await expect(page.getByRole('note', { name: 'Vote results' })).toContainText('2 of 2 votes received · 0 missing.');
  await expect(page.locator('.area-card').first()).toContainText('1 favourite · Accepted by 2 of 2 guests');
  await expect(page.locator('.area-card').nth(2)).toContainText('0 favourites · Accepted by 0 of 2 guests');
  await expect(page.getByRole('button', { name: /Choose North/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose Central/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose South/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Update dinner duration', exact: true })).toHaveCount(0);
  // If nobody accepts a common area, the organiser can resolve disagreement
  // explicitly; totals remain honest and no individual ballot is revealed.
  dinner.guests[1].ballot = { favourite: null, acceptable: [], none: true };
  await sql`UPDATE dinners SET document=${sql.json(dinner)} WHERE id=${dinner.id}`;
  await page.reload();
  await expect(page.locator('.area-card').first()).toContainText('1 favourite · Accepted by 1 of 2 guests');
  await expect(page.getByRole('button', { name: /Choose South/ })).toBeVisible();
  await expect(page.locator('.organiser-vote button')).toHaveCount(3);
});
