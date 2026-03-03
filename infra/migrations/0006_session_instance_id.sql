ALTER TABLE bf_sessions ADD COLUMN instance_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bf_sessions_instance_id ON bf_sessions (instance_id);
