// @ts-check

export const LEGACY_TABLE = "_burstflare_state";
export const LEGACY_STATE_KEY = "global";
export const META_TABLE = "bf_state_meta";
export const SCHEMA_VERSION_KEY = "schema_version";
export const NORMALIZED_SCHEMA_VERSION = "1";

export const TABLES = [
  {
    source: "users",
    table: "bf_users",
    keyOf: (row) => row.id,
    columns: [
      { name: "email", field: "email" },
      { name: "created_at", field: "createdAt" }
    ],
    indexes: ["email"]
  },
  {
    source: "workspaces",
    table: "bf_workspaces",
    keyOf: (row) => row.id,
    columns: [
      { name: "owner_user_id", field: "ownerUserId" },
      { name: "plan", field: "plan" },
      { name: "created_at", field: "createdAt" }
    ],
    indexes: ["owner_user_id", "plan"]
  },
  {
    source: "memberships",
    table: "bf_workspace_memberships",
    keyOf: (row) => `${row.workspaceId}:${row.userId}`,
    columns: [
      { name: "workspace_id", field: "workspaceId" },
      { name: "user_id", field: "userId" },
      { name: "role", field: "role" },
      { name: "created_at", field: "createdAt" }
    ],
    indexes: ["workspace_id", "user_id"]
  },
  {
    source: "workspaceInvites",
    table: "bf_workspace_invites",
    keyOf: (row) => row.id,
    columns: [
      { name: "workspace_id", field: "workspaceId" },
      { name: "email", field: "email" },
      { name: "code", field: "code" },
      { name: "status", field: "status" },
      { name: "expires_at", field: "expiresAt" }
    ],
    indexes: ["workspace_id", "email", "code", "status"]
  },
  {
    source: "authTokens",
    table: "bf_auth_tokens",
    keyOf: (row) => row.token,
    columns: [
      { name: "token_id", field: "id" },
      { name: "user_id", field: "userId" },
      { name: "workspace_id", field: "workspaceId" },
      { name: "kind", field: "kind" },
      { name: "session_id", field: "sessionId" },
      { name: "session_group_id", field: "sessionGroupId" },
      { name: "expires_at", field: "expiresAt" },
      { name: "revoked_at", field: "revokedAt" }
    ],
    indexes: ["user_id", "workspace_id", "kind", "session_id", "session_group_id"]
  },
  {
    source: "deviceCodes",
    table: "bf_device_codes",
    keyOf: (row) => row.code,
    columns: [
      { name: "user_id", field: "userId" },
      { name: "workspace_id", field: "workspaceId" },
      { name: "status", field: "status" },
      { name: "expires_at", field: "expiresAt" }
    ],
    indexes: ["user_id", "workspace_id", "status"]
  },
  {
    source: "templates",
    table: "bf_templates",
    keyOf: (row) => row.id,
    columns: [
      { name: "workspace_id", field: "workspaceId" },
      { name: "active_version_id", field: "activeVersionId" },
      { name: "archived_at", field: "archivedAt" },
      { name: "created_by_user_id", field: "createdByUserId" }
    ],
    indexes: ["workspace_id", "active_version_id", "archived_at"]
  },
  {
    source: "templateVersions",
    table: "bf_template_versions",
    keyOf: (row) => row.id,
    columns: [
      { name: "template_id", field: "templateId" },
      { name: "version", field: "version" },
      { name: "status", field: "status" },
      { name: "created_at", field: "createdAt" }
    ],
    indexes: ["template_id", "version", "status"]
  },
  {
    source: "templateBuilds",
    table: "bf_template_builds",
    keyOf: (row) => row.id,
    columns: [
      { name: "template_version_id", field: "templateVersionId" },
      { name: "status", field: "status" },
      { name: "created_at", field: "createdAt" },
      { name: "updated_at_field", field: "updatedAt" }
    ],
    indexes: ["template_version_id", "status"]
  },
  {
    source: "bindingReleases",
    table: "bf_binding_releases",
    keyOf: (row) => row.id,
    columns: [
      { name: "workspace_id", field: "workspaceId" },
      { name: "template_id", field: "templateId" },
      { name: "template_version_id", field: "templateVersionId" },
      { name: "created_at", field: "createdAt" }
    ],
    indexes: ["workspace_id", "template_id", "template_version_id"]
  },
  {
    source: "sessions",
    table: "bf_sessions",
    keyOf: (row) => row.id,
    columns: [
      { name: "workspace_id", field: "workspaceId" },
      { name: "template_id", field: "templateId" },
      { name: "state", field: "state" },
      { name: "name", field: "name" },
      { name: "updated_at_field", field: "updatedAt" }
    ],
    indexes: ["workspace_id", "template_id", "state", "name"]
  },
  {
    source: "sessionEvents",
    table: "bf_session_events",
    keyOf: (row) => row.id,
    columns: [
      { name: "session_id", field: "sessionId" },
      { name: "state", field: "state" },
      { name: "created_at", field: "createdAt" }
    ],
    indexes: ["session_id", "state"]
  },
  {
    source: "snapshots",
    table: "bf_snapshots",
    keyOf: (row) => row.id,
    columns: [
      { name: "session_id", field: "sessionId" },
      { name: "label", field: "label" },
      { name: "created_at", field: "createdAt" }
    ],
    indexes: ["session_id", "label"]
  },
  {
    source: "uploadGrants",
    table: "bf_upload_grants",
    keyOf: (row) => row.id,
    columns: [
      { name: "kind", field: "kind" },
      { name: "workspace_id", field: "workspaceId" },
      { name: "expires_at", field: "expiresAt" },
      { name: "used_at", field: "usedAt" }
    ],
    indexes: ["kind", "workspace_id"]
  },
  {
    source: "usageEvents",
    table: "bf_usage_events",
    keyOf: (row) => row.id,
    columns: [
      { name: "workspace_id", field: "workspaceId" },
      { name: "kind", field: "kind" },
      { name: "created_at", field: "createdAt" }
    ],
    indexes: ["workspace_id", "kind"]
  },
  {
    source: "auditLogs",
    table: "bf_audit_logs",
    keyOf: (row) => row.id,
    columns: [
      { name: "workspace_id", field: "workspaceId" },
      { name: "actor_user_id", field: "actorUserId" },
      { name: "action", field: "action" },
      { name: "created_at", field: "createdAt" }
    ],
    indexes: ["workspace_id", "actor_user_id", "action"]
  }
];

export function createTableSql(definition) {
  const extraColumns = definition.columns
    .map((column) => `,\n          ${column.name} TEXT`)
    .join("");
  return `
        CREATE TABLE IF NOT EXISTS ${definition.table} (
          row_key TEXT PRIMARY KEY,
          position INTEGER NOT NULL${extraColumns},
          payload_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `;
}

export function createIndexSql(table, column) {
  return `CREATE INDEX IF NOT EXISTS idx_${table}_${column} ON ${table} (${column});`;
}
