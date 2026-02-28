import { html, appJs, styles } from "../../web/src/assets.js";
import { createBurstFlareService } from "../../../packages/shared/src/service.js";
import { createCloudflareStateStore } from "../../../packages/shared/src/cloudflare-store.js";
import { createMemoryStore } from "../../../packages/shared/src/memory-store.js";
import {
  badRequest,
  cookie,
  notFound,
  parseJson,
  readCookie,
  toJson,
  unauthorized
} from "../../../packages/shared/src/utils.js";

const CSRF_COOKIE = "burstflare_csrf";
const WEBAUTHN_CHALLENGE_TTL_SECONDS = 300;
const localWebAuthnChallenges = new Map();

function tokenFromRequest(request, sessionCookieName) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }
  return readCookie(request.headers.get("cookie"), sessionCookieName);
}

function withErrorHandling(handler) {
  return async (request, params = {}) => {
    try {
      return await handler(request, params);
    } catch (error) {
      return toJson(
        {
          error: error.message || "Internal error"
        },
        { status: error.status || 500 }
      );
    }
  };
}

function matchRoute(method, pathname, pattern) {
  const routeParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (routeParts.length !== pathParts.length) {
    return null;
  }
  const params = {};
  for (let index = 0; index < routeParts.length; index += 1) {
    const routePart = routeParts[index];
    const pathPart = pathParts[index];
    if (routePart.startsWith(":")) {
      params[routePart.slice(1)] = pathPart;
      continue;
    }
    if (routePart !== pathPart) {
      return null;
    }
  }
  return { method, params };
}

function requireToken(request, service) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }
  const cookieHeader = request.headers.get("cookie");
  const token = readCookie(cookieHeader, service.sessionCookieName);
  if (!token) {
    return null;
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const csrfCookie = readCookie(cookieHeader, CSRF_COOKIE);
    const csrfHeader = request.headers.get("x-burstflare-csrf");
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      const error = new Error("CSRF token mismatch");
      error.status = 403;
      throw error;
    }
  }
  return token;
}

async function readEditorRequestAuth(request, service) {
  const authHeader = request.headers.get("authorization");
  const bodyText = request.method === "POST" ? await request.text() : null;
  if (authHeader?.startsWith("Bearer ")) {
    return {
      token: authHeader.slice("Bearer ".length),
      bodyText
    };
  }

  const cookieHeader = request.headers.get("cookie");
  const token = readCookie(cookieHeader, service.sessionCookieName);
  if (!token) {
    return null;
  }

  if (request.method === "POST") {
    const csrfCookie = readCookie(cookieHeader, CSRF_COOKIE);
    const form = new URLSearchParams(bodyText || "");
    const csrfValue = form.get("csrf") || request.headers.get("x-burstflare-csrf");
    if (!csrfCookie || !csrfValue || csrfCookie !== csrfValue) {
      const error = new Error("CSRF token mismatch");
      error.status = 403;
      throw error;
    }
  }

  return {
    token,
    bodyText
  };
}

function createCsrfToken() {
  return globalThis.crypto.randomUUID();
}

function toJsonWithCookies(data, cookies, init = {}) {
  const response = toJson(data, init);
  for (const value of cookies) {
    response.headers.append("set-cookie", value);
  }
  return response;
}

function authCookies(service, token, csrfToken) {
  return [
    cookie(service.sessionCookieName, token, { maxAge: 60 * 60 * 24 * 7 }),
    cookie(CSRF_COOKIE, csrfToken, { maxAge: 60 * 60 * 24 * 7, httpOnly: false })
  ];
}

function clearAuthCookies(service) {
  return [
    cookie(service.sessionCookieName, "", { maxAge: 0 }),
    cookie(CSRF_COOKIE, "", { maxAge: 0, httpOnly: false })
  ];
}

function devicePage(code) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BurstFlare Device Approval</title>
    <style>
      body {
        margin: 0;
        padding: 32px;
        font-family: "IBM Plex Sans", sans-serif;
        background: #f7f2e8;
        color: #1d2424;
      }
      main {
        max-width: 640px;
        margin: 0 auto;
        background: #ffffff;
        border-radius: 20px;
        padding: 24px;
        box-shadow: 0 20px 40px rgba(29, 36, 36, 0.08);
      }
      code {
        display: block;
        background: #f1eee7;
        padding: 12px;
        border-radius: 12px;
        margin: 16px 0;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Approve CLI Login</h1>
      <p>Approve the pending CLI device code from the web app or call the approval API with your browser session.</p>
      <code>${code || "No device code supplied."}</code>
      <p>The app shell at <a href="/">/</a> can approve pending device codes after you sign in.</p>
    </main>
  </body>
</html>`;
}

function createObjectStore(options) {
  if (!options.TEMPLATE_BUCKET && !options.BUILD_BUCKET && !options.SNAPSHOT_BUCKET) {
    return null;
  }

  return {
    async putTemplateVersionBundle({ templateVersion, body, contentType }) {
      if (!options.TEMPLATE_BUCKET || !templateVersion.bundleKey) {
        return null;
      }
      await options.TEMPLATE_BUCKET.put(templateVersion.bundleKey, body, {
        httpMetadata: { contentType }
      });
      return { key: templateVersion.bundleKey };
    },

    async getTemplateVersionBundle({ templateVersion }) {
      if (!options.TEMPLATE_BUCKET || !templateVersion.bundleKey) {
        return null;
      }
      const object = await options.TEMPLATE_BUCKET.get(templateVersion.bundleKey);
      if (!object) {
        return null;
      }
      return {
        body: await object.arrayBuffer(),
        contentType: object.httpMetadata?.contentType || templateVersion.bundleContentType || "application/octet-stream",
        bytes: object.size ?? templateVersion.bundleBytes
      };
    },

    async deleteTemplateVersionBundle({ templateVersion }) {
      if (!options.TEMPLATE_BUCKET || !templateVersion.bundleKey) {
        return null;
      }
      await options.TEMPLATE_BUCKET.delete(templateVersion.bundleKey);
      return { key: templateVersion.bundleKey };
    },

    async putBuildLog({ templateVersion, log }) {
      if (!options.BUILD_BUCKET || !templateVersion.buildLogKey) {
        return null;
      }
      await options.BUILD_BUCKET.put(templateVersion.buildLogKey, log, {
        httpMetadata: { contentType: "text/plain; charset=utf-8" }
      });
      return { key: templateVersion.buildLogKey };
    },

    async getBuildLog({ templateVersion }) {
      if (!options.BUILD_BUCKET || !templateVersion.buildLogKey) {
        return null;
      }
      const object = await options.BUILD_BUCKET.get(templateVersion.buildLogKey);
      if (!object) {
        return null;
      }
      return {
        text: await object.text(),
        contentType: object.httpMetadata?.contentType || "text/plain; charset=utf-8",
        bytes: object.size ?? 0
      };
    },

    async deleteBuildLog({ templateVersion }) {
      if (!options.BUILD_BUCKET || !templateVersion.buildLogKey) {
        return null;
      }
      await options.BUILD_BUCKET.delete(templateVersion.buildLogKey);
      return { key: templateVersion.buildLogKey };
    },

    async putBuildArtifact({ build, artifact }) {
      if (!options.BUILD_BUCKET || !build.artifactKey) {
        return null;
      }
      await options.BUILD_BUCKET.put(build.artifactKey, artifact, {
        httpMetadata: { contentType: "application/json; charset=utf-8" }
      });
      return { key: build.artifactKey };
    },

    async getBuildArtifact({ build }) {
      if (!options.BUILD_BUCKET || !build.artifactKey) {
        return null;
      }
      const object = await options.BUILD_BUCKET.get(build.artifactKey);
      if (!object) {
        return null;
      }
      return {
        text: await object.text(),
        contentType: object.httpMetadata?.contentType || "application/json; charset=utf-8",
        bytes: object.size ?? 0
      };
    },

    async deleteBuildArtifact({ build }) {
      if (!options.BUILD_BUCKET || !build.artifactKey) {
        return null;
      }
      await options.BUILD_BUCKET.delete(build.artifactKey);
      return { key: build.artifactKey };
    },

    async putSnapshot({ snapshot, body, contentType }) {
      if (!options.SNAPSHOT_BUCKET || !snapshot.objectKey) {
        return null;
      }
      await options.SNAPSHOT_BUCKET.put(snapshot.objectKey, body, {
        httpMetadata: { contentType }
      });
      return { key: snapshot.objectKey };
    },

    async getSnapshot({ snapshot }) {
      if (!options.SNAPSHOT_BUCKET || !snapshot.objectKey) {
        return null;
      }
      const object = await options.SNAPSHOT_BUCKET.get(snapshot.objectKey);
      if (!object) {
        return null;
      }
      return {
        body: await object.arrayBuffer(),
        contentType: object.httpMetadata?.contentType || snapshot.contentType || "application/octet-stream",
        bytes: object.size ?? snapshot.bytes
      };
    },

    async deleteSnapshot({ snapshot }) {
      if (!options.SNAPSHOT_BUCKET || !snapshot.objectKey) {
        return null;
      }
      await options.SNAPSHOT_BUCKET.delete(snapshot.objectKey);
      return { key: snapshot.objectKey };
    }
  };
}

function createTurnstileVerifier(options) {
  const secret = options.TURNSTILE_SECRET || "";
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  return {
    enabled: Boolean(secret),
    async verify(token, remoteIp) {
      if (!secret) {
        return;
      }
      if (!token) {
        const error = new Error("Turnstile token is required");
        error.status = 400;
        throw error;
      }
      const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({
          secret,
          response: token,
          ...(remoteIp ? { remoteip: remoteIp } : {})
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        const error = new Error((data["error-codes"] && data["error-codes"].join(", ")) || "Turnstile verification failed");
        error.status = 400;
        throw error;
      }
    }
  };
}

function createJobQueue(options) {
  if (!options.BUILD_QUEUE && !options.RECONCILE_QUEUE && !options.BUILD_WORKFLOW) {
    return null;
  }

  return {
    buildStrategy: options.BUILD_WORKFLOW ? "workflow" : options.BUILD_QUEUE ? "queue" : null,
    async enqueueBuild(buildId) {
      const dispatchedAt = new Date().toISOString();
      if (options.BUILD_WORKFLOW && typeof options.BUILD_WORKFLOW.create === "function") {
        const instanceId = `bwf_${buildId}_${globalThis.crypto.randomUUID()}`;
        const workflowName = options.BUILD_WORKFLOW_NAME || "burstflare-builds";
        await options.BUILD_WORKFLOW.create({
          id: instanceId,
          params: {
            buildId,
            instanceId,
            workflowName,
            dispatchedAt
          }
        });
        return {
          buildId,
          dispatch: "workflow",
          dispatchedAt,
          workflow: {
            name: workflowName,
            instanceId,
            dispatchedAt
          }
        };
      }
      if (!options.BUILD_QUEUE) {
        return null;
      }
      await options.BUILD_QUEUE.send({
        type: "build",
        buildId,
        dispatchedAt
      });
      return {
        buildId,
        dispatch: "queue",
        dispatchedAt
      };
    },

    async enqueueReconcile() {
      if (!options.RECONCILE_QUEUE) {
        return null;
      }
      await options.RECONCILE_QUEUE.send({
        type: "reconcile"
      });
      return { ok: true };
    }
  };
}

function createRateLimiter(options) {
  const storage = options.AUTH_KV || options.CACHE_KV || null;
  const local = new Map();

  return {
    async consume(scope, identity, limit, windowSeconds) {
      const safeIdentity = identity || "anonymous";
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const key = `ratelimit:${scope}:${safeIdentity}`;

      if (storage) {
        const existing = (await storage.get(key, "json")) || null;
        const current =
          existing && existing.resetAt > now
            ? existing
            : {
                count: 0,
                resetAt: now + windowMs
              };
        current.count += 1;
        await storage.put(key, JSON.stringify(current), {
          expirationTtl: windowSeconds + 5
        });
        return {
          ok: current.count <= limit,
          limit,
          remaining: Math.max(limit - current.count, 0),
          resetAt: current.resetAt
        };
      }

      const existing = local.get(key) || null;
      const current =
        existing && existing.resetAt > now
          ? existing
          : {
              count: 0,
              resetAt: now + windowMs
            };
      current.count += 1;
      local.set(key, current);
      return {
        ok: current.count <= limit,
        limit,
        remaining: Math.max(limit - current.count, 0),
        resetAt: current.resetAt
      };
    }
  };
}

function toBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return new Uint8Array();
}

function toBase64Url(value) {
  const bytes = toBytes(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toBase64(value) {
  const bytes = toBytes(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64Url(value) {
  const input = String(value || "");
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createChallenge() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

function concatBytes(...parts) {
  const arrays = parts.map((value) => toBytes(value));
  const total = arrays.reduce((sum, entry) => sum + entry.byteLength, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const entry of arrays) {
    combined.set(entry, offset);
    offset += entry.byteLength;
  }
  return combined;
}

function readUint32(value, offset) {
  const bytes = toBytes(value);
  if (bytes.byteLength < offset + 4) {
    return null;
  }
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function createWebAuthnChallengeStore(options) {
  const storage = options.AUTH_KV || options.CACHE_KV || null;

  function keyOf(id) {
    return `webauthn:challenge:${id}`;
  }

  function pruneLocal() {
    const now = Date.now();
    for (const [key, value] of localWebAuthnChallenges.entries()) {
      if (!value || value.expiresAt <= now) {
        localWebAuthnChallenges.delete(key);
      }
    }
  }

  return {
    async create(payload, ttlSeconds = WEBAUTHN_CHALLENGE_TTL_SECONDS) {
      const id = `wac_${globalThis.crypto.randomUUID()}`;
      const record = {
        ...payload,
        id,
        expiresAt: Date.now() + ttlSeconds * 1000
      };
      if (storage) {
        await storage.put(keyOf(id), JSON.stringify(record), {
          expirationTtl: ttlSeconds
        });
      } else {
        pruneLocal();
        localWebAuthnChallenges.set(keyOf(id), record);
      }
      return record;
    },

    async consume(id) {
      if (!id) {
        return null;
      }
      const key = keyOf(id);
      let record = null;
      if (storage) {
        record = (await storage.get(key, "json")) || null;
        if (typeof storage.delete === "function") {
          await storage.delete(key);
        }
      } else {
        pruneLocal();
        record = localWebAuthnChallenges.get(key) || null;
        localWebAuthnChallenges.delete(key);
      }
      if (!record || record.expiresAt <= Date.now()) {
        return null;
      }
      return record;
    }
  };
}

function getRequestOrigin(request) {
  return new URL(request.url).origin;
}

function getRequestRpId(request) {
  return new URL(request.url).hostname;
}

function parseClientData(clientDataValue) {
  const clientDataJSON = fromBase64Url(clientDataValue);
  const parsed = JSON.parse(new TextDecoder().decode(clientDataJSON));
  return {
    clientDataJSON,
    parsed
  };
}

function verifyClientData(clientDataValue, expected) {
  const { clientDataJSON, parsed } = parseClientData(clientDataValue);
  if (parsed.type !== expected.type) {
    const error = new Error("Passkey client data type mismatch");
    error.status = 401;
    throw error;
  }
  if (parsed.challenge !== expected.challenge) {
    const error = new Error("Passkey challenge mismatch");
    error.status = 401;
    throw error;
  }
  if (parsed.origin !== expected.origin) {
    const error = new Error("Passkey origin mismatch");
    error.status = 401;
    throw error;
  }
  return {
    clientDataJSON,
    parsed
  };
}

function importPasskeyKey(publicKey, algorithm) {
  const spki = fromBase64Url(publicKey);
  if (algorithm === -7) {
    return globalThis.crypto.subtle.importKey(
      "spki",
      spki,
      {
        name: "ECDSA",
        namedCurve: "P-256"
      },
      false,
      ["verify"]
    );
  }
  if (algorithm === -257) {
    return globalThis.crypto.subtle.importKey(
      "spki",
      spki,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256"
      },
      false,
      ["verify"]
    );
  }
  const error = new Error("Unsupported passkey algorithm");
  error.status = 400;
  throw error;
}

async function verifyPasskeyAssertion(assertion, expected, passkey) {
  const { clientDataJSON } = verifyClientData(assertion.response?.clientDataJSON, {
    challenge: expected.challenge,
    origin: expected.origin,
    type: "webauthn.get"
  });

  const authenticatorData = fromBase64Url(assertion.response?.authenticatorData);
  const signature = fromBase64Url(assertion.response?.signature);
  const clientDataHash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", clientDataJSON));
  const verificationData = concatBytes(authenticatorData, clientDataHash);
  const key = await importPasskeyKey(passkey.publicKey, passkey.algorithm);
  const verifyOptions =
    passkey.algorithm === -7
      ? {
          name: "ECDSA",
          hash: "SHA-256"
        }
      : {
          name: "RSASSA-PKCS1-v1_5"
        };
  const valid = await globalThis.crypto.subtle.verify(verifyOptions, key, signature, verificationData);
  if (!valid) {
    const error = new Error("Passkey assertion invalid");
    error.status = 401;
    throw error;
  }
  return {
    signCount: readUint32(authenticatorData, 33)
  };
}

function requestIdentity(request) {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) {
    return cfIp.trim();
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return "anonymous";
}

export function createWorkerService(options = {}) {
  if (options.service) {
    return options.service;
  }
  return createBurstFlareService({
    store: options.DB ? createCloudflareStateStore(options.DB) : createMemoryStore(),
    objects: createObjectStore(options),
    jobs: createJobQueue(options)
  });
}

function hasRuntimeBinding(options = {}) {
  return Boolean(options.containersEnabled && typeof options.getSessionContainer === "function");
}

async function readContainerRuntimeState(container) {
  if (!container) {
    return null;
  }
  if (typeof container.getRuntimeState === "function") {
    return container.getRuntimeState();
  }
  if (typeof container.getState === "function") {
    const state = await container.getState();
    return {
      desiredState: ["healthy", "running"].includes(state?.status) ? "running" : "sleeping",
      status: ["healthy", "running"].includes(state?.status) ? "running" : "sleeping",
      runtimeState: state?.status || "unknown"
    };
  }
  return null;
}

function createContainerControlRequest(pathname, payload) {
  return new Request(`http://runtime.internal${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
}

async function applyRuntimeBootstrapToContainer(container, session) {
  if (!container || !session) {
    return null;
  }

  const payload = {
    sessionId: session.id,
    workspaceId: session.workspaceId || null,
    templateId: session.templateId || null,
    templateName: session.templateName || null,
    state: session.state || null,
    previewUrl: session.previewUrl || null,
    lastRestoredSnapshotId: session.lastRestoredSnapshotId || null,
    persistedPaths: Array.isArray(session.persistedPaths) ? session.persistedPaths : [],
    runtimeVersion: Number.isInteger(session.runtimeVersion) ? session.runtimeVersion : 0
  };

  let result = null;
  if (typeof container.fetch === "function") {
    try {
      const response = await container.fetch(createContainerControlRequest("/runtime/bootstrap", payload));
      if (response.ok) {
        result = await response.json().catch(() => null);
      }
    } catch (_error) {
      result = null;
    }
  }
  if (typeof container.recordBootstrap === "function") {
    try {
      await container.recordBootstrap(payload);
    } catch (_error) {}
  }
  return result;
}

async function emitRuntimeLifecycleHook(container, sessionId, phase, reason = "", { writeRuntimeFile = false } = {}) {
  if (!container || !sessionId || !phase) {
    return null;
  }

  const payload = {
    sessionId,
    phase,
    reason: reason || phase
  };

  let result = null;
  if (typeof container.recordLifecycleHook === "function") {
    try {
      await container.recordLifecycleHook(payload);
    } catch (_error) {}
  }
  if (writeRuntimeFile && typeof container.fetch === "function") {
    try {
      const response = await container.fetch(createContainerControlRequest("/runtime/lifecycle", payload));
      if (response.ok) {
        result = await response.json().catch(() => null);
      }
    } catch (_error) {
      result = null;
    }
  }
  return result;
}

async function stopContainerRuntime(container, reason = "reconcile", sessionId = null) {
  if (!container) {
    return null;
  }
  await emitRuntimeLifecycleHook(container, sessionId, "sleep", reason, {
    writeRuntimeFile: true
  });
  if (typeof container.stopRuntime === "function") {
    return container.stopRuntime(reason);
  }
  if (typeof container.stop === "function") {
    await container.stop();
  }
  return readContainerRuntimeState(container);
}

export async function runReconcile(options = {}) {
  const service = createWorkerService(options);
  let runtimeSleptSessions = 0;

  if (hasRuntimeBinding(options)) {
    const result = await service.listSessionsForRuntimeReconcile();
    for (const session of result.sessions) {
      if (session.state !== "running") {
        continue;
      }
      const container = options.getSessionContainer(session.id);
      if (!container) {
        continue;
      }
      const runtime = await stopContainerRuntime(container, "reconcile", session.id);
      await service.applySystemSessionTransition(session.id, "stop", runtime);
      runtimeSleptSessions += 1;
    }
  }

  const result = await service.reconcile();
  return {
    ...result,
    runtimeSleptSessions
  };
}

export async function handleScheduled(controller, options = {}) {
  if (options.RECONCILE_QUEUE) {
    await options.RECONCILE_QUEUE.send({
      type: "reconcile",
      source: "scheduled",
      cron: controller.cron || null
    });
    return;
  }
  await runReconcile(options);
}

export function createApp(options = {}) {
  const service = createWorkerService(options);
  const jobs = createJobQueue(options);
  const rateLimiter = createRateLimiter(options);
  const turnstile = createTurnstileVerifier(options);
  const webAuthnChallenges = createWebAuthnChallengeStore(options);

  function hasContainerBinding() {
    return hasRuntimeBinding(options);
  }

  function getSessionContainer(sessionId) {
    if (!hasContainerBinding()) {
      return null;
    }
    return options.getSessionContainer(sessionId);
  }

  async function startSessionContainer(sessionId) {
    const container = getSessionContainer(sessionId);
    if (!container) {
      return null;
    }
    if (typeof container.startAndWaitForPorts === "function") {
      await container.startAndWaitForPorts();
    }
    return container;
  }

  async function getSessionRuntimeState(sessionId) {
    const container = getSessionContainer(sessionId);
    return readContainerRuntimeState(container);
  }

  async function syncSessionRuntime(action, session) {
    const container = getSessionContainer(session.id);
    if (!container) {
      return null;
    }
    if (action === "start") {
      if (typeof container.startRuntime === "function") {
        return container.startRuntime({
          sessionId: session.id,
          previewUrl: session.previewUrl
        });
      }
      await startSessionContainer(session.id);
      return getSessionRuntimeState(session.id);
    }
    if (action === "stop") {
      return stopContainerRuntime(container, "session_stop", session.id);
    }
    if (action === "restart") {
      if (session.state === "running") {
        await emitRuntimeLifecycleHook(container, session.id, "restart", "restart", {
          writeRuntimeFile: true
        });
      }
      if (typeof container.restartRuntime === "function") {
        return container.restartRuntime({
          sessionId: session.id,
          previewUrl: session.previewUrl
        });
      }
      if (typeof container.stop === "function") {
        await container.stop();
      }
      await startSessionContainer(session.id);
      return getSessionRuntimeState(session.id);
    }
    if (action === "delete") {
      await emitRuntimeLifecycleHook(container, session.id, "delete", "delete", {
        writeRuntimeFile: session.state === "running"
      });
      if (typeof container.deleteRuntime === "function") {
        return container.deleteRuntime();
      }
      if (typeof container.destroy === "function") {
        await container.destroy();
      }
      return getSessionRuntimeState(session.id);
    }
    return getSessionRuntimeState(session.id);
  }

  async function transitionSession(token, sessionId, action) {
    if (!hasContainerBinding()) {
      if (action === "start") {
        return service.startSession(token, sessionId);
      }
      if (action === "stop") {
        return service.stopSession(token, sessionId);
      }
      if (action === "restart") {
        return service.restartSession(token, sessionId);
      }
      if (action === "delete") {
        return service.deleteSession(token, sessionId);
      }
      throw new Error(`Unsupported session action: ${action}`);
    }

    const result = await service.transitionSessionWithRuntime(token, sessionId, action, (session) => syncSessionRuntime(action, session));
    if (
      ["start", "restart"].includes(action) &&
      result.session.state === "running" &&
      !result.stale
    ) {
      const container = getSessionContainer(result.session.id);
      await applyRuntimeBootstrapToContainer(container, result.session);
      if (result.session.lastRestoredSnapshotId) {
        const runtimeRestore = await applyRuntimeSnapshotHydration(token, result.session);
        if (runtimeRestore) {
          result.runtimeRestore = runtimeRestore;
        }
      }
    }
    return result;
  }

  async function attachRuntimeToSession(session) {
    const runtime = await getSessionRuntimeState(session.id);
    return runtime ? { ...session, runtime } : session;
  }

  function createPreviewRequest(request, sessionId) {
    const url = new URL(request.url);
    url.pathname = "/";
    url.search = "";
    url.searchParams.set("sessionId", sessionId);
    return new Request(url.toString(), request);
  }

  function createRuntimeSshRequest(request, sessionId) {
    const url = new URL(request.url);
    url.pathname = "/ssh";
    url.search = "";
    url.searchParams.set("sessionId", sessionId);
    return new Request(url.toString(), request);
  }

  function createRuntimeTerminalRequest(request, sessionId) {
    const url = new URL(request.url);
    url.pathname = "/shell";
    url.search = "";
    url.searchParams.set("sessionId", sessionId);
    return new Request(url.toString(), request);
  }

  function createRuntimeEditorRequest(request, session, bodyText = null) {
    const source = new URL(request.url);
    const url = new URL(request.url);
    url.pathname = "/editor";
    url.search = "";
    url.searchParams.set("sessionId", session.id);
    if (Array.isArray(session?.persistedPaths)) {
      for (const persistedPath of session.persistedPaths) {
        url.searchParams.append("persistedPath", persistedPath);
      }
    }
    const requestedPath = source.searchParams.get("path");
    if (requestedPath) {
      url.searchParams.set("path", requestedPath);
    }
    const csrfCookie = readCookie(request.headers.get("cookie"), CSRF_COOKIE);
    if (csrfCookie) {
      url.searchParams.set("csrf", csrfCookie);
    }
    if (bodyText === null) {
      return new Request(url.toString(), request);
    }
    return new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: bodyText
    });
  }

  function createSnapshotRestoreRequest(session, snapshotId, snapshot, content) {
    const url = new URL("http://runtime.internal/snapshot/restore");
    url.searchParams.set("sessionId", session.id);
    return new Request(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        sessionId: session.id,
        snapshotId,
        label: snapshot?.label || snapshotId,
        persistedPaths: Array.isArray(session?.persistedPaths) ? session.persistedPaths : [],
        contentType: content.contentType,
        bytes: content.bytes,
        contentBase64: toBase64(content.body)
      })
    });
  }

  function createSnapshotExportRequest(session) {
    const url = new URL("http://runtime.internal/snapshot/export");
    url.searchParams.set("sessionId", session.id);
    return new Request(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        sessionId: session.id,
        persistedPaths: Array.isArray(session?.persistedPaths) ? session.persistedPaths : []
      })
    });
  }

  async function applySnapshotContentToRuntime(session, snapshotId, snapshot, content) {
    const container = getSessionContainer(session.id);
    if (!container || typeof container.fetch !== "function") {
      return null;
    }
    const response = await container.fetch(createSnapshotRestoreRequest(session, snapshotId, snapshot, content));
    if (!response.ok) {
      const message = await response.text().catch(() => "Snapshot restore failed");
      const error = new Error(message || "Snapshot restore failed");
      error.status = 502;
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    return {
      ok: true,
      snapshotId,
      ...data
    };
  }

  async function applySnapshotToRuntime(token, session, snapshotId, snapshot) {
    const content = await service.getSnapshotContent(token, session.id, snapshotId);
    return applySnapshotContentToRuntime(session, snapshotId, snapshot, content);
  }

  async function applyRuntimeSnapshotHydration(token, session, { runtimeToken = false } = {}) {
    if (!session?.lastRestoredSnapshotId) {
      return null;
    }
    const content = runtimeToken
      ? await service.getRuntimeSnapshotContent(token, session.id, session.lastRestoredSnapshotId)
      : await service.getSnapshotContent(token, session.id, session.lastRestoredSnapshotId);
    return applySnapshotContentToRuntime(
      session,
      session.lastRestoredSnapshotId,
      {
        id: session.lastRestoredSnapshotId,
        label: session.lastRestoredSnapshotId
      },
      content
    );
  }

  async function captureSnapshotFromRuntime(session) {
    const container = getSessionContainer(session.id);
    if (!container || typeof container.fetch !== "function") {
      return null;
    }
    const response = await container.fetch(createSnapshotExportRequest(session));
    if (!response.ok) {
      const message = await response.text().catch(() => "Snapshot export failed");
      const error = new Error(message || "Snapshot export failed");
      error.status = 502;
      throw error;
    }
    const body = await response.arrayBuffer();
    return {
      body,
      contentType: response.headers.get("content-type") || "application/octet-stream",
      bytes: body.byteLength
    };
  }

  function rewriteSshCommand(request, sshCommand) {
    const url = new URL(request.url);
    const host = url.host;
    return sshCommand.replace("ws://localhost:8787", `wss://${host}`);
  }

  function renderShellHtml() {
    const turnstileScript = options.TURNSTILE_SITE_KEY
      ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>'
      : "";
    return html.replace("__BURSTFLARE_TURNSTILE_SCRIPT__", turnstileScript);
  }

  function renderShellJs() {
    return appJs.replace("__BURSTFLARE_TURNSTILE_SITE_KEY__", JSON.stringify(String(options.TURNSTILE_SITE_KEY || "")));
  }

  function createRuntimeSshBridge(sessionId) {
    if (typeof options.createWebSocketPair === "function") {
      return options.createWebSocketPair(sessionId);
    }
    if (typeof globalThis.WebSocketPair !== "function") {
      return null;
    }
    const pair = new globalThis.WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    server.send(`BurstFlare SSH bridge attached to ${sessionId}`);
    server.addEventListener("message", (event) => {
      if (event.data === "__burstflare_close__") {
        server.close(1000, "Closed by client");
        return;
      }
      server.send(`echo: ${String(event.data ?? "")}`);
    });
    return { client, server };
  }

  function withRateLimit(config, handler) {
    return async (request, params = {}) => {
      const identity = config.identity ? config.identity(request, params) : requestIdentity(request);
      const result = await rateLimiter.consume(config.scope, identity, config.limit, config.windowSeconds);
      if (!result.ok) {
        return toJson(
          {
            error: `Rate limit exceeded for ${config.scope}`
          },
          {
            status: 429,
            headers: {
              "x-burstflare-rate-limit-limit": String(result.limit),
              "x-burstflare-rate-limit-remaining": String(result.remaining),
              "x-burstflare-rate-limit-reset": new Date(result.resetAt).toISOString()
            }
          }
        );
      }
      const response = await handler(request, params);
      response.headers.set("x-burstflare-rate-limit-limit", String(result.limit));
      response.headers.set("x-burstflare-rate-limit-remaining", String(result.remaining));
      response.headers.set("x-burstflare-rate-limit-reset", new Date(result.resetAt).toISOString());
      return response;
    };
  }

  async function verifyTurnstile(request, body) {
    if (!turnstile.enabled) {
      return;
    }
    await turnstile.verify(body.turnstileToken || request.headers.get("cf-turnstile-response"), requestIdentity(request));
  }

  async function beginPasskeyRegistration(request, token) {
    const registration = await service.beginPasskeyRegistration(token);
    const challenge = createChallenge();
    const challengeRecord = await webAuthnChallenges.create({
      kind: "passkey-register",
      userId: registration.user.id,
      workspaceId: registration.workspace.id,
      challenge,
      origin: getRequestOrigin(request),
      rpId: getRequestRpId(request)
    });
    return {
      challengeId: challengeRecord.id,
      publicKey: {
        challenge,
        rpId: challengeRecord.rpId,
        user: {
          id: toBase64Url(registration.user.id),
          name: registration.user.email,
          displayName: registration.user.name
        },
        timeoutMs: 60_000,
        excludeCredentialIds: registration.passkeys.map((entry) => entry.id),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 }
        ]
      },
      passkeys: registration.passkeys
    };
  }

  async function finishPasskeyRegistration(request, token, body) {
    const challenge = await webAuthnChallenges.consume(body.challengeId);
    if (!challenge || challenge.kind !== "passkey-register") {
      const error = new Error("Passkey registration challenge not found");
      error.status = 400;
      throw error;
    }
    const auth = await service.authenticate(token);
    if (auth.user.id !== challenge.userId || auth.workspace.id !== challenge.workspaceId) {
      const error = new Error("Passkey registration challenge does not match the current session");
      error.status = 403;
      throw error;
    }
    verifyClientData(body.credential?.response?.clientDataJSON, {
      challenge: challenge.challenge,
      origin: challenge.origin,
      type: "webauthn.create"
    });
    return service.registerPasskey(token, {
      credentialId: body.credential?.id,
      label: body.label,
      publicKey: body.credential?.response?.publicKey,
      publicKeyAlgorithm: Number(body.credential?.response?.publicKeyAlgorithm),
      transports: body.credential?.response?.transports || []
    });
  }

  async function beginPasskeyLogin(request, body) {
    await verifyTurnstile(request, body);
    const login = await service.beginPasskeyLogin(body);
    const challenge = createChallenge();
    const challengeRecord = await webAuthnChallenges.create({
      kind: "passkey-login",
      userId: login.user.id,
      workspaceId: login.workspace.id,
      challenge,
      origin: getRequestOrigin(request),
      rpId: getRequestRpId(request),
      credentialIds: login.passkeys.map((entry) => entry.id)
    });
    return {
      challengeId: challengeRecord.id,
      publicKey: {
        challenge,
        rpId: challengeRecord.rpId,
        timeoutMs: 60_000,
        userVerification: "preferred",
        allowCredentialIds: login.passkeys.map((entry) => entry.id)
      }
    };
  }

  async function finishPasskeyLogin(body) {
    const challenge = await webAuthnChallenges.consume(body.challengeId);
    if (!challenge || challenge.kind !== "passkey-login") {
      const error = new Error("Passkey login challenge not found");
      error.status = 400;
      throw error;
    }
    if (!challenge.credentialIds.includes(body.credential?.id)) {
      const error = new Error("Passkey credential is not allowed for this challenge");
      error.status = 401;
      throw error;
    }
    const assertion = await service.getPasskeyAssertion({
      userId: challenge.userId,
      workspaceId: challenge.workspaceId,
      credentialId: body.credential?.id
    });
    const verified = await verifyPasskeyAssertion(body.credential, {
      challenge: challenge.challenge,
      origin: challenge.origin
    }, assertion.passkey);
    return service.completePasskeyLogin({
      userId: challenge.userId,
      workspaceId: challenge.workspaceId,
      credentialId: body.credential?.id,
      signCount: verified.signCount
    });
  }

  const routes = [
    {
      method: "GET",
      pattern: "/",
      handler: () =>
        new Response(renderShellHtml(), {
          headers: { "content-type": "text/html; charset=utf-8" }
        })
    },
    {
      method: "GET",
      pattern: "/app.js",
      handler: () =>
        new Response(renderShellJs(), {
          headers: { "content-type": "application/javascript; charset=utf-8" }
        })
    },
    {
      method: "GET",
      pattern: "/styles.css",
      handler: () =>
        new Response(styles, {
          headers: { "content-type": "text/css; charset=utf-8" }
        })
    },
    {
      method: "GET",
      pattern: "/device",
      handler: (request) => {
        const url = new URL(request.url);
        return new Response(devicePage(url.searchParams.get("code")), {
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
    },
    {
      method: "GET",
      pattern: "/api/health",
      handler: () =>
        toJson({
          ok: true,
          service: "burstflare",
          runtime: {
            containersEnabled: hasContainerBinding(),
            turnstileEnabled: turnstile.enabled,
            workflowEnabled: jobs?.buildStrategy === "workflow",
            buildDispatchMode: jobs?.buildStrategy || "manual"
          }
        })
    },
    {
      method: "POST",
      pattern: "/api/auth/register",
      handler: withRateLimit(
        {
          scope: "auth-register",
          limit: 4,
          windowSeconds: 60
        },
        withErrorHandling(async (request) => {
          const body = await parseJson(await request.text());
          await verifyTurnstile(request, body);
          const result = await service.registerUser(body);
          const csrfToken = createCsrfToken();
          return toJsonWithCookies(
            {
              ...result,
              csrfToken
            },
            authCookies(service, result.token, csrfToken)
          );
        })
      )
    },
    {
      method: "POST",
      pattern: "/api/auth/login",
      handler: withRateLimit(
        {
          scope: "auth-login",
          limit: 8,
          windowSeconds: 60
        },
        withErrorHandling(async (request) => {
          const body = await parseJson(await request.text());
          await verifyTurnstile(request, body);
          const result = await service.login(body);
          const csrfToken = createCsrfToken();
          return toJsonWithCookies(
            {
              ...result,
              csrfToken
            },
            authCookies(service, result.token, csrfToken)
          );
        })
      )
    },
    {
      method: "POST",
      pattern: "/api/auth/recover",
      handler: withRateLimit(
        {
          scope: "auth-recover",
          limit: 6,
          windowSeconds: 60
        },
        withErrorHandling(async (request) => {
          const body = await parseJson(await request.text());
          await verifyTurnstile(request, body);
          const result = await service.recoverWithCode(body);
          const csrfToken = createCsrfToken();
          return toJsonWithCookies(
            {
              ...result,
              csrfToken
            },
            authCookies(service, result.token, csrfToken)
          );
        })
      )
    },
    {
      method: "POST",
      pattern: "/api/auth/passkeys/login/start",
      handler: withRateLimit(
        {
          scope: "auth-passkey-login-start",
          limit: 8,
          windowSeconds: 60
        },
        withErrorHandling(async (request) => {
          const body = await parseJson(await request.text());
          return toJson(await beginPasskeyLogin(request, body));
        })
      )
    },
    {
      method: "POST",
      pattern: "/api/auth/passkeys/login/finish",
      handler: withRateLimit(
        {
          scope: "auth-passkey-login-finish",
          limit: 12,
          windowSeconds: 60
        },
        withErrorHandling(async (request) => {
          const body = await parseJson(await request.text());
          const result = await finishPasskeyLogin(body);
          const csrfToken = createCsrfToken();
          return toJsonWithCookies(
            {
              ...result,
              csrfToken
            },
            authCookies(service, result.token, csrfToken)
          );
        })
      )
    },
    {
      method: "POST",
      pattern: "/api/auth/refresh",
      handler: withRateLimit(
        {
          scope: "auth-refresh",
          limit: 12,
          windowSeconds: 60
        },
        withErrorHandling(async (request) => {
          const body = await parseJson(await request.text());
          const result = await service.refreshSession(body.refreshToken);
          const csrfToken = createCsrfToken();
          return toJsonWithCookies(
            {
              ...result,
              csrfToken
            },
            authCookies(service, result.token, csrfToken)
          );
        })
      )
    },
    {
      method: "POST",
      pattern: "/api/auth/logout",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        const result = await service.logout(token, body.refreshToken || null);
        return toJsonWithCookies(result, clearAuthCookies(service));
      })
    },
    {
      method: "POST",
      pattern: "/api/auth/logout-all",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const result = await service.logoutAllSessions(token);
        return toJsonWithCookies(result, clearAuthCookies(service));
      })
    },
    {
      method: "POST",
      pattern: "/api/auth/switch-workspace",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        const result = await service.switchWorkspace(token, body.workspaceId);
        const csrfToken = createCsrfToken();
        return toJsonWithCookies(
          {
            ...result,
            csrfToken
          },
          authCookies(service, result.token, csrfToken)
        );
      })
    },
    {
      method: "GET",
      pattern: "/api/auth/me",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.authenticate(token));
      })
    },
    {
      method: "GET",
      pattern: "/api/auth/sessions",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.listAuthSessions(token));
      })
    },
    {
      method: "DELETE",
      pattern: "/api/auth/sessions/:authSessionId",
      handler: withErrorHandling(async (request, { authSessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.revokeAuthSession(token, authSessionId));
      })
    },
    {
      method: "POST",
      pattern: "/api/auth/recovery-codes/generate",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.generateRecoveryCodes(token, body));
      })
    },
    {
      method: "GET",
      pattern: "/api/auth/passkeys",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.listPasskeys(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/auth/passkeys/register/start",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await beginPasskeyRegistration(request, token));
      })
    },
    {
      method: "POST",
      pattern: "/api/auth/passkeys/register/finish",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await finishPasskeyRegistration(request, token, body));
      })
    },
    {
      method: "DELETE",
      pattern: "/api/auth/passkeys/:credentialId",
      handler: withErrorHandling(async (request, { credentialId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.deletePasskey(token, credentialId));
      })
    },
    {
      method: "POST",
      pattern: "/api/cli/device/start",
      handler: withRateLimit(
        {
          scope: "device-start",
          limit: 4,
          windowSeconds: 60
        },
        withErrorHandling(async (request) => {
          const body = await parseJson(await request.text());
          await verifyTurnstile(request, body);
          return toJson(await service.deviceStart(body));
        })
      )
    },
    {
      method: "POST",
      pattern: "/api/cli/device/approve",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.deviceApprove(token, body.deviceCode));
      })
    },
    {
      method: "POST",
      pattern: "/api/cli/device/exchange",
      handler: withErrorHandling(async (request) => {
        const body = await parseJson(await request.text());
        return toJson(await service.deviceExchange(body.deviceCode));
      })
    },
    {
      method: "GET",
      pattern: "/api/workspaces",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.listWorkspaces(token));
      })
    },
    {
      method: "GET",
      pattern: "/api/workspaces/current/members",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.listWorkspaceMembers(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/workspaces/current/invites",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.createWorkspaceInvite(token, body));
      })
    },
    {
      method: "POST",
      pattern: "/api/workspaces/current/invites/accept",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.acceptWorkspaceInvite(token, body.inviteCode));
      })
    },
    {
      method: "POST",
      pattern: "/api/workspaces/current/members/:userId/role",
      handler: withErrorHandling(async (request, { userId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.updateWorkspaceMemberRole(token, userId, body.role));
      })
    },
    {
      method: "POST",
      pattern: "/api/workspaces/current/plan",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.setWorkspacePlan(token, body.plan));
      })
    },
    {
      method: "PATCH",
      pattern: "/api/workspaces/current/settings",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.updateWorkspaceSettings(token, body));
      })
    },
    {
      method: "POST",
      pattern: "/api/workspaces/current/quota-overrides",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.setWorkspaceQuotaOverrides(token, body));
      })
    },
    {
      method: "GET",
      pattern: "/api/templates",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.listTemplates(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/templates",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.createTemplate(token, body));
      })
    },
    {
      method: "POST",
      pattern: "/api/templates/:templateId/versions",
      handler: withErrorHandling(async (request, { templateId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.addTemplateVersion(token, templateId, body));
      })
    },
    {
      method: "PUT",
      pattern: "/api/templates/:templateId/versions/:versionId/bundle",
      handler: withRateLimit(
        {
          scope: "template-bundle-upload",
          limit: 8,
          windowSeconds: 60,
          identity: (request) => request.headers.get("authorization") || requestIdentity(request)
        },
        withErrorHandling(async (request, { templateId, versionId }) => {
          const token = requireToken(request, service);
          if (!token) {
            return unauthorized();
          }
          return toJson(
            await service.uploadTemplateVersionBundle(token, templateId, versionId, {
              body: await request.arrayBuffer(),
              contentType: request.headers.get("content-type") || "application/octet-stream"
            })
          );
        })
      )
    },
    {
      method: "POST",
      pattern: "/api/templates/:templateId/versions/:versionId/bundle/upload",
      handler: withErrorHandling(async (request, { templateId, versionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        const result = await service.createTemplateVersionBundleUploadGrant(token, templateId, versionId, body);
        return toJson({
          ...result,
          uploadGrant: {
            ...result.uploadGrant,
            url: new URL(`/api/uploads/${result.uploadGrant.id}`, request.url).toString()
          }
        });
      })
    },
    {
      method: "GET",
      pattern: "/api/templates/:templateId/versions/:versionId/bundle",
      handler: withErrorHandling(async (request, { templateId, versionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const bundle = await service.getTemplateVersionBundle(token, templateId, versionId);
        return new Response(bundle.body, {
          headers: {
            "content-type": bundle.contentType,
            "content-disposition": `inline; filename="${bundle.fileName}"`,
            "content-length": String(bundle.bytes)
          }
        });
      })
    },
    {
      method: "POST",
      pattern: "/api/templates/:templateId/promote",
      handler: withErrorHandling(async (request, { templateId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.promoteTemplateVersion(token, templateId, body.versionId));
      })
    },
    {
      method: "POST",
      pattern: "/api/templates/:templateId/rollback",
      handler: withErrorHandling(async (request, { templateId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.rollbackTemplate(token, templateId, body.releaseId || null));
      })
    },
    {
      method: "POST",
      pattern: "/api/templates/:templateId/archive",
      handler: withErrorHandling(async (request, { templateId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.archiveTemplate(token, templateId));
      })
    },
    {
      method: "POST",
      pattern: "/api/templates/:templateId/restore",
      handler: withErrorHandling(async (request, { templateId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.restoreTemplate(token, templateId));
      })
    },
    {
      method: "DELETE",
      pattern: "/api/templates/:templateId",
      handler: withErrorHandling(async (request, { templateId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.deleteTemplate(token, templateId));
      })
    },
    {
      method: "GET",
      pattern: "/api/template-builds",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.listTemplateBuilds(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/template-builds/process",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.processTemplateBuilds(token));
      })
    },
    {
      method: "GET",
      pattern: "/api/template-builds/:buildId/log",
      handler: withErrorHandling(async (request, { buildId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const log = await service.getTemplateBuildLog(token, buildId);
        return new Response(log.text, {
          headers: {
            "content-type": log.contentType
          }
        });
      })
    },
    {
      method: "GET",
      pattern: "/api/template-builds/:buildId/artifact",
      handler: withErrorHandling(async (request, { buildId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const artifact = await service.getTemplateBuildArtifact(token, buildId);
        return new Response(artifact.text, {
          headers: {
            "content-type": artifact.contentType
          }
        });
      })
    },
    {
      method: "POST",
      pattern: "/api/template-builds/:buildId/retry",
      handler: withErrorHandling(async (request, { buildId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.retryTemplateBuild(token, buildId));
      })
    },
    {
      method: "GET",
      pattern: "/api/releases",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.listBindingReleases(token));
      })
    },
    {
      method: "GET",
      pattern: "/api/sessions",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const result = await service.listSessions(token);
        return toJson({
          sessions: await Promise.all(result.sessions.map((session) => attachRuntimeToSession(session)))
        });
      })
    },
    {
      method: "POST",
      pattern: "/api/sessions",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.createSession(token, body));
      })
    },
    {
      method: "GET",
      pattern: "/api/sessions/:sessionId",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const result = await service.getSession(token, sessionId);
        return toJson({
          ...result,
          session: await attachRuntimeToSession(result.session)
        });
      })
    },
    {
      method: "GET",
      pattern: "/api/sessions/:sessionId/events",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.listSessionEvents(token, sessionId));
      })
    },
    {
      method: "POST",
      pattern: "/api/sessions/:sessionId/start",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await transitionSession(token, sessionId, "start"));
      })
    },
    {
      method: "POST",
      pattern: "/api/sessions/:sessionId/stop",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await transitionSession(token, sessionId, "stop"));
      })
    },
    {
      method: "POST",
      pattern: "/api/sessions/:sessionId/restart",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await transitionSession(token, sessionId, "restart"));
      })
    },
    {
      method: "DELETE",
      pattern: "/api/sessions/:sessionId",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await transitionSession(token, sessionId, "delete"));
      })
    },
    {
      method: "GET",
      pattern: "/api/sessions/:sessionId/snapshots",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.listSnapshots(token, sessionId));
      })
    },
    {
      method: "POST",
      pattern: "/api/sessions/:sessionId/snapshots",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        const result = await service.createSnapshot(token, sessionId, body);
        const detail = await service.getSession(token, sessionId);
        if (hasContainerBinding() && detail.session.state === "running") {
          const runtimeCapture = await captureSnapshotFromRuntime(detail.session);
          if (runtimeCapture) {
            const uploaded = await service.uploadSnapshotContent(token, sessionId, result.snapshot.id, runtimeCapture);
            result.snapshot = uploaded.snapshot;
            result.runtimeCapture = {
              bytes: runtimeCapture.bytes,
              contentType: runtimeCapture.contentType
            };
          }
        }
        return toJson(result);
      })
    },
    {
      method: "POST",
      pattern: "/api/sessions/:sessionId/snapshots/:snapshotId/content/upload",
      handler: withErrorHandling(async (request, { sessionId, snapshotId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        const result = await service.createSnapshotUploadGrant(token, sessionId, snapshotId, body);
        return toJson({
          ...result,
          uploadGrant: {
            ...result.uploadGrant,
            url: new URL(`/api/uploads/${result.uploadGrant.id}`, request.url).toString()
          }
        });
      })
    },
    {
      method: "PUT",
      pattern: "/api/sessions/:sessionId/snapshots/:snapshotId/content",
      handler: withErrorHandling(async (request, { sessionId, snapshotId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(
          await service.uploadSnapshotContent(token, sessionId, snapshotId, {
            body: await request.arrayBuffer(),
            contentType: request.headers.get("content-type") || "application/octet-stream"
          })
        );
      })
    },
    {
      method: "GET",
      pattern: "/api/sessions/:sessionId/snapshots/:snapshotId/content",
      handler: withErrorHandling(async (request, { sessionId, snapshotId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const content = await service.getSnapshotContent(token, sessionId, snapshotId);
        return new Response(content.body, {
          headers: {
            "content-type": content.contentType,
            "content-disposition": `inline; filename="${content.fileName}"`,
            "content-length": String(content.bytes)
          }
        });
      })
    },
    {
      method: "POST",
      pattern: "/api/sessions/:sessionId/snapshots/:snapshotId/restore",
      handler: withErrorHandling(async (request, { sessionId, snapshotId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const result = await service.restoreSnapshot(token, sessionId, snapshotId);
        if (hasContainerBinding() && result.session.state === "running") {
          const runtimeRestore = await applySnapshotToRuntime(token, result.session, snapshotId, result.snapshot);
          if (runtimeRestore) {
            result.runtimeRestore = runtimeRestore;
          }
        }
        return toJson(result);
      })
    },
    {
      method: "DELETE",
      pattern: "/api/sessions/:sessionId/snapshots/:snapshotId",
      handler: withErrorHandling(async (request, { sessionId, snapshotId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.deleteSnapshot(token, sessionId, snapshotId));
      })
    },
    {
      method: "PUT",
      pattern: "/api/uploads/:uploadGrantId",
      handler: withRateLimit(
        {
          scope: "signed-upload",
          limit: 16,
          windowSeconds: 60
        },
        withErrorHandling(async (request, { uploadGrantId }) => {
          return toJson(
            await service.consumeUploadGrant(uploadGrantId, {
              body: await request.arrayBuffer(),
              contentType: request.headers.get("content-type") || "application/octet-stream"
            })
          );
        })
      )
    },
    {
      method: "POST",
      pattern: "/api/sessions/:sessionId/ssh-token",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const result = await service.issueRuntimeToken(token, sessionId);
        result.sshCommand = rewriteSshCommand(request, result.sshCommand);
        return toJson(result);
      })
    },
    {
      method: "GET",
      pattern: "/api/usage",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.getUsage(token));
      })
    },
    {
      method: "GET",
      pattern: "/api/audit",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.getAudit(token));
      })
    },
    {
      method: "GET",
      pattern: "/api/admin/report",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.getAdminReport(token));
      })
    },
    {
      method: "GET",
      pattern: "/api/admin/reconcile/preview",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.previewReconcile(token));
      })
    },
    {
      method: "GET",
      pattern: "/api/admin/export",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.exportWorkspace(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/admin/builds/retry-dead-lettered",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.retryDeadLetteredBuilds(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/admin/reconcile",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.reconcile(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/admin/reconcile/sleep-running",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.sleepRunningSessions(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/admin/reconcile/recover-builds",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.recoverStuckBuilds(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/admin/reconcile/purge-sleeping",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.purgeStaleSleepingSessions(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/admin/reconcile/purge-deleted",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.purgeDeletedSessions(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/admin/reconcile/enqueue",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.enqueueReconcile(token));
      })
    },
    {
      method: "GET",
      pattern: "/runtime/sessions/:sessionId/preview",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const detail = await service.getSession(token, sessionId);
        const container = await startSessionContainer(sessionId);
        if (!container) {
          return new Response("Session container runtime is not bound in this deployment.", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        await applyRuntimeBootstrapToContainer(container, detail.session);
        if (detail.session.lastRestoredSnapshotId) {
          await applyRuntimeSnapshotHydration(token, detail.session);
        }
        return container.fetch(createPreviewRequest(request, sessionId));
      })
    },
    {
      method: "GET",
      pattern: "/runtime/sessions/:sessionId/editor",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const auth = await readEditorRequestAuth(request, service);
        if (!auth?.token) {
          return unauthorized();
        }
        const detail = await service.getSession(auth.token, sessionId);
        const container = await startSessionContainer(sessionId);
        if (!container) {
          return new Response("Session container runtime is not bound in this deployment.", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        await applyRuntimeBootstrapToContainer(container, detail.session);
        if (detail.session.lastRestoredSnapshotId) {
          await applyRuntimeSnapshotHydration(auth.token, detail.session);
        }
        return container.fetch(createRuntimeEditorRequest(request, detail.session, auth.bodyText));
      })
    },
    {
      method: "POST",
      pattern: "/runtime/sessions/:sessionId/editor",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const auth = await readEditorRequestAuth(request, service);
        if (!auth?.token) {
          return unauthorized();
        }
        const detail = await service.getSession(auth.token, sessionId);
        const container = await startSessionContainer(sessionId);
        if (!container) {
          return new Response("Session container runtime is not bound in this deployment.", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        await applyRuntimeBootstrapToContainer(container, detail.session);
        if (detail.session.lastRestoredSnapshotId) {
          await applyRuntimeSnapshotHydration(auth.token, detail.session);
        }
        return container.fetch(createRuntimeEditorRequest(request, detail.session, auth.bodyText));
      })
    },
    {
      method: "GET",
      pattern: "/runtime/sessions/:sessionId/terminal",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (!token) {
          return unauthorized("Runtime token missing");
        }
        const runtimeAccess = await service.validateRuntimeToken(token, sessionId);
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return new Response("WebSocket upgrade required for terminal attach.", {
            status: 426,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        const container = await startSessionContainer(sessionId);
        if (container && typeof container.fetch === "function") {
          await applyRuntimeBootstrapToContainer(container, runtimeAccess.session);
          if (runtimeAccess.session?.lastRestoredSnapshotId) {
            await applyRuntimeSnapshotHydration(token, runtimeAccess.session, { runtimeToken: true });
          }
          return container.fetch(createRuntimeTerminalRequest(request, sessionId));
        }
        const bridge = createRuntimeSshBridge(sessionId);
        if (!bridge?.client) {
          return new Response("Runtime WebSocket support is unavailable in this deployment.", {
            status: 501,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        return new Response(null, {
          status: 101,
          webSocket: bridge.client
        });
      })
    },
    {
      method: "GET",
      pattern: "/runtime/sessions/:sessionId/ssh",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (!token) {
          return unauthorized("Runtime token missing");
        }
        const runtimeAccess = await service.validateRuntimeToken(token, sessionId);
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return new Response("WebSocket upgrade required for SSH attach.", {
            status: 426,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        const container = await startSessionContainer(sessionId);
        if (container && typeof container.fetch === "function") {
          await applyRuntimeBootstrapToContainer(container, runtimeAccess.session);
          if (runtimeAccess.session?.lastRestoredSnapshotId) {
            await applyRuntimeSnapshotHydration(token, runtimeAccess.session, { runtimeToken: true });
          }
          return container.fetch(createRuntimeSshRequest(request, sessionId));
        }
        const bridge = createRuntimeSshBridge(sessionId);
        if (!bridge?.client) {
          return new Response("Runtime WebSocket support is unavailable in this deployment.", {
            status: 501,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        return new Response(null, {
          status: 101,
          webSocket: bridge.client
        });
      })
    }
  ];

  return {
    async fetch(request) {
      const url = new URL(request.url);
      for (const route of routes) {
        if (route.method !== request.method) {
          continue;
        }
        const match = matchRoute(route.method, url.pathname, route.pattern);
        if (!match) {
          continue;
        }
        return route.handler(request, match.params);
      }
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/runtime/")) {
        return notFound();
      }
      return badRequest("Route not found");
    }
  };
}
