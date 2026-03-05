import path from "node:path";
import { type CloudflareConfig, loadCloudflareConfig, readProvisionState } from "./lib/cloudflare.js";

interface CloudflareScriptError extends Error {
  payload?: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderWrangler(state: any, config: CloudflareConfig): string {
  const { resources } = state;
  const containerImage = config.containerImage || "./containers/session/Dockerfile";
  const containerImageUbuntu = config.containerImageUbuntu || "./containers/session/Dockerfile.ubuntu";
  const containerImageDebian = config.containerImageDebian || "./containers/session/Dockerfile.debian";
  const dataFile =
    config.environment === "production"
      ? ".local/burstflare-data.json"
      : `.local/burstflare-data.${config.environment}.json`;
  const vars = [
    `BURSTFLARE_DATA_FILE = "${dataFile}"`,
    `CLOUDFLARE_ENVIRONMENT = "${config.environment}"`,
    `CLOUDFLARE_DOMAIN = "${state.domain}"`
  ];
  if (config.turnstileSiteKey) {
    vars.push(`TURNSTILE_SITE_KEY = "${config.turnstileSiteKey}"`);
  }
  if (config.turnstileSecret) {
    vars.push(`TURNSTILE_SECRET = "${config.turnstileSecret}"`);
  }
  if (config.resendApiKey) {
    vars.push(`RESEND_API_KEY = "${config.resendApiKey}"`);
  }
  if (config.resendFrom) {
    vars.push(`RESEND_FROM = "${config.resendFrom}"`);
  }
  if (config.remoteBuildUrl) {
    vars.push(`REMOTE_BUILD_URL = "${config.remoteBuildUrl}"`);
  }
  if (config.remoteBuildToken) {
    vars.push(`REMOTE_BUILD_TOKEN = "${config.remoteBuildToken}"`);
  }
  if (config.enableContainers) {
    const imageBindings = {
      "ubuntu:24.04": "SESSION_CONTAINER_UBUNTU",
      "debian:12": "SESSION_CONTAINER_DEBIAN",
      "node:20": "SESSION_CONTAINER_DEBIAN",
      "node:22": "SESSION_CONTAINER_DEBIAN",
      "python:3.12": "SESSION_CONTAINER_DEBIAN",
      "burstflare/session-runtime:v1": "SESSION_CONTAINER",
      "*": "SESSION_CONTAINER"
    };
    const bindingJson = JSON.stringify(imageBindings)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    vars.push(`SESSION_CONTAINER_IMAGE_BINDINGS = "${bindingJson}"`);
    vars.push(`SESSION_CONTAINER_IMAGE_BINDINGS_STRICT = "1"`);
  }
  const lines = [`name = "${config.workerName}"
main = "apps/edge/src/worker.ts"
compatibility_date = "2026-02-27"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[observability.traces]
enabled = true
head_sampling_rate = 1

[vars]
${vars.join("\n")}

[assets]
directory = "${path.resolve(process.cwd(), "apps", "web", "dist", "client")}"
binding = "ASSETS"
not_found_handling = "none"

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
    lines.push(`[[durable_objects.bindings]]
name = "SESSION_CONTAINER_UBUNTU"
class_name = "BurstFlareSessionContainerUbuntu"`);
    lines.push(`[[durable_objects.bindings]]
name = "SESSION_CONTAINER_DEBIAN"
class_name = "BurstFlareSessionContainerDebian"`);
    lines.push(`[[migrations]]
tag = "v1"
new_sqlite_classes = ["BurstFlareSessionContainer"]`);
    lines.push(`[[migrations]]
tag = "v2"
new_sqlite_classes = ["BurstFlareSessionContainerUbuntu", "BurstFlareSessionContainerDebian"]`);
    lines.push(`[[containers]]
class_name = "BurstFlareSessionContainer"
image = "${containerImage}"`);
    lines.push(`[[containers]]
class_name = "BurstFlareSessionContainerUbuntu"
image = "${containerImageUbuntu}"`);
    lines.push(`[[containers]]
class_name = "BurstFlareSessionContainerDebian"
image = "${containerImageDebian}"`);
  }

  if (resources.r2) {
    lines.push(`[[r2_buckets]]
binding = "SNAPSHOT_BUCKET"
bucket_name = "${resources.r2.snapshots.name}"`);
  }

  if (resources.queues) {
    lines.push(`[[queues.producers]]
binding = "RECONCILE_QUEUE"
queue = "${resources.queues.reconcile.name}"`);
    lines.push(`[[queues.consumers]]
queue = "${resources.queues.reconcile.name}"
max_batch_size = 1
max_batch_timeout = 1`);
  }

  lines.push(`[triggers]
crons = ["*/15 * * * *"]`);

  return `${lines.join("\n\n")}\n`;
}

async function main(): Promise<void> {
  const config = await loadCloudflareConfig();
  const state = await readProvisionState(config.stateFile);
  if (!state) {
    throw new Error(`Missing ${config.stateFile}. Run npm run cf:provision first.`);
  }
  const output = renderWrangler(state, config);
  process.stdout.write(output);
}

main().catch((error: unknown) => {
  const typedError = error as CloudflareScriptError;
  process.stderr.write(`${typedError.message}\n`);
  process.exit(1);
});
