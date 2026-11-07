import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { digest, token } from '../src/lib/security';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
test.afterAll(async () => { await sql.end(); });

async function signIn(page: Page, email: string, checkRecovery = false) {
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a verification code' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  if (checkRecovery) {
    await page.getByLabel('Email verification code').fill('abcdef');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByLabel('Email verification code')).toBeFocused();
    await page.getByLabel('Email verification code').fill('000000');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText('Email verification failed or expired');
    await expect(page.locator('main').getByRole('alert')).toBeFocused();
  }
  await page.getByLabel('Email verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByText('Signed in as', { exact: false })).toBeVisible();
}

test('V2 verified accounts redeem intended invitations, return on another browser and confirm a dinner', async ({ browser }) => {
  const run = token().slice(0, 10).toLowerCase();
  const hostEmail = `host-${run}@example.invalid`;
  const guestEmail = `guest-${run}@example.invalid`;
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [host, guest, returning] = await Promise.all(contexts.map(context => context.newPage()));
  const pilot = token();
  await sql`INSERT INTO pilot_invites (hash, expires_at) VALUES (${digest(pilot)}, now() + interval '1 hour')`;
  try {
    await host.goto('/account');
    // Verification must validate the separate email form before contacting auth.
    await host.getByLabel('Email verification code').fill('123456');
    await host.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(host.getByLabel('Email address', { exact: true })).toBeFocused();
    await signIn(host, hostEmail, true);
    await host.goto('/invite/' + pilot);
    await host.getByRole('button', { name: 'Activate my invitation' }).click();
    await host.getByLabel('Use V2').check();
    await host.getByLabel('Give your dinner a name').fill('Synthetic verified-account dinner');
    await host.getByLabel('Your name', { exact: true }).fill('Alex');
    await host.getByLabel('Who’s coming?').fill('Alex\nSam');
    await host.getByLabel('Guest invitation emails').fill(hostEmail + '\n' + guestEmail);
    await host.getByLabel('Allow one reminder').check();
    await host.getByLabel('We have a date').check();
    await host.getByLabel('Dinner starts · London time').fill(day(7) + 'T19:00');
    await host.getByLabel('Reply by · London time').fill(day(1) + 'T12:00');
    await host.getByRole('button', { name: /Create & get the invite link/ }).click();
    await expect(host).toHaveURL(/\/d\/[\w-]+/);
    const path = new URL(host.url()).pathname;
    await host.getByRole('button', { name: 'Generate link for Alex' }).click();
    const hostLink = await host.getByLabel('Private link for Alex').inputValue();
    await host.getByRole('button', { name: 'Generate link for Sam' }).click();
    const guestLink = await host.getByLabel('Private link for Sam').inputValue();
    await host.goto(hostLink);
    await host.getByRole('button', { name: 'Accept personal invitation' }).click();
    await expect(host.getByLabel('Your starting station or postcode')).toBeVisible();
    await host.getByLabel('Your starting station or postcode').fill('Waterloo');
    await host.getByLabel('Low · £', { exact: true }).check();
    await host.getByRole('button', { name: 'Save my reply', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Your dinner details' })).toBeVisible();

    await guest.goto(guestLink);
    await signIn(guest, `wrong-${run}@example.invalid`);
    await guest.getByRole('button', { name: 'Accept personal invitation' }).click();
    await expect(guest.locator('main').getByRole('alert')).toContainText('email address this personal invitation was sent to');
    await expect(guest.locator('main').getByRole('alert')).toBeFocused();
    await guest.getByRole('button', { name: 'Sign out of this device' }).click();
    await expect(guest.getByLabel('Email address', { exact: true })).toBeVisible();
    await signIn(guest, guestEmail);
    await guest.getByLabel('Email me one reply reminder').check();
    await guest.getByRole('button', { name: 'Accept personal invitation' }).click();
    await expect(guest.getByLabel('Your starting station or postcode')).toBeVisible();
    await guest.getByLabel('Your starting station or postcode').fill('Bank');
    await guest.getByLabel('Low · £', { exact: true }).check();
    await guest.getByLabel('Medium · ££', { exact: true }).uncheck();
    await guest.getByRole('button', { name: 'Save my reply', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Where shall we meet?' })).toBeVisible({ timeout: 45000 });

    await returning.goto('/account');
    await signIn(returning, guestEmail);
    await returning.goto(path);
    await expect(returning.getByRole('heading', { name: 'Where shall we meet?' })).toBeVisible();
    await expect(returning.getByRole('heading', { name: 'Who are you?' })).toHaveCount(0);
    await expect(returning.locator('body')).not.toContainText('Waterloo');
    await returning.goto('/account?dinner=' + path.split('/').at(-1));
    await expect(returning.getByLabel('Email me a reply reminder for this dinner', { exact: true })).toBeChecked();
    await returning.goto(path);
    await host.reload();
    const area = await host.locator('.area-card legend').first().innerText();
    for (const page of [returning, host]) {
      await page.locator('.area-card').filter({ has: page.locator('legend', { hasText: area }) }).getByRole('radio', { name: 'My favourite' }).check();
      await page.getByRole('button', { name: 'Save my vote', exact: true }).click();
    }
    await expect(host.getByRole('heading', { name: 'Find your dinner spot' })).toBeVisible({ timeout: 45000 });
    await host.getByText('Have somewhere in mind? Enter a restaurant').click();
    await host.getByLabel('Restaurant name', { exact: true }).fill('Synthetic account kitchen');
    await host.getByLabel('Street address').fill('1 Synthetic Street, London');
    await host.getByRole('button', { name: 'Save this restaurant' }).click();
    await host.getByLabel('I checked the venue details and suitability.').check();
    host.once('dialog', dialog => dialog.accept());
    await host.getByRole('button', { name: /Confirm dinner/ }).click();
    await expect(host.getByText('See you there', { exact: true })).toBeVisible();
    await returning.reload();
    await expect(returning.getByRole('heading', { name: 'Synthetic account kitchen', exact: true })).toBeVisible();
    const [row] = await sql`SELECT document FROM dinners WHERE id=${path.split('/').at(-1)!}`;
    expect(row.document.identityMode).toBe('account');
    expect(row.document.guests[0].remindersAllowed).toBe(false);
    expect(row.document.guests[1].remindersAllowed).toBe(true);
    expect(row.document.guests[1].reply.budgets).toEqual(['low']);
    expect(row.document.guests[1].accountId).toBeTruthy();
    expect(row.document.guests[0].reply.budgets).toEqual(['low', 'medium']);
    const sessions = await contexts[2].cookies();
    expect(sessions.find(cookie => cookie.name === 'am_account')).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
