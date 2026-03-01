import { generateKeyPairSync } from "node:crypto";
import http from "node:http";
import net from "node:net";
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

async function runSshCommand(port) {
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
        password: "burstflare",
        readyTimeout: 5000
      });
  });
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

    const output = await runSshCommand(tunnel.port);
    assert(output === "dev", `Expected ssh to return 'dev', received '${output}'`);

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          runtimePort,
          sshPort,
          tunnelPort: tunnel.port,
          sshOutput: output
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
