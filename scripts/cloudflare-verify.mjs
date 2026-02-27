import { createCloudflareClient, loadCloudflareConfig } from "./lib/cloudflare.mjs";

async function main() {
  const config = await loadCloudflareConfig();
  const client = createCloudflareClient(config);
  const verified = await client.verifyToken();
  process.stdout.write(
    JSON.stringify(
      {
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
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
