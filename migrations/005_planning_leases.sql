CREATE TABLE IF NOT EXISTS planning_leases (
  dinner_id text PRIMARY KEY REFERENCES dinners(id) ON DELETE CASCADE,
  owner_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE planning_leases ENABLE ROW LEVEL SECURITY;
