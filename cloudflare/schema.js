// Idempotent bootstrap: a new Cloudflare deployment needs no manual SQL setup.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  school_id TEXT NOT NULL,
  lookup_name TEXT NOT NULL,
  data TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','deleting')),
  reserved_bytes INTEGER NOT NULL,
  model_bytes INTEGER NOT NULL,
  preview_bytes INTEGER NOT NULL,
  model_key TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  model_done INTEGER NOT NULL DEFAULT 0,
  preview_done INTEGER NOT NULL DEFAULT 0,
  model_lease INTEGER NOT NULL DEFAULT 0,
  preview_lease INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  pending_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS submissions_lookup ON submissions(school_id,lookup_name,state,expires_at);
CREATE INDEX IF NOT EXISTS submissions_expiry ON submissions(state, expires_at);
CREATE INDEX IF NOT EXISTS submissions_pending ON submissions(state, pending_until);
CREATE TABLE IF NOT EXISTS revoked_sessions (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
`;
export async function initialiseDatabase(db) {
  const statements=SCHEMA.split(';').map(sql=>sql.trim()).filter(Boolean);
  await db.batch(statements.map(sql=>db.prepare(sql)));
}
