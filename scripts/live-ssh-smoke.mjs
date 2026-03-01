import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSshTunnel } from "../apps/cli/src/cli.js";

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }
  return process.argv[index + 1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json; charset=utf-8" } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `${options.method || "GET"} ${pathname} failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function resolveAccessToken(baseUrl, explicitToken, refreshToken) {
  if (explicitToken) {
    return explicitToken;
  }
  if (!refreshToken) {
    return null;
  }
  const refreshed = await requestJson(baseUrl, "/api/auth/refresh", {
    method: "POST",
    body: JSON.stringify({
      refreshToken
    })
  });
  return refreshed.token || null;
}

async function authedRequestJson(baseUrl, pathname, token, refreshToken, options = {}) {
  const headers = {
    ...(options.headers || {})
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  try {
    return await requestJson(baseUrl, pathname, {
      ...options,
      headers
    });
  } catch (error) {
    if (error.status !== 401 || !refreshToken) {
      throw error;
    }
    const rotated = await requestJson(baseUrl, "/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({
        refreshToken
      })
    });
    const nextToken = rotated.token || null;
    if (!nextToken) {
      throw error;
    }
    return requestJson(baseUrl, pathname, {
      ...options,
      headers: {
        ...(options.headers || {}),
        authorization: `Bearer ${nextToken}`
      }
    });
  }
}

async function waitForHealthy(baseUrl) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const health = await requestJson(baseUrl, "/api/health");
      if (health.ok) {
        return health;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError || new Error("Health check did not become ready");
}

async function main() {
  const baseUrl = getArg("--base-url") || process.env.BURSTFLARE_BASE_URL || "https://burstflare.dev";
  const templateId = getArg("--template-id") || process.env.BURSTFLARE_LIVE_SMOKE_TEMPLATE_ID || "";
  const providedToken = getArg("--token") || process.env.BURSTFLARE_LIVE_SMOKE_TOKEN || "";
  const refreshToken = getArg("--refresh-token") || process.env.BURSTFLARE_LIVE_SMOKE_REFRESH_TOKEN || "";

  if (!templateId || (!providedToken && !refreshToken)) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: "Missing BURSTFLARE_LIVE_SMOKE_TEMPLATE_ID and auth token/refresh token"
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const health = await waitForHealthy(baseUrl);
  const token = await resolveAccessToken(baseUrl, providedToken, refreshToken);
  assert(token, "Failed to resolve an access token for the live SSH smoke");

  const tempDir = await mkdtemp(join(tmpdir(), "burstflare-live-ssh-"));
  const keyPath = join(tempDir, "id_ed25519");
  const sessionName = `live-ssh-smoke-${Date.now().toString(36)}`;
  let sessionId = null;
  let tunnel = null;

  try {
    await runCommand("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath], {
      stdio: "ignore"
    });
    const publicKey = (await readFile(`${keyPath}.pub`, "utf8")).trim();

    const created = await authedRequestJson(baseUrl, "/api/sessions", token, refreshToken, {
      method: "POST",
      body: JSON.stringify({
        name: sessionName,
        templateId
      })
    });
    sessionId = created?.session?.id || null;
    assert(sessionId, "Session creation did not return an id");

    const started = await authedRequestJson(baseUrl, `/api/sessions/${sessionId}/start`, token, refreshToken, {
      method: "POST"
    });
    assert(started?.session?.state === "running", "Live smoke session did not reach running state");

    const synced = await authedRequestJson(baseUrl, `/api/sessions/${sessionId}/ssh-key`, token, refreshToken, {
      method: "PUT",
      body: JSON.stringify({
        keyId: `live-smoke:${sessionId}`,
        label: "Live SSH Smoke",
        publicKey
      })
    });
    assert(Number(synced?.sshKeyCount || 0) >= 1, "Live smoke key sync did not register the SSH key");

    const runtimeToken = await authedRequestJson(baseUrl, `/api/sessions/${sessionId}/ssh-token`, token, refreshToken, {
      method: "POST"
    });
    assert(runtimeToken?.token, "Live smoke did not receive a runtime token");

    const sshUrl = new URL(`/runtime/sessions/${sessionId}/ssh`, baseUrl);
    sshUrl.protocol = sshUrl.protocol === "https:" ? "wss:" : "ws:";
    sshUrl.searchParams.set("token", runtimeToken.token);

    tunnel = await createSshTunnel(sshUrl.toString());
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
    assert(output === "dev", `Expected live SSH smoke to return 'dev', received '${output}'`);

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          skipped: false,
          baseUrl,
          sessionId,
          sessionName,
          templateId,
          containersEnabled: Boolean(health?.runtime?.containersEnabled),
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
    if (sessionId) {
      await authedRequestJson(baseUrl, `/api/sessions/${sessionId}`, token, refreshToken, {
        method: "DELETE"
      }).catch(() => {});
    }
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || "Live SSH smoke failed"}\n`);
  process.exit(1);
});
