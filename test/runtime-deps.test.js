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
    await writeFile(path.join(toolDir, "wstunnel"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(toolDir, "ssh"), 0o755);
    await chmod(path.join(toolDir, "wstunnel"), 0o755);

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

test("install dependency check warns when ssh tools are missing", () => {
  const stderr = capture();
  const result = runInstallDependencyCheck({
    env: {
      PATH: ""
    },
    platform: "linux",
    stderr
  });

  assert.deepEqual(result.missing, ["ssh", "wstunnel"]);
  assert.match(stderr.data, /Missing local dependencies for flare ssh/);
  assert.match(stderr.data, /Install `wstunnel`/);
  assert.match(stderr.data, /Install an OpenSSH client/);
  assert.match(
    formatMissingCommandMessage(["ssh", "wstunnel"], { action: "flare ssh" }),
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
  assert.deepEqual(report.missing, ["ssh", "wstunnel"]);
  assert.equal(report.dependencies[0].command, "ssh");
  assert.equal(report.dependencies[0].installed, false);
  assert.match(report.dependencies[1].hints.join("\n"), /Linux:/);
  assert.match(formatDoctorReport(report), /ssh-ready: no/);
  assert.match(formatDoctorReport(report), /summary:/);
});
