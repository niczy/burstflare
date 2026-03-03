ALTER TABLE bf_instances ADD COLUMN common_state_key TEXT;
ALTER TABLE bf_instances ADD COLUMN common_state_bytes TEXT;
ALTER TABLE bf_instances ADD COLUMN common_state_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bf_instances_common_state_updated_at ON bf_instances (common_state_updated_at);
