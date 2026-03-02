// @ts-check

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
    write(chunk) {
      this.data += chunk;
    }
  };
}

function createFetch(app) {
  return async (url, options) =>
    app.fetch(
      new Request(url, {
        ...options
      })
    );
}

function toBytes(value) {
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
  const values = new Map();

  return {
    async put(key, value, options = {}) {
      values.set(key, {
        body: toBytes(value),
        contentType: options.httpMetadata?.contentType || "application/octet-stream"
      });
    },
    async delete(key) {
      values.delete(key);
    },
    async get(key) {
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

test("cli can run device flow, build processing, session lifecycle, and reporting", async () => {
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
  const restoredPath = path.join(os.tmpdir(), `flare-restored-${Date.now()}.txt`);
  const exportPath = path.join(os.tmpdir(), `flare-export-${Date.now()}.json`);
  const toolDir = path.join(os.tmpdir(), `flare-tools-${Date.now()}`);

  try {
    await writeFile(bundlePath, "cli bundle payload");
    await mkdir(toolDir, { recursive: true });
    await writeFile(path.join(toolDir, "ssh"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(toolDir, "ssh"), 0o755);
    await writeFile(path.join(toolDir, "ssh-keygen"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(toolDir, "ssh-keygen"), 0o755);

    let code = await runCli(["auth", "register", "--email", "cli@example.com", "--name", "CLI User", "--url", "http://local"], {
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
    assert.deepEqual(secretsOutput.secrets.map((entry) => entry.name), ["API_TOKEN"]);
    assert.equal("value" in secretsOutput.secrets[0], false);

    stdout.data = "";

    code = await runCli(["auth", "device-start", "--email", "cli@example.com", "--url", "http://local"], {
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
    assert.equal(whoamiOutput.user.email, "cli@example.com");
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

    code = await runCli(["template", "create", "go-dev", "--description", "Go runtime", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const templateOutput = JSON.parse(stdout.data.trim());
    const templateId = templateOutput.template.id;

    stdout.data = "";

    code = await runCli(
      [
        "template",
        "upload",
        templateId,
        "--version",
        "1.0.0",
        "--file",
        bundlePath,
        "--content-type",
        "text/plain",
        "--sleep-ttl-seconds",
        "1",
        "--persisted-paths",
        "/workspace,/home/dev/.cache",
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
    const versionOutput = JSON.parse(stdout.data.trim());
    const versionId = versionOutput.templateVersion.id;
    assert.equal(versionOutput.bundle.contentType, "text/plain");
    assert.deepEqual(versionOutput.templateVersion.manifest.persistedPaths, ["/workspace", "/home/dev/.cache"]);

    stdout.data = "";

    code = await runCli(["build", "process", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const processOutput = JSON.parse(stdout.data.trim());
    assert.equal(processOutput.processed, 1);

    stdout.data = "";

    code = await runCli(["build", "log", versionOutput.build.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    assert.match(stdout.data, /bundle_uploaded=true/);

    stdout.data = "";

    code = await runCli(["build", "artifact", versionOutput.build.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const buildArtifactOutput = JSON.parse(stdout.data.trim());
    assert.equal(buildArtifactOutput.source, "bundle");
    assert.equal(buildArtifactOutput.templateVersionId, versionOutput.templateVersion.id);
    assert.match(buildArtifactOutput.imageReference, /@sha256:/);
    assert.match(buildArtifactOutput.imageDigest, /^sha256:/);
    assert.equal(buildArtifactOutput.layerCount, 2);

    stdout.data = "";

    code = await runCli(
      [
        "template",
        "upload",
        templateId,
        "--version",
        "2.0.0",
        "--file",
        bundlePath,
        "--content-type",
        "text/plain",
        "--simulate-failure",
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
    const failingVersionOutput = JSON.parse(stdout.data.trim());

    stdout.data = "";

    code = await runCli(["build", "process", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

    stdout.data = "";

    code = await runCli(["build", "log", failingVersionOutput.build.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    assert.match(stdout.data, /build_status=failed/);

    stdout.data = "";

    code = await runCli(["build", "retry", failingVersionOutput.build.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

    stdout.data = "";

    code = await runCli(["build", "process", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

    stdout.data = "";

    code = await runCli(["build", "retry", failingVersionOutput.build.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

    stdout.data = "";

    code = await runCli(["build", "process", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

    stdout.data = "";

    code = await runCli(["build", "log", failingVersionOutput.build.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    assert.match(stdout.data, /build_status=dead_lettered/);

    stdout.data = "";

    code = await runCli(["build", "retry-dead-lettered", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const bulkRetried = JSON.parse(stdout.data.trim());
    assert.equal(bulkRetried.recovered, 1);
    assert.deepEqual(bulkRetried.buildIds, [failingVersionOutput.build.id]);

    stdout.data = "";

    code = await runCli(["template", "promote", templateId, versionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const promoteOutput = JSON.parse(stdout.data.trim());
    assert.equal(promoteOutput.release.binding.artifactSource, "bundle");

    stdout.data = "";

    code = await runCli(["template", "inspect", templateId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const inspectedTemplate = JSON.parse(stdout.data.trim());
    assert.equal(inspectedTemplate.template.releaseCount, 1);
    assert.equal(inspectedTemplate.template.releases.length, 1);
    assert.equal(inspectedTemplate.template.latestRelease.id, promoteOutput.release.id);

    stdout.data = "";

    code = await runCli(["template", "archive", templateId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

    stdout.data = "";

    code = await runCli(["up", "blocked-shell", "--template", templateId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 1);
    assert.match(stderr.data, /Template is archived/);

    stdout.data = "";
    stderr.data = "";

    code = await runCli(["template", "restore", templateId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

    stdout.data = "";

    code = await runCli(["template", "create", "trash-dev", "--description", "Disposable template", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const disposableTemplate = JSON.parse(stdout.data.trim());
    const disposableTemplateId = disposableTemplate.template.id;

    stdout.data = "";

    code = await runCli(["template", "delete", disposableTemplateId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const deletedTemplate = JSON.parse(stdout.data.trim());
    assert.equal(deletedTemplate.ok, true);

    stdout.data = "";

    code = await runCli(["up", "my-shell", "--template", templateId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const sessionOutput = JSON.parse(stdout.data.trim());
    const sessionId = sessionOutput.session.id;

    stdout.data = "";

    code = await runCli(["up", "sleepy-shell", "--template", templateId, "--url", "http://local"], {
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

    code = await runCli(["snapshot", "get", sessionId, snapshotId, "--output", restoredPath, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const restoreOutput = JSON.parse(stdout.data.trim());
    assert.equal(restoreOutput.bytes, 18);
    assert.equal(await readFile(restoredPath, "utf8"), "cli bundle payload");

    stdout.data = "";

    code = await runCli(["snapshot", "restore", sessionId, snapshotId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const restoreSnapshotOutput = JSON.parse(stdout.data.trim());
    assert.equal(restoreSnapshotOutput.session.lastRestoredSnapshotId, snapshotId);

    stdout.data = "";

    code = await runCli(["snapshot", "delete", sessionId, snapshotId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const deletedSnapshot = JSON.parse(stdout.data.trim());
    assert.equal(deletedSnapshot.ok, true);

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
    assert.equal(reportOutput.report.releases, 1);
    assert.equal(reportOutput.report.buildsQueued, 1);
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
    assert.equal(exported.export.artifacts.templateBundles.length >= 1, true);

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

    /** @type {{ command: string; args: string[]; options: any } | null} */
    let spawned = null;
    let tunnelClosed = false;
    const spawnImpl = (command, args, options) => {
      if (command === "ssh-keygen") {
        const outputPath = args[args.indexOf("-f") + 1];
        return {
          on(event, handler) {
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
        on(event, handler) {
          if (event === "exit") {
            setImmediate(() => handler(0, null));
          }
          return this;
        }
      };
    };
    const createSshTunnelImpl = async (sshUrl) => ({
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
      "dev@127.0.0.1"
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
    assert.equal(printedSsh.sshUser, "dev");
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
    assert.equal(cleanupOutput.purgedStaleSleepingSessions, 1);

    stdout.data = "";

    code = await runCli(["status", staleSessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 1);
    assert.match(stderr.data, /Session not found/);

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

    code = await runCli(["auth", "login", "--email", "cli@example.com", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
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
    assert.ok(sessionsOutput.sessions.some((entry) => entry.id === initialAuthSessionId));
    assert.ok(sessionsOutput.sessions.some((entry) => entry.current));

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
    assert.equal(afterRevokeSessions.sessions.some((entry) => entry.id === initialAuthSessionId), false);

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

    code = await runCli(["auth", "recover", "--email", "cli@example.com", "--code", recoveryCode, "--url", "http://local"], {
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
    await rm(restoredPath, { force: true });
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
  assert.match(stdout.data, /^    flare template inspect <templateId>$/m);
  assert.match(stdout.data, /^    flare session list \[--status <status>\] \[--template <templateId>\]$/m);
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
    write(chunk) {
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
      fetchImpl: async (url) => {
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
  const bundlePath = path.join(os.tmpdir(), `flare-alias-bundle-${Date.now()}.txt`);

  try {
    await writeFile(bundlePath, "alias bundle payload");

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

    code = await runCli(["template", "create", "alias-active", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const activeTemplate = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(
      ["template", "upload", activeTemplate.template.id, "--version", "1.0.0", "--file", bundlePath, "--content-type", "text/plain", "--url", "http://local"],
      {
        fetchImpl,
        stdout,
        stderr,
        configPath
      }
    );
    assert.equal(code, 0);
    const uploadedVersion = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["builds", "--status", "queued", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const queuedBuilds = JSON.parse(stdout.data.trim());
    assert.equal(queuedBuilds.count, 1);
    assert.equal(queuedBuilds.filtered, false);
    stdout.data = "";

    code = await runCli(["build", "process", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["build", "--status", "succeeded", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const succeededBuilds = JSON.parse(stdout.data.trim());
    assert.equal(succeededBuilds.count, 1);
    stdout.data = "";

    code = await runCli(["template", "promote", activeTemplate.template.id, uploadedVersion.templateVersion.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["template", "create", "alias-archived", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const archivedTemplate = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["template", "archive", archivedTemplate.template.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["templates", "--active", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const activeTemplates = JSON.parse(stdout.data.trim());
    assert.deepEqual(activeTemplates.templates.map((entry) => entry.id), [activeTemplate.template.id]);
    stdout.data = "";

    code = await runCli(["template", "--archived", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const archivedTemplates = JSON.parse(stdout.data.trim());
    assert.deepEqual(archivedTemplates.templates.map((entry) => entry.id), [archivedTemplate.template.id]);
    stdout.data = "";

    code = await runCli(["releases", "--template", activeTemplate.template.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const releases = JSON.parse(stdout.data.trim());
    assert.equal(releases.count, 1);
    assert.equal(releases.releases[0].templateId, activeTemplate.template.id);
    stdout.data = "";

    code = await runCli(["session", "up", "alias-session", "--template", activeTemplate.template.id, "--url", "http://local"], {
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
    assert.deepEqual(runningSessions.sessions.map((entry) => entry.id), [sessionId]);
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

    code = await runCli(["list", "--status", stoppedStatus, "--template", activeTemplate.template.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const sleepingSessions = JSON.parse(stdout.data.trim());
    assert.deepEqual(sleepingSessions.sessions.map((entry) => entry.id), [sessionId]);
  } finally {
    await rm(configPath, { force: true });
    await rm(bundlePath, { force: true });
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

    code = await runCli(["template", "create", "operator-cli-template", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const template = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(
      [
        "template",
        "upload",
        template.template.id,
        "--version",
        "1.0.0",
        "--file",
        bundlePath,
        "--content-type",
        "text/plain",
        "--sleep-ttl-seconds",
        "1",
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
    const version = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["build", "process", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["template", "promote", template.template.id, version.templateVersion.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["up", "operator-running", "--template", template.template.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const running = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["up", "operator-stale", "--template", template.template.id, "--url", "http://local"], {
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

    code = await runCli(["up", "operator-deleted", "--template", template.template.id, "--url", "http://local"], {
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
    assert.equal(preview.preview.purgedStaleSleepingSessions, 1);
    assert.equal(preview.preview.purgedDeletedSessions, 1);
    assert.deepEqual(preview.preview.sessionIds.running, [running.session.id]);
    stdout.data = "";

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
    assert.equal(purgedSleeping.purgedStaleSleepingSessions, 1);
    assert.equal(purgedSleeping.purgedSnapshots, 1);
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

test("cli can roll back a template to a prior release", async () => {
  const app = createApp({
    TEMPLATE_BUCKET: createBucket(),
    BUILD_BUCKET: createBucket()
  });
  const fetchImpl = createFetch(app);
  const stdout = capture();
  const stderr = capture();
  const configPath = path.join(os.tmpdir(), `flare-cli-rollback-${Date.now()}.json`);
  const bundlePath = path.join(os.tmpdir(), `flare-rollback-bundle-${Date.now()}.txt`);

  try {
    await writeFile(bundlePath, "rollback bundle payload");

    let code = await runCli(["auth", "register", "--email", "rollback-cli@example.com", "--name", "Rollback CLI", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["template", "create", "rollback-cli", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const created = JSON.parse(stdout.data.trim());
    const templateId = created.template.id;
    stdout.data = "";

    code = await runCli(
      ["template", "upload", templateId, "--version", "1.0.0", "--file", bundlePath, "--content-type", "text/plain", "--url", "http://local"],
      {
        fetchImpl,
        stdout,
        stderr,
        configPath
      }
    );
    assert.equal(code, 0);
    const versionOne = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["build", "process", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["template", "promote", templateId, versionOne.templateVersion.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const firstPromotion = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(
      ["template", "upload", templateId, "--version", "2.0.0", "--file", bundlePath, "--content-type", "text/plain", "--url", "http://local"],
      {
        fetchImpl,
        stdout,
        stderr,
        configPath
      }
    );
    assert.equal(code, 0);
    const versionTwo = JSON.parse(stdout.data.trim());
    stdout.data = "";

    code = await runCli(["build", "process", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["template", "promote", templateId, versionTwo.templateVersion.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    stdout.data = "";

    code = await runCli(["template", "rollback", templateId, firstPromotion.release.id, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const rolledBack = JSON.parse(stdout.data.trim());
    assert.equal(rolledBack.activeVersion.id, versionOne.templateVersion.id);
    assert.equal(rolledBack.release.mode, "rollback");
    assert.equal(rolledBack.release.sourceReleaseId, firstPromotion.release.id);
  } finally {
    await rm(configPath, { force: true });
    await rm(bundlePath, { force: true });
  }
});
