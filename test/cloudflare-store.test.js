import test from "node:test";
import assert from "node:assert/strict";
import { createCloudflareStateStore } from "../packages/shared/src/cloudflare-store.js";

class MockD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.trim();
    this.bindings = [];
  }

  bind(...values) {
    this.bindings = values;
    return this;
  }

  async run() {
    return this.database.execute(this.sql, this.bindings);
  }

  async first() {
    const rows = await this.database.query(this.sql, this.bindings);
    return rows[0] || null;
  }

  async all() {
    return {
      results: await this.database.query(this.sql, this.bindings)
    };
  }
}

class MockD1Database {
  constructor() {
    this.tables = new Map();
  }

  prepare(sql) {
    return new MockD1Statement(this, sql);
  }

  ensureTable(name) {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name);
  }

  execute(sql, bindings) {
    if (sql.startsWith("CREATE TABLE IF NOT EXISTS")) {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/);
      if (match) {
        this.ensureTable(match[1]);
      }
      return { success: true };
    }

    if (sql.startsWith("CREATE INDEX IF NOT EXISTS")) {
      return { success: true };
    }

    if (sql.startsWith("DELETE FROM")) {
      const match = sql.match(/DELETE FROM\s+([a-zA-Z0-9_]+)/);
      if (match) {
        const table = this.ensureTable(match[1]);
        if (sql.includes("WHERE row_key = ?")) {
          table.delete(bindings[0]);
        } else {
          table.clear();
        }
      }
      return { success: true };
    }

    if (sql.startsWith("INSERT INTO")) {
      const match = sql.match(/INSERT INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)/);
      if (!match) {
        throw new Error(`Unsupported insert statement: ${sql}`);
      }
      const [, tableName, columnList] = match;
      const table = this.ensureTable(tableName);
      const columns = columnList.split(",").map((column) => column.trim());
      const row = {};
      for (let index = 0; index < columns.length; index += 1) {
        row[columns[index]] = bindings[index] ?? null;
      }
      const key = row.row_key ?? row.key ?? row.id;
      if (!key) {
        throw new Error(`Missing primary key for ${tableName}`);
      }
      table.set(key, row);
      return { success: true };
    }

    throw new Error(`Unsupported run statement: ${sql}`);
  }

  query(sql, bindings) {
    if (sql.startsWith("SELECT value FROM")) {
      const match = sql.match(/SELECT value FROM\s+([a-zA-Z0-9_]+)/);
      if (!match) {
        throw new Error(`Unsupported select statement: ${sql}`);
      }
      const [, tableName] = match;
      const table = this.ensureTable(tableName);
      const key = bindings[0];
      const row = table.get(key);
      return row ? [{ value: row.value }] : [];
    }

    if (sql.startsWith("SELECT row_key FROM")) {
      const match = sql.match(/SELECT row_key FROM\s+([a-zA-Z0-9_]+)/);
      if (!match) {
        throw new Error(`Unsupported row-key select: ${sql}`);
      }
      const [, tableName] = match;
      const table = this.ensureTable(tableName);
      return Array.from(table.values())
        .sort((left, right) => String(left.row_key).localeCompare(String(right.row_key)))
        .map((row) => ({ row_key: row.row_key }));
    }

    if (sql.startsWith("SELECT payload_json FROM")) {
      const match = sql.match(/SELECT payload_json FROM\s+([a-zA-Z0-9_]+)/);
      if (!match) {
        throw new Error(`Unsupported payload select: ${sql}`);
      }
      const [, tableName] = match;
      const table = this.ensureTable(tableName);
      return Array.from(table.values())
        .sort((left, right) => {
          if (left.position !== right.position) {
            return left.position - right.position;
          }
          return String(left.row_key).localeCompare(String(right.row_key));
        })
        .map((row) => ({ payload_json: row.payload_json }));
    }

    throw new Error(`Unsupported query statement: ${sql}`);
  }
}

test("cloudflare store projects legacy state into normalized tables on save and preserves array order", async () => {
  const db = new MockD1Database();
  const legacyState = {
    users: [
      {
        id: "usr_2",
        email: "zeta@example.com",
        name: "Zeta",
        createdAt: "2026-02-28T00:00:00.000Z"
      },
      {
        id: "usr_1",
        email: "alpha@example.com",
        name: "Alpha",
        createdAt: "2026-02-28T00:00:01.000Z"
      }
    ],
    sessions: [
      {
        id: "ses_z",
        workspaceId: "ws_1",
        templateId: "tpl_1",
        name: "z-first",
        state: "running",
        createdByUserId: "usr_2",
        createdAt: "2026-02-28T00:00:00.000Z",
        updatedAt: "2026-02-28T00:00:00.000Z"
      },
      {
        id: "ses_a",
        workspaceId: "ws_1",
        templateId: "tpl_1",
        name: "a-second",
        state: "sleeping",
        createdByUserId: "usr_1",
        createdAt: "2026-02-28T00:00:01.000Z",
        updatedAt: "2026-02-28T00:00:01.000Z"
      }
    ]
  };

  await db
    .prepare(
      `
        INSERT INTO _burstflare_state (id, value, updated_at)
        VALUES (?, ?, ?)
      `
    )
    .bind("global", JSON.stringify(legacyState), "2026-02-28T00:00:02.000Z")
    .run();

  const store = createCloudflareStateStore(db);
  const loaded = await store.load();
  await store.save(loaded);
  const loadedAgain = await store.load();

  assert.deepEqual(loaded.users.map((entry) => entry.id), ["usr_2", "usr_1"]);
  assert.deepEqual(loadedAgain.users.map((entry) => entry.id), ["usr_2", "usr_1"]);
  assert.deepEqual(loaded.sessions.map((entry) => entry.id), ["ses_z", "ses_a"]);
  assert.deepEqual(loadedAgain.sessions.map((entry) => entry.id), ["ses_z", "ses_a"]);

  const meta = await db.prepare("SELECT value FROM bf_state_meta WHERE key = ? LIMIT 1").bind("schema_version").first();
  assert.equal(meta.value, "1");

  const normalizedUsers = await db.prepare("SELECT payload_json FROM bf_users ORDER BY position ASC, row_key ASC").all();
  assert.equal(normalizedUsers.results.length, 2);
});
