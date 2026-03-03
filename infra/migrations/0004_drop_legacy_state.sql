INSERT INTO bf_state_meta (key, value, updated_at)
VALUES ('schema_version', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;

DROP TABLE IF EXISTS _burstflare_state;

-- 0005_simplified_model.sql
CREATE TABLE IF NOT EXISTS bf_instances (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  user_id TEXT,
  name TEXT,
  image TEXT,
  created_at TEXT,
  updated_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at_field TEXT
);
CREATE INDEX IF NOT EXISTS idx_bf_instances_user_id ON bf_instances (user_id);
CREATE INDEX IF NOT EXISTS idx_bf_instances_name ON bf_instances (name);

-- Sessions now reference instance_id in normalized payload/column index
CREATE INDEX IF NOT EXISTS idx_bf_sessions_instance_id ON bf_sessions (instance_id);
