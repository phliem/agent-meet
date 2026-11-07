CREATE TABLE IF NOT EXISTS reminder_jobs (
  id text PRIMARY KEY,
  dinner_id text NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  guest_id text NOT NULL,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  claim_hash text NOT NULL,
  deadline timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','fixture','suppressed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  UNIQUE(dinner_id,guest_id,deadline,claim_hash)
);
CREATE INDEX IF NOT EXISTS reminder_jobs_pending ON reminder_jobs(available_at) WHERE status='pending';
ALTER TABLE reminder_jobs ENABLE ROW LEVEL SECURITY;
