CREATE TABLE IF NOT EXISTS email_subscriptions (
  id text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('dinner', 'waitlist')),
  dinner_id text REFERENCES dinners(id) ON DELETE CASCADE,
  guest_id text,
  guest_claim_hash text,
  email text NOT NULL,
  verification_hash text UNIQUE NOT NULL,
  verification_expires_at timestamptz NOT NULL,
  unsubscribe_hash text UNIQUE NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'dinner' AND dinner_id IS NOT NULL AND guest_id IS NOT NULL AND guest_claim_hash IS NOT NULL) OR (scope = 'waitlist' AND dinner_id IS NULL AND guest_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS email_subscription_guest ON email_subscriptions(dinner_id, guest_id) WHERE scope = 'dinner';
CREATE UNIQUE INDEX IF NOT EXISTS email_subscription_waitlist ON email_subscriptions(email) WHERE scope = 'waitlist';
CREATE TABLE IF NOT EXISTS email_outbox (
  id text PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES email_subscriptions(id) ON DELETE CASCADE,
  event_key text UNIQUE NOT NULL,
  kind text NOT NULL CHECK (kind IN ('verification', 'area-voting', 'confirmed')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'fixture', 'suppressed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_outbox_pending ON email_outbox(available_at) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS email_request_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  requests integer NOT NULL DEFAULT 1
);
-- Server-side Postgres connections own these tables. No browser/PostgREST role gets a policy.
ALTER TABLE email_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_request_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE dinners ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE dinner_events ENABLE ROW LEVEL SECURITY;
