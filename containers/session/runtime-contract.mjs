export const runtimeControlPaths = Object.freeze({
  health: "/health",
  meta: "/meta",
  bootstrap: "/runtime/bootstrap",
  lifecycle: "/runtime/lifecycle",
  snapshotRestore: "/snapshot/restore",
  snapshotExport: "/snapshot/export",
  commonStateRestore: "/common-state/restore",
  commonStateExport: "/common-state/export",
  editor: "/editor",
  shell: "/shell",
  ssh: "/ssh"
});

export const runtimeEnvelopeFormats = Object.freeze({
  snapshot: "burstflare.snapshot.v2",
  commonState: "burstflare.common-state.v1"
});

export const runtimeContentTypes = Object.freeze({
  snapshot: "application/vnd.burstflare.snapshot+json; charset=utf-8",
  commonState: "application/vnd.burstflare.common-state+json; charset=utf-8"
});

export const runtimeSystemPaths = Object.freeze({
  authorizedKeys: "/home/flare/.ssh/authorized_keys",
  lastSnapshotAlias: "/workspace/.burstflare/last.snapshot",
  lifecycleMetadata: "/workspace/.burstflare/lifecycle.json",
  secretsEnv: "/run/burstflare/secrets.env",
  sessionMetadata: "/workspace/.burstflare/session.json",
  snapshotDirectory: "/workspace/.burstflare/snapshots"
});

function normalizeRuntimeSecretsPayload(runtimeSecrets = null) {
  if (!runtimeSecrets || typeof runtimeSecrets !== "object") {
    return {
      secretNames: [],
      runtimeSecrets: {}
    };
  }

  const secretPayload =
    runtimeSecrets &&
    typeof runtimeSecrets === "object" &&
    "runtimeSecrets" in runtimeSecrets &&
    runtimeSecrets.runtimeSecrets &&
    typeof runtimeSecrets.runtimeSecrets === "object"
      ? runtimeSecrets.runtimeSecrets
      : {};
  const providedNames =
    runtimeSecrets &&
    typeof runtimeSecrets === "object" &&
    "secretNames" in runtimeSecrets &&
    Array.isArray(runtimeSecrets.secretNames)
      ? runtimeSecrets.secretNames
      : Object.keys(secretPayload);

  const secretNames = Array.from(
    new Set(
      providedNames
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )
  );

  return {
    secretNames,
    runtimeSecrets: secretPayload
  };
}

export function createRuntimeBootstrapPayload(session = {}, runtimeSecrets = null) {
  const secretPayload = normalizeRuntimeSecretsPayload(runtimeSecrets);
  return {
    sessionId: session?.id || null,
    workspaceId: session?.workspaceId || null,
    templateId: session?.templateId || null,
    instanceId: session?.instanceId || null,
    templateName: session?.templateName || null,
    state: session?.state || null,
    previewUrl: session?.previewUrl || null,
    lastRestoredSnapshotId: session?.lastRestoredSnapshotId || null,
    persistedPaths: Array.isArray(session?.persistedPaths) ? session.persistedPaths : [],
    runtimeSecretNames: secretPayload.secretNames,
    runtimeSecrets: secretPayload.runtimeSecrets,
    runtimeVersion: Number.isInteger(session?.runtimeVersion) ? session.runtimeVersion : 0,
    sshAuthorizedKeys: Array.isArray(session?.sshAuthorizedKeys) ? session.sshAuthorizedKeys : []
  };
}

export function createRuntimeLifecyclePayload(sessionId, phase, reason = "") {
  return {
    sessionId: sessionId || null,
    phase: phase || null,
    reason: reason || phase || null
  };
}
