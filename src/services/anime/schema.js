// Additive, idempotent migration shared by runtime and scripts/migrate.js.
export const animeTableStatements = [
  `CREATE TABLE IF NOT EXISTS anime_documents (
    scope TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(scope,id)
  )`,
  `CREATE TABLE IF NOT EXISTS anime_jobs (
    id BIGSERIAL PRIMARY KEY, unique_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
    payload JSONB NOT NULL, run_at TIMESTAMPTZ NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending', lease_until TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS anime_jobs_due ON anime_jobs(state,run_at)`,
  `CREATE TABLE IF NOT EXISTS anime_deliveries (
    job_id BIGINT PRIMARY KEY REFERENCES anime_jobs(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL, message_id TEXT, state TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS anime_locks (name TEXT PRIMARY KEY, until_at TIMESTAMPTZ NOT NULL, owner TEXT)`,
  `ALTER TABLE anime_locks ADD COLUMN IF NOT EXISTS owner TEXT`,
];
