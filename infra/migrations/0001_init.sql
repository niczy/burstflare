CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE workspace_memberships (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  active_version_id TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  build_log_key TEXT,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  state TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE session_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE binding_releases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
