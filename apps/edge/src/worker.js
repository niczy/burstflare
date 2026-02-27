import { html, appJs, styles } from "../../web/src/assets.js";
import {
  badRequest,
  cookie,
  createBurstFlareService,
  notFound,
  parseJson,
  readCookie,
  toJson,
  unauthorized
} from "../../../packages/shared/src/index.js";

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

export function createApp(options = {}) {
  const service =
    options.service ||
    createBurstFlareService({
      dataFile: options.dataFile || options.BURSTFLARE_DATA_FILE
    });

  const routes = [
    {
      method: "GET",
      pattern: "/",
      handler: () =>
        new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8" }
        })
    },
    {
      method: "GET",
      pattern: "/app.js",
      handler: () =>
        new Response(appJs, {
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
      pattern: "/api/health",
      handler: () => toJson({ ok: true, service: "burstflare" })
    },
    {
      method: "POST",
      pattern: "/api/auth/register",
      handler: withErrorHandling(async (request) => {
        const body = await parseJson(await request.text());
        const result = await service.registerUser(body);
        return toJson(result, {
          headers: {
            "set-cookie": cookie(service.sessionCookieName, result.token, { maxAge: 60 * 60 * 24 * 7 })
          }
        });
      })
    },
    {
      method: "POST",
      pattern: "/api/auth/login",
      handler: withErrorHandling(async (request) => {
        const body = await parseJson(await request.text());
        const result = await service.login(body);
        return toJson(result, {
          headers: {
            "set-cookie": cookie(service.sessionCookieName, result.token, { maxAge: 60 * 60 * 24 * 7 })
          }
        });
      })
    },
    {
      method: "GET",
      pattern: "/api/auth/me",
      handler: withErrorHandling(async (request) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.authenticate(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/cli/device/start",
      handler: withErrorHandling(async (request) => {
        const body = await parseJson(await request.text());
        return toJson(await service.deviceStart(body));
      })
    },
    {
      method: "POST",
      pattern: "/api/cli/device/approve",
      handler: withErrorHandling(async (request) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
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
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.listWorkspaces(token));
      })
    },
    {
      method: "GET",
      pattern: "/api/templates",
      handler: withErrorHandling(async (request) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
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
        const token = tokenFromRequest(request, service.sessionCookieName);
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
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.addTemplateVersion(token, templateId, body));
      })
    },
    {
      method: "POST",
      pattern: "/api/templates/:templateId/promote",
      handler: withErrorHandling(async (request, { templateId }) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.promoteTemplateVersion(token, templateId, body.versionId));
      })
    },
    {
      method: "GET",
      pattern: "/api/sessions",
      handler: withErrorHandling(async (request) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
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
        const token = tokenFromRequest(request, service.sessionCookieName);
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
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.getSession(token, sessionId));
      })
    },
    {
      method: "POST",
      pattern: "/api/sessions/:sessionId/start",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.startSession(token, sessionId));
      })
    },
    {
      method: "POST",
      pattern: "/api/sessions/:sessionId/stop",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.stopSession(token, sessionId));
      })
    },
    {
      method: "DELETE",
      pattern: "/api/sessions/:sessionId",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
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
        const token = tokenFromRequest(request, service.sessionCookieName);
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
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        return toJson(await service.createSnapshot(token, sessionId, body));
      })
    },
    {
      method: "POST",
      pattern: "/api/sessions/:sessionId/ssh-token",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.issueRuntimeToken(token, sessionId));
      })
    },
    {
      method: "GET",
      pattern: "/api/usage",
      handler: withErrorHandling(async (request) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
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
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        return toJson(await service.getAudit(token));
      })
    },
    {
      method: "POST",
      pattern: "/api/admin/reconcile",
      handler: withErrorHandling(async (request) => {
        const token = tokenFromRequest(request, service.sessionCookieName);
        if (!token) {
          return unauthorized();
        }
        await service.authenticate(token);
        return toJson(await service.reconcile());
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
        await service.authenticate(token);
        return new Response(`Runtime WebSocket proxy placeholder for ${sessionId}`, {
          headers: { "content-type": "text/plain; charset=utf-8" }
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
      if (url.pathname.startsWith("/api/")) {
        return notFound();
      }
      return badRequest("Route not found");
    }
  };
}

export default {
  async fetch(request, env) {
    const app = createApp(env || {});
    return app.fetch(request);
  }
};
