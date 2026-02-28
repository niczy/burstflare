import { BaseStore, createDefaultState } from "./store-base.js";
import {
  META_TABLE,
  NORMALIZED_SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  TABLES,
  createIndexSql,
  createTableSql
} from "./cloudflare-schema.js";

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
