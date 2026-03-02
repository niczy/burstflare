import { createCloudflareClient, loadCloudflareConfig } from "./lib/cloudflare.mjs";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function main(): Promise<void> {
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

main().catch((error: unknown) => {
  process.stderr.write(`${getErrorMessage(error)}\n`);
  process.exit(1);
});
