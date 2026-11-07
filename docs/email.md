# Email updates and creator waitlist

Agent Meet uses a server-only Resend REST transport and a Postgres outbox. An attending guest can opt into two updates for their dinner, when area voting opens and when dinner is confirmed. The creator waitlist is a separate consent and record. Joining either does not enrol the other or grant creator access.

## Local setup

Set `EMAIL_MODE=fixture` and `APP_URL=http://localhost:3000` in ignored `.env.local`, then run migrations. In this explicit local mode, signup returns a labelled verification-preview URL. Opening that URL shows a confirmation form. Submitting it verifies the signup. The fake transport records `fixture` status and sends nothing. A production build or a non-local app origin never returns verification tokens in signup responses.

Run `pnpm jobs:run` with `.env.local` loaded to process queued events. Root dinner actions record `dinner_events` atomically with state changes. A worker materializes at most one outbox item per event and subscription. It only includes guests verified before the event. A guest who verifies afterwards can view current state on the shared page.

## Live setup

Configure these values only in the server environment:

- `EMAIL_MODE=live`
- `APP_URL` set to the exact deployed HTTPS app origin
- `RESEND_API_KEY` from the authorised Resend account
- `EMAIL_FROM` using an address on a verified sending domain
- `CRON_SECRET` as a random secret at least 24 characters long

The domain must be verified in Resend. The sending domain can differ from the Vercel app domain. No account, verified domain or provider credentials are provisioned by this implementation.

The app attempts dispatch on signup and should run the worker immediately after a state-change event is committed. `/api/jobs` accepts GET or POST with `Authorization: Bearer <CRON_SECRET>` for retry scheduling. It fails closed when the secret is missing. Pick a scheduler compatible with the actual Vercel plan. A daily schedule is only a delayed recovery mechanism, not a suitable first attempt for an action email. `maxDuration` is 60 seconds and the HTTP worker processes up to four messages, each with a ten-second provider timeout.

## Delivery and privacy

Verification and unsubscribe use separate random tokens, stored as hashes in the subscription table. Raw links are confined to private outbox payloads. A GET renders a confirmation form and POST changes consent, avoiding mail-scanner GETs silently opting in or withdrawing consent. Withdrawal deletes the subscription and cascades its outbox rows. Repeated removal is safe.

The worker checks the current guest claim, attendance, inclusion, dinner expiry and current stage before dispatch. Area-vote emails are suppressed if the guest already voted. Guest reset must delete `email_subscriptions` for that dinner and guest in the reset transaction, which cascades pending delivery. Dinner expiry cascades both. No guest locations, dietary details, attendee lists or email addresses appear in another guest's response or in log messages.

Concurrent workers lock and skip busy outbox rows. Resend receives a stable idempotency key. Retries stop after six attempts or twelve hours, within Resend's documented 24-hour idempotency window. Transport failures remain durable and do not report success. A provider may accept a message immediately before a network failure, which is why the same key and unchanged payload are retained for retry. Failed jobs need operator review and are not silently replayed after the deduplication window.

The tables have row-level security enabled with no browser policies. Use a server database owner or a role with appropriate application permissions, never a Supabase anon credential.

## Validation

`pnpm exec tsx --test tests/notifications.test.ts` runs pure validation, privacy, eligibility and fixture transport tests. Load `DATABASE_URL` for the isolated test database to run the integration case after migrations. The integration test uses unique synthetic records and deletes those records afterwards. The default no-database test explicitly skips that case.

Live delivery remains unverified until authorised Resend credentials, a verified sender and the deployed origin are configured. Do not infer inbox delivery from fixture tests.

## Sources

- [Resend send API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Verified sending domains](https://resend.com/docs/dashboard/domains/introduction)
