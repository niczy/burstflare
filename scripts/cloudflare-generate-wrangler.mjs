import { loadCloudflareConfig, readProvisionState } from "./lib/cloudflare.mjs";

function renderWrangler(state, config) {
  const { resources } = state;
  const containerImage = config.containerImage || "./containers/session/Dockerfile";
  const lines = [`name = "burstflare"
main = "apps/edge/src/worker.js"
compatibility_date = "2026-02-27"

[vars]
BURSTFLARE_DATA_FILE = ".local/burstflare-data.json"
CLOUDFLARE_DOMAIN = "${state.domain}"

[[d1_databases]]
binding = "DB"
database_name = "${resources.d1.name}"
database_id = "${resources.d1.id}"`,
`[[kv_namespaces]]
binding = "AUTH_KV"
id = "${resources.kv.auth.id}"`,
`[[kv_namespaces]]
binding = "CACHE_KV"
id = "${resources.kv.cache.id}"`];

  if (config.enableContainers) {
    lines.push(`[[durable_objects.bindings]]
name = "SESSION_CONTAINER"
class_name = "BurstFlareSessionContainer"`);
    lines.push(`[[migrations]]
tag = "v1"
new_sqlite_classes = ["BurstFlareSessionContainer"]`);
    lines.push(`[[containers]]
class_name = "BurstFlareSessionContainer"
image = "${containerImage}"`);
  }

  if (resources.r2) {
    lines.push(`[[r2_buckets]]
binding = "TEMPLATE_BUCKET"
bucket_name = "${resources.r2.templates.name}"`);
    lines.push(`[[r2_buckets]]
binding = "SNAPSHOT_BUCKET"
bucket_name = "${resources.r2.snapshots.name}"`);
    lines.push(`[[r2_buckets]]
binding = "BUILD_BUCKET"
bucket_name = "${resources.r2.builds.name}"`);
  }

  if (resources.queues) {
    lines.push(`[[queues.producers]]
binding = "BUILD_QUEUE"
queue = "${resources.queues.builds.name}"`);
    lines.push(`[[queues.producers]]
binding = "RECONCILE_QUEUE"
queue = "${resources.queues.reconcile.name}"`);
    lines.push(`[[queues.consumers]]
queue = "${resources.queues.builds.name}"
max_batch_size = 1
max_batch_timeout = 1`);
    lines.push(`[[queues.consumers]]
queue = "${resources.queues.reconcile.name}"
max_batch_size = 1
max_batch_timeout = 1`);
  }

  return `${lines.join("\n\n")}\n`;
}

async function main() {
  const state = await readProvisionState();
  if (!state) {
    throw new Error("Missing .local/cloudflare-state.json. Run npm run cf:provision first.");
  }
  const config = await loadCloudflareConfig();
  const output = renderWrangler(state, config);
  process.stdout.write(output);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
