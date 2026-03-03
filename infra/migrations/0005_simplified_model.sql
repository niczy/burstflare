CREATE TABLE IF NOT EXISTS bf_instances (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  user_id TEXT,
  name TEXT,
  image TEXT,
  created_at TEXT,
  updated_at_field TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bf_instances_user_id ON bf_instances (user_id);
CREATE INDEX IF NOT EXISTS idx_bf_instances_name ON bf_instances (name);
CREATE INDEX IF NOT EXISTS idx_bf_instances_image ON bf_instances (image);
