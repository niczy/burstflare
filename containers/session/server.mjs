import http from "node:http";
import os from "node:os";

const port = Number(process.env.PORT || 8080);

function renderHtml(req) {
  const sessionId = new URL(req.url, "http://localhost").searchParams.get("sessionId") || "unknown";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BurstFlare Session ${sessionId}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7efe3;
        --panel: #ffffff;
        --ink: #1d2524;
        --muted: #5d6664;
        --accent: #c25719;
      }
      body {
        margin: 0;
        padding: 24px;
        font-family: "IBM Plex Sans", sans-serif;
        background:
          radial-gradient(circle at top right, rgba(194, 87, 25, 0.12), transparent 28%),
          linear-gradient(135deg, #fbf1e6 0%, #f7efe3 45%, #eef2ea 100%);
        color: var(--ink);
      }
      main {
        max-width: 820px;
        margin: 0 auto;
        background: rgba(255, 255, 255, 0.94);
        border-radius: 22px;
        padding: 28px;
        box-shadow: 0 24px 50px rgba(29, 37, 36, 0.08);
      }
      h1 {
        margin: 0;
        font-size: clamp(2rem, 4vw, 3.4rem);
        line-height: 0.94;
        letter-spacing: -0.04em;
      }
      .pill {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 0.78rem;
        font-weight: 700;
        background: #ffe3d2;
        color: var(--accent);
        margin-bottom: 14px;
      }
      .muted {
        color: var(--muted);
      }
      pre {
        margin: 18px 0 0;
        padding: 16px;
        border-radius: 14px;
        background: #f4efe8;
        overflow: auto;
        font-family: "IBM Plex Mono", monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="pill">Cloudflare Container Runtime</div>
      <h1>BurstFlare Session ${sessionId}</h1>
      <p class="muted">This page is rendered from inside the container, proxied through the Worker and keyed by session ID.</p>
      <pre>${JSON.stringify(
        {
          sessionId,
          hostname: os.hostname(),
          now: new Date().toISOString(),
          node: process.version
        },
        null,
        2
      )}</pre>
    </main>
  </body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        hostname: os.hostname(),
        now: new Date().toISOString()
      })
    );
    return;
  }

  if (url.pathname === "/meta") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        path: url.pathname,
        search: url.search,
        hostname: os.hostname(),
        node: process.version
      })
    );
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderHtml(req));
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`BurstFlare session container listening on ${port}\n`);
});
