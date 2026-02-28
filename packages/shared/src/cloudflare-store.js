import { BaseStore, createDefaultState } from "./store-base.js";

const LEGACY_TABLE = "_burstflare_state";
const LEGACY_STATE_KEY = "global";
const META_TABLE = "bf_state_meta";
const SCHEMA_VERSION_KEY = "schema_version";
const NORMALIZED_SCHEMA_VERSION = "1";

const TABLES = [
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

function nowIso() {
  return new Date().toISOString();
}

function resultsFromQuery(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result?.results)) {
    return result.results;
  }
  return [];
}

function serializeCollection(rows) {
  return JSON.stringify(Array.isArray(rows) ? rows : []);
}

function createTableSql(definition) {
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

function createIndexSql(table, column) {
  return `CREATE INDEX IF NOT EXISTS idx_${table}_${column} ON ${table} (${column});`;
}

function normalizeScope(collections) {
  if (!Array.isArray(collections) || collections.length === 0) {
    return null;
  }
  return Array.from(new Set(collections.filter(Boolean)));
}

class CloudflareStateStore extends BaseStore {
  constructor(db) {
    super();
    this.db = db;
    this.schemaReady = false;
    this.lastLoadSource = "empty";
    this.lastLoadScope = null;
  }

  async prepare(sql, bindings = []) {
    let statement = this.db.prepare(sql);
    if (bindings.length) {
      statement = statement.bind(...bindings);
    }
    return statement;
  }

  async run(sql, bindings = []) {
    const statement = await this.prepare(sql, bindings);
    return statement.run();
  }

  async first(sql, bindings = []) {
    const statement = await this.prepare(sql, bindings);
    return statement.first();
  }

  async all(sql, bindings = []) {
    const statement = await this.prepare(sql, bindings);
    return statement.all();
  }

  async listRowKeys(table) {
    const result = await this.all(`SELECT row_key FROM ${table} ORDER BY row_key ASC`);
    return resultsFromQuery(result).map((row) => row.row_key);
  }

  async ensureSchema() {
    if (this.schemaReady) {
      return;
    }

    await this.run(`
        CREATE TABLE IF NOT EXISTS ${LEGACY_TABLE} (
          id TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

    await this.run(`
        CREATE TABLE IF NOT EXISTS ${META_TABLE} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

    for (const definition of TABLES) {
      await this.run(createTableSql(definition));
      for (const column of definition.indexes || []) {
        await this.run(createIndexSql(definition.table, column));
      }
    }

    this.schemaReady = true;
  }

  async readMeta(key) {
    return this.first(`SELECT value FROM ${META_TABLE} WHERE key = ? LIMIT 1`, [key]);
  }

  async writeMeta(key, value) {
    await this.run(
      `
        INSERT INTO ${META_TABLE} (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `,
      [key, value, nowIso()]
    );
  }

  async readLegacyState() {
    return this.first(`SELECT value FROM ${LEGACY_TABLE} WHERE id = ? LIMIT 1`, [LEGACY_STATE_KEY]);
  }

  async hasNormalizedData() {
    for (const definition of TABLES) {
      const row = await this.first(`SELECT row_key FROM ${definition.table} LIMIT 1`);
      if (row?.row_key) {
        return true;
      }
    }
    return false;
  }

  async loadNormalizedState(collections = null) {
    const scope = normalizeScope(collections);
    const scopeSet = scope ? new Set(scope) : null;
    const state = createDefaultState();

    for (const definition of TABLES) {
      if (scopeSet && !scopeSet.has(definition.source)) {
        continue;
      }
      const result = await this.all(`SELECT payload_json FROM ${definition.table} ORDER BY position ASC, row_key ASC`);
      state[definition.source] = resultsFromQuery(result).map((row) => JSON.parse(row.payload_json));
    }

    return state;
  }

  async saveNormalizedState(nextState, previousState = null, options = {}) {
    const timestamp = nowIso();
    const scope = normalizeScope(options.collections);
    const scopeSet = scope ? new Set(scope) : null;

    for (const definition of TABLES) {
      if (scopeSet && !scopeSet.has(definition.source)) {
        continue;
      }
      const nextRows = Array.isArray(nextState[definition.source]) ? nextState[definition.source] : [];
      const previousRows = previousState ? previousState[definition.source] : null;
      if (previousRows && serializeCollection(previousRows) === serializeCollection(nextRows)) {
        continue;
      }

      const previousByKey = new Map();
      if (Array.isArray(previousRows)) {
        for (let index = 0; index < previousRows.length; index += 1) {
          const row = previousRows[index];
          const key = definition.keyOf(row, index);
          if (!key) {
            throw new Error(`Missing normalized row key for ${definition.source}[${index}]`);
          }
          previousByKey.set(key, {
            position: index,
            payload: JSON.stringify(row)
          });
        }
      }

      const existingKeys = new Set(Array.isArray(previousRows) ? previousByKey.keys() : await this.listRowKeys(definition.table));
      const nextKeys = new Set();
      const columnNames = definition.columns.map((column) => column.name);
      const insertColumns = ["row_key", "position", ...columnNames, "payload_json", "updated_at"];
      const placeholders = insertColumns.map(() => "?").join(", ");
      const updateColumns = ["position", ...columnNames, "payload_json", "updated_at"];
      const updateAssignments = updateColumns.map((column) => `${column} = excluded.${column}`).join(", ");

      for (let index = 0; index < nextRows.length; index += 1) {
        const row = nextRows[index];
        const key = definition.keyOf(row, index);
        if (!key) {
          throw new Error(`Missing normalized row key for ${definition.source}[${index}]`);
        }
        nextKeys.add(key);
        const payload = JSON.stringify(row);
        const previous = previousByKey.get(key);
        if (previous && previous.position === index && previous.payload === payload) {
          continue;
        }
        const values = [
          key,
          index,
          ...definition.columns.map((column) => row[column.field] ?? null),
          payload,
          timestamp
        ];
        await this.run(
          `INSERT INTO ${definition.table} (${insertColumns.join(", ")}) VALUES (${placeholders})
           ON CONFLICT(row_key) DO UPDATE SET ${updateAssignments}`,
          values
        );
      }

      for (const key of existingKeys) {
        if (nextKeys.has(key)) {
          continue;
        }
        await this.run(`DELETE FROM ${definition.table} WHERE row_key = ?`, [key]);
      }
    }

    await this.writeMeta(SCHEMA_VERSION_KEY, NORMALIZED_SCHEMA_VERSION);
  }

  async load() {
    await this.ensureSchema();
    this.lastLoadScope = null;

    const schemaVersion = await this.readMeta(SCHEMA_VERSION_KEY);
    if (schemaVersion?.value === NORMALIZED_SCHEMA_VERSION) {
      this.lastLoadSource = "normalized";
      return this.loadNormalizedState();
    }

    const legacy = await this.readLegacyState();
    if (legacy?.value) {
      this.lastLoadSource = "legacy";
      return { ...createDefaultState(), ...JSON.parse(legacy.value) };
    }

    if (await this.hasNormalizedData()) {
      await this.writeMeta(SCHEMA_VERSION_KEY, NORMALIZED_SCHEMA_VERSION);
      this.lastLoadSource = "normalized";
      return this.loadNormalizedState();
    }

    this.lastLoadSource = "empty";
    return createDefaultState();
  }

  async loadCollections(collections) {
    await this.ensureSchema();
    const scope = normalizeScope(collections);

    const schemaVersion = await this.readMeta(SCHEMA_VERSION_KEY);
    if (schemaVersion?.value === NORMALIZED_SCHEMA_VERSION) {
      this.lastLoadSource = "normalized";
      this.lastLoadScope = scope;
      return this.loadNormalizedState(scope);
    }

    const legacy = await this.readLegacyState();
    if (legacy?.value) {
      this.lastLoadSource = "legacy";
      this.lastLoadScope = null;
      return { ...createDefaultState(), ...JSON.parse(legacy.value) };
    }

    if (await this.hasNormalizedData()) {
      await this.writeMeta(SCHEMA_VERSION_KEY, NORMALIZED_SCHEMA_VERSION);
      this.lastLoadSource = "normalized";
      this.lastLoadScope = scope;
      return this.loadNormalizedState(scope);
    }

    this.lastLoadSource = "empty";
    this.lastLoadScope = scope;
    return createDefaultState();
  }

  async save(nextState, previousState = null, options = {}) {
    await this.ensureSchema();
    const normalizedPreviousState = this.lastLoadSource === "normalized" || this.lastLoadSource === "empty" ? previousState : null;
    const collections = normalizeScope(options.collections);
    const effectiveScope = this.lastLoadScope && collections ? this.lastLoadScope : null;
    await this.saveNormalizedState(nextState, normalizedPreviousState, { collections: effectiveScope });
    this.lastLoadSource = "normalized";
    this.lastLoadScope = null;
  }
}

export function createCloudflareStateStore(db) {
  return new CloudflareStateStore(db);
}
