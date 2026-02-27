import { BaseStore, createDefaultState } from "./store-base.js";

const STATE_KEY = "global";

class CloudflareStateStore extends BaseStore {
  constructor(db) {
    super();
    this.db = db;
  }

  async ensureTable() {
    await this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS _burstflare_state (
          id TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        `
      )
      .run();
  }

  async load() {
    await this.ensureTable();
    const row = await this.db
      .prepare("SELECT value FROM _burstflare_state WHERE id = ? LIMIT 1")
      .bind(STATE_KEY)
      .first();
    if (!row?.value) {
      return createDefaultState();
    }
    return { ...createDefaultState(), ...JSON.parse(row.value) };
  }

  async save(nextState) {
    await this.ensureTable();
    await this.db
      .prepare(
        `
        INSERT INTO _burstflare_state (id, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        `
      )
      .bind(STATE_KEY, JSON.stringify(nextState), new Date().toISOString())
      .run();
  }
}

export function createCloudflareStateStore(db) {
  return new CloudflareStateStore(db);
}
