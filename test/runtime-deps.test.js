// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import {
  buildDoctorReport,
  formatMissingCommandMessage,
  formatDoctorReport,
  listMissingCommands,
  runInstallDependencyCheck,
  SSH_RUNTIME_DEPENDENCIES
} from "../apps/cli/src/runtime-deps.js";

/**
 * @returns {{
 *   data: string;
 *   write(chunk: string): void;
 * }}
 */
function capture() {
  return {
    data: "",
    write(chunk) {
      this.data += chunk;
    }
  };
}

test("runtime dependency detection finds available commands on PATH", async () => {
  const toolDir = path.join(os.tmpdir(), `flare-runtime-deps-${Date.now()}`);

  try {
    await mkdir(toolDir, { recursive: true });
    await writeFile(path.join(toolDir, "ssh"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(toolDir, "ssh"), 0o755);
    await writeFile(path.join(toolDir, "ssh-keygen"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(toolDir, "ssh-keygen"), 0o755);

    const missing = listMissingCommands(SSH_RUNTIME_DEPENDENCIES, {
      env: {
        PATH: toolDir
      },
      platform: process.platform
    });
    assert.deepEqual(missing, []);
  } finally {
    await rm(toolDir, { force: true, recursive: true });
  }
});

test("install dependency check warns when ssh tooling is missing", () => {
  const stderr = capture();
  const result = runInstallDependencyCheck({
    env: {
      PATH: ""
    },
    platform: "linux",
    stderr
  });

  assert.deepEqual(result.missing, ["ssh", "ssh-keygen"]);
  assert.match(stderr.data, /Missing local dependencies for flare ssh/);
  assert.match(stderr.data, /Install an OpenSSH client/);
  assert.match(stderr.data, /ssh-keygen/);
  assert.match(
    formatMissingCommandMessage(["ssh"], { action: "flare ssh" }),
    /Preview and editor commands still work/
  );
});

test("doctor report includes summary and per-command hints", () => {
  const report = buildDoctorReport({
    env: {
      PATH: ""
    },
    platform: "linux",
    nodeVersion: "v20.0.0"
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, ["ssh", "ssh-keygen"]);
  assert.equal(report.dependencies[0].command, "ssh");
  assert.equal(report.dependencies[0].installed, false);
  assert.match(report.dependencies[0].hints.join("\n"), /OpenSSH client/);
  assert.equal(report.dependencies[1].command, "ssh-keygen");
  assert.equal(report.dependencies[1].installed, false);
  assert.match(formatDoctorReport(report), /ssh-ready: no/);
  assert.match(formatDoctorReport(report), /summary:/);
});
