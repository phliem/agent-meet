# Implementation verification

Verified locally on 7 November 2026.

- TypeScript no-emit check and ESLint pass.
- Production Next.js build passes.
- 81 unit, provider contract and isolated Postgres integration tests pass without skips.
- Eight Playwright scenarios pass together against the production build, including the six-person V1 dinner flow, a separate-browser claim/privacy check, account-dinner public-view isolation, V2 venue-evidence/fallback presentation, form network-error recovery, availability-window removal, the complete flexible-date no-overlap/reopen/early-vote-closure flow, and tie/disagreement resolution. Each spec owns its database fixture connection.
- Independent read-only review found a doubled worker budget and stale reminder eligibility time. Both were fixed with a regression test covering the shared delivery cap and a slow earlier send crossing a deadline.
- A separate regression protects returning account guests opening an already-consumed invitation after the reply deadline.
- Provider work is deduplicated per dinner with database leases, and stale results are rejected by version checks.
- A subsequent independent review fixed skipped email events starving later updates, disabled accounts retaining alternate-contact subscriptions, reset guests remaining excluded, and automatic selection of recommended venues. Decline subscription cleanup is now transactional. Each fix has regression coverage.
- Provider payloads are bounded while streaming. Public raw venue responses have a bounded, per-process cache; private filters are reapplied per dinner and cache consumers keep their own operation deadlines. These constraints have fake-transport regression coverage.
- A live smoke check exposed TfL interchange hubs wrapping the requested station IDs. The adapter now finds exact child stops; a nested-hub contract regression passes. Public postcode lookup and a separate public timed TfL journey succeeded. The full live smoke still reports a service-unavailable error, so complete live coverage remains unverified.
- Calendar text handles lone carriage returns as well as LF/CRLF without adding properties or events.
- A commit-pinned GitHub Actions workflow now provisions disposable Postgres, checks the code and runs production browser flows. Local equivalent checks passed; a remote run must be observed separately.
- The initial remote CI run on commit e2d07a3 passed, including the original seven production browser scenarios. Later changes must receive their own run.
- An additional opt-in production browser test exercises the actual account controls and server actions against a local HTTPS Supabase REST double with a trusted temporary CA. It passes OTP validation/recovery, intended-email rejection, a second browser, private origins, budgets, consent, voting and confirmation. This is mocked provider coverage, not live Supabase or inbox verification.
- Background provider and delivery work now shares an absolute deadline from action entry; exhausted worker budgets preserve queued events and still clean expired data. This prevents each phase starting a fresh time budget inside the page's 60-second function limit.
- An optional GitHub worker workflow is prepared but inactive until the owner configures its production origin/secret and enables it. No production scheduler has been activated.
- The organiser can change duration before voting; replies and the included group survive while dependent planning results are invalidated. Closed votes expose aggregate counts and only valid resolution choices. The organiser-only food checklist contains structured group diets and rejected cuisines without identities; Other notes stay private. Pure authority/privacy tests and browser coverage verify these behaviours.

V2 requires explicit enablement for new dinners. Existing V1 dinners retain their original identity and behaviour. The Supabase authentication adapter has no development authentication bypass. Its network contract is tested with mocks; actual provider configuration, inbox OTP and cross-device HTTPS sign-in still need live verification.

Reminder and update transport tests use a fake sender. They do not establish real email delivery. A frequent authenticated production scheduler and verified Resend sender must be configured before relying on delivery or expiry cleanup.

The OSM restaurant adapter cannot reliably establish price and future opening-hour evidence. Automatic V2 recommendations therefore fall back honestly when evidence is insufficient. Fixture recommendations are synthetic examples. Complete live restaurant coverage remains a release check.

The Lab metadata entry is created with the public repository link. The live application link is empty until a deployment is verified. Liem selected MIT; the licence is recorded in LICENSE and package metadata. The full clickable design review and production setup remain outstanding.
