import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { createSshTunnel } from "../apps/cli/src/cli.js";

import ssh2 from "ssh2";

const { Client: SshClient, Server: SshServer } = ssh2;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function listenOnRandomPort(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

async function closeServer(server) {
  if (!server) {
    return;
  }
  await new Promise((resolve) => server.close(() => resolve()));
}

async function reservePort(host = "127.0.0.1") {
  const server = net.createServer();
  const port = await listenOnRandomPort(server, host);
  await closeServer(server);
  return port;
}

async function runCommand(command, args, options = {}) {
  const { cwd, stdio = "pipe" } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio
    });
    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr
        });
        return;
      }
      const error = new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`);
      error.code = code;
      reject(error);
    });
  });
}

async function isDockerAvailable() {
  try {
    await runCommand("docker", ["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch (_error) {
    return false;
  }
}

async function waitForHttpJson(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function createSmokeSshServer() {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {
      format: "pem",
      type: "pkcs1"
    },
    publicKeyEncoding: {
      format: "pem",
      type: "pkcs1"
    }
  });

  return new SshServer(
    {
      hostKeys: [privateKey]
    },
    (client) => {
      client.on("authentication", (context) => {
        if (context.method === "password" && context.username === "dev" && context.password === "burstflare") {
          context.accept();
          return;
        }
        context.reject();
      });

      client.on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();
          session.on("exec", (acceptExec, _rejectExec, info) => {
            const stream = acceptExec();
            if (info.command === "whoami") {
              stream.write("dev\n");
              stream.exit(0);
              stream.end();
              return;
            }
            stream.stderr.write("unsupported command\n");
            stream.exit(127);
            stream.end();
          });
        });
      });
    }
  );
}

function createWebSocketProxyServer(targetPort) {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, targetPort }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname !== "/ssh") {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (ws) => {
      const upstream = net.createConnection({
        host: "127.0.0.1",
        port: targetPort
      });

      upstream.on("data", (chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        }
      });

      upstream.on("end", () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "upstream closed");
        }
      });

      upstream.on("error", () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1011, "upstream unavailable");
        }
      });

      ws.on("message", (data) => {
        upstream.write(Buffer.from(data));
      });

      ws.on("close", () => {
        upstream.end();
      });

      ws.on("error", () => {
        upstream.destroy();
      });
    });
  });

  return { server, webSocketServer };
}

async function runSshCommand(port, auth = {}) {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      client.end();
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    };

    client
      .on("ready", () => {
        client.exec("whoami", (error, stream) => {
          if (error) {
            finish(error);
            return;
          }

          let stdout = "";
          let stderr = "";
          stream.on("data", (chunk) => {
            stdout += chunk.toString();
          });
          stream.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
          });
          stream.on("close", (code) => {
            if (code !== 0) {
              finish(new Error(stderr.trim() || `ssh exec exited with code ${code}`));
              return;
            }
            finish(null, stdout.trim());
          });
        });
      })
      .on("error", (error) => {
        finish(error);
      })
      .connect({
        host: "127.0.0.1",
        port,
        username: "dev",
        readyTimeout: 5000,
        ...auth
      });
  });
}

async function runContainerSshSmoke() {
  if (!(await isDockerAvailable())) {
    return {
      ok: true,
      skipped: true,
      reason: "docker unavailable"
    };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "burstflare-ssh-smoke-"));
  const containerName = `burstflare-ssh-smoke-${Date.now().toString(36)}`;
  const imageName = "burstflare-session-smoke";
  const runtimePort = await reservePort();
  const keyPath = path.join(tempDir, "id_ed25519");
  let tunnel = null;

  try {
    await runCommand("docker", ["build", "-t", imageName, "containers/session"], {
      cwd: process.cwd()
    });
    await runCommand("docker", ["run", "-d", "--rm", "--name", containerName, "-p", `127.0.0.1:${runtimePort}:8080`, imageName]);

    const health = await waitForHttpJson(`http://127.0.0.1:${runtimePort}/health`);
    assert(health.ok === true, "Session container health failed");

    await runCommand("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath], {
      stdio: "ignore"
    });
    const publicKey = (await readFile(`${keyPath}.pub`, "utf8")).trim();

    const bootstrap = await fetch(`http://127.0.0.1:${runtimePort}/runtime/bootstrap`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        sessionId: "smoke-session",
        workspaceId: "ws_smoke",
        templateId: "tpl_smoke",
        templateName: "Smoke Template",
        state: "running",
        persistedPaths: ["/workspace"],
        sshAuthorizedKeys: [publicKey]
      })
    });
    assert(bootstrap.ok, `Runtime bootstrap failed (${bootstrap.status})`);

    tunnel = await createSshTunnel(`ws://127.0.0.1:${runtimePort}/ssh`);
    const sshResult = await runCommand(
      "ssh",
      [
        "-i",
        keyPath,
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "PreferredAuthentications=publickey",
        "-p",
        String(tunnel.port),
        "dev@127.0.0.1",
        "whoami"
      ],
      {
        stdio: "pipe"
      }
    );
    const output = sshResult.stdout.trim();
    assert(output === "dev", `Expected container ssh to return 'dev', received '${output}'`);
    return {
      ok: true,
      skipped: false,
      runtimePort,
      tunnelPort: tunnel.port,
      sshOutput: output
    };
  } finally {
    if (tunnel) {
      await tunnel.close().catch(() => {});
    }
    await runCommand("docker", ["rm", "-f", containerName]).catch(() => {});
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const sshServer = createSmokeSshServer();
  const sshPort = await listenOnRandomPort(sshServer);
  const { server: proxyServer, webSocketServer } = createWebSocketProxyServer(sshPort);
  const runtimePort = await listenOnRandomPort(proxyServer);
  let tunnel = null;

  try {
    const health = await fetch(`http://127.0.0.1:${runtimePort}/health`).then((response) => response.json());
    assert(health.ok === true, "WebSocket proxy health failed");
    assert(health.targetPort === sshPort, "Proxy health reported the wrong SSH port");

    tunnel = await createSshTunnel(`ws://127.0.0.1:${runtimePort}/ssh`);
    assert(tunnel.port > 0, "Tunnel did not allocate a local port");

    const output = await runSshCommand(tunnel.port, {
      password: "burstflare"
    });
    assert(output === "dev", `Expected ssh to return 'dev', received '${output}'`);

    const container = await runContainerSshSmoke();

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          runtimePort,
          sshPort,
          tunnelPort: tunnel.port,
          sshOutput: output,
          container
        },
        null,
        2
      )}\n`
    );
  } finally {
    if (tunnel) {
      await tunnel.close().catch(() => {});
    }
    await closeServer(proxyServer);
    webSocketServer.close();
    await closeServer(sshServer);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || "SSH smoke failed"}\n`);
  process.exit(1);
});
