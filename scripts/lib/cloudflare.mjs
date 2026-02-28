import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRequiredEnv, loadEnv, mergeEnv, slugifyDomain } from "./env.mjs";

const API_BASE = "https://api.cloudflare.com/client/v4";

function normalizeEnvironment(value = "production") {
  const normalized = String(value || "production").trim().toLowerCase();
  if (!["production", "staging"].includes(normalized)) {
    throw new Error(`Unsupported Cloudflare environment: ${value}`);
  }
  return normalized;
}

function getStateFileForEnvironment(environment) {
  return environment === "production" ? ".local/cloudflare-state.json" : `.local/cloudflare-state.${environment}.json`;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const message =
      data?.errors?.map((item) => item.message).filter(Boolean).join("; ") ||
      data?.messages?.join("; ") ||
      `Cloudflare API request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export async function loadCloudflareConfig() {
  const dotEnv = await loadEnv(".env");
  const env = mergeEnv(dotEnv);
  const environment = normalizeEnvironment(env.CLOUDFLARE_ENVIRONMENT || "production");
  return {
    accountId: getRequiredEnv(env, "CLOUDFLARE_ACCOUNT_ID", ["account_id"]),
    zoneId: getRequiredEnv(env, "CLOUDFLARE_ZONE_ID", ["zone_id"]),
    domain: getRequiredEnv(env, "CLOUDFLARE_DOMAIN", ["domain"]),
    apiToken: getRequiredEnv(env, "CLOUDFLARE_API_TOKEN"),
    enableContainers: env.CLOUDFLARE_ENABLE_CONTAINERS === "1" || Boolean(env.CLOUDFLARE_CONTAINER_IMAGE),
    containerImage: env.CLOUDFLARE_CONTAINER_IMAGE || "",
    slug: slugifyDomain(getRequiredEnv(env, "CLOUDFLARE_DOMAIN", ["domain"])),
    environment,
    workerName: environment === "production" ? "burstflare" : `burstflare-${environment}`,
    stateFile: getStateFileForEnvironment(environment)
  };
}

export function createCloudflareClient(config) {
  async function api(pathname, { method = "GET", body, headers = {} } = {}) {
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        ...headers
      }
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return requestJson(`${API_BASE}${pathname}`, init);
  }

  return {
    async verifyToken() {
      const data = await api("/user/tokens/verify");
      return data.result;
    },

    async listD1Databases() {
      const data = await api(`/accounts/${config.accountId}/d1/database`);
      return Array.isArray(data.result) ? data.result : [];
    },

    async createD1Database(name) {
      const data = await api(`/accounts/${config.accountId}/d1/database`, {
        method: "POST",
        body: {
          name,
          primary_location_hint: "wnam"
        }
      });
      return data.result;
    },

    async listKvNamespaces() {
      const data = await api(`/accounts/${config.accountId}/storage/kv/namespaces`);
      return Array.isArray(data.result) ? data.result : [];
    },

    async createKvNamespace(title) {
      const data = await api(`/accounts/${config.accountId}/storage/kv/namespaces`, {
        method: "POST",
        body: { title }
      });
      return data.result;
    },

    async listR2Buckets() {
      const data = await api(`/accounts/${config.accountId}/r2/buckets`);
      return Array.isArray(data.result?.buckets) ? data.result.buckets : [];
    },

    async createR2Bucket(name) {
      const data = await api(`/accounts/${config.accountId}/r2/buckets`, {
        method: "POST",
        body: { name }
      });
      return data.result;
    },

    async listQueues() {
      const data = await api(`/accounts/${config.accountId}/queues`);
      return Array.isArray(data.result) ? data.result : [];
    },

    async createQueue(queueName) {
      const data = await api(`/accounts/${config.accountId}/queues`, {
        method: "POST",
        body: { queue_name: queueName }
      });
      return data.result;
    },

    async d1Query(databaseId, sql, params = []) {
      const data = await api(`/accounts/${config.accountId}/d1/database/${databaseId}/query`, {
        method: "POST",
        body: {
          sql,
          params
        }
      });
      return data.result;
    }
  };
}

export function desiredResourceNames(config) {
  const prefix = config.environment === "production" ? config.slug : `${config.slug}-${config.environment}`;
  return {
    d1: config.environment === "production" ? `${prefix}-prod` : `${prefix}-db`,
    kv: {
      auth: `${prefix}-auth`,
      cache: `${prefix}-cache`
    },
    r2: {
      templates: `${prefix}-templates`,
      snapshots: `${prefix}-snapshots`,
      builds: `${prefix}-build-logs`
    },
    queues: {
      builds: `${prefix}-builds`,
      reconcile: `${prefix}-reconcile`
    }
  };
}

export async function readProvisionState(filePath = ".local/cloudflare-state.json") {
  const absolute = path.resolve(process.cwd(), filePath);
  try {
    const content = await readFile(absolute, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeProvisionState(state, filePath = ".local/cloudflare-state.json") {
  const absolute = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(state, null, 2));
}
