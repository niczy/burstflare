import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.PORT || 8080);
const textEncoder = new TextEncoder();
const wsMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const runtimeState = {
  restoredSnapshotId: null,
  restoredAt: null,
  restoredBytes: 0,
  restoredContentType: null,
  files: new Map()
};

function fromBase64(value) {
  return Buffer.from(String(value || ""), "base64");
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function applySnapshotRestore(payload) {
  const sessionId = String(payload.sessionId || "unknown");
  const snapshotId = String(payload.snapshotId || "unknown");
  const label = String(payload.label || snapshotId);
  const contentType = String(payload.contentType || "application/octet-stream");
  const raw = fromBase64(payload.contentBase64);
  const text = raw.toString("utf8");
  const snapshotPath = `/workspace/.burstflare/snapshots/${snapshotId}.snapshot`;
  const aliasPath = "/workspace/.burstflare/last.snapshot";

  runtimeState.restoredSnapshotId = snapshotId;
  runtimeState.restoredAt = new Date().toISOString();
  runtimeState.restoredBytes = raw.byteLength;
  runtimeState.restoredContentType = contentType;
  runtimeState.files.set(snapshotPath, text);
  runtimeState.files.set(aliasPath, text);

  return {
    ok: true,
    sessionId,
    snapshotId,
    label,
    appliedPath: snapshotPath,
    aliasPath,
    restoredAt: runtimeState.restoredAt,
    bytes: raw.byteLength,
    contentType
  };
}

function exportSnapshotPayload(sessionId = "unknown") {
  const aliasPath = "/workspace/.burstflare/last.snapshot";
  const current = runtimeState.files.get(aliasPath);
  if (current !== undefined) {
    return {
      body: Buffer.from(current, "utf8"),
      contentType: runtimeState.restoredContentType || "text/plain; charset=utf-8"
    };
  }

  const fallback = JSON.stringify(
    {
      sessionId,
      exportedAt: new Date().toISOString(),
      restoredSnapshotId: runtimeState.restoredSnapshotId,
      restoredAt: runtimeState.restoredAt,
      cwd: "/workspace"
    },
    null,
    2
  );
  return {
    body: Buffer.from(fallback, "utf8"),
    contentType: "application/json; charset=utf-8"
  };
}

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
          node: process.version,
          restoredSnapshotId: runtimeState.restoredSnapshotId,
          restoredAt: runtimeState.restoredAt,
          restoredFiles: Array.from(runtimeState.files.keys())
        },
        null,
        2
      )}</pre>
    </main>
  </body>
</html>`;
}

function frameBuffer(data, opcode = 0x1) {
  const payload = data instanceof Uint8Array ? data : textEncoder.encode(String(data));
  let header;
  if (payload.byteLength < 126) {
    header = new Uint8Array(2);
    header[1] = payload.byteLength;
  } else if (payload.byteLength < 65536) {
    header = new Uint8Array(4);
    header[1] = 126;
    new DataView(header.buffer).setUint16(2, payload.byteLength);
  } else {
    header = new Uint8Array(10);
    header[1] = 127;
    const view = new DataView(header.buffer);
    view.setUint32(2, 0);
    view.setUint32(6, payload.byteLength);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([Buffer.from(header), Buffer.from(payload)]);
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (cursor + 2 > buffer.length) {
        break;
      }
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) {
        break;
      }
      const high = buffer.readUInt32BE(cursor);
      const low = buffer.readUInt32BE(cursor + 4);
      if (high !== 0) {
        throw new Error("WebSocket frame too large");
      }
      length = low;
      cursor += 8;
    }

    let mask;
    if (masked) {
      if (cursor + 4 > buffer.length) {
        break;
      }
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }

    if (cursor + length > buffer.length) {
      break;
    }

    const payload = buffer.subarray(cursor, cursor + length);
    const decoded = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) {
      decoded[index] = masked ? payload[index] ^ mask[index % 4] : payload[index];
    }

    frames.push({
      opcode,
      payload: decoded
    });
    offset = cursor + length;
  }

  return {
    frames,
    remaining: buffer.subarray(offset)
  };
}

function resolveShellPath(currentDir, target) {
  const raw = String(target || "").trim();
  if (!raw || raw === "~") {
    return "/workspace";
  }
  const absolute = raw.startsWith("/") ? raw : path.posix.join(currentDir, raw);
  const normalized = path.posix.normalize(absolute);
  if (normalized === "." || normalized === "") {
    return "/workspace";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function runShellCommand(state, command) {
  const trimmed = String(command || "").trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed === "help") {
    return "available: help, pwd, ls, cd <path>, cat <path>, whoami, env, uname -a, exit";
  }

  if (trimmed === "pwd") {
    return state.cwd;
  }

  if (trimmed === "ls") {
    if (state.cwd === "/workspace/.burstflare/snapshots") {
      const snapshots = Array.from(runtimeState.files.keys())
        .filter((entry) => entry.startsWith("/workspace/.burstflare/snapshots/"))
        .map((entry) => path.posix.basename(entry));
      return snapshots.length ? snapshots.join("\n") : "";
    }
    if (state.cwd === "/workspace/.burstflare") {
      const entries = ["last.snapshot"];
      if (Array.from(runtimeState.files.keys()).some((entry) => entry.startsWith("/workspace/.burstflare/snapshots/"))) {
        entries.push("snapshots");
      }
      return entries.join("\n");
    }
    return [".burstflare", "workspace", "README.md", "logs"].join("\n");
  }

  if (trimmed === "whoami") {
    return "dev";
  }

  if (trimmed === "env") {
    return [
      `SESSION_ID=${state.sessionId}`,
      "USER=dev",
      `HOME=${state.home}`,
      `PWD=${state.cwd}`,
      `LAST_RESTORED_SNAPSHOT=${runtimeState.restoredSnapshotId || ""}`
    ].join("\n");
  }

  if (trimmed === "uname -a") {
    return `Linux ${os.hostname()} 6.6-cloudflare #1 SMP ${process.arch} ${process.platform}`;
  }

  if (trimmed === "exit") {
    state.closed = true;
    return "logout";
  }

  if (trimmed.startsWith("cd")) {
    const target = trimmed.slice(2).trim();
    state.cwd = resolveShellPath(state.cwd, target);
    return state.cwd;
  }

  if (trimmed.startsWith("cat")) {
    const target = trimmed.slice(3).trim();
    const resolved = resolveShellPath(state.cwd, target);
    const content = runtimeState.files.get(resolved);
    return content ?? `cat: ${resolved}: No such file or directory`;
  }

  return [
    `$ ${trimmed}`,
    `session=${state.sessionId}`,
    `cwd=${state.cwd}`,
    `executed_at=${new Date().toISOString()}`
  ].join("\n");
}

function attachShell(req, socket) {
  const url = new URL(req.url, "http://localhost");
  const sessionId = url.searchParams.get("sessionId") || "unknown";
  const key = req.headers["sec-websocket-key"];

  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const accept = crypto.createHash("sha1").update(`${key}${wsMagic}`).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n")
  );

  const state = {
    sessionId,
    cwd: "/workspace",
    home: "/home/dev",
    closed: false
  };
  let incoming = Buffer.alloc(0);

  socket.write(frameBuffer(`BurstFlare container shell attached to ${sessionId}`));
  socket.write(frameBuffer("Type `help` for available commands."));

  socket.on("data", (chunk) => {
    incoming = Buffer.concat([incoming, chunk]);
    const decoded = decodeFrames(incoming);
    incoming = decoded.remaining;

    for (const frame of decoded.frames) {
      if (frame.opcode === 0x8) {
        socket.write(frameBuffer(frame.payload, 0x8));
        socket.end();
        return;
      }

      if (frame.opcode === 0x9) {
        socket.write(frameBuffer(frame.payload, 0x0a));
        continue;
      }

      if (frame.opcode !== 0x1) {
        continue;
      }

      const reply = runShellCommand(state, frame.payload.toString("utf8"));
      if (reply) {
        socket.write(frameBuffer(reply));
      }
      if (state.closed) {
        socket.write(frameBuffer("Session closed by remote shell.", 0x8));
        socket.end();
        return;
      }
    }
  });

  socket.on("error", () => {
    socket.destroy();
  });
}

const server = http.createServer(async (req, res) => {
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
        node: process.version,
        restoredSnapshotId: runtimeState.restoredSnapshotId,
        restoredAt: runtimeState.restoredAt
      })
    );
    return;
  }

  if (url.pathname === "/snapshot/restore" && req.method === "POST") {
    const body = await readRequestBody(req);
    const payload = JSON.parse(body.toString("utf8") || "{}");
    const restored = applySnapshotRestore(payload);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(restored));
    return;
  }

  if (url.pathname === "/snapshot/export" && req.method === "GET") {
    const payload = exportSnapshotPayload(url.searchParams.get("sessionId") || "unknown");
    res.writeHead(200, { "content-type": payload.contentType });
    res.end(payload.body);
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderHtml(req));
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/ssh" || req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  attachShell(req, socket);
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`BurstFlare session container listening on ${port}\n`);
});
