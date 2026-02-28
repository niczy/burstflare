import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
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
  const configPath = path.join(os.tmpdir(), `burstflare-cli-${Date.now()}.json`);
  const bundlePath = path.join(os.tmpdir(), `burstflare-bundle-${Date.now()}.txt`);
  const restoredPath = path.join(os.tmpdir(), `burstflare-restored-${Date.now()}.txt`);

  try {
    await writeFile(bundlePath, "cli bundle payload");

    let code = await runCli(["auth", "register", "--email", "cli@example.com", "--name", "CLI User", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

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
      ["template", "upload", templateId, "--version", "1.0.0", "--file", bundlePath, "--content-type", "text/plain", "--url", "http://local"],
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

    code = await runCli(["template", "promote", templateId, versionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

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

    stdout.data = "";

    code = await runCli(["ssh", sessionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    assert.match(stdout.data, /ssh -o ProxyCommand=/);
    assert.equal(stderr.data, "");

    stdout.data = "";

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
  } finally {
    await rm(configPath, { force: true });
    await rm(bundlePath, { force: true });
    await rm(restoredPath, { force: true });
  }
});
