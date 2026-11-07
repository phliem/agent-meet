CREATE TABLE IF NOT EXISTS dinners (
  id text PRIMARY KEY,
  document jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_invites (
  hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz
);
CREATE TABLE IF NOT EXISTS pilot_access (
  hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS dinner_events (
  id text PRIMARY KEY,
  dinner_id text NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('area-voting', 'confirmed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
