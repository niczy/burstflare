// @ts-check

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createCloudflareClient, loadCloudflareConfig, readProvisionState } from "./lib/cloudflare.mjs";

/**
 * @typedef {Error & {
 *   payload?: unknown;
 * }} CloudflareScriptError
 */

function flattenResults(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (!result) {
    return [];
  }
  return [result];
}

async function ensureMigrationTable(client, databaseId) {
  await client.d1Query(
    databaseId,
    `
    CREATE TABLE IF NOT EXISTS _burstflare_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    `
  );
}

async function fetchAppliedMigrations(client, databaseId) {
  const result = await client.d1Query(databaseId, "SELECT name FROM _burstflare_migrations ORDER BY name ASC;");
  const rows = flattenResults(result).flatMap((entry) => entry.results || []);
  return new Set(rows.map((row) => row.name));
}

async function applyMigration(client, databaseId, name, sql) {
  await client.d1Query(databaseId, sql);
  await client.d1Query(
    databaseId,
    "INSERT INTO _burstflare_migrations (name, applied_at) VALUES (?, ?);",
    [name, new Date().toISOString()]
  );
}

async function main() {
  const config = await loadCloudflareConfig();
  const state = await readProvisionState(config.stateFile);
  if (!state?.resources?.d1?.id) {
    throw new Error("Missing provisioned D1 database. Run npm run cf:provision first.");
  }

  const migrationsDir = path.join(process.cwd(), "infra", "migrations");
  const entries = await readdir(migrationsDir);
  const migrationFiles = entries.filter((name) => name.endsWith(".sql")).sort();
  const client = createCloudflareClient(config);
  const databaseId = state.resources.d1.id;

  await ensureMigrationTable(client, databaseId);
  const applied = await fetchAppliedMigrations(client, databaseId);
  const appliedNow = [];
  const skipped = [];

  for (const fileName of migrationFiles) {
    if (applied.has(fileName)) {
      skipped.push(fileName);
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, fileName), "utf8");
    await applyMigration(client, databaseId, fileName, sql);
    appliedNow.push(fileName);
  }

  process.stdout.write(
    JSON.stringify(
      {
        databaseId,
        applied: appliedNow,
        skipped
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((error) => {
  const typedError = /** @type {CloudflareScriptError} */ (error);
  process.stderr.write(`${typedError.message}\n`);
  if (typedError.payload) {
    process.stderr.write(`${JSON.stringify(typedError.payload, null, 2)}\n`);
  }
  process.exit(1);
});
