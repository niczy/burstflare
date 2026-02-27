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

function requireToken(request, service) {
  const token = tokenFromRequest(request, service.sessionCookieName);
  if (!token) {
    return null;
  }
  return token;
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
      method: "POST",
      pattern: "/api/auth/switch-workspace",
      handler: withErrorHandling(async (request) => {
        const token = requireToken(request, service);
        if (!token) {
          return unauthorized();
        }
        const body = await parseJson(await request.text());
        const result = await service.switchWorkspace(token, body.workspaceId);
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
        const token = requireToken(request, service);
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
        return toJson(await service.startSession(token, sessionId));
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
      pattern: "/api/sessions/:sessionId/ssh-token",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const token = requireToken(request, service);
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
      method: "GET",
      pattern: "/runtime/sessions/:sessionId/ssh",
      handler: withErrorHandling(async (request, { sessionId }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (!token) {
          return unauthorized("Runtime token missing");
        }
        await service.validateRuntimeToken(token, sessionId);
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
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/runtime/")) {
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
