function nowMs(clock) {
  return clock();
}

function nowIso(clock) {
  return new Date(nowMs(clock)).toISOString();
}

const DEFAULT_BOOTSTRAP_VERSION = "v1";
const DEFAULT_MANAGED_RUNTIME_IMAGE = `burstflare/session-runtime:${DEFAULT_BOOTSTRAP_VERSION}`;

function hashHex(input) {
  let hash = 0x811c9dc5;
  const value = String(input || "");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function resolveInstanceRuntimeSpec(instance) {
  const rawBaseImage =
    instance && Object.prototype.hasOwnProperty.call(instance, "baseImage") && instance.baseImage != null
      ? instance.baseImage
      : instance?.image;
  const baseImage = String(rawBaseImage || "").trim();
  const dockerfilePath = instance?.dockerfilePath == null ? null : String(instance.dockerfilePath || "");
  const dockerContext = instance?.dockerContext == null ? null : String(instance.dockerContext || "");
  const bootstrapVersion = String(instance?.bootstrapVersion || DEFAULT_BOOTSTRAP_VERSION);
  const hasExplicitManagedArtifact =
    instance &&
    (Object.prototype.hasOwnProperty.call(instance, "managedRuntimeImage") ||
      Object.prototype.hasOwnProperty.call(instance, "managedImageDigest") ||
      Object.prototype.hasOwnProperty.call(instance, "buildStatus") ||
      Object.prototype.hasOwnProperty.call(instance, "buildId"));
  const managedRuntimeImage =
    instance?.managedRuntimeImage != null
      ? String(instance.managedRuntimeImage)
      : hasExplicitManagedArtifact
        ? null
        : `burstflare/session-runtime:${bootstrapVersion}`;
  const digestSeed = [
    bootstrapVersion,
    baseImage,
    dockerfilePath || "",
    dockerContext || "",
    managedRuntimeImage || ""
  ].join("\n");
  const digestChunk = hashHex(digestSeed);
  return {
    baseImage,
    bootstrapVersion,
    managedRuntimeImage,
    managedImageDigest:
      instance?.managedImageDigest != null
        ? String(instance.managedImageDigest)
        : hasExplicitManagedArtifact
          ? null
          : `sha256:${digestChunk.repeat(8)}`
  };
}

export function getSessionInstance(state, session) {
  if (!session?.instanceId) {
    return null;
  }
  return state.instances.find((entry) => entry.id === session.instanceId) || null;
}

export function listSessionSnapshots(state, sessionId) {
  return state.snapshots
    .filter((entry) => entry.sessionId === sessionId)
    .sort((left, right) => {
      const leftStamp = String(left.createdAt || left.uploadedAt || "");
      const rightStamp = String(right.createdAt || right.uploadedAt || "");
      if (leftStamp !== rightStamp) {
        return rightStamp.localeCompare(leftStamp);
      }
      return String(right.id || "").localeCompare(String(left.id || ""));
    });
}

export function getLatestSessionSnapshot(state, sessionId) {
  return listSessionSnapshots(state, sessionId)[0] || null;
}

export function listVisibleSessionSnapshots(state, sessionId) {
  const snapshot = getLatestSessionSnapshot(state, sessionId);
  return snapshot ? [snapshot] : [];
}

export function requireLatestSnapshot(state, sessionId, snapshotId, deps) {
  const { ensure } = deps;
  const snapshot = getLatestSessionSnapshot(state, sessionId);
  ensure(snapshot && snapshot.id === snapshotId, "Snapshot not found", 404);
  return snapshot;
}

export function formatInstance(instance) {
  const runtimeSpec = resolveInstanceRuntimeSpec(instance);
  const { secrets: _secrets, ...baseInstance } = instance;
  const secretNames = Object.keys(instance.secrets || {}).sort();
  return {
    ...baseInstance,
    image: runtimeSpec.baseImage,
    baseImage: runtimeSpec.baseImage,
    bootstrapVersion: runtimeSpec.bootstrapVersion,
    managedRuntimeImage: runtimeSpec.managedRuntimeImage,
    managedImageDigest: runtimeSpec.managedImageDigest,
    envVars: { ...(instance.envVars || {}) },
    persistedPaths: Array.isArray(instance.persistedPaths) ? [...instance.persistedPaths] : [],
    secretNames,
    secretCount: secretNames.length
  };
}

export function formatSession(state, session, { includeSshKeys = false }: { includeSshKeys?: boolean } = {}, deps) {
  const { getSessionSshKeys, listSessionAuthorizedPublicKeys, summarizeSessionSshKeys } = deps;
  const instance = getSessionInstance(state, session);
  const events = state.sessionEvents.filter((entry) => entry.sessionId === session.id);
  const snapshots = listVisibleSessionSnapshots(state, session.id);
  const { sshAuthorizedKeys: _sshAuthorizedKeys, ...baseSession } = session;
  const sshKeyCount = getSessionSshKeys(session).length;
  return {
    ...baseSession,
    instanceId: session.instanceId || null,
    instanceName: instance?.name || null,
    instanceBaseImage: instance?.baseImage || instance?.image || null,
    instanceManagedRuntimeImage: instance?.managedRuntimeImage || null,
    templateName: null,
    eventsCount: events.length,
    snapshotCount: snapshots.length,
    sshKeyCount,
    ...(includeSshKeys
      ? {
          sshAuthorizedKeys: listSessionAuthorizedPublicKeys(session),
          sshKeyMetadata: summarizeSessionSshKeys(session)
        }
      : {})
  };
}

export function syncSessionRuntimeSnapshot(session, runtime, clock) {
  if (!runtime) {
    return;
  }
  session.runtimeDesiredState = runtime.desiredState || session.runtimeDesiredState || null;
  session.runtimeStatus = runtime.status || session.runtimeStatus || null;
  session.runtimeState = runtime.runtimeState || session.runtimeState || null;
  if (Number.isInteger(runtime.version)) {
    session.runtimeVersion = runtime.version;
  }
  if (runtime.operationId) {
    session.runtimeOperationId = runtime.operationId;
  }
  session.runtimeUpdatedAt = nowIso(clock);
}

export function syncLatestRestoredSnapshot(state, session, timestamp) {
  const snapshot = getLatestSessionSnapshot(state, session.id);
  if (!snapshot) {
    session.lastRestoredSnapshotId = null;
    session.lastRestoredAt = null;
    return;
  }
  session.lastRestoredSnapshotId = snapshot.id;
  session.lastRestoredAt = timestamp;
}

export function isStaleRuntimeSnapshot(session, runtime) {
  if (!runtime || !Number.isInteger(runtime.version)) {
    return false;
  }
  const currentVersion = Number.isInteger(session.runtimeVersion) ? session.runtimeVersion : 0;
  if (runtime.version < currentVersion) {
    return true;
  }
  if (
    runtime.version === currentVersion &&
    runtime.operationId &&
    session.runtimeOperationId &&
    runtime.operationId !== session.runtimeOperationId
  ) {
    return true;
  }
  return false;
}

export function resolveSessionStateFromRuntime(action, runtime) {
  const runtimeStatus = runtime?.status || null;
  if (action === "delete") {
    return "deleted";
  }
  if (action === "stop") {
    return "sleeping";
  }
  if (action === "start" || action === "restart") {
    if (!runtimeStatus) {
      return "running";
    }
    if (runtimeStatus === "running") {
      return "running";
    }
    if (runtimeStatus === "deleted") {
      return "deleted";
    }
    if (runtimeStatus === "sleeping") {
      return "sleeping";
    }
    return "starting";
  }
  return null;
}

export function applySessionTransition({ state, clock, auth, action, runtime = null }, deps) {
  const { ensure, getEffectiveLimits, getRunningSessionCount, summarizeUsage, writeSessionEvent, writeUsage, writeAudit, formatSession } = deps;
  const session = auth.session;
  const timestamp = nowIso(clock);
  syncSessionRuntimeSnapshot(session, runtime, clock);

  if (action === "start") {
    ensure(session.state !== "deleted", "Session deleted", 409);
    ensure(["created", "sleeping"].includes(session.state), "Session cannot be started", 409);
    const limits = getEffectiveLimits(auth.workspace);
    const runningCount = getRunningSessionCount(state, auth.workspace.id);
    ensure(runningCount < limits.maxRunningSessions, "Running session limit reached", 403);

    session.state = "starting";
    session.updatedAt = timestamp;
    writeSessionEvent(state, clock, session.id, "starting");

    session.state = resolveSessionStateFromRuntime("start", runtime);
    if (session.state === "running") {
      const usage = summarizeUsage(state, auth.workspace.id);
      ensure(usage.runtimeMinutes < limits.maxRuntimeMinutes, "Runtime minute limit reached", 403);
      session.lastStartedAt = timestamp;
      syncLatestRestoredSnapshot(state, session, timestamp);
      writeUsage(state, clock, {
        workspaceId: auth.workspace.id,
        kind: "runtime_minutes",
        value: 1,
        details: { sessionId: session.id }
      });
    }
    session.updatedAt = timestamp;
    writeSessionEvent(state, clock, session.id, session.state);
    writeAudit(state, clock, {
      action: "session.started",
      actorUserId: auth.user.id,
      workspaceId: auth.workspace.id,
      targetType: "session",
      targetId: session.id
    });
    return { session: formatSession(state, session), runtime };
  }

  if (action === "stop") {
    ensure(session.state !== "deleted", "Session deleted", 409);
    ensure(["running", "starting"].includes(session.state), "Session cannot be stopped", 409);
    session.state = "stopping";
    session.updatedAt = timestamp;
    writeSessionEvent(state, clock, session.id, "stopping");

    session.state = resolveSessionStateFromRuntime("stop", runtime);
    session.lastStoppedAt = timestamp;
    session.updatedAt = timestamp;
    writeSessionEvent(state, clock, session.id, session.state);
    writeAudit(state, clock, {
      action: "session.stopped",
      actorUserId: auth.user.id,
      workspaceId: auth.workspace.id,
      targetType: "session",
      targetId: session.id
    });
    return { session: formatSession(state, session), runtime };
  }

  if (action === "restart") {
    ensure(session.state !== "deleted", "Session deleted", 409);
    if (session.state === "running") {
      session.state = "stopping";
      session.updatedAt = timestamp;
      writeSessionEvent(state, clock, session.id, "stopping", { reason: "restart" });
      session.state = "sleeping";
      session.lastStoppedAt = timestamp;
      session.updatedAt = timestamp;
      writeSessionEvent(state, clock, session.id, "sleeping", { reason: "restart" });
    }
    ensure(["created", "sleeping"].includes(session.state), "Session cannot be restarted", 409);
    const limits = getEffectiveLimits(auth.workspace);
    const runningCount = getRunningSessionCount(state, auth.workspace.id);
    ensure(runningCount < limits.maxRunningSessions, "Running session limit reached", 403);

    session.state = "starting";
    session.updatedAt = timestamp;
    writeSessionEvent(state, clock, session.id, "starting", { reason: "restart" });

    session.state = resolveSessionStateFromRuntime("restart", runtime);
    if (session.state === "running") {
      const usage = summarizeUsage(state, auth.workspace.id);
      ensure(usage.runtimeMinutes < limits.maxRuntimeMinutes, "Runtime minute limit reached", 403);
      session.lastStartedAt = timestamp;
      syncLatestRestoredSnapshot(state, session, timestamp);
      writeUsage(state, clock, {
        workspaceId: auth.workspace.id,
        kind: "runtime_minutes",
        value: 1,
        details: { sessionId: session.id, restart: true }
      });
    }
    session.updatedAt = timestamp;
    writeSessionEvent(state, clock, session.id, session.state, { reason: "restart" });
    writeAudit(state, clock, {
      action: "session.restarted",
      actorUserId: auth.user.id,
      workspaceId: auth.workspace.id,
      targetType: "session",
      targetId: session.id
    });
    return { session: formatSession(state, session), runtime };
  }

  if (action === "delete") {
    session.state = resolveSessionStateFromRuntime("delete", runtime);
    session.updatedAt = timestamp;
    writeSessionEvent(state, clock, session.id, "deleted");
    writeAudit(state, clock, {
      action: "session.deleted",
      actorUserId: auth.user.id,
      workspaceId: auth.workspace.id,
      targetType: "session",
      targetId: session.id
    });
    return { session: formatSession(state, session), runtime };
  }

  throw new Error(`Unsupported session action: ${action}`);
}
