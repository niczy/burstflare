import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { runCli } from "../apps/cli/src/cli.js";
import { createApp } from "../apps/edge/src/app.js";

function capture() {
  return {
    data: "",
    write(chunk: string) {
      this.data += chunk;
    }
  };
}

function createFetch(app: { fetch: (req: Request) => Promise<Response> }) {
  return async (url: string, options?: RequestInit) =>
    app.fetch(
      new Request(url, {
        ...options
      })
    );
}

function createMockStdin() {
  const listeners = new Set<(chunk: string) => void>();
  return {
    isTTY: true,
    setEncoding() {},
    resume() {},
    pause() {},
    on(event: string, handler: (chunk: string) => void) {
      if (event === "data") {
        listeners.add(handler);
      }
    },
    removeListener(event: string, handler: (chunk: string) => void) {
      if (event === "data") {
        listeners.delete(handler);
      }
    },
    pushLine(value: string) {
      for (const handler of [...listeners]) {
        handler(`${value}\n`);
      }
    }
  };
}

async function completeCliBrowserLogin(
  app: { fetch: (req: Request) => Promise<Response> },
  loginUrlValue: string,
  label: string
): Promise<void> {
  const fetchImpl = createFetch(app);
  const loginUrl = new URL(loginUrlValue);
  const email = loginUrl.searchParams.get("email") || "";
  const deviceCode = loginUrl.searchParams.get("device_code") || "";
  const cliRedirect = loginUrl.searchParams.get("cli_redirect") || "";

  const deliveryResponse = await fetchImpl(`${loginUrl.origin}/api/auth/email-code/request`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email,
      name: label
    })
  });
  const delivery = await deliveryResponse.json();

  const verifyResponse = await fetchImpl(`${loginUrl.origin}/api/auth/email-code/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email,
      code: delivery.code
    })
  });
  const verified = await verifyResponse.json();

  await fetchImpl(`${loginUrl.origin}/api/cli/device/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${verified.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      deviceCode
    })
  });

  if (cliRedirect) {
    const redirectTarget = new URL(cliRedirect);
    redirectTarget.searchParams.set("device_code", deviceCode);
    await fetch(redirectTarget);
  }
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value.slice();
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return new Uint8Array();
}

function createBucket() {
  const values = new Map<string, { body: Uint8Array; contentType: string }>();

  return {
    async put(key: string, value: unknown, options: { httpMetadata?: { contentType?: string } } = {}) {
      values.set(key, {
        body: toBytes(value),
        contentType: options.httpMetadata?.contentType || "application/octet-stream"
      });
    },
    async delete(key: string) {
      values.delete(key);
    },
    async get(key: string) {
      const entry = values.get(key);
      if (!entry) {
        return null;
      }
      return {
        size: entry.body.byteLength,
        httpMetadata: { contentType: entry.contentType },
        async arrayBuffer() {
          return entry.body.slice().buffer;
        },
        async text() {
          return new TextDecoder().decode(entry.body);
        }
      };
    }
  };
}

test("cli can run device flow, instance lifecycle, and reporting", async () => {
  const app = createApp({
    TEMPLATE_BUCKET: createBucket(),
    RECONCILE_QUEUE: {
      async send() {}
    },
    BUILD_BUCKET: createBucket(),
    SNAPSHOT_BUCKET: createBucket()
  });
  const fetchImpl = createFetch(app);
  const stdout = capture();
  const stderr = capture();
  const configPath = path.join(os.tmpdir(), `flare-cli-${Date.now()}.json`);
  const bundlePath = path.join(os.tmpdir(), `flare-bundle-${Date.now()}.txt`);
  const exportPath = path.join(os.tmpdir(), `flare-export-${Date.now()}.json`);
  const toolDir = path.join(os.tmpdir(), `flare-tools-${Date.now()}`);
  const cliEmail = "smoke_test+cli@burstflare.dev";

  try {
    await writeFile(bundlePath, "cli bundle payload");
    await mkdir(toolDir, { recursive: true });
    await writeFile(path.join(toolDir, "ssh"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(toolDir, "ssh"), 0o755);
    await writeFile(path.join(toolDir, "ssh-keygen"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(toolDir, "ssh-keygen"), 0o755);

    let code = await runCli(["auth", "register", "--email", cliEmail, "--name", "CLI User", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const registeredOutput = JSON.parse(stdout.data.trim());
    const initialAuthSessionId = registeredOutput.authSessionId;

    stdout.data = "";

    code = await runCli(["workspace", "rename", "CLI-HQ", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const renamedWorkspace = JSON.parse(stdout.data.trim());
    assert.equal(renamedWorkspace.workspace.name, "CLI-HQ");

    stdout.data = "";

    code = await runCli(["workspace", "quota-overrides", "--max-running-sessions", "4", "--max-storage-bytes", "2048", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const quotaOverrideOutput = JSON.parse(stdout.data.trim());
    assert.equal(quotaOverrideOutput.limits.maxRunningSessions, 4);
    assert.equal(quotaOverrideOutput.overrides.maxStorageBytes, 2048);

    stdout.data = "";

    code = await runCli(["workspace", "set-secret", "api_token", "--value", "super-secret", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const secretOutput = JSON.parse(stdout.data.trim());
    assert.equal(secretOutput.secret.name, "API_TOKEN");

    stdout.data = "";

    code = await runCli(["workspace", "secrets", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const secretsOutput = JSON.parse(stdout.data.trim());
    assert.deepEqual(secretsOutput.secrets.map((entry: any) => entry.name), ["API_TOKEN"]);
    assert.equal("value" in secretsOutput.secrets[0], false);

    stdout.data = "";

    code = await runCli(["auth", "device-start", "--email", cliEmail, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const deviceStart = JSON.parse(stdout.data.trim());

    stdout.data = "";

    code = await runCli(["auth", "device-approve", "--code", deviceStart.deviceCode, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

    stdout.data = "";

    code = await runCli(["auth", "device-exchange", "--code", deviceStart.deviceCode, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const exchanged = JSON.parse(stdout.data.trim());
    assert.ok(exchanged.refreshToken);

    stdout.data = "";

    code = await runCli(["auth", "refresh", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const refreshed = JSON.parse(stdout.data.trim());
    assert.ok(refreshed.refreshToken);

    stdout.data = "";

    const staleConfig = JSON.parse(await readFile(configPath, "utf8"));
    staleConfig.token = "browser_invalid";
    await writeFile(configPath, JSON.stringify(staleConfig, null, 2));

    code = await runCli(["auth", "whoami", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const whoamiOutput = JSON.parse(stdout.data.trim());
    assert.equal(whoamiOutput.user.email, cliEmail);
    const refreshedConfig = JSON.parse(await readFile(configPath, "utf8"));
    assert.notEqual(refreshedConfig.token, "browser_invalid");

    stdout.data = "";

    code = await runCli(["auth", "recovery-generate", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const recoveryOutput = JSON.parse(stdout.data.trim());
    assert.equal(recoveryOutput.recoveryCodes.length, 8);
    const recoveryCode = recoveryOutput.recoveryCodes[0];

    stdout.data = "";

    code = await runCli(
      [
        "instance",
        "create",
        "go-dev",
        "--description",
        "Go runtime",
        "--image",
        "ubuntu:24.04",
        "--env",
        "MODE=dev",
        "--secret",
        "API_KEY=abc",
        "--url",
        "http://local"
      ],
      {
        fetchImpl,
        stdout,
        stderr,
        configPath
      }
    );
    assert.equal(code, 0);
    const instanceOutput = JSON.parse(stdout.data.trim());
    const instanceId = instanceOutput.instance.id;
    assert.equal(instanceOutput.instance.image, "ubuntu:24.04");
    assert.deepEqual(instanceOutput.instance.secretNames, ["API_KEY"]);

    stdout.data = "";

    code = await runCli(["instance", "inspect", instanceId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const inspectedInstance = JSON.parse(stdout.data.trim());
    assert.equal(inspectedInstance.instance.id, instanceId);

    stdout.data = "";

    code = await runCli(["instance", "edit", instanceId, "--description", "Go runtime updated", "--image", "node:22", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const editedInstance = JSON.parse(stdout.data.trim());
    assert.equal(editedInstance.instance.description, "Go runtime updated");
    assert.equal(editedInstance.instance.image, "node:22");

    stdout.data = "";

    code = await runCli(["instance", "create", "trash-dev", "--description", "Disposable instance", "--image", "debian:12", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const disposableInstance = JSON.parse(stdout.data.trim());
    const disposableInstanceId = disposableInstance.instance.id;

    stdout.data = "";

    code = await runCli(["instance", "delete", disposableInstanceId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const deletedInstance = JSON.parse(stdout.data.trim());
    assert.equal(deletedInstance.ok, true);

    stdout.data = "";

    code = await runCli(["up", "my-shell", "--instance", instanceId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const sessionOutput = JSON.parse(stdout.data.trim());
    const sessionId = sessionOutput.session.id;

    stdout.data = "";

    code = await runCli(["up", "sleepy-shell", "--instance", instanceId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const staleSessionOutput = JSON.parse(stdout.data.trim());
    const staleSessionId = staleSessionOutput.session.id;

    stdout.data = "";

    code = await runCli(["down", staleSessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

    stdout.data = "";

    code = await runCli(["snapshot", "save", sessionId, "--label", "manual", "--file", bundlePath, "--content-type", "text/plain", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const snapshotOutput = JSON.parse(stdout.data.trim());
    const snapshotId = snapshotOutput.snapshot.id;
    assert.equal(snapshotOutput.snapshot.bytes, 18);

    stdout.data = "";

    code = await runCli(["snapshot", "list", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const listedSnapshots = JSON.parse(stdout.data.trim());
    assert.equal(listedSnapshots.snapshots.length, 1);
    assert.equal(listedSnapshots.snapshots[0].id, snapshotId);

    stdout.data = "";

    code = await runCli(["status", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const sessionStatus = JSON.parse(stdout.data.trim());
    assert.equal(sessionStatus.session.id, sessionId);
    assert.equal(sessionStatus.session.snapshotCount, 1);

    stdout.data = "";

    code = await runCli(["events", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const eventsOutput = JSON.parse(stdout.data.trim());
    assert.ok(eventsOutput.events.length >= 2);

    stdout.data = "";

    code = await runCli(["report", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const reportOutput = JSON.parse(stdout.data.trim());
    assert.equal(reportOutput.report.releases, 0);
    assert.equal(reportOutput.report.buildsQueued, 0);
    assert.equal(reportOutput.report.buildsBuilding, 0);
    assert.equal(reportOutput.report.buildsStuck, 0);
    assert.equal(reportOutput.report.buildsDeadLettered, 0);
    assert.equal(reportOutput.report.sessionsSleeping, 1);
    assert.equal(reportOutput.report.activeUploadGrants, 0);
    assert.equal(reportOutput.report.limits.maxRunningSessions, 4);

    stdout.data = "";

    code = await runCli(["export", "--output", exportPath, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const exportOutput = JSON.parse(stdout.data.trim());
    assert.equal(exportOutput.output, exportPath);
    const exported = JSON.parse(await readFile(exportPath, "utf8"));
    assert.equal(exported.export.workspace.id, refreshedConfig.workspaceId);
    assert.equal(exported.export.members.length, 1);
    assert.equal(exported.export.security.runtimeSecrets[0].name, "API_TOKEN");
    assert.equal(exported.export.artifacts.templateBundles.length, 0);

    stdout.data = "";
    stderr.data = "";

    code = await runCli(["down", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

    stdout.data = "";
    stderr.data = "";

    let spawned: { command: string; args: string[]; options: any } | null = null;
    let tunnelClosed = false;
    const spawnImpl = (command: string, args: string[], options: any) => {
      if (command === "ssh-keygen") {
        const outputPath = args[args.indexOf("-f") + 1];
        return {
          on(event: string, handler: (code: number | null, signal: NodeJS.Signals | null) => void) {
            if (event === "exit") {
              void (async () => {
                await writeFile(outputPath, "PRIVATE KEY\n");
                await writeFile(outputPath + ".pub", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHRlc3RrZXk= flare@test\n");
                handler(0, null);
              })();
            }
            return this;
          }
        };
      }
      spawned = { command, args, options };
      return {
        on(event: string, handler: (code: number | null, signal: NodeJS.Signals | null) => void) {
          if (event === "exit") {
            setImmediate(() => handler(0, null));
          }
          return this;
        }
      };
    };
    const createSshTunnelImpl = async (sshUrl: string) => ({
      host: "127.0.0.1",
      port: 4123,
      sshUrl,
      async close() {
        tunnelClosed = true;
      }
    });

    code = await runCli(["ssh", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath,
      env: {
        PATH: toolDir
      },
      spawnImpl,
      createSshTunnelImpl
    });
    assert.equal(code, 0);
    assert.equal(stdout.data, "");
    assert.equal(stderr.data, "");
    assert.ok(spawned);
    assert.equal(spawned.command, "ssh");
    assert.deepEqual(spawned.args, [
      "-i",
      path.join(path.dirname(configPath), "ssh", `${sessionId}.ed25519`),
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "PreferredAuthentications=publickey",
      "-p",
      "4123",
      "flare@127.0.0.1"
    ]);
    assert.equal(spawned.options.stdio, "inherit");
    assert.equal(tunnelClosed, true);

    stdout.data = "";
    stderr.data = "";

    code = await runCli(["status", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const runningAfterSsh = JSON.parse(stdout.data.trim());
    assert.equal(runningAfterSsh.session.state, "running");

    stdout.data = "";
    stderr.data = "";

    code = await runCli(["ssh", sessionId, "--url", "http://local", "--print"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const printedSsh = JSON.parse(stdout.data.trim());
    assert.match(printedSsh.sshUrl, new RegExp(`^ws://local/runtime/sessions/${sessionId}/ssh\\?token=runtime_`));
    assert.equal(printedSsh.sshUser, "flare");
    assert.equal(printedSsh.sshPrivateKeyPath, path.join(path.dirname(configPath), "ssh", `${sessionId}.ed25519`));
    assert.match(printedSsh.localCommand, /-i .*\.ed25519/);
    assert.match(printedSsh.localCommand, /<local-port>/);
    assert.equal(stderr.data, "");

    stdout.data = "";
    stderr.data = "";

    let missingSpawned = false;
    code = await runCli(["ssh", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath,
      env: {
        PATH: ""
      },
      spawnImpl() {
        missingSpawned = true;
        throw new Error("spawn should not run when dependencies are missing");
      }
    });
    assert.equal(code, 1);
    assert.equal(missingSpawned, false);
    assert.match(stderr.data, /Missing local dependencies for flare ssh/);
    assert.match(stderr.data, /ssh/);

    stdout.data = "";
    stderr.data = "";

    code = await runCli(["editor", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    assert.equal(stdout.data.trim(), `http://local/runtime/sessions/${sessionId}/editor`);
    assert.equal(stderr.data, "");

    stdout.data = "";
    stderr.data = "";

    await new Promise((resolve) => setTimeout(resolve, 1100));

    code = await runCli(["reconcile", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const cleanupOutput = JSON.parse(stdout.data.trim());
    assert.equal(cleanupOutput.recoveredStuckBuilds, 0);
    assert.equal(cleanupOutput.purgedStaleSleepingSessions, 0);

    stdout.data = "";

    code = await runCli(["status", staleSessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const staleStatus = JSON.parse(stdout.data.trim());
    assert.equal(staleStatus.session.id, staleSessionId);
    assert.equal(staleStatus.session.state, "sleeping");

    stdout.data = "";
    stderr.data = "";

    code = await runCli(["auth", "logout", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const cleared = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(cleared.token, "");
    assert.equal(cleared.refreshToken, "");

    stdout.data = "";

    const loginStdin = createMockStdin();
    code = await runCli(["auth", "login", "--email", cliEmail, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      stdin: loginStdin,
      openUrlImpl: async (loginUrl: string) => {
        await completeCliBrowserLogin(app, loginUrl, "CLI User");
      },
      configPath
    });
    assert.equal(code, 0);
    const loginOutput = JSON.parse(stdout.data.trim());
    assert.ok(loginOutput.authSessionId);

    stdout.data = "";

    code = await runCli(["auth", "sessions", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const sessionsOutput = JSON.parse(stdout.data.trim());
    assert.ok(sessionsOutput.sessions.some((entry: any) => entry.id === initialAuthSessionId));
    assert.ok(sessionsOutput.sessions.some((entry: any) => entry.current));

    stdout.data = "";

    code = await runCli(["auth", "revoke-session", initialAuthSessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const revokedSession = JSON.parse(stdout.data.trim());
    assert.equal(revokedSession.ok, true);

    stdout.data = "";

    code = await runCli(["auth", "sessions", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const afterRevokeSessions = JSON.parse(stdout.data.trim());
    assert.equal(afterRevokeSessions.sessions.some((entry: any) => entry.id === initialAuthSessionId), false);

    stdout.data = "";

    code = await runCli(["reconcile", "--enqueue", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const reconcileOutput = JSON.parse(stdout.data.trim());
    assert.equal(reconcileOutput.queued, true);

    stdout.data = "";

    code = await runCli(["auth", "logout-all", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const clearedAll = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(clearedAll.token, "");
    assert.equal(clearedAll.refreshToken, "");

    stdout.data = "";

    code = await runCli(["auth", "recover", "--email", cliEmail, "--code", recoveryCode, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const recoveredConfig = JSON.parse(await readFile(configPath, "utf8"));
    assert.notEqual(recoveredConfig.token, "");
    assert.notEqual(recoveredConfig.refreshToken, "");

    stdout.data = "";

    code = await runCli(["workspace", "delete-secret", "api_token", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const deletedSecret = JSON.parse(stdout.data.trim());
    assert.equal(deletedSecret.ok, true);

    stdout.data = "";

    code = await runCli(["workspace", "quota-overrides", "--clear", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const clearedOverrides = JSON.parse(stdout.data.trim());
    assert.deepEqual(clearedOverrides.overrides, {});
  } finally {
    await rm(configPath, { force: true });
    await rm(bundlePath, { force: true });
    await rm(exportPath, { force: true });
    await rm(toolDir, { force: true, recursive: true });
  }
});

test("cli help uses flare branding", async () => {
  const stdout = capture();
  const stderr = capture();

  const code = await runCli([], {
    stdout,
    stderr,
    env: {
      FLARE_CONFIG: path.join(os.tmpdir(), `flare-help-${Date.now()}.json`)
    }
  });

  assert.equal(code, 0);
  assert.match(stdout.data, /^flare CLI$/m);
  assert.match(stdout.data, /^Authentication$/m);
  assert.match(stdout.data, /^  flare auth$/m);
  assert.match(stdout.data, /^    flare auth register --email <email> \[--name <name>\]$/m);
  assert.match(stdout.data, /^    flare instance inspect <instanceId>$/m);
  assert.match(stdout.data, /^    flare session list \[--status <status>\] \[--instance <instanceId>\]$/m);
  assert.match(stdout.data, /^Shortcuts$/m);
  assert.match(stdout.data, /Use `flare help <topic>` or append `--help`/);
  assert.doesNotMatch(stdout.data, /burstflare auth register/);
  assert.equal(stderr.data, "");
});

test("cli supports focused help for command groups and leaf commands", async () => {
  const stdout = capture();
  const stderr = capture();

  let code = await runCli(["help", "session"], {
    stdout,
    stderr,
    env: {
      FLARE_CONFIG: path.join(os.tmpdir(), `flare-help-session-${Date.now()}.json`)
    }
  });

  assert.equal(code, 0);
  assert.match(stdout.data, /^Usage: flare session/m);
  assert.match(stdout.data, /^Commands:$/m);
  assert.match(stdout.data, /ssh\s+Open or print SSH attach details\./);
  assert.equal(stderr.data, "");

  stdout.data = "";

  code = await runCli(["auth", "register", "--help"], {
    stdout,
    stderr,
    env: {
      FLARE_CONFIG: path.join(os.tmpdir(), `flare-help-register-${Date.now()}.json`)
    }
  });

  assert.equal(code, 0);
  assert.match(stdout.data, /^Usage: flare auth register/m);
  assert.match(stdout.data, /Create a user and save auth tokens locally\./);
  assert.match(stdout.data, /-h, --help/);
  assert.equal(stderr.data, "");
});

test("cli help adds ansi color when output supports it", async () => {
  const stdout = {
    data: "",
    isTTY: true,
    write(chunk: string) {
      this.data += chunk;
    }
  };
  const stderr = capture();

  const code = await runCli([], {
    stdout,
    stderr,
    env: {
      FORCE_COLOR: "1",
      FLARE_CONFIG: path.join(os.tmpdir(), `flare-help-color-${Date.now()}.json`)
    }
  });

  assert.equal(code, 0);
  assert.match(stdout.data, /\u001B\[1;36mflare CLI\u001B\[0m/);
  assert.match(stdout.data, /\u001B\[1;33mAuthentication\u001B\[0m/);
  assert.match(stdout.data, /\u001B\[1;32mflare\u001B\[0m auth register/);
  assert.equal(stderr.data, "");
});

test("cli doctor reports missing local ssh dependencies", async () => {
  const stdout = capture();
  const stderr = capture();

  const code = await runCli(["doctor"], {
    stdout,
    stderr,
    env: {
      PATH: ""
    }
  });

  assert.equal(code, 1);
  assert.match(stdout.data, /flare doctor/);
  assert.match(stdout.data, /ssh-ready: no/);
  assert.match(stdout.data, /ssh: missing/);
  assert.match(stdout.data, /ssh-keygen: missing/);
  assert.match(stdout.data, /summary:/);
  assert.equal(stderr.data, "");
});

test("cli uses burstflare.dev by default when no url is provided", async () => {
  const stdout = capture();
  const stderr = capture();
  const configPath = path.join(os.tmpdir(), `flare-default-url-${Date.now()}.json`);
  let requestedUrl = "";

  try {
    const code = await runCli(["auth", "register", "--email", "default-url@example.com", "--name", "Default Url"], {
      fetchImpl: async (url: string) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            user: {
              id: "usr_default",
              email: "default-url@example.com",
              name: "Default Url"
            },
            workspace: {
              id: "ws_default",
              name: "Default Url Workspace"
            },
            authSessionId: "auths_default",
            token: "browser_default",
            refreshToken: "refresh_default"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      },
      stdout,
      stderr,
      configPath
    });

    assert.equal(code, 0);
    assert.equal(requestedUrl, "https://burstflare.dev/api/auth/register");
    const savedConfig = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(savedConfig.baseUrl, "https://burstflare.dev");
    assert.equal(stderr.data, "");
  } finally {
    await rm(configPath, { force: true });
  }
});

test("cli supports noun-first aliases and local list filters", async () => {
  const app = createApp({
    TEMPLATE_BUCKET: createBucket(),
    BUILD_BUCKET: createBucket()
  });
  const fetchImpl = createFetch(app);
  const stdout = capture();
  const stderr = capture();
  const configPath = path.join(os.tmpdir(), `flare-cli-aliases-${Date.now()}.json`);
  try {
    let code = await runCli(["auth", "register", "--email", "alias-cli@example.com", "--name", "Alias CLI", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const registered = JSON.parse(stdout.data.trim());
    const workspaceId = registered.workspace.id;
    stdout.data = "";

    code = await runCli(["workspace", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const currentWorkspace = JSON.parse(stdout.data.trim());
    assert.equal(currentWorkspace.workspace.id, workspaceId);
    stdout.data = "";

    code = await runCli(["instance", "create", "alias-active", "--image", "ubuntu:24.04", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const activeInstance = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["instance", "create", "alias-secondary", "--image", "node:22", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const secondaryInstance = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["instances", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const instances = JSON.parse(stdout.data.trim());
    assert.deepEqual(
      instances.instances.map((entry: any) => entry.id),
      [activeInstance.instance.id, secondaryInstance.instance.id]
    );
    stdout.data = "";

    code = await runCli(["session", "up", "alias-session", "--instance", activeInstance.instance.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const createdSession = JSON.parse(stdout.data.trim());
    const sessionId = createdSession.session.id;
    stdout.data = "";

    code = await runCli(["session", "status", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const sessionStatus = JSON.parse(stdout.data.trim());
    assert.equal(sessionStatus.session.id, sessionId);
    const runningStatus =
      sessionStatus.session.runtime?.status || sessionStatus.session.runtimeStatus || sessionStatus.session.status || "running";
    stdout.data = "";

    code = await runCli(["sessions", "--status", runningStatus, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const runningSessions = JSON.parse(stdout.data.trim());
    assert.deepEqual(runningSessions.sessions.map((entry: any) => entry.id), [sessionId]);
    stdout.data = "";

    code = await runCli(["session", "stop", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const stoppedSession = JSON.parse(stdout.data.trim());
    const stoppedStatus =
      stoppedSession.session.runtime?.status || stoppedSession.session.runtimeStatus || stoppedSession.session.status || "sleeping";
    stdout.data = "";

    code = await runCli(["list", "--status", stoppedStatus, "--instance", activeInstance.instance.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const sleepingSessions = JSON.parse(stdout.data.trim());
    assert.deepEqual(sleepingSessions.sessions.map((entry: any) => entry.id), [sessionId]);
  } finally {
    await rm(configPath, { force: true });
  }
});

test("cli exposes targeted operator reconcile commands", async () => {
  const app = createApp({
    TEMPLATE_BUCKET: createBucket(),
    BUILD_BUCKET: createBucket(),
    SNAPSHOT_BUCKET: createBucket()
  });
  const fetchImpl = createFetch(app);
  const stdout = capture();
  const stderr = capture();
  const configPath = path.join(os.tmpdir(), `flare-cli-operator-${Date.now()}.json`);
  const bundlePath = path.join(os.tmpdir(), `flare-operator-bundle-${Date.now()}.txt`);

  try {
    await writeFile(bundlePath, "operator bundle payload");

    let code = await runCli(["auth", "register", "--email", "operator-cli@example.com", "--name", "Operator CLI", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["instance", "create", "operator-cli-instance", "--image", "ubuntu:24.04", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const instance = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["up", "operator-running", "--instance", instance.instance.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const running = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["up", "operator-stale", "--instance", instance.instance.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const stale = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["down", stale.session.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["snapshot", "save", stale.session.id, "--label", "stale", "--file", bundlePath, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["up", "operator-deleted", "--instance", instance.instance.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const deleted = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(
      ["snapshot", "save", deleted.session.id, "--label", "deleted", "--file", bundlePath, "--url", "http://local"],
      {
        fetchImpl,
        stdout,
        stderr,
        configPath
      }
    );
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["delete", deleted.session.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    await new Promise((resolve) => setTimeout(resolve, 1100));

    code = await runCli(["reconcile", "preview", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const preview = JSON.parse(stdout.data.trim());
    assert.equal(preview.preview.sleptSessions, 1);
    assert.equal(preview.preview.purgedStaleSleepingSessions, 0);
    assert.equal(preview.preview.purgedDeletedSessions, 1);
    assert.deepEqual(preview.preview.sessionIds.running, [running.session.id]);
    stdout.data = "";
    stderr.data = "";

    code = await runCli(["reconcile", "recover-builds", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 1);
    assert.match(stderr.data, /reconcile recover-builds/);
    assert.match(stderr.data, /no longer supported/);
    stdout.data = "";
    stderr.data = "";

    code = await runCli(["reconcile", "sleep-running", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const slept = JSON.parse(stdout.data.trim());
    assert.equal(slept.sleptSessions, 1);
    stdout.data = "";

    code = await runCli(["reconcile", "purge-sleeping", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const purgedSleeping = JSON.parse(stdout.data.trim());
    assert.equal(purgedSleeping.purgedStaleSleepingSessions, 0);
    assert.equal(purgedSleeping.purgedSnapshots, 0);
    stdout.data = "";

    code = await runCli(["reconcile", "purge-deleted", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const purgedDeleted = JSON.parse(stdout.data.trim());
    assert.equal(purgedDeleted.purgedDeletedSessions, 1);
    assert.equal(purgedDeleted.purgedSnapshots, 1);
    stdout.data = "";

    code = await runCli(["report", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const report = JSON.parse(stdout.data.trim());
    assert.equal(report.report.reconcileCandidates.runningSessions, 0);
    assert.equal(report.report.reconcileCandidates.staleSleepingSessions, 0);
    assert.equal(report.report.reconcileCandidates.deletedSessions, 0);
  } finally {
    await rm(configPath, { force: true });
    await rm(bundlePath, { force: true });
  }
});

test("cli stores docker source metadata without local docker builds", async () => {
  const app = createApp();
  const fetchImpl = createFetch(app);
  const stdout = capture();
  const stderr = capture();
  const configPath = path.join(os.tmpdir(), `flare-cli-docker-${Date.now()}.json`);
  const spawned: Array<{ command: string; args: string[]; options: any }> = [];

  try {
    const spawnImpl = (command: string, args: string[], options: any) => {
      spawned.push({ command, args, options });
      return {
        on(event: string, handler: (code: number | null, signal: NodeJS.Signals | null) => void) {
          if (event === "exit") {
            setImmediate(() => handler(0, null));
          }
          return this;
        }
      };
    };

    let code = await runCli(["auth", "register", "--email", "docker-cli@example.com", "--name", "Docker CLI", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["instance", "create", "docker-cli", "--image", "ubuntu:24.04", "--dockerfile", "./Dockerfile", "--context", ".", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath,
      spawnImpl
    });
    assert.equal(code, 0);
    const created = JSON.parse(stdout.data.trim());
    assert.equal(created.instance.dockerfilePath, "./Dockerfile");
    assert.equal(created.instance.dockerContext, ".");
    assert.equal(created.instance.image, "ubuntu:24.04");
    assert.equal(created.instance.baseImage, "ubuntu:24.04");
    assert.match(created.instance.managedImageDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(spawned.length, 0);
    stdout.data = "";

    code = await runCli(["instance", "rebuild", created.instance.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath,
      spawnImpl
    });
    assert.equal(code, 0);
    const rebuilt = JSON.parse(stdout.data.trim());
    assert.equal(rebuilt.instance.id, created.instance.id);
    assert.equal(rebuilt.rebuild.baseImage, created.instance.baseImage);
    assert.match(rebuilt.rebuild.managedImageDigest, /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(rebuilt.rebuild.managedImageDigest, created.instance.managedImageDigest);
    assert.equal(rebuilt.rebuild.dockerfilePath, "./Dockerfile");
    assert.equal(rebuilt.rebuild.dockerContext, ".");
    assert.equal(spawned.length, 0);
  } finally {
    await rm(configPath, { force: true });
  }
});
