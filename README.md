# Agent Meet

Plan a London dinner with a fair trip there and home. An invited organiser shares a link, guests reply and vote on an area, and the organiser checks and confirms a restaurant.

## Local setup

Requires Node 24+, corepack/pnpm and Docker. This repository has its own dependencies and database.

1. Run `corepack pnpm install`.
2. Copy `.env.example` to ignored `.env.local`. Generate a random local database password and set `POSTGRES_PASSWORD`. Set `DATABASE_URL` to the matching local `agent_meet` Postgres connection on port 55439. Set `APP_URL=http://localhost:3000`, `DATA_MODE=fixture` and `EMAIL_MODE=fixture` for a clearly labelled local preview.
3. Run `docker compose --env-file .env.local up -d db`.
4. Run `corepack pnpm db:migrate`.
5. Run `corepack pnpm dev`.
6. Run `corepack pnpm invite` privately. Open the single-use invitation in the browser you will use as organiser. Other browsers see the creator waitlist.

The invitation output is a private access link. Keep it out of screenshots, issue comments and public logs. The app has no self-service organiser recovery in V1. A dinner organiser can reset a guest before voting to release their name and clear their old reply.

## What works in V1

- Fixed-date or flexible availability flow, including declines and deadline extension.
- Server-enforced browser claims for guests, organiser controls and invite-only creation.
- Shared time windows, fair area ranking across outward and return trips, and favourite/acceptable/none ballots.
- Organiser review of restaurant evidence, manual venue entry and read-only confirmation.
- Optional verified dinner emails and a separate creator waitlist.
- Group-chat copy actions and one-time Google/Apple calendar export.
- Responsive Dinner Poll layout and marketing homepage.

The remaining V2 tickets cover authenticated accounts/personal invitations, automatic deadline reminders, budget bands and recommending one venue for confirmation. These are not included in the current build.

## Data and email modes

Fixture mode uses synthetic estimates and fictional restaurant names. It is visibly marked in the interface. Switching `DATA_MODE` does not relabel existing dinners; start a new dinner after changing modes. Live adapters use TfL, Postcodes.io and OpenStreetMap. Coverage, credentials, attribution and limitations are documented in [docs/providers.md](docs/providers.md). Unknown venue facts remain unknown; organisers must verify suitability.

Email setup, confirmation and opt-out behaviour, Resend configuration, and retry scheduling are documented in [docs/email.md](docs/email.md). Local fixture verification links preview the workflow and do not mean that an email was delivered.

## Supabase and Vercel

Deploy this repository's root as a Next.js app. Production uses Supabase Postgres through a server-side connection string. A transaction-pooler connection is suitable for the application with prepared statements disabled. Use a direct/session connection in `MIGRATION_DATABASE_URL` when running schema migrations. Confirm the connection method and SSL settings against your Supabase project before deployment.

Set all server credentials only in Vercel's server environment configuration. `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM` and `CRON_SECRET` must never have a `NEXT_PUBLIC_` prefix. Keep preview and production databases separate. Set `APP_URL` to the actual deployment URL and `DATA_MODE=live` only after validating live coverage. `EMAIL_MODE=live` requires a configured Resend sender and verified domain. Optional `NEXT_PUBLIC_REPO_URL` may identify this public repository in the footer once it exists.

All database tables have row-level security enabled without browser policies. The application uses its server database connection rather than exposing database access to clients. Never put the server database credential in a browser.

Migrations are explicit and tracked under `migrations/`. Do not run them on an existing production database without review and a backup. Deploying, paid service setup and applying changes to real data require their own release step.

The application attempts event-triggered work after committed changes. Configure an authenticated frequent retry worker for production through `/api/jobs` or the documented local job runner. The worker also deletes expired dinners and dependent content. Vercel plan restrictions must be accounted for; a daily retry schedule cannot promise timely email delivery.

## Verification

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm exec playwright test` with the local app and database running

Database integration tests run when `DATABASE_URL` is configured. Use the isolated local database for tests. E2E test data is synthetic. Secret scanning and a review of the tracked file list and Git history are required before publishing.

## Open-source release

The intended repository is public. The licence decision is pending owner confirmation. Do not represent the code as licensed under MIT, Apache or another licence until the chosen licence is added. Contributions and deployment examples must use synthetic data and placeholder credentials.
