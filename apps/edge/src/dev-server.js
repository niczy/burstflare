// @ts-check

import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { createApp } from "./app.js";
import { createBurstFlareService, createFileStore } from "@burstflare/shared";

const port = Number(process.env.PORT || 8787);
const dataFile = process.env.BURSTFLARE_DATA_FILE || ".local/burstflare-data.json";
const clientDist = path.resolve(process.cwd(), "apps", "web", "dist", "client");
const service = createBurstFlareService({
  store: createFileStore(dataFile)
});

function contentTypeForAsset(filePath) {
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (filePath.endsWith(".png")) {
    return "image/png";
  }
  return "application/octet-stream";
}

async function getFrontendAssetResponse(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/assets/")) {
    return null;
  }
  const relativePath = url.pathname.replace(/^\/+/, "");
  const resolvedPath = path.resolve(clientDist, relativePath);
  const safePrefix = `${clientDist}${path.sep}`;
  if (resolvedPath !== clientDist && !resolvedPath.startsWith(safePrefix)) {
    return null;
  }
  try {
    const body = await readFile(resolvedPath);
    return new Response(body, {
      headers: {
        "content-type": contentTypeForAsset(resolvedPath)
      }
    });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

const app = createApp({ service, getFrontendAssetResponse });

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/**
 * @param {http.IncomingHttpHeaders} nodeHeaders
 */
function headersFromNode(nodeHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

const server = http.createServer(async (req, res) => {
  const body =
    req.method === "GET" || req.method === "HEAD" || req.method === "DELETE"
      ? undefined
      : await readRequestBody(req);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: headersFromNode(req.headers),
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
      const typedError = /** @type {Error} */ (error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: typedError.message }));
        return;
      }
      res.destroy(typedError);
    }).pipe(res);
  } catch (error) {
    const typedError = /** @type {Error} */ (error);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: typedError.message }));
  }
});

server.listen(port, () => {
  process.stdout.write(`BurstFlare dev server running at http://127.0.0.1:${port}\n`);
});
