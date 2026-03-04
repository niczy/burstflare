import http from "node:http";
import { buildManagedRuntime, loadBuilderConfig, parseBuildRequest } from "./service.js";

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body, null, 2));
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > 1024 * 1024) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function isAuthorized(request: http.IncomingMessage, token: string): boolean {
  if (!token) {
    return true;
  }
  const authHeader = String(request.headers.authorization || "");
  return authHeader === `Bearer ${token}`;
}

export function createBuilderServer(env: NodeJS.ProcessEnv = process.env): http.Server {
  const config = loadBuilderConfig(env);
  return http.createServer(async (request, response) => {
    const method = request.method || "GET";
    const pathname = String(request.url || "/").split("?")[0];

    if (method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "burstflare-builder",
        imageRepositoryConfigured: Boolean(config.imageRepository),
        pushEnabled: config.push,
        platform: config.platform
      });
      return;
    }

    if (method === "POST" && pathname === "/build") {
      if (!isAuthorized(request, config.authToken)) {
        sendJson(response, 401, {
          error: "Unauthorized"
        });
        return;
      }
      try {
        const text = await readBody(request);
        const payload = text ? JSON.parse(text) : {};
        const buildRequest = parseBuildRequest(payload);
        const result = await buildManagedRuntime(buildRequest, config);
        sendJson(response, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status =
          message === "Unauthorized"
            ? 401
            : message === "Request body too large"
              ? 413
              : /required|must be/i.test(message)
                ? 400
                : 500;
        sendJson(response, status, {
          error: message
        });
      }
      return;
    }

    sendJson(response, 404, {
      error: "Not found"
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8788);
  const host = String(process.env.BUILDER_HOST || "0.0.0.0");
  const server = createBuilderServer(process.env);
  server.listen(port, host, () => {
    process.stdout.write(`burstflare-builder listening on http://${host}:${port}\n`);
  });
}
