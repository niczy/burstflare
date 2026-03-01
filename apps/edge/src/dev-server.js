import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";
import { createApp } from "./app.js";
import { createBurstFlareService, createFileStore } from "../../../packages/shared/src/index.js";

const port = Number(process.env.PORT || 8787);
const dataFile = process.env.BURSTFLARE_DATA_FILE || ".local/burstflare-data.json";
const frontendOrigin = process.env.BURSTFLARE_FRONTEND_ORIGIN || "http://127.0.0.1:3000";
const frontendUrl = new URL(frontendOrigin);
const service = createBurstFlareService({
  store: createFileStore(dataFile)
});
const app = createApp({ service, frontendOrigin });

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const body =
    req.method === "GET" || req.method === "HEAD" || req.method === "DELETE"
      ? undefined
      : await readRequestBody(req);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body
  });

  try {
    const response = await app.fetch(request);
    res.statusCode = response.status;
    for (const [key, value] of response.headers.entries()) {
      res.setHeader(key, value);
    }
    if (!response.body) {
      res.end();
      return;
    }
    Readable.fromWeb(response.body).on("error", (error) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
      res.destroy(error);
    }).pipe(res);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.on("upgrade", (req, socket, head) => {
  const requestPath = req.url || "/";
  if (requestPath.startsWith("/runtime/")) {
    socket.write(
      "HTTP/1.1 501 Not Implemented\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\nRuntime WebSocket proxy is unavailable in the local dev server.\r\n"
    );
    socket.destroy();
    return;
  }
  if (frontendUrl.protocol !== "http:") {
    socket.write(
      "HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\nFrontend WebSocket proxy requires an http frontend origin.\r\n"
    );
    socket.destroy();
    return;
  }

  const upstream = net.connect(Number(frontendUrl.port || 80), frontendUrl.hostname);

  upstream.on("connect", () => {
    const headerLines = Object.entries(req.headers)
      .filter(([key, value]) => value !== undefined && key.toLowerCase() !== "host")
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`);

    upstream.write(
      [
        `GET ${requestPath} HTTP/${req.httpVersion}`,
        `Host: ${frontendUrl.host}`,
        ...headerLines,
        "",
        ""
      ].join("\r\n")
    );

    if (head?.length) {
      upstream.write(head);
    }

    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  const closeSockets = () => {
    if (!socket.destroyed) {
      socket.destroy();
    }
    if (!upstream.destroyed) {
      upstream.destroy();
    }
  };

  upstream.on("error", closeSockets);
  socket.on("error", () => {
    if (!upstream.destroyed) {
      upstream.destroy();
    }
  });
});

server.listen(port, () => {
  process.stdout.write(
    `BurstFlare dev server running at http://127.0.0.1:${port} (frontend proxy: ${frontendOrigin})\n`
  );
});
