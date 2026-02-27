import http from "node:http";
import { createApp } from "./worker.js";

const port = Number(process.env.PORT || 8787);
const dataFile = process.env.BURSTFLARE_DATA_FILE || ".local/burstflare-data.json";
const app = createApp({ dataFile });

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
    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, () => {
  process.stdout.write(`BurstFlare dev server running at http://127.0.0.1:${port}\n`);
});
