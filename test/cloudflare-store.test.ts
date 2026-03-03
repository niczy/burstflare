import test from "node:test";
import assert from "node:assert/strict";
import { createCloudflareStateStore } from "@burstflare/shared";

class MockD1Statement {
  database: MockD1Database;
  sql: string;
  bindings: unknown[];

  constructor(database: MockD1Database, sql: string) {
    this.database = database;
    this.sql = sql.trim();
    this.bindings = [];
  }

  bind(...values: unknown[]) {
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
  tables: Map<string, Map<unknown, Record<string, unknown>>>;

  constructor() {
    this.tables = new Map();
  }

  prepare(sql: string) {
    return new MockD1Statement(this, sql);
  }

  ensureTable(name: string) {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name)!;
  }

  execute(sql: string, bindings: unknown[]): { success: boolean } {
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
      const row: Record<string, unknown> = {};
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

  query(sql: string, bindings: unknown[]): Record<string, unknown>[] {
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
            return (left.position as number) - (right.position as number);
          }
          return String(left.row_key).localeCompare(String(right.row_key));
        })
        .map((row) => ({ payload_json: row.payload_json }));
    }

    throw new Error(`Unsupported query statement: ${sql}`);
  }
}

test("cloudflare store loads normalized state without legacy fallback and preserves array order", async () => {
  const db = new MockD1Database();

  await db
    .prepare(
      `
        INSERT INTO bf_users (row_key, position, email, created_at, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      "usr_2",
      0,
      "zeta@example.com",
      "2026-02-28T00:00:00.000Z",
      JSON.stringify({
        id: "usr_2",
        email: "zeta@example.com",
        name: "Zeta",
        createdAt: "2026-02-28T00:00:00.000Z"
      }),
      "2026-02-28T00:00:00.000Z"
    )
    .run();

  await db
    .prepare(
      `
        INSERT INTO bf_users (row_key, position, email, created_at, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      "usr_1",
      1,
      "alpha@example.com",
      "2026-02-28T00:00:01.000Z",
      JSON.stringify({
        id: "usr_1",
        email: "alpha@example.com",
        name: "Alpha",
        createdAt: "2026-02-28T00:00:01.000Z"
      }),
      "2026-02-28T00:00:01.000Z"
    )
    .run();

  await db
    .prepare(
      `
        INSERT INTO bf_sessions (row_key, position, workspace_id, template_id, instance_id, state, name, updated_at_field, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      "ses_z",
      0,
      "ws_1",
      "tpl_1",
      "ins_1",
      "running",
      "z-first",
      "2026-02-28T00:00:00.000Z",
      JSON.stringify({
        id: "ses_z",
        workspaceId: "ws_1",
        templateId: "tpl_1",
        instanceId: "ins_1",
        name: "z-first",
        state: "running",
        createdByUserId: "usr_2",
        createdAt: "2026-02-28T00:00:00.000Z",
        updatedAt: "2026-02-28T00:00:00.000Z"
      }),
      "2026-02-28T00:00:00.000Z"
    )
    .run();

  await db
    .prepare(
      `
        INSERT INTO bf_sessions (row_key, position, workspace_id, template_id, instance_id, state, name, updated_at_field, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      "ses_a",
      1,
      "ws_1",
      "tpl_1",
      null,
      "sleeping",
      "a-second",
      "2026-02-28T00:00:01.000Z",
      JSON.stringify({
        id: "ses_a",
        workspaceId: "ws_1",
        templateId: "tpl_1",
        instanceId: null,
        name: "a-second",
        state: "sleeping",
        createdByUserId: "usr_1",
        createdAt: "2026-02-28T00:00:01.000Z",
        updatedAt: "2026-02-28T00:00:01.000Z"
      }),
      "2026-02-28T00:00:01.000Z"
    )
    .run();

  const store = createCloudflareStateStore(db);
  const loaded = await store.load();

  assert.deepEqual(loaded.users.map((entry: any) => entry.id), ["usr_2", "usr_1"]);
  assert.deepEqual(loaded.sessions.map((entry: any) => entry.id), ["ses_z", "ses_a"]);
  assert.equal(loaded.sessions[0].instanceId, "ins_1");
  assert.equal(loaded.sessions[1].instanceId, null);

  const meta = await db.prepare("SELECT value FROM bf_state_meta WHERE key = ? LIMIT 1").bind("schema_version").first();
  assert.equal(meta.value, "1");
});

test("cloudflare store can load and save a scoped normalized collection without wiping unrelated tables", async () => {
  const db = new MockD1Database();

  await db
    .prepare(
      `
        INSERT INTO bf_state_meta (key, value, updated_at)
        VALUES (?, ?, ?)
      `
    )
    .bind("schema_version", "1", "2026-02-28T00:00:00.000Z")
    .run();

  await db
    .prepare(
      `
        INSERT INTO bf_users (row_key, position, email, created_at, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      "usr_1",
      0,
      "alpha@example.com",
      "2026-02-28T00:00:00.000Z",
      JSON.stringify({
        id: "usr_1",
        email: "alpha@example.com",
        name: "Alpha",
        createdAt: "2026-02-28T00:00:00.000Z"
      }),
      "2026-02-28T00:00:00.000Z"
    )
    .run();

  await db
    .prepare(
      `
        INSERT INTO bf_instances (row_key, position, user_id, name, image, created_at, updated_at_field, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      "ins_1",
      0,
      "usr_1",
      "Keep Me",
      "node:20",
      "2026-02-28T00:00:00.000Z",
      "2026-02-28T00:00:00.000Z",
      JSON.stringify({
        id: "ins_1",
        userId: "usr_1",
        name: "Keep Me",
        description: "",
        image: "node:20",
        dockerfilePath: null,
        dockerContext: null,
        persistedPaths: [],
        sleepTtlSeconds: null,
        envVars: {},
        secrets: {},
        commonStateKey: null,
        commonStateBytes: 0,
        commonStateUpdatedAt: null,
        createdAt: "2026-02-28T00:00:00.000Z",
        updatedAt: "2026-02-28T00:00:00.000Z"
      }),
      "2026-02-28T00:00:00.000Z"
    )
    .run();

  const store = createCloudflareStateStore(db);
  const state = await store.loadCollections(["users"]);

  assert.deepEqual(state.users.map((entry: any) => entry.id), ["usr_1"]);
  assert.deepEqual(state.instances, []);

  state.users[0].name = "Alpha Updated";
  await store.save(state, {
    users: [
      {
        id: "usr_1",
        email: "alpha@example.com",
        name: "Alpha",
        createdAt: "2026-02-28T00:00:00.000Z"
      }
    ]
  }, {
    collections: ["users"]
  });

  const users = await db.prepare("SELECT payload_json FROM bf_users ORDER BY position ASC, row_key ASC").all();
  const instances = await db.prepare("SELECT payload_json FROM bf_instances ORDER BY position ASC, row_key ASC").all();

  assert.equal(JSON.parse(users.results[0].payload_json as string).name, "Alpha Updated");
  assert.equal(JSON.parse(instances.results[0].payload_json as string).name, "Keep Me");
});

test("cloudflare store removes deleted rows from a scoped normalized collection", async () => {
  const db = new MockD1Database();

  await db
    .prepare(
      `
        INSERT INTO bf_users (row_key, position, email, created_at, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      "usr_1",
      0,
      "alpha@example.com",
      "2026-02-28T00:00:00.000Z",
      JSON.stringify({
        id: "usr_1",
        email: "alpha@example.com",
        name: "Alpha",
        createdAt: "2026-02-28T00:00:00.000Z"
      }),
      "2026-02-28T00:00:00.000Z"
    )
    .run();

  await db
    .prepare(
      `
        INSERT INTO bf_users (row_key, position, email, created_at, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      "usr_2",
      1,
      "beta@example.com",
      "2026-02-28T00:00:01.000Z",
      JSON.stringify({
        id: "usr_2",
        email: "beta@example.com",
        name: "Beta",
        createdAt: "2026-02-28T00:00:01.000Z"
      }),
      "2026-02-28T00:00:01.000Z"
    )
    .run();

  const store = createCloudflareStateStore(db);
  const state = await store.loadCollections(["users"]);
  state.users = state.users.filter((entry: any) => entry.id === "usr_2");

  await store.save(
    state,
    {
      users: [
        {
          id: "usr_1",
          email: "alpha@example.com",
          name: "Alpha",
          createdAt: "2026-02-28T00:00:00.000Z"
        },
        {
          id: "usr_2",
          email: "beta@example.com",
          name: "Beta",
          createdAt: "2026-02-28T00:00:01.000Z"
        }
      ]
    },
    {
      collections: ["users"]
    }
  );

  const users = await db.prepare("SELECT payload_json FROM bf_users ORDER BY position ASC, row_key ASC").all();

  assert.equal(users.results.length, 1);
  assert.equal(JSON.parse(users.results[0].payload_json as string).id, "usr_2");
});

test("cloudflare store can persist scoped instance rows", async () => {
  const db = new MockD1Database();
  const store = createCloudflareStateStore(db);
  const state = await store.loadCollections(["instances"]);

  state.instances.push({
    id: "ins_1",
    userId: "usr_1",
    name: "Base Node",
    description: "Node runtime",
    image: "node:20",
    dockerfilePath: "./Dockerfile",
    dockerContext: ".",
    persistedPaths: ["/workspace", "/home/flare"],
    sleepTtlSeconds: 60,
    envVars: {
      NODE_ENV: "development"
    },
    secrets: {
      API_KEY: "secret-1"
    },
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-03T00:00:00.000Z"
  });

  await store.save(state, { instances: [] }, { collections: ["instances"] });

  const reloaded = await store.loadCollections(["instances"]);
  assert.equal(reloaded.instances.length, 1);
  assert.equal(reloaded.instances[0].id, "ins_1");
  assert.equal(reloaded.instances[0].image, "node:20");
  assert.deepEqual(reloaded.instances[0].persistedPaths, ["/workspace", "/home/flare"]);
  assert.equal(reloaded.instances[0].sleepTtlSeconds, 60);
  assert.equal(reloaded.instances[0].envVars.NODE_ENV, "development");
});
