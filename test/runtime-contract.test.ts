import test from "node:test";
import assert from "node:assert/strict";
import {
  createRuntimeBootstrapPayload,
  createRuntimeLifecyclePayload,
  runtimeContentTypes,
  runtimeControlPaths,
  runtimeEnvelopeFormats,
  runtimeSystemPaths
} from "../containers/session/runtime-contract.mjs";

test("runtime control contract exposes the container route map", () => {
  assert.equal(runtimeControlPaths.health, "/health");
  assert.equal(runtimeControlPaths.bootstrap, "/runtime/bootstrap");
  assert.equal(runtimeControlPaths.lifecycle, "/runtime/lifecycle");
  assert.equal(runtimeControlPaths.snapshotRestore, "/snapshot/restore");
  assert.equal(runtimeControlPaths.snapshotExport, "/snapshot/export");
  assert.equal(runtimeControlPaths.commonStateRestore, "/common-state/restore");
  assert.equal(runtimeControlPaths.commonStateExport, "/common-state/export");
  assert.equal(runtimeControlPaths.editor, "/editor");
  assert.equal(runtimeControlPaths.shell, "/shell");
  assert.equal(runtimeControlPaths.ssh, "/ssh");
});

test("runtime contract exports canonical envelope metadata and runtime file locations", () => {
  assert.equal(runtimeEnvelopeFormats.snapshot, "burstflare.snapshot.v2");
  assert.equal(runtimeEnvelopeFormats.commonState, "burstflare.common-state.v1");
  assert.equal(runtimeContentTypes.snapshot, "application/vnd.burstflare.snapshot+json; charset=utf-8");
  assert.equal(runtimeContentTypes.commonState, "application/vnd.burstflare.common-state+json; charset=utf-8");
  assert.equal(runtimeSystemPaths.sessionMetadata, "/workspace/.burstflare/session.json");
  assert.equal(runtimeSystemPaths.lifecycleMetadata, "/workspace/.burstflare/lifecycle.json");
  assert.equal(runtimeSystemPaths.secretsEnv, "/run/burstflare/secrets.env");
  assert.equal(runtimeSystemPaths.authorizedKeys, "/home/flare/.ssh/authorized_keys");
});

test("runtime bootstrap payload builder normalizes the worker-to-container body shape", () => {
  const payload = createRuntimeBootstrapPayload(
    {
      id: "ses_123",
      workspaceId: "ws_123",
      instanceId: "ins_123",
      templateId: "tpl_123",
      templateName: "Example Runtime",
      state: "running",
      previewUrl: "https://preview.example.test",
      lastRestoredSnapshotId: "snap_123",
      persistedPaths: ["/workspace/project"],
      runtimeVersion: 7,
      sshAuthorizedKeys: ["ssh-ed25519 AAAA user@test"]
    },
    {
      secretNames: ["API_TOKEN"],
      runtimeSecrets: {
        API_TOKEN: "secret-value"
      }
    }
  );

  assert.deepEqual(payload, {
    sessionId: "ses_123",
    workspaceId: "ws_123",
    templateId: "tpl_123",
    instanceId: "ins_123",
    templateName: "Example Runtime",
    state: "running",
    previewUrl: "https://preview.example.test",
    lastRestoredSnapshotId: "snap_123",
    persistedPaths: ["/workspace/project"],
    runtimeSecretNames: ["API_TOKEN"],
    runtimeSecrets: {
      API_TOKEN: "secret-value"
    },
    runtimeVersion: 7,
    sshAuthorizedKeys: ["ssh-ed25519 AAAA user@test"],
    bootstrapScript: null
  });
});

test("runtime bootstrap payload includes bootstrapScript from session", () => {
  const payload = createRuntimeBootstrapPayload({
    id: "ses_456",
    instanceBootstrapScript: "#!/bin/sh\napt-get install -y curl",
    sshAuthorizedKeys: []
  });
  assert.equal(payload.bootstrapScript, "#!/bin/sh\napt-get install -y curl");
});

test("runtime bootstrap payload defaults bootstrapScript to null", () => {
  const payload = createRuntimeBootstrapPayload({ id: "ses_789", sshAuthorizedKeys: [] });
  assert.equal(payload.bootstrapScript, null);
});

test("runtime lifecycle payload builder fills the default reason from the phase", () => {
  assert.deepEqual(createRuntimeLifecyclePayload("ses_123", "sleep"), {
    sessionId: "ses_123",
    phase: "sleep",
    reason: "sleep"
  });
});
