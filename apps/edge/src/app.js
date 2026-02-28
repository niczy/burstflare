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
  if (!options.BUILD_QUEUE && !options.RECONCILE_QUEUE) {
    return null;
  }

  return {
    async enqueueBuild(buildId) {
      if (!options.BUILD_QUEUE) {
        return null;
      }
      await options.BUILD_QUEUE.send({
        type: "build",
        buildId
      });
      return { buildId };
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

export async function handleScheduled(controller, options = {}) {
  if (options.RECONCILE_QUEUE) {
    await options.RECONCILE_QUEUE.send({
      type: "reconcile",
      source: "scheduled",
      cron: controller.cron || null
    });
    return;
  }
  const service = createWorkerService(options);
  await service.reconcile();
}

export function createApp(options = {}) {
  const service = createWorkerService(options);
  const rateLimiter = createRateLimiter(options);
  const turnstile = createTurnstileVerifier(options);

  function hasContainerBinding() {
    return Boolean(options.containersEnabled);
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
            turnstileEnabled: turnstile.enabled
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
        return toJson(await service.listSessions(token));
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
        return toJson(await service.getSession(token, sessionId));
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
        const result = await service.startSession(token, sessionId);
        await startSessionContainer(sessionId);
        return toJson(result);
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
        return toJson(await service.stopSession(token, sessionId));
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
        return toJson(await service.restartSession(token, sessionId));
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
        return toJson(await service.deleteSession(token, sessionId));
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
        return toJson(await service.createSnapshot(token, sessionId, body));
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
        return toJson(await service.restoreSnapshot(token, sessionId, snapshotId));
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
        await service.getSession(token, sessionId);
        const container = await startSessionContainer(sessionId);
        if (!container) {
          return new Response("Session container runtime is not bound in this deployment.", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        return container.fetch(createPreviewRequest(request, sessionId));
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
        await service.validateRuntimeToken(token, sessionId);
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return new Response("WebSocket upgrade required for SSH attach.", {
            status: 426,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        const container = await startSessionContainer(sessionId);
        if (container && typeof container.fetch === "function") {
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
