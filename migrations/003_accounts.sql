CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  email text NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_sessions (
  hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_sessions ENABLE ROW LEVEL SECURITY;
