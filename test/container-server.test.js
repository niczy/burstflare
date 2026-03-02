// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import {
  applySnapshotRestore,
  applyRuntimeBootstrap,
  exportSnapshotPayload,
  listEditorFiles,
  recordLifecycleHook,
  resetRuntimeState,
  runtimeState,
  updateEditorFile
} from "../containers/session/server.mjs";

function toBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

test("session container restores only files inside persisted paths and exports a structured envelope", async () => {
  resetRuntimeState();

  const snapshotBody = JSON.stringify(
    {
      format: "burstflare.snapshot.v2",
      files: [
        {
          path: "/workspace/project/app.txt",
          content: "hello world"
        },
        {
          path: "/tmp/blocked.txt",
          content: "should not restore"
        }
      ]
    },
    null,
    2
  );

  const restored = applySnapshotRestore({
    sessionId: "ses_test",
    snapshotId: "snap_test",
    label: "test",
    persistedPaths: ["/workspace/project"],
    contentType: "application/vnd.burstflare.snapshot+json; charset=utf-8",
    contentBase64: toBase64(snapshotBody)
  });

  assert.deepEqual(restored.persistedPaths, ["/workspace/project"]);
  assert.deepEqual(restored.restoredPaths, ["/workspace/project/app.txt"]);
  assert.equal(runtimeState.files.get("/workspace/project/app.txt"), "hello world");
  assert.equal(runtimeState.files.has("/tmp/blocked.txt"), false);

  const exported = exportSnapshotPayload("ses_test", ["/workspace/project"]);
  assert.equal(exported.contentType, "application/vnd.burstflare.snapshot+json; charset=utf-8");

  const parsed = JSON.parse(exported.body.toString("utf8"));
  assert.equal(parsed.format, "burstflare.snapshot.v2");
  assert.deepEqual(parsed.persistedPaths, ["/workspace/project"]);
  assert.deepEqual(parsed.files, [
    {
      path: "/workspace/project/app.txt",
      content: "hello world"
    }
  ]);
});

test("session container editor writes stay inside the configured persisted paths", async () => {
  resetRuntimeState();

  const saved = updateEditorFile("/workspace/project/notes.txt", "draft 1", ["/workspace/project"]);
  assert.equal(saved.ok, true);
  assert.equal(saved.path, "/workspace/project/notes.txt");
  assert.equal(runtimeState.files.get("/workspace/project/notes.txt"), "draft 1");

  const listed = listEditorFiles(["/workspace/project"]);
  assert.deepEqual(listed.scope, ["/workspace/project"]);
  assert.deepEqual(listed.files, ["/workspace/project/notes.txt"]);

  assert.throws(
    () => updateEditorFile("/tmp/blocked.txt", "nope", ["/workspace/project"]),
    /persisted paths/
  );
});

test("session container bootstrap and lifecycle hooks persist runtime metadata files", async () => {
  resetRuntimeState();

  const bootstrapped = applyRuntimeBootstrap({
    sessionId: "ses_bootstrap",
    workspaceId: "ws_test",
    templateId: "tpl_test",
    templateName: "Runtime Template",
    state: "running",
    lastRestoredSnapshotId: "snap_boot",
    persistedPaths: ["/workspace/project"],
    runtimeSecrets: {
      API_TOKEN: "super-secret"
    },
    sshAuthorizedKeys: [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGJ1cnN0ZmxhcmV0ZXN0a2V5bWF0ZXJpYWw= flare@test"
    ],
    runtimeVersion: 3
  });
  assert.equal(bootstrapped.ok, true);
  assert.equal(bootstrapped.bootstrap.sessionId, "ses_bootstrap");
  assert.equal(bootstrapped.bootstrap.sshKeyCount, 1);
  assert.deepEqual(runtimeState.persistedPaths, ["/workspace/project"]);
  assert.deepEqual(runtimeState.secretNames, ["API_TOKEN"]);
  assert.equal(runtimeState.sshAuthorizedKeys.length, 1);
  assert.match(runtimeState.files.get("/workspace/.burstflare/session.json"), /Runtime Template/);
  assert.match(runtimeState.files.get("/run/burstflare/secrets.env"), /API_TOKEN=super-secret/);
  assert.match(runtimeState.files.get("/home/dev/.ssh/authorized_keys"), /ssh-ed25519/);

  const lifecycle = recordLifecycleHook({
    sessionId: "ses_bootstrap",
    phase: "sleep",
    reason: "session_stop"
  });
  assert.equal(lifecycle.ok, true);
  assert.equal(lifecycle.lifecycle.phase, "sleep");
  assert.match(runtimeState.files.get("/workspace/.burstflare/lifecycle.json"), /session_stop/);
});
