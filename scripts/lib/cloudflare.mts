import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRequiredEnv, loadEnv, mergeEnv, slugifyDomain } from "./env.mjs";

const API_BASE = "https://api.cloudflare.com/client/v4";

interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface CloudflareRequestError extends Error {
  status?: number;
  payload?: unknown;
}

export type CloudflareConfig = Awaited<ReturnType<typeof loadCloudflareConfig>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResult = any;

function normalizeEnvironment(value = "production"): string {
  const normalized = String(value || "production").trim().toLowerCase();
  if (!["production", "staging"].includes(normalized)) {
    throw new Error(`Unsupported Cloudflare environment: ${value}`);
  }
  return normalized;
}

function getStateFileForEnvironment(environment: string): string {
  return environment === "production" ? ".local/cloudflare-state.json" : `.local/cloudflare-state.${environment}.json`;
}

async function requestJson(url: string, init?: RequestInit): Promise<ApiResult> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const message =
      data?.errors?.map((item: { message?: string }) => item.message).filter(Boolean).join("; ") ||
      data?.messages?.join("; ") ||
      `Cloudflare API request failed (${response.status})`;
    const error = new Error(message) as CloudflareRequestError;
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
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
    turnstileSecret: env.TURNSTILE_SECRET || "",
    slug: slugifyDomain(getRequiredEnv(env, "CLOUDFLARE_DOMAIN", ["domain"])),
    environment,
    workerName: environment === "production" ? "burstflare" : `burstflare-${environment}`,
    stateFile: getStateFileForEnvironment(environment)
  };
}

export function createCloudflareClient(config: CloudflareConfig) {
  async function api(pathname: string, { method = "GET", body, headers = {} }: ApiRequestOptions = {}): Promise<ApiResult> {
    const init: RequestInit & { headers: Record<string, string> } = {
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

    async createD1Database(name: string) {
      const data = await api(`/accounts/${config.accountId}/d1/database`, {
        method: "POST",
        body: { name, primary_location_hint: "wnam" }
      });
      return data.result;
    },

    async listKvNamespaces() {
      const data = await api(`/accounts/${config.accountId}/storage/kv/namespaces`);
      return Array.isArray(data.result) ? data.result : [];
    },

    async createKvNamespace(title: string) {
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

    async createR2Bucket(name: string) {
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

    async createQueue(queueName: string) {
      const data = await api(`/accounts/${config.accountId}/queues`, {
        method: "POST",
        body: { queue_name: queueName }
      });
      return data.result;
    },

    async d1Query(databaseId: string, sql: string, params: unknown[] = []) {
      const data = await api(`/accounts/${config.accountId}/d1/database/${databaseId}/query`, {
        method: "POST",
        body: { sql, params }
      });
      return data.result;
    }
  };
}

export function desiredResourceNames(config: CloudflareConfig) {
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

export async function readProvisionState(filePath = ".local/cloudflare-state.json"): Promise<ApiResult | null> {
  const absolute = path.resolve(process.cwd(), filePath);
  try {
    const content = await readFile(absolute, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeProvisionState(state: unknown, filePath = ".local/cloudflare-state.json"): Promise<void> {
  const absolute = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(state, null, 2));
}
