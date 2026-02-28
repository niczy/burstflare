CREATE TABLE IF NOT EXISTS bf_state_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bf_users (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  email TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_users_email ON bf_users (email);

CREATE TABLE IF NOT EXISTS bf_workspaces (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  owner_user_id TEXT,
  plan TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_workspaces_owner_user_id ON bf_workspaces (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_bf_workspaces_plan ON bf_workspaces (plan);

CREATE TABLE IF NOT EXISTS bf_workspace_memberships (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  workspace_id TEXT,
  user_id TEXT,
  role TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_workspace_memberships_workspace_id ON bf_workspace_memberships (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bf_workspace_memberships_user_id ON bf_workspace_memberships (user_id);

CREATE TABLE IF NOT EXISTS bf_workspace_invites (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  workspace_id TEXT,
  email TEXT,
  code TEXT,
  status TEXT,
  expires_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_workspace_invites_workspace_id ON bf_workspace_invites (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bf_workspace_invites_email ON bf_workspace_invites (email);
CREATE INDEX IF NOT EXISTS idx_bf_workspace_invites_code ON bf_workspace_invites (code);
CREATE INDEX IF NOT EXISTS idx_bf_workspace_invites_status ON bf_workspace_invites (status);

CREATE TABLE IF NOT EXISTS bf_auth_tokens (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  token_id TEXT,
  user_id TEXT,
  workspace_id TEXT,
  kind TEXT,
  session_id TEXT,
  session_group_id TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_auth_tokens_user_id ON bf_auth_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_bf_auth_tokens_workspace_id ON bf_auth_tokens (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bf_auth_tokens_kind ON bf_auth_tokens (kind);
CREATE INDEX IF NOT EXISTS idx_bf_auth_tokens_session_id ON bf_auth_tokens (session_id);
CREATE INDEX IF NOT EXISTS idx_bf_auth_tokens_session_group_id ON bf_auth_tokens (session_group_id);

CREATE TABLE IF NOT EXISTS bf_device_codes (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  user_id TEXT,
  workspace_id TEXT,
  status TEXT,
  expires_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_device_codes_user_id ON bf_device_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_bf_device_codes_workspace_id ON bf_device_codes (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bf_device_codes_status ON bf_device_codes (status);

CREATE TABLE IF NOT EXISTS bf_templates (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  workspace_id TEXT,
  active_version_id TEXT,
  archived_at TEXT,
  created_by_user_id TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_templates_workspace_id ON bf_templates (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bf_templates_active_version_id ON bf_templates (active_version_id);
CREATE INDEX IF NOT EXISTS idx_bf_templates_archived_at ON bf_templates (archived_at);

CREATE TABLE IF NOT EXISTS bf_template_versions (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  template_id TEXT,
  version TEXT,
  status TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_template_versions_template_id ON bf_template_versions (template_id);
CREATE INDEX IF NOT EXISTS idx_bf_template_versions_version ON bf_template_versions (version);
CREATE INDEX IF NOT EXISTS idx_bf_template_versions_status ON bf_template_versions (status);

CREATE TABLE IF NOT EXISTS bf_template_builds (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  template_version_id TEXT,
  status TEXT,
  created_at TEXT,
  updated_at_field TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_template_builds_template_version_id ON bf_template_builds (template_version_id);
CREATE INDEX IF NOT EXISTS idx_bf_template_builds_status ON bf_template_builds (status);

CREATE TABLE IF NOT EXISTS bf_binding_releases (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  workspace_id TEXT,
  template_id TEXT,
  template_version_id TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_binding_releases_workspace_id ON bf_binding_releases (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bf_binding_releases_template_id ON bf_binding_releases (template_id);
CREATE INDEX IF NOT EXISTS idx_bf_binding_releases_template_version_id ON bf_binding_releases (template_version_id);

CREATE TABLE IF NOT EXISTS bf_sessions (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  workspace_id TEXT,
  template_id TEXT,
  state TEXT,
  name TEXT,
  updated_at_field TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_sessions_workspace_id ON bf_sessions (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bf_sessions_template_id ON bf_sessions (template_id);
CREATE INDEX IF NOT EXISTS idx_bf_sessions_state ON bf_sessions (state);
CREATE INDEX IF NOT EXISTS idx_bf_sessions_name ON bf_sessions (name);

CREATE TABLE IF NOT EXISTS bf_session_events (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  session_id TEXT,
  state TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_session_events_session_id ON bf_session_events (session_id);
CREATE INDEX IF NOT EXISTS idx_bf_session_events_state ON bf_session_events (state);

CREATE TABLE IF NOT EXISTS bf_snapshots (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  session_id TEXT,
  label TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_snapshots_session_id ON bf_snapshots (session_id);
CREATE INDEX IF NOT EXISTS idx_bf_snapshots_label ON bf_snapshots (label);

CREATE TABLE IF NOT EXISTS bf_upload_grants (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  kind TEXT,
  workspace_id TEXT,
  expires_at TEXT,
  used_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_upload_grants_kind ON bf_upload_grants (kind);
CREATE INDEX IF NOT EXISTS idx_bf_upload_grants_workspace_id ON bf_upload_grants (workspace_id);

CREATE TABLE IF NOT EXISTS bf_usage_events (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  workspace_id TEXT,
  kind TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_usage_events_workspace_id ON bf_usage_events (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bf_usage_events_kind ON bf_usage_events (kind);

CREATE TABLE IF NOT EXISTS bf_audit_logs (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  workspace_id TEXT,
  actor_user_id TEXT,
  action TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_audit_logs_workspace_id ON bf_audit_logs (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bf_audit_logs_actor_user_id ON bf_audit_logs (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_bf_audit_logs_action ON bf_audit_logs (action);
