import { createMemoryStore } from "./memory-store.js";
import { createId, defaultNameFromEmail } from "./utils.js";

const SESSION_COOKIE = "burstflare_session";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const RUNTIME_TOKEN_TTL_MS = 1000 * 60 * 15;
const DEVICE_CODE_TTL_MS = 1000 * 60 * 10;
const UPLOAD_GRANT_TTL_MS = 1000 * 60 * 10;
const MAX_BUILD_ATTEMPTS = 3;
const STUCK_BUILD_TTL_MS = 1000 * 60 * 5;
const MAX_TEMPLATE_BUNDLE_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const ALLOWED_TEMPLATE_FEATURES = new Set(["ssh", "browser", "snapshots"]);

const PLANS = {
  free: {
    maxTemplates: 10,
    maxRunningSessions: 3
  },
  pro: {
    maxTemplates: 100,
    maxRunningSessions: 20
  },
  enterprise: {
    maxTemplates: 1000,
    maxRunningSessions: 200
  }
};

function nowMs(clock) {
  return clock();
}

function nowIso(clock) {
  return new Date(nowMs(clock)).toISOString();
}

function futureIso(clock, durationMs) {
  return new Date(nowMs(clock) + durationMs).toISOString();
}

function getPlan(name) {
  return PLANS[name] || PLANS.free;
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return new Uint8Array();
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function ensure(condition, message, status = 400) {
  if (!condition) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }
}

function canManageWorkspace(role) {
  return role === "owner" || role === "admin";
}

function canWrite(role) {
  return role === "owner" || role === "admin" || role === "member";
}

function validateTemplateManifest(manifest) {
  ensure(manifest && typeof manifest === "object" && !Array.isArray(manifest), "Manifest must be an object");
  ensure(typeof manifest.image === "string" && manifest.image.trim(), "Manifest image is required");

  if (manifest.features !== undefined) {
    ensure(Array.isArray(manifest.features), "Manifest features must be an array");
    for (const feature of manifest.features) {
      ensure(ALLOWED_TEMPLATE_FEATURES.has(feature), `Unsupported manifest feature: ${feature}`);
    }
  }

  if (manifest.persistedPaths !== undefined) {
    ensure(Array.isArray(manifest.persistedPaths), "Manifest persistedPaths must be an array");
    ensure(manifest.persistedPaths.length <= 8, "Manifest persistedPaths exceeds limit");
    for (const entry of manifest.persistedPaths) {
      ensure(typeof entry === "string" && entry.startsWith("/"), "Persisted paths must be absolute");
    }
  }

  if (manifest.sleepTtlSeconds !== undefined) {
    ensure(Number.isInteger(manifest.sleepTtlSeconds), "Manifest sleepTtlSeconds must be an integer");
    ensure(manifest.sleepTtlSeconds >= 1, "Manifest sleepTtlSeconds must be at least 1");
    ensure(manifest.sleepTtlSeconds <= 60 * 60 * 24 * 7, "Manifest sleepTtlSeconds exceeds limit");
  }
}

function findUserByEmail(state, email) {
  return state.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

function getRecoveryCodes(user) {
  if (!Array.isArray(user.recoveryCodes)) {
    user.recoveryCodes = [];
  }
  return user.recoveryCodes;
}

function createRecoveryCode() {
  const raw = globalThis.crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function findUserById(state, userId) {
  return state.users.find((user) => user.id === userId) || null;
}

function getUserWorkspace(state, userId) {
  const membership = state.memberships.find((entry) => entry.userId === userId && entry.role === "owner");
  if (!membership) {
    return null;
  }
  return state.workspaces.find((workspace) => workspace.id === membership.workspaceId) || null;
}

function getMembership(state, userId, workspaceId) {
  return state.memberships.find((entry) => entry.userId === userId && entry.workspaceId === workspaceId) || null;
}

function getTokenRecord(state, token) {
  return state.authTokens.find((entry) => entry.token === token && !entry.revokedAt) || null;
}

function createToken(state, clock, { userId, workspaceId, kind, sessionId = null, grantKind = null, sessionGroupId = null }) {
  const record = {
    id: createId("tok"),
    token: createId(kind),
    userId,
    workspaceId,
    kind,
    sessionId,
    sessionGroupId,
    grantKind,
    createdAt: nowIso(clock),
    expiresAt: futureIso(
      clock,
      kind === "runtime" ? RUNTIME_TOKEN_TTL_MS : kind === "refresh" ? REFRESH_TOKEN_TTL_MS : TOKEN_TTL_MS
    ),
    revokedAt: null
  };
  state.authTokens.push(record);
  return record;
}

function issueSessionTokens(state, clock, { userId, workspaceId, accessKind }) {
  const sessionGroupId = createId("auths");
  const accessToken = createToken(state, clock, {
    userId,
    workspaceId,
    kind: accessKind,
    sessionGroupId
  });
  const refreshToken = createToken(state, clock, {
    userId,
    workspaceId,
    kind: "refresh",
    grantKind: accessKind,
    sessionGroupId
  });
  return { accessToken, refreshToken };
}

function writeAudit(state, clock, { action, actorUserId, workspaceId, targetType, targetId, details = {} }) {
  state.auditLogs.push({
    id: createId("audit"),
    action,
    actorUserId,
    workspaceId,
    targetType,
    targetId,
    details,
    createdAt: nowIso(clock)
  });
}

function writeUsage(state, clock, { workspaceId, kind, value, details = {} }) {
  state.usageEvents.push({
    id: createId("usage"),
    workspaceId,
    kind,
    value,
    details,
    createdAt: nowIso(clock)
  });
}

function writeSessionEvent(state, clock, sessionId, stateName, details = {}) {
  state.sessionEvents.push({
    id: createId("sevt"),
    sessionId,
    state: stateName,
    details,
    createdAt: nowIso(clock)
  });
}

function writeBindingRelease(state, clock, workspaceId, templateId, templateVersionId) {
  const release = {
    id: createId("rel"),
    workspaceId,
    templateId,
    templateVersionId,
    createdAt: nowIso(clock)
  };
  state.bindingReleases.push(release);
  return release;
}

function getUploadGrants(state) {
  if (!Array.isArray(state.uploadGrants)) {
    state.uploadGrants = [];
  }
  return state.uploadGrants;
}

function pruneUploadGrants(state, clock) {
  const cutoff = nowMs(clock);
  state.uploadGrants = getUploadGrants(state).filter(
    (entry) => !entry.usedAt && new Date(entry.expiresAt).getTime() > cutoff
  );
  return state.uploadGrants;
}

function createUploadGrant(state, clock, details) {
  const grants = pruneUploadGrants(state, clock);
  const grant = {
    id: createId("upg"),
    createdAt: nowIso(clock),
    expiresAt: futureIso(clock, UPLOAD_GRANT_TTL_MS),
    usedAt: null,
    ...details
  };
  grants.push(grant);
  return grant;
}

async function storeTemplateBundleUpload({
  state,
  clock,
  objects,
  workspace,
  template,
  templateVersion,
  actorUserId,
  body,
  contentType = "application/octet-stream"
}) {
  const bundleBody = toUint8Array(body);
  ensure(bundleBody.byteLength > 0, "Bundle body is required");
  ensure(bundleBody.byteLength <= MAX_TEMPLATE_BUNDLE_BYTES, "Bundle exceeds size limit", 413);

  templateVersion.bundleKey =
    templateVersion.bundleKey || `templates/${workspace.id}/${template.id}/${templateVersion.id}/bundle.bin`;
  templateVersion.bundleUploadedAt = nowIso(clock);
  templateVersion.bundleContentType = contentType;
  templateVersion.bundleBytes = bundleBody.byteLength;

  if (objects?.putTemplateVersionBundle) {
    await objects.putTemplateVersionBundle({
      workspace,
      template,
      templateVersion,
      body: bundleBody,
      contentType
    });
  }

  writeAudit(state, clock, {
    action: "template.bundle_uploaded",
    actorUserId,
    workspaceId: workspace.id,
    targetType: "template_version",
    targetId: templateVersion.id,
    details: {
      contentType,
      bytes: bundleBody.byteLength
    }
  });

  return {
    templateVersion,
    bundle: {
      key: templateVersion.bundleKey,
      uploadedAt: templateVersion.bundleUploadedAt,
      contentType: templateVersion.bundleContentType,
      bytes: templateVersion.bundleBytes
    }
  };
}

async function storeSnapshotUpload({
  state,
  clock,
  objects,
  workspace,
  session,
  snapshot,
  actorUserId,
  body,
  contentType = "application/octet-stream"
}) {
  const snapshotBody = toUint8Array(body);
  ensure(snapshotBody.byteLength > 0, "Snapshot body is required");
  ensure(snapshotBody.byteLength <= MAX_SNAPSHOT_BYTES, "Snapshot exceeds size limit", 413);

  snapshot.uploadedAt = nowIso(clock);
  snapshot.contentType = contentType;
  snapshot.bytes = snapshotBody.byteLength;

  if (objects?.putSnapshot) {
    await objects.putSnapshot({
      workspace,
      session,
      snapshot,
      body: snapshotBody,
      contentType
    });
    snapshot.inlineContentBase64 = null;
  } else {
    snapshot.inlineContentBase64 = toBase64(snapshotBody);
  }

  writeAudit(state, clock, {
    action: "snapshot.content_uploaded",
    actorUserId,
    workspaceId: workspace.id,
    targetType: "snapshot",
    targetId: snapshot.id,
    details: {
      contentType,
      bytes: snapshot.bytes
    }
  });

  return { snapshot };
}

function requireAuth(state, token, clock) {
  const auth = getTokenRecord(state, token);
  ensure(auth && new Date(auth.expiresAt).getTime() > nowMs(clock), "Unauthorized", 401);
  const user = findUserById(state, auth.userId);
  const workspace = state.workspaces.find((entry) => entry.id === auth.workspaceId);
  ensure(user && workspace, "Unauthorized", 401);
  const membership = getMembership(state, user.id, workspace.id);
  ensure(membership, "Unauthorized", 401);
  return { auth, user, workspace, membership };
}

function requireManageWorkspace(state, token, clock) {
  const auth = requireAuth(state, token, clock);
  ensure(canManageWorkspace(auth.membership.role), "Insufficient permissions", 403);
  return auth;
}

function requireWriteAccess(state, token, clock) {
  const auth = requireAuth(state, token, clock);
  ensure(canWrite(auth.membership.role), "Insufficient permissions", 403);
  return auth;
}

function requireTemplateAccess(state, authToken, templateId, clock) {
  const auth = requireAuth(state, authToken, clock);
  const template = state.templates.find((entry) => entry.id === templateId && entry.workspaceId === auth.workspace.id);
  ensure(template, "Template not found", 404);
  return { ...auth, template };
}

function requireSessionAccess(state, authToken, sessionId, clock) {
  const auth = requireAuth(state, authToken, clock);
  const session = state.sessions.find((entry) => entry.id === sessionId && entry.workspaceId === auth.workspace.id);
  ensure(session, "Session not found", 404);
  return { ...auth, session };
}

function requireRuntimeToken(state, token, sessionId, clock) {
  const auth = getTokenRecord(state, token);
  ensure(auth && new Date(auth.expiresAt).getTime() > nowMs(clock), "Unauthorized", 401);
  ensure(auth.kind === "runtime", "Runtime token required", 401);
  ensure(auth.sessionId === sessionId, "Runtime token does not match session", 403);
  const session = state.sessions.find((entry) => entry.id === sessionId);
  ensure(session && session.state === "running", "Session is not running", 409);
  return { auth, session };
}

function summarizeUsage(state, workspaceId) {
  const usage = {
    runtimeMinutes: 0,
    snapshots: 0,
    templateBuilds: 0
  };
  for (const event of state.usageEvents) {
    if (event.workspaceId !== workspaceId) {
      continue;
    }
    if (event.kind === "runtime_minutes") {
      usage.runtimeMinutes += event.value;
    }
    if (event.kind === "snapshot") {
      usage.snapshots += event.value;
    }
    if (event.kind === "template_build") {
      usage.templateBuilds += event.value;
    }
  }
  return usage;
}

function getActiveVersion(state, templateId) {
  const template = state.templates.find((entry) => entry.id === templateId);
  if (!template || template.archivedAt || !template.activeVersionId) {
    return null;
  }
  return state.templateVersions.find((entry) => entry.id === template.activeVersionId) || null;
}

function getRunningSessionCount(state, workspaceId) {
  return state.sessions.filter((entry) => entry.workspaceId === workspaceId && entry.state === "running").length;
}

function formatWorkspace(state, workspace, role) {
  const memberCount = state.memberships.filter((entry) => entry.workspaceId === workspace.id).length;
  return { ...workspace, role, memberCount };
}

function formatTemplate(state, template) {
  const versions = state.templateVersions
    .filter((entry) => entry.templateId === template.id)
    .map((version) => {
      const build = state.templateBuilds.find((entry) => entry.templateVersionId === version.id) || null;
      return { ...version, build };
    });
  const activeVersion = versions.find((entry) => entry.id === template.activeVersionId) || null;
  return {
    ...template,
    activeVersion,
    versions
  };
}

function formatSession(state, session) {
  const template = state.templates.find((entry) => entry.id === session.templateId);
  const events = state.sessionEvents.filter((entry) => entry.sessionId === session.id);
  const snapshots = state.snapshots.filter((entry) => entry.sessionId === session.id);
  return {
    ...session,
    templateName: template?.name || "unknown",
    eventsCount: events.length,
    snapshotCount: snapshots.length
  };
}

function buildTemplateBuildLog(build, template, templateVersion) {
  const lines = [
    `build_id=${build.id}`,
    `template_id=${template.id}`,
    `template_name=${template.name}`,
    `template_version_id=${templateVersion.id}`,
    `template_version=${templateVersion.version}`,
    `bundle_uploaded=${templateVersion.bundleUploadedAt ? "true" : "false"}`,
    `bundle_key=${templateVersion.bundleKey || ""}`,
    `build_status=${build.status}`,
    `attempts=${build.attempts}`,
    `last_error=${build.lastError || ""}`,
    `last_failure_at=${build.lastFailureAt || ""}`,
    `dead_lettered_at=${build.deadLetteredAt || ""}`,
    `started_at=${build.startedAt || ""}`,
    `finished_at=${build.finishedAt || ""}`
  ];
  return `${lines.join("\n")}\n`;
}

function getBuildFailureReason(templateVersion) {
  if (templateVersion?.manifest?.simulateFailure) {
    return "Simulated builder failure";
  }
  return null;
}

async function persistBuildLog({ objects, template, templateVersion, build, log }) {
  if (!objects?.putBuildLog) {
    return;
  }
  await objects.putBuildLog({
    workspace: { id: template.workspaceId },
    template,
    templateVersion,
    build,
    log
  });
}

async function processBuildRecord({
  state,
  clock,
  objects,
  jobs,
  build,
  template,
  templateVersion,
  source = "manual",
  actorUserId = null
}) {
  if (!["queued", "retrying"].includes(build.status)) {
    return null;
  }

  build.status = "building";
  build.startedAt = nowIso(clock);
  build.updatedAt = nowIso(clock);
  build.attempts += 1;
  templateVersion.status = "building";

  const failureReason = getBuildFailureReason(templateVersion);
  if (failureReason) {
    build.finishedAt = nowIso(clock);
    build.updatedAt = nowIso(clock);
    build.lastError = failureReason;
    build.lastFailureAt = build.finishedAt;
    templateVersion.status = "failed";
    templateVersion.builtAt = null;

    if (source === "queue" && build.attempts < MAX_BUILD_ATTEMPTS) {
      build.status = "retrying";
      if (jobs?.enqueueBuild) {
        await jobs.enqueueBuild(build.id);
      }
      writeAudit(state, clock, {
        action: "template.build_retry_scheduled",
        actorUserId,
        workspaceId: template.workspaceId,
        targetType: "template_build",
        targetId: build.id,
        details: {
          templateId: template.id,
          templateVersionId: templateVersion.id,
          source,
          attempts: build.attempts,
          maxAttempts: MAX_BUILD_ATTEMPTS,
          error: failureReason
        }
      });
    } else if (build.attempts >= MAX_BUILD_ATTEMPTS) {
      build.status = "dead_lettered";
      build.deadLetteredAt = build.finishedAt;
      writeAudit(state, clock, {
        action: "template.build_dead_lettered",
        actorUserId,
        workspaceId: template.workspaceId,
        targetType: "template_build",
        targetId: build.id,
        details: {
          templateId: template.id,
          templateVersionId: templateVersion.id,
          source,
          attempts: build.attempts,
          maxAttempts: MAX_BUILD_ATTEMPTS,
          error: failureReason
        }
      });
    } else {
      build.status = "failed";
      build.deadLetteredAt = null;
      writeAudit(state, clock, {
        action: "template.build_failed",
        actorUserId,
        workspaceId: template.workspaceId,
        targetType: "template_build",
        targetId: build.id,
        details: {
          templateId: template.id,
          templateVersionId: templateVersion.id,
          source,
          attempts: build.attempts,
          maxAttempts: MAX_BUILD_ATTEMPTS,
          error: failureReason
        }
      });
    }

    const failedBuildLog = buildTemplateBuildLog(build, template, templateVersion);
    await persistBuildLog({
      objects,
      template,
      templateVersion,
      build,
      log: failedBuildLog
    });

    return {
      ...build,
      templateId: template.id,
      templateVersionId: templateVersion.id
    };
  }

  build.status = "succeeded";
  build.finishedAt = nowIso(clock);
  build.updatedAt = nowIso(clock);
  build.lastError = null;
  build.lastFailureAt = null;
  build.deadLetteredAt = null;
  templateVersion.status = "ready";
  templateVersion.builtAt = nowIso(clock);

  const buildLog = buildTemplateBuildLog(build, template, templateVersion);
  await persistBuildLog({
    objects,
    template,
    templateVersion,
    build,
    log: buildLog
  });

  writeUsage(state, clock, {
    workspaceId: template.workspaceId,
    kind: "template_build",
    value: 1,
    details: { templateId: template.id, templateVersionId: templateVersion.id, source }
  });
  writeAudit(state, clock, {
    action: "template.build_succeeded",
    actorUserId,
    workspaceId: template.workspaceId,
    targetType: "template_build",
    targetId: build.id,
    details: { templateId: template.id, templateVersionId: templateVersion.id, source }
  });

  return {
    ...build,
    templateId: template.id,
    templateVersionId: templateVersion.id
  };
}

export function createBurstFlareService(options = {}) {
  const store = options.store || createMemoryStore();
  const clock = options.clock || (() => Date.now());
  const objects = options.objects || null;
  const jobs = options.jobs || null;

  return {
    sessionCookieName: SESSION_COOKIE,

    async registerUser({ email, name }) {
      return store.transact((state) => {
        ensure(email, "Email is required");
        let user = findUserByEmail(state, email);
        if (!user) {
          user = {
            id: createId("usr"),
            email,
            name: name || defaultNameFromEmail(email),
            recoveryCodes: [],
            createdAt: nowIso(clock)
          };
          state.users.push(user);

          const workspace = {
            id: createId("ws"),
            name: `${user.name}'s Workspace`,
            ownerUserId: user.id,
            plan: "free",
            createdAt: nowIso(clock)
          };
          state.workspaces.push(workspace);
          state.memberships.push({
            workspaceId: workspace.id,
            userId: user.id,
            role: "owner",
            createdAt: nowIso(clock)
          });
          writeAudit(state, clock, {
            action: "user.registered",
            actorUserId: user.id,
            workspaceId: workspace.id,
            targetType: "user",
            targetId: user.id,
            details: { email: user.email }
          });
        }

        const workspace = getUserWorkspace(state, user.id);
        ensure(workspace, "Workspace not found", 500);
        const sessionTokens = issueSessionTokens(state, clock, {
          userId: user.id,
          workspaceId: workspace.id,
          accessKind: "browser"
        });

        return {
          user,
          workspace: formatWorkspace(state, workspace, "owner"),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async login({ email, kind = "browser", workspaceId = null }) {
      return store.transact((state) => {
        ensure(email, "Email is required");
        const user = findUserByEmail(state, email);
        ensure(user, "User not found", 404);
        const workspace = workspaceId
          ? state.workspaces.find((entry) => entry.id === workspaceId)
          : getUserWorkspace(state, user.id);
        ensure(workspace, "Workspace not found", 404);
        const membership = getMembership(state, user.id, workspace.id);
        ensure(membership, "Unauthorized workspace", 403);

        const sessionTokens = issueSessionTokens(state, clock, {
          userId: user.id,
          workspaceId: workspace.id,
          accessKind: kind
        });

        writeAudit(state, clock, {
          action: "user.logged_in",
          actorUserId: user.id,
          workspaceId: workspace.id,
          targetType: "workspace",
          targetId: workspace.id,
          details: { kind }
        });

        return {
          user,
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async generateRecoveryCodes(token, { count = 8 } = {}) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        ensure(Number.isInteger(count) && count >= 4 && count <= 12, "Recovery code count must be between 4 and 12");
        const recoveryCodes = Array.from({ length: count }, () => ({
          code: createRecoveryCode(),
          createdAt: nowIso(clock),
          usedAt: null
        }));
        auth.user.recoveryCodes = recoveryCodes;
        writeAudit(state, clock, {
          action: "auth.recovery_codes_generated",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "user",
          targetId: auth.user.id,
          details: {
            count
          }
        });
        return {
          recoveryCodes: recoveryCodes.map((entry) => entry.code)
        };
      });
    },

    async recoverWithCode({ email, code, workspaceId = null }) {
      return store.transact((state) => {
        ensure(email, "Email is required");
        ensure(code, "Recovery code is required");
        const user = findUserByEmail(state, email);
        ensure(user, "Recovery code invalid", 401);
        const normalizedCode = String(code).trim().toUpperCase();
        const recoveryCode = getRecoveryCodes(user).find((entry) => entry.code === normalizedCode && !entry.usedAt);
        ensure(recoveryCode, "Recovery code invalid", 401);

        const workspace = workspaceId
          ? state.workspaces.find((entry) => entry.id === workspaceId)
          : getUserWorkspace(state, user.id);
        ensure(workspace, "Workspace not found", 404);
        const membership = getMembership(state, user.id, workspace.id);
        ensure(membership, "Unauthorized workspace", 403);

        recoveryCode.usedAt = nowIso(clock);
        const sessionTokens = issueSessionTokens(state, clock, {
          userId: user.id,
          workspaceId: workspace.id,
          accessKind: "browser"
        });

        writeAudit(state, clock, {
          action: "auth.recovered",
          actorUserId: user.id,
          workspaceId: workspace.id,
          targetType: "user",
          targetId: user.id
        });

        return {
          user,
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async switchWorkspace(token, workspaceId) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
        ensure(workspace, "Workspace not found", 404);
        const membership = getMembership(state, auth.user.id, workspace.id);
        ensure(membership, "Unauthorized workspace", 403);
        const sessionTokens = issueSessionTokens(state, clock, {
          userId: auth.user.id,
          workspaceId: workspace.id,
          accessKind: auth.auth.kind === "browser" ? "browser" : "api"
        });
        writeAudit(state, clock, {
          action: "workspace.switched",
          actorUserId: auth.user.id,
          workspaceId: workspace.id,
          targetType: "workspace",
          targetId: workspace.id
        });
        return {
          user: auth.user,
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async deviceStart({ email, workspaceId = null }) {
      return store.transact((state) => {
        const user = findUserByEmail(state, email);
        ensure(user, "User not found", 404);
        const workspace = workspaceId
          ? state.workspaces.find((entry) => entry.id === workspaceId)
          : getUserWorkspace(state, user.id);
        ensure(workspace, "Workspace not found", 404);
        const deviceCode = {
          id: createId("dev"),
          code: createId("device"),
          userId: user.id,
          workspaceId: workspace.id,
          status: "pending",
          createdAt: nowIso(clock),
          expiresAt: futureIso(clock, DEVICE_CODE_TTL_MS),
          approvedAt: null
        };
        state.deviceCodes.push(deviceCode);
        writeAudit(state, clock, {
          action: "device.started",
          actorUserId: user.id,
          workspaceId: workspace.id,
          targetType: "device_code",
          targetId: deviceCode.id
        });
        return {
          deviceCode: deviceCode.code,
          verificationUri: `/device?code=${deviceCode.code}`,
          expiresAt: deviceCode.expiresAt
        };
      });
    },

    async deviceApprove(browserToken, deviceCodeValue) {
      return store.transact((state) => {
        const auth = requireAuth(state, browserToken, clock);
        const deviceCode = state.deviceCodes.find((entry) => entry.code === deviceCodeValue);
        ensure(deviceCode, "Device code not found", 404);
        ensure(deviceCode.workspaceId === auth.workspace.id, "Workspace mismatch", 403);
        deviceCode.status = "approved";
        deviceCode.approvedAt = nowIso(clock);
        writeAudit(state, clock, {
          action: "device.approved",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "device_code",
          targetId: deviceCode.id
        });
        return {
          ok: true,
          deviceCode: deviceCode.code
        };
      });
    },

    async deviceExchange(deviceCodeValue) {
      return store.transact((state) => {
        const deviceCode = state.deviceCodes.find((entry) => entry.code === deviceCodeValue);
        ensure(deviceCode, "Device code not found", 404);
        ensure(new Date(deviceCode.expiresAt).getTime() > nowMs(clock), "Device code expired", 400);
        ensure(deviceCode.status === "approved", "Device code not approved", 409);
        deviceCode.status = "exchanged";

        const sessionTokens = issueSessionTokens(state, clock, {
          userId: deviceCode.userId,
          workspaceId: deviceCode.workspaceId,
          accessKind: "api"
        });
        const user = findUserById(state, deviceCode.userId);
        const workspace = state.workspaces.find((entry) => entry.id === deviceCode.workspaceId);
        ensure(user && workspace, "User or workspace missing", 500);
        const membership = getMembership(state, user.id, workspace.id);
        ensure(membership, "Unauthorized workspace", 403);

        writeAudit(state, clock, {
          action: "device.exchanged",
          actorUserId: user.id,
          workspaceId: workspace.id,
          targetType: "device_code",
          targetId: deviceCode.id
        });

        return {
          user,
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async refreshSession(refreshTokenValue) {
      return store.transact((state) => {
        const refreshRecord = getTokenRecord(state, refreshTokenValue);
        ensure(refreshRecord && new Date(refreshRecord.expiresAt).getTime() > nowMs(clock), "Unauthorized", 401);
        ensure(refreshRecord.kind === "refresh", "Refresh token required", 401);
        const user = findUserById(state, refreshRecord.userId);
        const workspace = state.workspaces.find((entry) => entry.id === refreshRecord.workspaceId);
        ensure(user && workspace, "Unauthorized", 401);
        const membership = getMembership(state, user.id, workspace.id);
        ensure(membership, "Unauthorized", 401);

        refreshRecord.revokedAt = nowIso(clock);
        const sessionTokens = issueSessionTokens(state, clock, {
          userId: user.id,
          workspaceId: workspace.id,
          accessKind: refreshRecord.grantKind || "api"
        });

        writeAudit(state, clock, {
          action: "auth.refreshed",
          actorUserId: user.id,
          workspaceId: workspace.id,
          targetType: "auth_token",
          targetId: refreshRecord.id,
          details: { grantKind: refreshRecord.grantKind || "api" }
        });

        return {
          user,
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async logout(token, refreshTokenValue = null) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        auth.auth.revokedAt = nowIso(clock);
        let revokedRefreshTokens = 0;
        for (const record of state.authTokens) {
          const isMatchingRefresh =
            record.kind === "refresh" &&
            record.userId === auth.user.id &&
            record.workspaceId === auth.workspace.id &&
            record.grantKind === auth.auth.kind &&
            !record.revokedAt;
          const isExplicitRefresh = refreshTokenValue && record.token === refreshTokenValue && !record.revokedAt;
          if (isMatchingRefresh || isExplicitRefresh) {
            record.revokedAt = nowIso(clock);
            revokedRefreshTokens += 1;
          }
        }
        writeAudit(state, clock, {
          action: "auth.logged_out",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "auth_token",
          targetId: auth.auth.id,
          details: {
            revokedRefreshTokens
          }
        });
        return {
          ok: true,
          revokedAccessToken: auth.auth.id,
          revokedRefreshTokens
        };
      });
    },

    async logoutAllSessions(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const revokedAt = nowIso(clock);
        let revokedTokens = 0;
        for (const record of state.authTokens) {
          if (record.userId !== auth.user.id || record.revokedAt || record.kind === "runtime") {
            continue;
          }
          record.revokedAt = revokedAt;
          revokedTokens += 1;
        }
        writeAudit(state, clock, {
          action: "auth.logout_all",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "user",
          targetId: auth.user.id,
          details: {
            revokedTokens
          }
        });
        return {
          ok: true,
          revokedTokens
        };
      });
    },

    async listAuthSessions(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const groups = new Map();
        for (const record of state.authTokens) {
          if (record.userId !== auth.user.id || record.kind === "runtime" || record.revokedAt) {
            continue;
          }
          const groupId = record.sessionGroupId || record.id;
          const current = (auth.auth.sessionGroupId || auth.auth.id) === groupId;
          const existing = groups.get(groupId) || {
            id: groupId,
            workspaceId: record.workspaceId,
            createdAt: record.createdAt,
            expiresAt: record.expiresAt,
            current,
            tokenKinds: new Set(),
            tokenCount: 0
          };
          existing.workspaceId = record.workspaceId;
          existing.current = existing.current || current;
          if (new Date(record.createdAt).getTime() < new Date(existing.createdAt).getTime()) {
            existing.createdAt = record.createdAt;
          }
          if (new Date(record.expiresAt).getTime() > new Date(existing.expiresAt).getTime()) {
            existing.expiresAt = record.expiresAt;
          }
          existing.tokenKinds.add(record.kind);
          existing.tokenCount += 1;
          groups.set(groupId, existing);
        }
        return {
          sessions: Array.from(groups.values())
            .map((entry) => ({
              ...entry,
              tokenKinds: Array.from(entry.tokenKinds).sort()
            }))
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        };
      });
    },

    async revokeAuthSession(token, authSessionId) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        ensure(authSessionId, "Auth session id is required");
        let revokedTokens = 0;
        for (const record of state.authTokens) {
          if (record.userId !== auth.user.id || record.kind === "runtime" || record.revokedAt) {
            continue;
          }
          if (record.sessionGroupId === authSessionId || record.id === authSessionId) {
            record.revokedAt = nowIso(clock);
            revokedTokens += 1;
          }
        }
        ensure(revokedTokens > 0, "Auth session not found", 404);
        writeAudit(state, clock, {
          action: "auth.session_revoked",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "auth_session",
          targetId: authSessionId,
          details: {
            revokedTokens
          }
        });
        return {
          ok: true,
          authSessionId,
          revokedTokens
        };
      });
    },

    async authenticate(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const pendingDeviceCodes = state.deviceCodes.filter(
          (entry) =>
            entry.workspaceId === auth.workspace.id &&
            entry.status === "pending" &&
            new Date(entry.expiresAt).getTime() > nowMs(clock)
        ).length;
        return {
          user: auth.user,
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          membership: auth.membership,
          usage: summarizeUsage(state, auth.workspace.id),
          limits: getPlan(auth.workspace.plan),
          pendingDeviceCodes
        };
      });
    },

    async listWorkspaces(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const workspaces = state.memberships
          .filter((entry) => entry.userId === auth.user.id)
          .map((entry) => {
            const workspace = state.workspaces.find((candidate) => candidate.id === entry.workspaceId);
            return workspace ? formatWorkspace(state, workspace, entry.role) : null;
          })
          .filter(Boolean);
        return { workspaces };
      });
    },

    async listWorkspaceMembers(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const members = state.memberships
          .filter((entry) => entry.workspaceId === auth.workspace.id)
          .map((entry) => ({
            ...entry,
            user: findUserById(state, entry.userId)
          }));
        const invites = state.workspaceInvites.filter(
          (entry) =>
            entry.workspaceId === auth.workspace.id &&
            entry.status === "pending" &&
            new Date(entry.expiresAt).getTime() > nowMs(clock)
        );
        return { members, invites };
      });
    },

    async createWorkspaceInvite(token, { email, role = "member" }) {
      return store.transact((state) => {
        const auth = requireManageWorkspace(state, token, clock);
        ensure(email, "Email is required");
        ensure(["admin", "member", "viewer"].includes(role), "Invalid role");
        const existing = findUserByEmail(state, email);
        if (existing) {
          ensure(!getMembership(state, existing.id, auth.workspace.id), "User is already a member", 409);
        }
        const invite = {
          id: createId("inv"),
          code: createId("invite"),
          workspaceId: auth.workspace.id,
          email: email.toLowerCase(),
          role,
          status: "pending",
          createdByUserId: auth.user.id,
          createdAt: nowIso(clock),
          expiresAt: futureIso(clock, TOKEN_TTL_MS)
        };
        state.workspaceInvites.push(invite);
        writeAudit(state, clock, {
          action: "workspace.invite_created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace_invite",
          targetId: invite.id,
          details: { email: invite.email, role }
        });
        return { invite };
      });
    },

    async acceptWorkspaceInvite(token, inviteCode) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const invite = state.workspaceInvites.find((entry) => entry.code === inviteCode);
        ensure(invite, "Invite not found", 404);
        ensure(invite.status === "pending", "Invite already used", 409);
        ensure(new Date(invite.expiresAt).getTime() > nowMs(clock), "Invite expired", 400);
        ensure(invite.email === auth.user.email.toLowerCase(), "Invite email mismatch", 403);
        ensure(!getMembership(state, auth.user.id, invite.workspaceId), "Already joined", 409);

        invite.status = "accepted";
        invite.acceptedAt = nowIso(clock);
        state.memberships.push({
          workspaceId: invite.workspaceId,
          userId: auth.user.id,
          role: invite.role,
          createdAt: nowIso(clock)
        });
        const workspace = state.workspaces.find((entry) => entry.id === invite.workspaceId);
        ensure(workspace, "Workspace missing", 500);
        writeAudit(state, clock, {
          action: "workspace.invite_accepted",
          actorUserId: auth.user.id,
          workspaceId: invite.workspaceId,
          targetType: "workspace_invite",
          targetId: invite.id
        });
        return {
          workspace: formatWorkspace(state, workspace, invite.role)
        };
      });
    },

    async updateWorkspaceMemberRole(token, userId, role) {
      return store.transact((state) => {
        const auth = requireManageWorkspace(state, token, clock);
        ensure(["admin", "member", "viewer"].includes(role), "Invalid role");
        const membership = getMembership(state, userId, auth.workspace.id);
        ensure(membership, "Membership not found", 404);
        ensure(membership.role !== "owner", "Cannot change owner role", 409);
        membership.role = role;
        writeAudit(state, clock, {
          action: "workspace.member_role_updated",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace_membership",
          targetId: `${auth.workspace.id}:${userId}`,
          details: { role }
        });
        return { membership };
      });
    },

    async setWorkspacePlan(token, plan) {
      return store.transact((state) => {
        const auth = requireManageWorkspace(state, token, clock);
        ensure(PLANS[plan], "Invalid plan");
        auth.workspace.plan = plan;
        writeAudit(state, clock, {
          action: "workspace.plan_updated",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace",
          targetId: auth.workspace.id,
          details: { plan }
        });
        return {
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          limits: getPlan(plan)
        };
      });
    },

    async updateWorkspaceSettings(token, { name }) {
      return store.transact((state) => {
        const auth = requireManageWorkspace(state, token, clock);
        ensure(typeof name === "string" && name.trim(), "Workspace name is required");
        const nextName = name.trim();
        ensure(nextName.length >= 3, "Workspace name must be at least 3 characters");
        ensure(nextName.length <= 80, "Workspace name is too long");
        auth.workspace.name = nextName;
        writeAudit(state, clock, {
          action: "workspace.updated",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace",
          targetId: auth.workspace.id,
          details: {
            name: nextName
          }
        });
        return {
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role)
        };
      });
    },

    async createTemplate(token, { name, description = "" }) {
      return store.transact((state) => {
        const auth = requireWriteAccess(state, token, clock);
        ensure(name, "Template name is required");
        ensure(
          state.templates.filter((entry) => entry.workspaceId === auth.workspace.id).length < getPlan(auth.workspace.plan).maxTemplates,
          "Template limit reached",
          403
        );
        ensure(
          !state.templates.some(
            (entry) => entry.workspaceId === auth.workspace.id && entry.name.toLowerCase() === name.toLowerCase()
          ),
          "Template name already exists"
        );

        const template = {
          id: createId("tpl"),
          workspaceId: auth.workspace.id,
          name,
          description,
          activeVersionId: null,
          archivedAt: null,
          archivedByUserId: null,
          createdByUserId: auth.user.id,
          createdAt: nowIso(clock)
        };
        state.templates.push(template);
        writeAudit(state, clock, {
          action: "template.created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template",
          targetId: template.id,
          details: { name }
        });
        return { template: formatTemplate(state, template) };
      });
    },

    async archiveTemplate(token, templateId) {
      return store.transact((state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canManageWorkspace(auth.membership.role), "Insufficient permissions", 403);
        ensure(!auth.template.archivedAt, "Template already archived", 409);
        auth.template.archivedAt = nowIso(clock);
        auth.template.archivedByUserId = auth.user.id;
        writeAudit(state, clock, {
          action: "template.archived",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template",
          targetId: auth.template.id
        });
        return {
          template: formatTemplate(state, auth.template)
        };
      });
    },

    async restoreTemplate(token, templateId) {
      return store.transact((state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canManageWorkspace(auth.membership.role), "Insufficient permissions", 403);
        ensure(auth.template.archivedAt, "Template is not archived", 409);
        auth.template.archivedAt = null;
        auth.template.archivedByUserId = null;
        writeAudit(state, clock, {
          action: "template.restored",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template",
          targetId: auth.template.id
        });
        return {
          template: formatTemplate(state, auth.template)
        };
      });
    },

    async deleteTemplate(token, templateId) {
      return store.transact(async (state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canManageWorkspace(auth.membership.role), "Insufficient permissions", 403);
        ensure(
          !state.sessions.some((entry) => entry.templateId === auth.template.id && entry.state !== "deleted"),
          "Template still has active sessions",
          409
        );

        const templateVersions = state.templateVersions.filter((entry) => entry.templateId === auth.template.id);
        const templateVersionIds = new Set(templateVersions.map((entry) => entry.id));

        for (const templateVersion of templateVersions) {
          if (objects?.deleteTemplateVersionBundle) {
            await objects.deleteTemplateVersionBundle({
              workspace: auth.workspace,
              template: auth.template,
              templateVersion
            });
          }
          if (objects?.deleteBuildLog) {
            await objects.deleteBuildLog({
              workspace: auth.workspace,
              template: auth.template,
              templateVersion
            });
          }
        }

        const deletedBuilds = state.templateBuilds.filter((entry) => templateVersionIds.has(entry.templateVersionId)).length;
        const deletedReleases = state.bindingReleases.filter((entry) => entry.templateId === auth.template.id).length;

        state.templates = state.templates.filter((entry) => entry.id !== auth.template.id);
        state.templateVersions = state.templateVersions.filter((entry) => !templateVersionIds.has(entry.id));
        state.templateBuilds = state.templateBuilds.filter((entry) => !templateVersionIds.has(entry.templateVersionId));
        state.bindingReleases = state.bindingReleases.filter((entry) => entry.templateId !== auth.template.id);
        state.uploadGrants = getUploadGrants(state).filter(
          (entry) => entry.templateId !== auth.template.id && !templateVersionIds.has(entry.templateVersionId)
        );

        writeAudit(state, clock, {
          action: "template.deleted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template",
          targetId: auth.template.id,
          details: {
            deletedVersions: templateVersions.length,
            deletedBuilds,
            deletedReleases
          }
        });

        return {
          ok: true,
          templateId: auth.template.id,
          deletedVersions: templateVersions.length,
          deletedBuilds,
          deletedReleases
        };
      });
    },

    async listTemplates(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const templates = state.templates
          .filter((entry) => entry.workspaceId === auth.workspace.id)
          .map((template) => formatTemplate(state, template));
        return { templates };
      });
    },

    async listTemplateBuilds(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const builds = state.templateBuilds
          .map((build) => {
            const version = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
            if (!version) {
              return null;
            }
            const template = state.templates.find((entry) => entry.id === version.templateId);
            if (!template || template.workspaceId !== auth.workspace.id) {
              return null;
            }
            return {
              ...build,
              templateId: template.id,
              templateName: template.name,
              templateVersion: version.version,
              templateVersionId: version.id,
              versionStatus: version.status
            };
          })
          .filter(Boolean)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        return { builds };
      });
    },

    async addTemplateVersion(token, templateId, { version, manifest = {}, notes = "" }) {
      return store.transact(async (state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canWrite(auth.membership.role), "Insufficient permissions", 403);
        ensure(version, "Version is required");
        validateTemplateManifest(manifest);
        ensure(
          !state.templateVersions.some((entry) => entry.templateId === templateId && entry.version === version),
          "Version already exists"
        );

        const templateVersion = {
          id: createId("tplv"),
          templateId,
          version,
          status: "queued",
          notes,
          manifest,
          bundleKey: null,
          bundleUploadedAt: null,
          bundleContentType: null,
          bundleBytes: 0,
          buildLogKey: `builds/${templateId}/${version}.log`,
          createdAt: nowIso(clock),
          builtAt: null
        };
        const build = {
          id: createId("bld"),
          templateVersionId: templateVersion.id,
          status: "queued",
          builderImage: "burstflare/builder:local",
          attempts: 0,
          lastError: null,
          lastFailureAt: null,
          deadLetteredAt: null,
          createdAt: nowIso(clock),
          updatedAt: nowIso(clock),
          startedAt: null,
          finishedAt: null
        };

        state.templateVersions.push(templateVersion);
        state.templateBuilds.push(build);
        writeAudit(state, clock, {
          action: "template.version_added",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template_version",
          targetId: templateVersion.id,
          details: { version }
        });

        if (jobs?.enqueueBuild) {
          await jobs.enqueueBuild(build.id);
        }

        return { templateVersion, build };
      });
    },

    async uploadTemplateVersionBundle(token, templateId, versionId, { body, contentType = "application/octet-stream" } = {}) {
      return store.transact(async (state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canWrite(auth.membership.role), "Insufficient permissions", 403);
        const templateVersion = state.templateVersions.find((entry) => entry.id === versionId && entry.templateId === templateId);
        ensure(templateVersion, "Template version not found", 404);
        return storeTemplateBundleUpload({
          state,
          clock,
          objects,
          workspace: auth.workspace,
          template: auth.template,
          templateVersion,
          actorUserId: auth.user.id,
          body,
          contentType
        });
      });
    },

    async createTemplateVersionBundleUploadGrant(
      token,
      templateId,
      versionId,
      { contentType = "application/octet-stream", bytes = null } = {}
    ) {
      return store.transact((state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canWrite(auth.membership.role), "Insufficient permissions", 403);
        const templateVersion = state.templateVersions.find((entry) => entry.id === versionId && entry.templateId === templateId);
        ensure(templateVersion, "Template version not found", 404);
        if (bytes !== null) {
          ensure(Number.isInteger(bytes) && bytes > 0, "Upload bytes must be a positive integer");
          ensure(bytes <= MAX_TEMPLATE_BUNDLE_BYTES, "Bundle exceeds size limit", 413);
        }

        const uploadGrant = createUploadGrant(state, clock, {
          kind: "template_bundle",
          workspaceId: auth.workspace.id,
          templateId: auth.template.id,
          templateVersionId: templateVersion.id,
          actorUserId: auth.user.id,
          contentType,
          expectedBytes: bytes
        });

        writeAudit(state, clock, {
          action: "template.bundle_upload_grant_created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template_version",
          targetId: templateVersion.id,
          details: {
            contentType,
            bytes,
            uploadGrantId: uploadGrant.id
          }
        });

        return {
          uploadGrant: {
            id: uploadGrant.id,
            method: "PUT",
            expiresAt: uploadGrant.expiresAt,
            contentType: uploadGrant.contentType,
            expectedBytes: uploadGrant.expectedBytes
          }
        };
      });
    },

    async getTemplateVersionBundle(token, templateId, versionId) {
      return store.transact(async (state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        const templateVersion = state.templateVersions.find((entry) => entry.id === versionId && entry.templateId === templateId);
        ensure(templateVersion, "Template version not found", 404);
        ensure(templateVersion.bundleUploadedAt, "Template bundle not uploaded", 404);

        if (objects?.getTemplateVersionBundle) {
          const bundle = await objects.getTemplateVersionBundle({
            workspace: auth.workspace,
            template: auth.template,
            templateVersion
          });
          ensure(bundle, "Template bundle not found", 404);
          return {
            body: bundle.body,
            contentType: bundle.contentType || templateVersion.bundleContentType || "application/octet-stream",
            bytes: bundle.bytes ?? templateVersion.bundleBytes,
            fileName: `${templateVersion.version}.bundle`
          };
        }

        const fallbackBody = JSON.stringify({ manifest: templateVersion.manifest }, null, 2);
        return {
          body: fallbackBody,
          contentType: "application/json; charset=utf-8",
          bytes: fallbackBody.length,
          fileName: `${templateVersion.version}.json`
        };
      });
    },

    async processTemplateBuilds(token) {
      return store.transact(async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const builds = [];
        for (const build of state.templateBuilds) {
          const version = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
          if (!version) {
            continue;
          }
          const template = state.templates.find((entry) => entry.id === version.templateId);
          if (!template || template.workspaceId !== auth.workspace.id) {
            continue;
          }
          const processedBuild = await processBuildRecord({
            state,
            clock,
            objects,
            jobs,
            build,
            template,
            templateVersion: version,
            source: "manual",
            actorUserId: auth.user.id
          });
          if (processedBuild) {
            builds.push(processedBuild);
          }
        }
        return { builds, processed: builds.length };
      });
    },

    async processTemplateBuildById(buildId, { source = "queue", actorUserId = null } = {}) {
      return store.transact(async (state) => {
        const build = state.templateBuilds.find((entry) => entry.id === buildId);
        ensure(build, "Build not found", 404);
        const templateVersion = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
        ensure(templateVersion, "Template version missing", 404);
        const template = state.templates.find((entry) => entry.id === templateVersion.templateId);
        ensure(template, "Template missing", 404);

        const processedBuild = await processBuildRecord({
          state,
          clock,
          objects,
          jobs,
          build,
          template,
          templateVersion,
          source,
          actorUserId
        });

        return {
          build: processedBuild,
          processed: processedBuild ? 1 : 0
        };
      });
    },

    async getTemplateBuildLog(token, buildId) {
      return store.transact(async (state) => {
        const auth = requireAuth(state, token, clock);
        const build = state.templateBuilds.find((entry) => entry.id === buildId);
        ensure(build, "Build not found", 404);
        const templateVersion = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
        ensure(templateVersion, "Template version missing", 404);
        const template = state.templates.find((entry) => entry.id === templateVersion.templateId);
        ensure(template && template.workspaceId === auth.workspace.id, "Build not found", 404);

        if (objects?.getBuildLog) {
          const log = await objects.getBuildLog({
            workspace: auth.workspace,
            template,
            templateVersion,
            build
          });
          if (log?.text) {
            return {
              buildId,
              buildLogKey: templateVersion.buildLogKey,
              contentType: log.contentType || "text/plain; charset=utf-8",
              text: log.text
            };
          }
        }

        return {
          buildId,
          buildLogKey: templateVersion.buildLogKey,
          contentType: "text/plain; charset=utf-8",
          text: buildTemplateBuildLog(build, template, templateVersion)
        };
      });
    },

    async retryTemplateBuild(token, buildId) {
      return store.transact(async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const build = state.templateBuilds.find((entry) => entry.id === buildId);
        ensure(build, "Build not found", 404);
        const version = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
        ensure(version, "Template version missing", 404);
        const template = state.templates.find((entry) => entry.id === version.templateId);
        ensure(template && template.workspaceId === auth.workspace.id, "Build not found", 404);
        ensure(["failed", "dead_lettered"].includes(build.status), "Build is not retryable", 409);
        build.status = "retrying";
        build.updatedAt = nowIso(clock);
        build.deadLetteredAt = null;
        version.status = "queued";
        writeAudit(state, clock, {
          action: "template.build_retried",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template_build",
          targetId: build.id
        });
        if (jobs?.enqueueBuild) {
          await jobs.enqueueBuild(build.id);
        }
        return { build };
      });
    },

    async promoteTemplateVersion(token, templateId, versionId) {
      return store.transact((state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canManageWorkspace(auth.membership.role), "Insufficient permissions", 403);
        const version = state.templateVersions.find((entry) => entry.id === versionId && entry.templateId === templateId);
        ensure(version, "Template version not found", 404);
        ensure(version.status === "ready", "Template version is not build-ready", 409);
        auth.template.activeVersionId = version.id;
        const release = writeBindingRelease(state, clock, auth.workspace.id, auth.template.id, version.id);
        writeAudit(state, clock, {
          action: "template.promoted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template",
          targetId: auth.template.id,
          details: { versionId, releaseId: release.id }
        });
        return {
          template: formatTemplate(state, auth.template),
          activeVersion: version,
          release
        };
      });
    },

    async listBindingReleases(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const releases = state.bindingReleases
          .filter((entry) => entry.workspaceId === auth.workspace.id)
          .map((entry) => {
            const version = state.templateVersions.find((candidate) => candidate.id === entry.templateVersionId);
            const template = state.templates.find((candidate) => candidate.id === entry.templateId);
            return {
              ...entry,
              templateName: template?.name || "unknown",
              version: version?.version || "unknown"
            };
          });
        return { releases };
      });
    },

    async createSession(token, { name, templateId }) {
      return store.transact((state) => {
        const auth = requireWriteAccess(state, token, clock);
        ensure(name, "Session name is required");
        const template = state.templates.find((entry) => entry.id === templateId && entry.workspaceId === auth.workspace.id);
        ensure(template, "Template not found", 404);
        ensure(!template.archivedAt, "Template is archived", 409);
        const activeVersion = getActiveVersion(state, template.id);
        ensure(activeVersion, "Template has no promoted version", 409);
        ensure(
          !state.sessions.some(
            (entry) => entry.workspaceId === auth.workspace.id && entry.name.toLowerCase() === name.toLowerCase() && entry.state !== "deleted"
          ),
          "Session name already exists",
          409
        );

        const session = {
          id: createId("ses"),
          workspaceId: auth.workspace.id,
          templateId: template.id,
          name,
          state: "created",
          createdByUserId: auth.user.id,
          createdAt: nowIso(clock),
          updatedAt: nowIso(clock),
          lastStartedAt: null,
          lastStoppedAt: null,
          sleepTtlSeconds: activeVersion.manifest?.sleepTtlSeconds || null,
          previewUrl: null
        };
        session.previewUrl = `/runtime/sessions/${session.id}/preview`;
        state.sessions.push(session);
        writeSessionEvent(state, clock, session.id, "created");
        writeAudit(state, clock, {
          action: "session.created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "session",
          targetId: session.id,
          details: { name, templateId }
        });
        return { session: formatSession(state, session) };
      });
    },

    async startSession(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        ensure(["created", "sleeping"].includes(auth.session.state), "Session cannot be started", 409);
        const runningCount = getRunningSessionCount(state, auth.workspace.id);
        ensure(runningCount < getPlan(auth.workspace.plan).maxRunningSessions, "Running session limit reached", 403);

        auth.session.state = "starting";
        auth.session.updatedAt = nowIso(clock);
        writeSessionEvent(state, clock, auth.session.id, "starting");

        auth.session.state = "running";
        auth.session.lastStartedAt = nowIso(clock);
        auth.session.updatedAt = nowIso(clock);
        writeSessionEvent(state, clock, auth.session.id, "running");
        writeUsage(state, clock, {
          workspaceId: auth.workspace.id,
          kind: "runtime_minutes",
          value: 1,
          details: { sessionId }
        });
        writeAudit(state, clock, {
          action: "session.started",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "session",
          targetId: auth.session.id
        });
        return { session: formatSession(state, auth.session) };
      });
    },

    async stopSession(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        ensure(["running", "starting"].includes(auth.session.state), "Session cannot be stopped", 409);
        auth.session.state = "stopping";
        auth.session.updatedAt = nowIso(clock);
        writeSessionEvent(state, clock, auth.session.id, "stopping");

        auth.session.state = "sleeping";
        auth.session.lastStoppedAt = nowIso(clock);
        auth.session.updatedAt = nowIso(clock);
        writeSessionEvent(state, clock, auth.session.id, "sleeping");
        writeAudit(state, clock, {
          action: "session.stopped",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "session",
          targetId: auth.session.id
        });
        return { session: formatSession(state, auth.session) };
      });
    },

    async restartSession(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        if (auth.session.state === "running") {
          auth.session.state = "stopping";
          auth.session.updatedAt = nowIso(clock);
          writeSessionEvent(state, clock, auth.session.id, "stopping", { reason: "restart" });
          auth.session.state = "sleeping";
          auth.session.lastStoppedAt = nowIso(clock);
          auth.session.updatedAt = nowIso(clock);
          writeSessionEvent(state, clock, auth.session.id, "sleeping", { reason: "restart" });
        }
        ensure(["created", "sleeping"].includes(auth.session.state), "Session cannot be restarted", 409);
        const runningCount = getRunningSessionCount(state, auth.workspace.id);
        ensure(runningCount < getPlan(auth.workspace.plan).maxRunningSessions, "Running session limit reached", 403);
        auth.session.state = "starting";
        auth.session.updatedAt = nowIso(clock);
        writeSessionEvent(state, clock, auth.session.id, "starting", { reason: "restart" });
        auth.session.state = "running";
        auth.session.lastStartedAt = nowIso(clock);
        auth.session.updatedAt = nowIso(clock);
        writeSessionEvent(state, clock, auth.session.id, "running", { reason: "restart" });
        writeUsage(state, clock, {
          workspaceId: auth.workspace.id,
          kind: "runtime_minutes",
          value: 1,
          details: { sessionId, restart: true }
        });
        writeAudit(state, clock, {
          action: "session.restarted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "session",
          targetId: auth.session.id
        });
        return { session: formatSession(state, auth.session) };
      });
    },

    async deleteSession(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        auth.session.state = "deleted";
        auth.session.updatedAt = nowIso(clock);
        writeSessionEvent(state, clock, auth.session.id, "deleted");
        writeAudit(state, clock, {
          action: "session.deleted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "session",
          targetId: auth.session.id
        });
        return { session: formatSession(state, auth.session) };
      });
    },

    async listSessions(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const sessions = state.sessions
          .filter((entry) => entry.workspaceId === auth.workspace.id && entry.state !== "deleted")
          .map((session) => formatSession(state, session));
        return { sessions };
      });
    },

    async listSessionEvents(token, sessionId) {
      return store.transact((state) => {
        requireSessionAccess(state, token, sessionId, clock);
        const events = state.sessionEvents.filter((entry) => entry.sessionId === sessionId);
        return { events };
      });
    },

    async getSession(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        const snapshots = state.snapshots.filter((entry) => entry.sessionId === auth.session.id);
        const events = state.sessionEvents.filter((entry) => entry.sessionId === auth.session.id);
        return {
          session: formatSession(state, auth.session),
          snapshots,
          events
        };
      });
    },

    async createSnapshot(token, sessionId, { label = "manual" }) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        const snapshot = {
          id: createId("snap"),
          sessionId: auth.session.id,
          label,
          objectKey: `snapshots/${auth.workspace.id}/${auth.session.id}/${createId("obj")}.bin`,
          uploadedAt: null,
          contentType: null,
          bytes: 0,
          inlineContentBase64: null,
          createdAt: nowIso(clock)
        };
        state.snapshots.push(snapshot);
        writeUsage(state, clock, {
          workspaceId: auth.workspace.id,
          kind: "snapshot",
          value: 1,
          details: { sessionId }
        });
        writeAudit(state, clock, {
          action: "snapshot.created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "snapshot",
          targetId: snapshot.id,
          details: { label }
        });
        return { snapshot };
      });
    },

    async uploadSnapshotContent(token, sessionId, snapshotId, { body, contentType = "application/octet-stream" } = {}) {
      return store.transact(async (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        const snapshot = state.snapshots.find((entry) => entry.id === snapshotId && entry.sessionId === auth.session.id);
        ensure(snapshot, "Snapshot not found", 404);
        return storeSnapshotUpload({
          state,
          clock,
          objects,
          workspace: auth.workspace,
          session: auth.session,
          snapshot,
          actorUserId: auth.user.id,
          body,
          contentType
        });
      });
    },

    async createSnapshotUploadGrant(
      token,
      sessionId,
      snapshotId,
      { contentType = "application/octet-stream", bytes = null } = {}
    ) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        const snapshot = state.snapshots.find((entry) => entry.id === snapshotId && entry.sessionId === auth.session.id);
        ensure(snapshot, "Snapshot not found", 404);
        if (bytes !== null) {
          ensure(Number.isInteger(bytes) && bytes > 0, "Upload bytes must be a positive integer");
          ensure(bytes <= MAX_SNAPSHOT_BYTES, "Snapshot exceeds size limit", 413);
        }

        const uploadGrant = createUploadGrant(state, clock, {
          kind: "snapshot",
          workspaceId: auth.workspace.id,
          sessionId: auth.session.id,
          snapshotId: snapshot.id,
          actorUserId: auth.user.id,
          contentType,
          expectedBytes: bytes
        });

        writeAudit(state, clock, {
          action: "snapshot.upload_grant_created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "snapshot",
          targetId: snapshot.id,
          details: {
            contentType,
            bytes,
            uploadGrantId: uploadGrant.id
          }
        });

        return {
          uploadGrant: {
            id: uploadGrant.id,
            method: "PUT",
            expiresAt: uploadGrant.expiresAt,
            contentType: uploadGrant.contentType,
            expectedBytes: uploadGrant.expectedBytes
          }
        };
      });
    },

    async consumeUploadGrant(grantId, { body, contentType = "application/octet-stream" } = {}) {
      return store.transact(async (state) => {
        const grants = pruneUploadGrants(state, clock);
        const uploadGrant = grants.find((entry) => entry.id === grantId);
        ensure(uploadGrant, "Upload grant not found", 404);

        const payload = toUint8Array(body);
        ensure(payload.byteLength > 0, "Upload body is required");
        if (uploadGrant.expectedBytes !== null && uploadGrant.expectedBytes !== undefined) {
          ensure(payload.byteLength === uploadGrant.expectedBytes, "Upload body size does not match grant");
        }

        uploadGrant.usedAt = nowIso(clock);
        const effectiveContentType = contentType || uploadGrant.contentType || "application/octet-stream";

        if (uploadGrant.kind === "template_bundle") {
          const workspace = state.workspaces.find((entry) => entry.id === uploadGrant.workspaceId);
          ensure(workspace, "Workspace not found", 404);
          const template = state.templates.find(
            (entry) => entry.id === uploadGrant.templateId && entry.workspaceId === uploadGrant.workspaceId
          );
          ensure(template, "Template not found", 404);
          const templateVersion = state.templateVersions.find(
            (entry) => entry.id === uploadGrant.templateVersionId && entry.templateId === template.id
          );
          ensure(templateVersion, "Template version not found", 404);
          const uploaded = await storeTemplateBundleUpload({
            state,
            clock,
            objects,
            workspace,
            template,
            templateVersion,
            actorUserId: uploadGrant.actorUserId,
            body: payload,
            contentType: effectiveContentType
          });
          return {
            target: "template_bundle",
            ...uploaded
          };
        }

        if (uploadGrant.kind === "snapshot") {
          const workspace = state.workspaces.find((entry) => entry.id === uploadGrant.workspaceId);
          ensure(workspace, "Workspace not found", 404);
          const session = state.sessions.find(
            (entry) => entry.id === uploadGrant.sessionId && entry.workspaceId === uploadGrant.workspaceId
          );
          ensure(session, "Session not found", 404);
          ensure(session.state !== "deleted", "Session deleted", 409);
          const snapshot = state.snapshots.find(
            (entry) => entry.id === uploadGrant.snapshotId && entry.sessionId === session.id
          );
          ensure(snapshot, "Snapshot not found", 404);
          const uploaded = await storeSnapshotUpload({
            state,
            clock,
            objects,
            workspace,
            session,
            snapshot,
            actorUserId: uploadGrant.actorUserId,
            body: payload,
            contentType: effectiveContentType
          });
          return {
            target: "snapshot",
            ...uploaded
          };
        }

        ensure(false, "Upload grant not supported", 400);
      });
    },

    async listSnapshots(token, sessionId) {
      return store.transact((state) => {
        requireSessionAccess(state, token, sessionId, clock);
        return {
          snapshots: state.snapshots.filter((entry) => entry.sessionId === sessionId)
        };
      });
    },

    async getSnapshotContent(token, sessionId, snapshotId) {
      return store.transact(async (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        const snapshot = state.snapshots.find((entry) => entry.id === snapshotId && entry.sessionId === auth.session.id);
        ensure(snapshot, "Snapshot not found", 404);
        ensure(snapshot.uploadedAt, "Snapshot content not uploaded", 404);

        if (objects?.getSnapshot) {
          const content = await objects.getSnapshot({
            workspace: auth.workspace,
            session: auth.session,
            snapshot
          });
          ensure(content, "Snapshot content not found", 404);
          return {
            body: content.body,
            contentType: content.contentType || snapshot.contentType || "application/octet-stream",
            bytes: content.bytes ?? snapshot.bytes,
            fileName: `${snapshot.label || snapshot.id}.snapshot`
          };
        }

        ensure(snapshot.inlineContentBase64, "Snapshot content not found", 404);
        return {
          body: fromBase64(snapshot.inlineContentBase64),
          contentType: snapshot.contentType || "application/octet-stream",
          bytes: snapshot.bytes,
          fileName: `${snapshot.label || snapshot.id}.snapshot`
        };
      });
    },

    async deleteSnapshot(token, sessionId, snapshotId) {
      return store.transact(async (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        const index = state.snapshots.findIndex((entry) => entry.id === snapshotId && entry.sessionId === auth.session.id);
        ensure(index >= 0, "Snapshot not found", 404);
        const snapshot = state.snapshots[index];

        if (objects?.deleteSnapshot) {
          await objects.deleteSnapshot({
            workspace: auth.workspace,
            session: auth.session,
            snapshot
          });
        }

        state.snapshots.splice(index, 1);
        writeAudit(state, clock, {
          action: "snapshot.deleted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "snapshot",
          targetId: snapshot.id
        });
        return {
          ok: true,
          snapshotId: snapshot.id
        };
      });
    },

    async issueRuntimeToken(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state === "running", "Session is not running", 409);
        const runtimeToken = createToken(state, clock, {
          userId: auth.user.id,
          workspaceId: auth.workspace.id,
          kind: "runtime",
          sessionId: auth.session.id
        });
        writeAudit(state, clock, {
          action: "session.runtime_token_issued",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "session",
          targetId: auth.session.id
        });
        return {
          token: runtimeToken.token,
          sshCommand: `ssh -o ProxyCommand='wscat --connect ws://localhost:8787/runtime/sessions/${auth.session.id}/ssh?token=${runtimeToken.token}' dev@burstflare`
        };
      });
    },

    async validateRuntimeToken(token, sessionId) {
      return store.transact((state) => {
        requireRuntimeToken(state, token, sessionId, clock);
        return { ok: true, sessionId };
      });
    },

    async getUsage(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        return {
          usage: summarizeUsage(state, auth.workspace.id),
          limits: getPlan(auth.workspace.plan),
          plan: auth.workspace.plan
        };
      });
    },

    async getAudit(token, { limit = 50 } = {}) {
      return store.transact((state) => {
        const auth = requireAuth(state, token, clock);
        const items = state.auditLogs
          .filter((entry) => entry.workspaceId === auth.workspace.id)
          .slice(-limit)
          .reverse();
        return { audit: items };
      });
    },

    async getAdminReport(token) {
      return store.transact((state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const reportAt = nowMs(clock);
        const workspaceBuilds = state.templateBuilds.filter((build) => {
          const version = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
          const template = version && state.templates.find((entry) => entry.id === version.templateId);
          return template && template.workspaceId === auth.workspace.id;
        });
        const report = {
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          members: state.memberships.filter((entry) => entry.workspaceId === auth.workspace.id).length,
          templates: state.templates.filter((entry) => entry.workspaceId === auth.workspace.id).length,
          templatesArchived: state.templates.filter(
            (entry) => entry.workspaceId === auth.workspace.id && entry.archivedAt
          ).length,
          buildsQueued: workspaceBuilds.filter((build) => ["queued", "retrying"].includes(build.status)).length,
          buildsBuilding: workspaceBuilds.filter((build) => build.status === "building").length,
          buildsStuck: workspaceBuilds.filter((build) => {
            if (build.status !== "building") {
              return false;
            }
            const referenceTime = build.startedAt || build.updatedAt || build.createdAt;
            if (!referenceTime) {
              return false;
            }
            return reportAt - new Date(referenceTime).getTime() >= STUCK_BUILD_TTL_MS;
          }).length,
          buildsFailed: workspaceBuilds.filter((build) => build.status === "failed").length,
          buildsDeadLettered: workspaceBuilds.filter((build) => build.status === "dead_lettered").length,
          sessionsRunning: getRunningSessionCount(state, auth.workspace.id),
          sessionsSleeping: state.sessions.filter(
            (entry) => entry.workspaceId === auth.workspace.id && entry.state === "sleeping"
          ).length,
          sessionsStaleEligible: state.sessions.filter((entry) => {
            if (entry.workspaceId !== auth.workspace.id || entry.state !== "sleeping") {
              return false;
            }
            if (!Number.isInteger(entry.sleepTtlSeconds) || entry.sleepTtlSeconds <= 0) {
              return false;
            }
            const referenceTime = entry.lastStoppedAt || entry.updatedAt || entry.createdAt;
            if (!referenceTime) {
              return false;
            }
            return reportAt - new Date(referenceTime).getTime() >= entry.sleepTtlSeconds * 1000;
          }).length,
          sessionsTotal: state.sessions.filter(
            (entry) => entry.workspaceId === auth.workspace.id && entry.state !== "deleted"
          ).length,
          activeUploadGrants: getUploadGrants(state).filter((entry) => {
            if (entry.workspaceId !== auth.workspace.id || entry.usedAt) {
              return false;
            }
            return new Date(entry.expiresAt).getTime() > reportAt;
          }).length,
          releases: state.bindingReleases.filter((entry) => entry.workspaceId === auth.workspace.id).length
        };
        return { report };
      });
    },

    async exportWorkspace(token) {
      return store.transact((state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const workspaceId = auth.workspace.id;
        const templateIds = new Set(
          state.templates.filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.id)
        );
        const templateVersionIds = new Set(
          state.templateVersions.filter((entry) => templateIds.has(entry.templateId)).map((entry) => entry.id)
        );
        const sessionIds = new Set(
          state.sessions.filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.id)
        );

        return {
          export: {
            exportedAt: nowIso(clock),
            workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
            members: state.memberships.filter((entry) => entry.workspaceId === workspaceId),
            invites: state.workspaceInvites.filter((entry) => entry.workspaceId === workspaceId),
            templates: state.templates
              .filter((entry) => entry.workspaceId === workspaceId)
              .map((entry) => formatTemplate(state, entry)),
            builds: state.templateBuilds.filter((entry) => templateVersionIds.has(entry.templateVersionId)),
            releases: state.bindingReleases.filter((entry) => entry.workspaceId === workspaceId),
            sessions: state.sessions
              .filter((entry) => entry.workspaceId === workspaceId)
              .map((entry) => formatSession(state, entry)),
            snapshots: state.snapshots.filter((entry) => sessionIds.has(entry.sessionId)),
            usage: state.usageEvents.filter((entry) => entry.workspaceId === workspaceId),
            audit: state.auditLogs.filter((entry) => entry.workspaceId === workspaceId)
          }
        };
      });
    },

    async reconcile(token) {
      return store.transact(async (state) => {
        const auth = token ? requireManageWorkspace(state, token, clock) : null;
        const workspaceId = auth?.workspace.id || null;

        let sleptSessions = 0;
        for (const session of state.sessions) {
          if (workspaceId && session.workspaceId !== workspaceId) {
            continue;
          }
          if (session.state === "running") {
            session.state = "sleeping";
            session.lastStoppedAt = nowIso(clock);
            session.updatedAt = nowIso(clock);
            writeSessionEvent(state, clock, session.id, "sleeping", { reason: "reconcile" });
            sleptSessions += 1;
          }
        }

        const reconcileAt = nowMs(clock);

        let recoveredStuckBuilds = 0;
        for (const build of state.templateBuilds) {
          if (build.status !== "building") {
            continue;
          }
          const version = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
          if (!version) {
            continue;
          }
          const template = state.templates.find((entry) => entry.id === version.templateId);
          if (!template) {
            continue;
          }
          if (workspaceId && template.workspaceId !== workspaceId) {
            continue;
          }
          const referenceTime = build.startedAt || build.updatedAt || build.createdAt;
          if (!referenceTime || reconcileAt - new Date(referenceTime).getTime() < STUCK_BUILD_TTL_MS) {
            continue;
          }

          const recoveredAt = nowIso(clock);
          build.updatedAt = recoveredAt;
          build.lastError = "Reconcile recovered stuck build";
          build.lastFailureAt = recoveredAt;
          version.status = "queued";

          if (build.attempts >= MAX_BUILD_ATTEMPTS) {
            build.status = "dead_lettered";
            build.deadLetteredAt = recoveredAt;
            writeAudit(state, clock, {
              action: "template.build_dead_lettered",
              actorUserId: auth?.user.id || null,
              workspaceId: template.workspaceId,
              targetType: "template_build",
              targetId: build.id,
              details: {
                templateId: template.id,
                templateVersionId: version.id,
                source: "reconcile_stuck",
                attempts: build.attempts,
                maxAttempts: MAX_BUILD_ATTEMPTS,
                error: build.lastError
              }
            });
          } else {
            build.status = "retrying";
            build.deadLetteredAt = null;
            if (jobs?.enqueueBuild) {
              await jobs.enqueueBuild(build.id);
            }
            writeAudit(state, clock, {
              action: "template.build_recovered",
              actorUserId: auth?.user.id || null,
              workspaceId: template.workspaceId,
              targetType: "template_build",
              targetId: build.id,
              details: {
                templateId: template.id,
                templateVersionId: version.id,
                source: "reconcile",
                attempts: build.attempts,
                maxAttempts: MAX_BUILD_ATTEMPTS
              }
            });
          }
          recoveredStuckBuilds += 1;
        }

        let processedBuilds = 0;
        for (const build of state.templateBuilds) {
          if (!["queued", "retrying"].includes(build.status)) {
            continue;
          }
          const version = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
          if (!version) {
            continue;
          }
          const template = state.templates.find((entry) => entry.id === version.templateId);
          if (!template) {
            continue;
          }
          if (workspaceId && template.workspaceId !== workspaceId) {
            continue;
          }
          const processedBuild = await processBuildRecord({
            state,
            clock,
            objects,
            jobs,
            build,
            template,
            templateVersion: version,
            source: "reconcile",
            actorUserId: auth?.user.id || null
          });
          if (processedBuild) {
            processedBuilds += 1;
          }
        }

        const staleSleepingSessionIds = new Set(
          state.sessions
            .filter((entry) => {
              if (entry.state !== "sleeping") {
                return false;
              }
              if (workspaceId && entry.workspaceId !== workspaceId) {
                return false;
              }
              if (!Number.isInteger(entry.sleepTtlSeconds) || entry.sleepTtlSeconds <= 0) {
                return false;
              }
              const referenceTime = entry.lastStoppedAt || entry.updatedAt || entry.createdAt;
              if (!referenceTime) {
                return false;
              }
              return reconcileAt - new Date(referenceTime).getTime() >= entry.sleepTtlSeconds * 1000;
            })
            .map((entry) => entry.id)
        );

        const deletedSessionIds = new Set(
          state.sessions
            .filter((entry) => entry.state === "deleted" && (!workspaceId || entry.workspaceId === workspaceId))
            .map((entry) => entry.id)
        );

        const purgedStaleSleepingSessions = staleSleepingSessionIds.size;
        for (const sessionId of staleSleepingSessionIds) {
          const session = state.sessions.find((entry) => entry.id === sessionId) || null;
          if (!session) {
            continue;
          }
          writeAudit(state, clock, {
            action: "session.purged_stale",
            actorUserId: auth?.user.id || null,
            workspaceId: session.workspaceId,
            targetType: "session",
            targetId: session.id,
            details: {
              sleepTtlSeconds: session.sleepTtlSeconds,
              lastStoppedAt: session.lastStoppedAt
            }
          });
        }

        let purgedSnapshots = 0;
        const retainedSnapshots = [];
        for (const snapshot of state.snapshots) {
          const session = state.sessions.find((entry) => entry.id === snapshot.sessionId) || null;
          const shouldPurge =
            deletedSessionIds.has(snapshot.sessionId) ||
            staleSleepingSessionIds.has(snapshot.sessionId) ||
            (!session && !workspaceId) ||
            (!session && workspaceId && snapshot.objectKey.startsWith(`snapshots/${workspaceId}/`));

          if (!shouldPurge) {
            retainedSnapshots.push(snapshot);
            continue;
          }

          if (objects?.deleteSnapshot) {
            await objects.deleteSnapshot({
              workspace: session ? { id: session.workspaceId } : { id: workspaceId },
              session,
              snapshot
            });
          }
          purgedSnapshots += 1;
        }
        state.snapshots = retainedSnapshots;

        const purgedDeletedSessions = deletedSessionIds.size;
        const purgedSessionIds = new Set([...deletedSessionIds, ...staleSleepingSessionIds]);
        if (purgedSessionIds.size > 0) {
          state.sessions = state.sessions.filter((entry) => !purgedSessionIds.has(entry.id));
          state.sessionEvents = state.sessionEvents.filter((entry) => !purgedSessionIds.has(entry.sessionId));
          state.authTokens = state.authTokens.filter((entry) => !(entry.sessionId && purgedSessionIds.has(entry.sessionId)));
        }

        return {
          sleptSessions,
          recoveredStuckBuilds,
          processedBuilds,
          purgedDeletedSessions,
          purgedStaleSleepingSessions,
          purgedSnapshots
        };
      });
    },

    async enqueueReconcile(token) {
      return store.transact(async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        if (jobs?.enqueueReconcile) {
          await jobs.enqueueReconcile();
        }
        writeAudit(state, clock, {
          action: "admin.reconcile_enqueued",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace",
          targetId: auth.workspace.id
        });
        return {
          ok: true,
          queued: Boolean(jobs?.enqueueReconcile)
        };
      });
    }
  };
}
