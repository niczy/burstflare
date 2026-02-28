import { loadCloudflareConfig, readProvisionState } from "./lib/cloudflare.mjs";

function renderWrangler(state, config) {
  const { resources } = state;
  const containerImage = config.containerImage || "./containers/session/Dockerfile";
  const dataFile =
    config.environment === "production"
      ? ".local/burstflare-data.json"
      : `.local/burstflare-data.${config.environment}.json`;
  const vars = [
    `BURSTFLARE_DATA_FILE = "${dataFile}"`,
    `CLOUDFLARE_ENVIRONMENT = "${config.environment}"`,
    `CLOUDFLARE_DOMAIN = "${state.domain}"`,
    `BUILD_WORKFLOW_NAME = "${config.workerName}-builds"`
  ];
  if (config.turnstileSiteKey) {
    vars.push(`TURNSTILE_SITE_KEY = "${config.turnstileSiteKey}"`);
  }
  if (config.turnstileSecret) {
    vars.push(`TURNSTILE_SECRET = "${config.turnstileSecret}"`);
  }

  const lines = [`name = "${config.workerName}"
main = "apps/edge/src/worker.js"
compatibility_date = "2026-02-27"

[vars]
${vars.join("\n")}

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

  lines.push(`[[workflows]]
binding = "BUILD_WORKFLOW"
name = "${config.workerName}-builds"
class_name = "BurstFlareBuildWorkflow"`);

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

  lines.push(`[triggers]
crons = ["*/15 * * * *"]`);

  return `${lines.join("\n\n")}\n`;
}

async function main() {
  const config = await loadCloudflareConfig();
  const state = await readProvisionState(config.stateFile);
  if (!state) {
    throw new Error(`Missing ${config.stateFile}. Run npm run cf:provision first.`);
  }
  const output = renderWrangler(state, config);
  process.stdout.write(output);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
