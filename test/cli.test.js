import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { runCli } from "../apps/cli/src/cli.js";
import { createApp } from "../apps/edge/src/worker.js";
import { createBurstFlareService, createMemoryStore } from "../packages/shared/src/index.js";

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

test("cli can run device flow, build processing, session lifecycle, and reporting", async () => {
  const service = createBurstFlareService({
    store: createMemoryStore()
  });
  const app = createApp({ service });
  const fetchImpl = createFetch(app);
  const stdout = capture();
  const stderr = capture();
  const configPath = path.join(os.tmpdir(), `burstflare-cli-${Date.now()}.json`);

  try {
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

    code = await runCli(["template", "upload", templateId, "--version", "1.0.0", "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);
    const versionOutput = JSON.parse(stdout.data.trim());
    const versionId = versionOutput.templateVersion.id;

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

    code = await runCli(["template", "promote", templateId, versionId, "--url", "http://local"], {
      fetchImpl,
      stdout,
      stderr,
      configPath
    });
    assert.equal(code, 0);

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
  } finally {
    await rm(configPath, { force: true });
  }
});
