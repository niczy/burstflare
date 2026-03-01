// @ts-check

import { createCloudflareClient, loadCloudflareConfig } from "./lib/cloudflare.mjs";

/**
 * @typedef {Error & {
 *   payload?: unknown;
 * }} CloudflareScriptError
 */

async function main() {
  const config = await loadCloudflareConfig();
  const client = createCloudflareClient(config);
  const verified = await client.verifyToken();
  process.stdout.write(
    JSON.stringify(
      {
        environment: config.environment,
        workerName: config.workerName,
        accountId: config.accountId,
        zoneId: config.zoneId,
        domain: config.domain,
        tokenStatus: verified?.status || "unknown",
        notBefore: verified?.not_before || null,
        expiresOn: verified?.expires_on || null
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((error) => {
  const typedError = /** @type {CloudflareScriptError} */ (error);
  process.stderr.write(`${typedError.message}\n`);
  process.exit(1);
});
