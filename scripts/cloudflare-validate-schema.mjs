// @ts-check

import { createCloudflareClient, loadCloudflareConfig, readProvisionState } from "./lib/cloudflare.mjs";
import {
  LEGACY_TABLE,
  META_TABLE,
  NORMALIZED_SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  TABLES
} from "../packages/shared/src/cloudflare-schema.js";

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

function expectedIndexNames() {
  const names = [];
  for (const definition of TABLES) {
    for (const column of definition.indexes || []) {
      names.push(`idx_${definition.table}_${column}`);
    }
  }
  return names.sort();
}

async function main() {
  const config = await loadCloudflareConfig();
  const state = await readProvisionState(config.stateFile);
  if (!state?.resources?.d1?.id) {
    throw new Error("Missing provisioned D1 database. Run npm run cf:provision first.");
  }

  const client = createCloudflareClient(config);
  const databaseId = state.resources.d1.id;

  const sqliteMasterResult = await client.d1Query(
    databaseId,
    `
    SELECT type, name, tbl_name
    FROM sqlite_master
    WHERE type IN ('table', 'index')
    ORDER BY type ASC, name ASC;
    `
  );
  const rows = flattenResults(sqliteMasterResult).flatMap((entry) => entry.results || []);

  const tableNames = new Set(rows.filter((row) => row.type === "table").map((row) => row.name));
  const indexNames = new Set(
    rows
      .filter((row) => row.type === "index" && typeof row.name === "string" && !row.name.startsWith("sqlite_"))
      .map((row) => row.name)
  );

  const requiredTables = ["_burstflare_migrations", META_TABLE, ...TABLES.map((definition) => definition.table)];
  const missingTables = requiredTables.filter((name) => !tableNames.has(name));
  const missingIndexes = expectedIndexNames().filter((name) => !indexNames.has(name));

  const schemaVersionResult = await client.d1Query(
    databaseId,
    `SELECT value FROM ${META_TABLE} WHERE key = ? LIMIT 1;`,
    [SCHEMA_VERSION_KEY]
  );
  const schemaVersionRows = flattenResults(schemaVersionResult).flatMap((entry) => entry.results || []);
  const schemaVersion = schemaVersionRows[0]?.value || null;
  const legacyTablePresent = tableNames.has(LEGACY_TABLE);

  const payload = {
    databaseId,
    schemaVersion,
    expectedSchemaVersion: NORMALIZED_SCHEMA_VERSION,
    missingTables,
    missingIndexes,
    legacyTablePresent
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  if (missingTables.length > 0 || missingIndexes.length > 0 || schemaVersion !== NORMALIZED_SCHEMA_VERSION || legacyTablePresent) {
    process.exit(1);
  }
}

main().catch((error) => {
  const typedError = /** @type {CloudflareScriptError} */ (error);
  process.stderr.write(`${typedError.message}\n`);
  if (typedError.payload) {
    process.stderr.write(`${JSON.stringify(typedError.payload, null, 2)}\n`);
  }
  process.exit(1);
});
