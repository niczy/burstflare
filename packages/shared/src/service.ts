import { createMemoryStore } from "./memory-store.js";
import {
  SESSION_COOKIE,
  createEmailAuthCode,
  createRecoveryCode,
  createToken,
  findUserByEmail,
  findUserById,
  getMembership,
  getPasskeys,
  getRecoveryCodes,
  getTokenRecord,
  getUserWorkspace,
  issueSessionTokens,
  issueUserSession,
  listEmailAuthCodes,
  pruneEmailAuthCodes,
  toPasskeySummary
} from "./service-auth.js";
import {
  ensureWorkspaceBillingOwner,
  formatWorkspaceBilling,
  getWorkspaceBillingSource,
  normalizeBillingCatalog,
  normalizeUsageTotals,
  normalizeWorkspaceBilling,
  priceUsageSummary,
  toIsoFromUnixSeconds,
  trackBillingWebhookEvent,
  writeWorkspaceBilling
} from "./service-billing.js";
import {
  applySessionTransition as applySessionTransitionInternal,
  formatInstance as formatInstanceInternal,
  formatSession as formatSessionInternal,
  getLatestSessionSnapshot as getLatestSessionSnapshotInternal,
  getSessionInstance as getSessionInstanceInternal,
  isStaleRuntimeSnapshot as isStaleRuntimeSnapshotInternal,
  listSessionSnapshots as listSessionSnapshotsInternal,
  listVisibleSessionSnapshots as listVisibleSessionSnapshotsInternal,
  requireLatestSnapshot as requireLatestSnapshotInternal,
  resolveInstanceRuntimeSpec,
  resolveSessionStateFromRuntime as resolveSessionStateFromRuntimeInternal,
  syncLatestRestoredSnapshot as syncLatestRestoredSnapshotInternal,
  syncSessionRuntimeSnapshot as syncSessionRuntimeSnapshotInternal
} from "./service-session.js";
import { createId } from "./utils.js";

const DEVICE_CODE_TTL_MS = 1000 * 60 * 10;
const EMAIL_AUTH_CODE_TTL_MS = 1000 * 60 * 10;
const UPLOAD_GRANT_TTL_MS = 1000 * 60 * 10;
const MAX_TEMPLATE_BUNDLE_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_COMMON_STATE_BYTES = 512 * 1024;
const MAX_RUNTIME_SECRETS = 32;
const MAX_RUNTIME_SECRET_VALUE_BYTES = 4096;

const PLANS = {
  free: {
    maxTemplates: 10,
    maxRunningSessions: 3,
    maxTemplateVersionsPerTemplate: 25,
    maxSnapshotsPerSession: 25,
    maxStorageBytes: 25 * 1024 * 1024,
    maxRuntimeMinutes: 500,
    maxTemplateBuilds: 100
  },
  pro: {
    maxTemplates: 100,
    maxRunningSessions: 20,
    maxTemplateVersionsPerTemplate: 250,
    maxSnapshotsPerSession: 250,
    maxStorageBytes: 250 * 1024 * 1024,
    maxRuntimeMinutes: 10_000,
    maxTemplateBuilds: 2_000
  },
  enterprise: {
    maxTemplates: 1000,
    maxRunningSessions: 200,
    maxTemplateVersionsPerTemplate: 2500,
    maxSnapshotsPerSession: 2_500,
    maxStorageBytes: 2_500 * 1024 * 1024,
    maxRuntimeMinutes: 100_000,
    maxTemplateBuilds: 20_000
  }
};

type ServiceError = Error & {
  status?: number;
  auditEvent?: unknown;
};

type UploadBodyOptions = {
  body?: unknown;
  contentType?: string;
};

type CheckoutSessionOptions = {
  successUrl?: string;
  cancelUrl?: string;
};

type BillingPortalOptions = {
  returnUrl?: string;
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

const QUOTA_OVERRIDE_KEYS = [
  "maxTemplates",
  "maxRunningSessions",
  "maxTemplateVersionsPerTemplate",
  "maxSnapshotsPerSession",
  "maxStorageBytes",
  "maxRuntimeMinutes",
  "maxTemplateBuilds"
];

function normalizeQuotaOverrides(overrides: any = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return {};
  }
  const normalized: Record<string, number> = {};
  for (const key of QUOTA_OVERRIDE_KEYS) {
    if (overrides[key] === undefined || overrides[key] === null || overrides[key] === "") {
      continue;
    }
    const value = Number(overrides[key]);
    ensure(Number.isInteger(value) && value > 0, `Quota override ${key} must be a positive integer`);
    normalized[key] = value;
  }
  return normalized;
}

function getWorkspaceQuotaOverrides(workspace) {
  return normalizeQuotaOverrides(workspace?.quotaOverrides || {});
}

function getEffectiveLimits(workspace) {
  return {
    ...getPlan(workspace?.plan),
    ...getWorkspaceQuotaOverrides(workspace)
  };
}

function ensureAbsoluteHttpUrl(value, label) {
  ensure(typeof value === "string" && value.trim(), `${label} is required`);
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    fail(`${label} must be a valid absolute URL`);
  }
  ensure(["http:", "https:"].includes(url.protocol), `${label} must use http or https`);
  return url.toString();
}

function normalizeSecretName(name) {
  const value = String(name || "").trim().toUpperCase();
  ensure(value, "Secret name is required");
  ensure(/^[A-Z][A-Z0-9_]{0,63}$/.test(value), "Secret name must match ^[A-Z][A-Z0-9_]{0,63}$");
  return value;
}

function normalizeSecretValue(value) {
  ensure(typeof value === "string", "Secret value is required");
  ensure(value.length > 0, "Secret value is required");
  const bytes = new TextEncoder().encode(value).byteLength;
  ensure(bytes <= MAX_RUNTIME_SECRET_VALUE_BYTES, "Secret value exceeds size limit", 413);
  return value;
}

function normalizeInstanceEnvVars(value) {
  ensure(value == null || (typeof value === "object" && !Array.isArray(value)), "Instance env vars must be an object");
  const envVars: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value || {})) {
    const key = String(rawKey || "").trim();
    ensure(key, "Instance env var name is required");
    ensure(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key), "Instance env var name must match ^[A-Za-z_][A-Za-z0-9_]{0,63}$");
    ensure(typeof rawValue === "string", `Instance env var ${key} must be a string`);
    envVars[key] = rawValue as string;
  }
  return envVars;
}

function normalizeInstanceSecrets(value) {
  ensure(value == null || (typeof value === "object" && !Array.isArray(value)), "Instance secrets must be an object");
  const secrets: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value || {})) {
    const key = normalizeSecretName(rawKey);
    secrets[key] = normalizeSecretValue(rawValue as string);
  }
  return secrets;
}

function normalizePersistedPaths(value) {
  if (value === undefined) {
    return undefined;
  }
  ensure(Array.isArray(value), "Persisted paths must be an array");
  ensure(value.length <= 8, "Persisted paths exceed limit");
  const persistedPaths: string[] = [];
  for (const entry of value) {
    ensure(typeof entry === "string" && entry.startsWith("/"), "Persisted paths must be absolute");
    persistedPaths.push(entry);
  }
  return persistedPaths;
}

function normalizeSleepTtlSeconds(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value == null) {
    return null;
  }
  ensure(Number.isInteger(value), "sleepTtlSeconds must be an integer");
  ensure(value >= 1, "sleepTtlSeconds must be at least 1");
  ensure(value <= 60 * 60 * 24 * 7, "sleepTtlSeconds exceeds limit");
  return value;
}

function resolveInstanceBaseImage(input: any): string {
  const rawValue =
    input && Object.prototype.hasOwnProperty.call(input, "baseImage") && input.baseImage != null
      ? input.baseImage
      : input && Object.prototype.hasOwnProperty.call(input, "image")
        ? input.image
        : "";
  const value = String(rawValue || "").trim();
  ensure(value, "Instance base image is required");
  return value;
}

function hashHex(value) {
  let hash = 0x811c9dc5;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hashDigest(value) {
  const chunk = hashHex(value);
  return `sha256:${chunk.repeat(8)}`;
}

function createManagedInstanceBuildArtifact(instance, buildId, builtAt) {
  const baseImage = resolveInstanceBaseImage(instance);
  const bootstrapVersion = String(instance?.bootstrapVersion || "v1");
  const artifactKey = `instance-builds/${instance.id}/${buildId}.json`;
  const managedRuntimeImage = `burstflare/session-runtime:${bootstrapVersion}-${buildId}`;
  const manifest = {
    format: "burstflare.instance-build.v1",
    instanceId: instance.id,
    buildId,
    baseImage,
    dockerfilePath: instance.dockerfilePath == null ? null : String(instance.dockerfilePath),
    dockerContext: instance.dockerContext == null ? null : String(instance.dockerContext),
    bootstrapVersion,
    builtAt,
    managedRuntimeImage
  };
  const body = JSON.stringify(manifest, null, 2);
  return {
    buildId,
    artifactKey,
    body,
    contentType: "application/vnd.burstflare.instance-build+json; charset=utf-8",
    managedRuntimeImage,
    managedImageDigest: hashDigest(body)
  };
}

function getWorkspaceRuntimeSecrets(workspace) {
  if (!Array.isArray(workspace.runtimeSecrets)) {
    workspace.runtimeSecrets = [];
  }
  return workspace.runtimeSecrets;
}

function listRuntimeSecretMetadata(workspace) {
  return getWorkspaceRuntimeSecrets(workspace).map((entry) => ({
    name: entry.name,
    valueBytes: new TextEncoder().encode(String(entry.value || "")).byteLength,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  }));
}

function getRuntimeSecretMap(workspace) {
  const runtimeSecrets = {};
  for (const entry of getWorkspaceRuntimeSecrets(workspace)) {
    runtimeSecrets[entry.name] = entry.value;
  }
  return runtimeSecrets;
}

function getSessionSshKeys(session) {
  if (!Array.isArray(session.sshAuthorizedKeys)) {
    session.sshAuthorizedKeys = [];
  }
  return session.sshAuthorizedKeys;
}

function summarizeSessionSshKeys(session) {
  return getSessionSshKeys(session).map((entry) => ({
    keyId: entry.keyId,
    label: entry.label,
    userId: entry.userId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  }));
}

function listSessionAuthorizedPublicKeys(session) {
  return getSessionSshKeys(session)
    .map((entry) => String(entry.publicKey || "").trim())
    .filter(Boolean);
}

function normalizeSessionSshKey(payload: any = {}) {
  const keyId = String(payload.keyId || "").trim();
  ensure(keyId, "SSH key id is required");
  ensure(keyId.length <= 128, "SSH key id exceeds size limit");

  const publicKey = String(payload.publicKey || "").trim();
  ensure(publicKey, "SSH public key is required");
  ensure(publicKey.length <= 4096, "SSH public key exceeds size limit", 413);
  ensure(/^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+(?:\s+.*)?$/.test(publicKey), "SSH public key format is invalid");

  const label = String(payload.label || "").trim();
  ensure(label.length <= 128, "SSH key label exceeds size limit");

  return {
    keyId,
    publicKey,
    label: label || null
  };
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
    fail(message, status);
  }
}

function fail(message, status = 400) {
  const error = new Error(message) as ServiceError;
  error.status = status;
  throw error;
}

function failLegacyTemplateBackendRemoved() {
  fail("Legacy template backend removed. Use instances instead.", 410);
}

function auditAndThrow(_state, _clock, audit, message, status = 400) {
  const error = new Error(message) as ServiceError;
  error.status = status;
  error.auditEvent = {
    ...audit,
    details: audit?.details || {}
  };
  throw error;
}

function canManageWorkspace(role) {
  return role === "owner" || role === "admin";
}

function canWrite(role) {
  return role === "owner" || role === "admin" || role === "member";
}

function formatUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt
  };
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
  const currentStorage = summarizeStorage(state, workspace.id);
  const existingBytes = templateVersion.bundleBytes || 0;
  ensureStorageWithinLimit(state, workspace, currentStorage.totalBytes - existingBytes + bundleBody.byteLength);

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
  const currentStorage = summarizeStorage(state, workspace.id);
  const existingBytes = snapshot.bytes || 0;
  ensureStorageWithinLimit(state, workspace, currentStorage.totalBytes - existingBytes + snapshotBody.byteLength);

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

function requireInstanceAccess(state, authToken, instanceId, clock) {
  const auth = requireAuth(state, authToken, clock);
  const instance = state.instances.find((entry) => entry.id === instanceId && entry.userId === auth.user.id);
  ensure(instance, "Instance not found", 404);
  return { ...auth, instance };
}

function getSessionInstance(state, session) {
  return getSessionInstanceInternal(state, session);
}

function listSessionSnapshots(state, sessionId) {
  return listSessionSnapshotsInternal(state, sessionId);
}

function getLatestSessionSnapshot(state, sessionId) {
  return getLatestSessionSnapshotInternal(state, sessionId);
}

function listVisibleSessionSnapshots(state, sessionId) {
  return listVisibleSessionSnapshotsInternal(state, sessionId);
}

function requireLatestSnapshot(state, sessionId, snapshotId) {
  return requireLatestSnapshotInternal(state, sessionId, snapshotId, { ensure });
}

function requireSessionAccess(state, authToken, sessionId, clock) {
  const auth = requireAuth(state, authToken, clock);
  const session = state.sessions.find((entry) => entry.id === sessionId);
  ensure(session, "Session not found", 404);
  const instance = getSessionInstance(state, session);
  const inWorkspace = session.workspaceId === auth.workspace.id;
  const ownsInstance = instance ? instance.userId === auth.user.id : false;
  ensure(inWorkspace || ownsInstance, "Session not found", 404);
  return { ...auth, session, instance };
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

function summarizeStorage(state, workspaceId) {
  const storage = {
    templateBundlesBytes: 0,
    snapshotBytes: 0,
    buildArtifactBytes: 0,
    commonStateBytes: 0,
    totalBytes: 0
  };

  const workspaceSessions = state.sessions.filter((entry) => entry.workspaceId === workspaceId);
  for (const session of workspaceSessions) {
    const snapshot = getLatestSessionSnapshot(state, session.id);
    if (!snapshot) {
      continue;
    }
    if (!session || session.workspaceId !== workspaceId) {
      continue;
    }
    storage.snapshotBytes += snapshot.bytes || 0;
  }

  const workspace = state.workspaces.find((entry) => entry.id === workspaceId) || null;
  if (workspace) {
    for (const instance of state.instances) {
      if (instance.userId !== workspace.ownerUserId) {
        continue;
      }
      storage.commonStateBytes += instance.commonStateBytes || 0;
    }
  }

  storage.totalBytes = storage.templateBundlesBytes + storage.snapshotBytes + storage.buildArtifactBytes;
  storage.totalBytes += storage.commonStateBytes;
  return storage;
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
  const sessions = state.sessions.filter((entry) => entry.workspaceId === workspaceId && entry.state !== "deleted");
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId) || null;
  const instances = workspace ? state.instances.filter((entry) => entry.userId === workspace.ownerUserId) : [];
  const snapshots = sessions
    .map((session) => getLatestSessionSnapshot(state, session.id))
    .filter(Boolean);

  return {
    ...usage,
    storage: summarizeStorage(state, workspaceId),
    inventory: {
      instances: instances.length,
      templates: 0,
      templateVersions: 0,
      sessions: sessions.length,
      snapshots: snapshots.length
    }
  };
}

function summarizeBillableUsage(state, workspaceId) {
  const usage = {
    runtimeMinutes: 0,
    storageGbDays: 0
  };
  for (const event of state.usageEvents) {
    if (event.workspaceId !== workspaceId) {
      continue;
    }
    if (event.kind === "runtime_minutes") {
      usage.runtimeMinutes += event.value;
    }
    if (event.kind === "storage_gb_day") {
      usage.storageGbDays += event.value;
    }
  }
  const storage = summarizeStorage(state, workspaceId);
  const currentStorageBytes = storage.snapshotBytes + storage.commonStateBytes;
  return {
    ...normalizeUsageTotals(usage),
    storageGbMonths: Number((usage.storageGbDays / 30).toFixed(4)),
    currentStorageBytes,
    currentStorageGb: Number((currentStorageBytes / (1024 * 1024 * 1024)).toFixed(4))
  };
}

function diffBillableUsageTotals(current, previous) {
  const next = normalizeUsageTotals(current);
  const prior = normalizeUsageTotals(previous);
  return {
    runtimeMinutes: Math.max(0, next.runtimeMinutes - prior.runtimeMinutes),
    storageGbDays: Math.max(0, Number((next.storageGbDays - prior.storageGbDays).toFixed(6)))
  };
}

function ensureStorageWithinLimit(state, workspace, nextTotalBytes) {
  const limits = getEffectiveLimits(workspace);
  ensure(nextTotalBytes <= limits.maxStorageBytes, "Workspace storage limit reached", 403);
}

function getRunningSessionCount(state, workspaceId) {
  return state.sessions.filter((entry) => entry.workspaceId === workspaceId && entry.state === "running").length;
}

function formatWorkspace(state, workspace, role) {
  const memberCount = state.memberships.filter((entry) => entry.workspaceId === workspace.id).length;
  const billingSource = getWorkspaceBillingSource(state, workspace);
  return {
    id: workspace.id,
    name: workspace.name,
    ownerUserId: workspace.ownerUserId,
    plan: workspace.plan,
    billing: formatWorkspaceBilling(billingSource),
    createdAt: workspace.createdAt,
    quotaOverrides: getWorkspaceQuotaOverrides(workspace),
    role,
    memberCount
  };
}

function formatInstance(instance) {
  return formatInstanceInternal(instance);
}

function formatSession(state, session, { includeSshKeys = false }: { includeSshKeys?: boolean } = {}) {
  return formatSessionInternal(state, session, { includeSshKeys }, {
    getSessionSshKeys,
    listSessionAuthorizedPublicKeys,
    summarizeSessionSshKeys
  });
}

function syncSessionRuntimeSnapshot(session, runtime, clock) {
  return syncSessionRuntimeSnapshotInternal(session, runtime, clock);
}

function syncLatestRestoredSnapshot(state, session, timestamp) {
  return syncLatestRestoredSnapshotInternal(state, session, timestamp);
}

function isStaleRuntimeSnapshot(session, runtime) {
  return isStaleRuntimeSnapshotInternal(session, runtime);
}

function resolveSessionStateFromRuntime(action, runtime) {
  return resolveSessionStateFromRuntimeInternal(action, runtime);
}

function applySessionTransition({ state, clock, auth, action, runtime = null }) {
  return applySessionTransitionInternal({ state, clock, auth, action, runtime }, {
    ensure,
    getEffectiveLimits,
    getRunningSessionCount,
    summarizeUsage,
    writeSessionEvent,
    writeUsage,
    writeAudit,
    formatSession
  });
}

export function createBurstFlareService(options: any = {}) {
  const store = options.store || createMemoryStore();
  const clock = options.clock || (() => Date.now());
  const objects = options.objects || null;
  const jobs = options.jobs || null;
  const billingProvider = options.billing || null;
  const billingCatalog = normalizeBillingCatalog(options.billingCatalog);
  const authSessionDeps = {
    ensure,
    writeAudit,
    formatUser,
    formatWorkspace
  };
  const AUTH_SCOPE = ["users", "workspaces", "memberships", "authTokens", "auditLogs"];
  const AUTH_DEVICE_SCOPE = [...AUTH_SCOPE, "deviceCodes", "usageEvents"];
  const WORKSPACE_SCOPE = [...AUTH_DEVICE_SCOPE];
  const INSTANCE_SCOPE = [...AUTH_SCOPE, "instances"];
  const SESSION_SCOPE = [...AUTH_SCOPE, "instances", "sessions", "sessionEvents", "snapshots", "usageEvents"];
  const ADMIN_SCOPE = [...AUTH_SCOPE, "instances", "deviceCodes", "sessions", "sessionEvents", "snapshots", "usageEvents", "uploadGrants"];
  const TRANSACTION_ERROR = Symbol("transactionError");

  async function transact(collections, work) {
    const runner =
      typeof store.transactCollections === "function"
        ? (transactionWork) => store.transactCollections(collections, transactionWork)
        : (transactionWork) => store.transact(transactionWork);
    const result = await runner(async (state) => {
      try {
        return await work(state);
      } catch (error) {
        if (error?.auditEvent) {
          writeAudit(state, clock, error.auditEvent);
          return {
            [TRANSACTION_ERROR]: error
          };
        }
        throw error;
      }
    });
    if (result && typeof result === "object" && TRANSACTION_ERROR in result) {
      throw result[TRANSACTION_ERROR];
    }
    return result;
  }

  function findOwnerWorkspaceForInstance(state, instance) {
    return state.workspaces.find((entry) => entry.ownerUserId === instance.userId) || null;
  }

  async function queueManagedInstanceBuild(instanceId, reason = "refresh") {
    const queued = await transact(INSTANCE_SCOPE, (state) => {
      const instance = state.instances.find((entry) => entry.id === instanceId);
      ensure(instance, "Instance not found", 404);
      const timestamp = nowIso(clock);
      const buildId = createId("bld");
      instance.buildId = buildId;
      instance.buildStatus = "queued";
      instance.buildRequestedAt = timestamp;
      instance.buildCompletedAt = null;
      instance.buildError = null;
      instance.updatedAt = timestamp;
      const workspace = findOwnerWorkspaceForInstance(state, instance);
      writeAudit(state, clock, {
        action: "instance.build_queued",
        actorUserId: null,
        workspaceId: workspace?.id || null,
        targetType: "instance",
        targetId: instance.id,
        details: {
          buildId,
          reason
        }
      });
      return {
        instanceId: instance.id,
        buildId
      };
    });

    if (jobs?.enqueueInstanceBuild) {
      await jobs.enqueueInstanceBuild(queued.instanceId, queued.buildId, reason);
      return getSystemInstanceBuild(queued.instanceId);
    }

    return runSystemInstanceBuild(queued.instanceId, queued.buildId, reason);
  }

  async function getSystemInstanceBuild(instanceId) {
    return transact(INSTANCE_SCOPE, (state) => {
      const instance = state.instances.find((entry) => entry.id === instanceId);
      ensure(instance, "Instance not found", 404);
      return {
        instance: formatInstance(instance),
        build: {
          id: instance.buildId || null,
          status: instance.buildStatus || null,
          requestedAt: instance.buildRequestedAt || null,
          completedAt: instance.buildCompletedAt || null,
          artifactKey: instance.buildArtifactKey || null,
          error: instance.buildError || null
        }
      };
    });
  }

  async function runSystemInstanceBuild(instanceId, expectedBuildId = null, reason = "system") {
    return transact(INSTANCE_SCOPE, async (state) => {
      const instance = state.instances.find((entry) => entry.id === instanceId);
      ensure(instance, "Instance not found", 404);
      if (expectedBuildId && instance.buildId && instance.buildId !== expectedBuildId) {
        return {
          instance: formatInstance(instance),
          build: {
            id: instance.buildId,
            status: instance.buildStatus || null,
            requestedAt: instance.buildRequestedAt || null,
            completedAt: instance.buildCompletedAt || null,
            artifactKey: instance.buildArtifactKey || null,
            error: instance.buildError || null
          },
          stale: true
        };
      }

      const timestamp = nowIso(clock);
      const buildId = expectedBuildId || instance.buildId || createId("bld");
      const workspace = findOwnerWorkspaceForInstance(state, instance);
      instance.buildId = buildId;
      instance.buildStatus = "building";
      instance.buildRequestedAt = instance.buildRequestedAt || timestamp;
      instance.buildCompletedAt = null;
      instance.buildError = null;

      try {
        const artifact = createManagedInstanceBuildArtifact(instance, buildId, timestamp);
        if (objects?.putBuildArtifact) {
          await objects.putBuildArtifact({
            instance,
            buildId,
            artifactKey: artifact.artifactKey,
            body: artifact.body,
            contentType: artifact.contentType
          });
        }
        instance.managedRuntimeImage = artifact.managedRuntimeImage;
        instance.managedImageDigest = artifact.managedImageDigest;
        instance.buildArtifactKey = artifact.artifactKey;
        instance.buildStatus = "ready";
        instance.buildCompletedAt = timestamp;
        instance.updatedAt = timestamp;
        writeAudit(state, clock, {
          action: "instance.build_completed",
          actorUserId: null,
          workspaceId: workspace?.id || null,
          targetType: "instance",
          targetId: instance.id,
          details: {
            buildId,
            reason,
            managedImageDigest: artifact.managedImageDigest
          }
        });
      } catch (error) {
        instance.buildStatus = "failed";
        instance.buildCompletedAt = timestamp;
        instance.buildError = error instanceof Error ? error.message : String(error || "Unknown build error");
        instance.updatedAt = timestamp;
        writeAudit(state, clock, {
          action: "instance.build_failed",
          actorUserId: null,
          workspaceId: workspace?.id || null,
          targetType: "instance",
          targetId: instance.id,
          details: {
            buildId,
            reason,
            error: instance.buildError
          }
        });
      }

      return {
        instance: formatInstance(instance),
        build: {
          id: instance.buildId || null,
          status: instance.buildStatus || null,
          requestedAt: instance.buildRequestedAt || null,
          completedAt: instance.buildCompletedAt || null,
          artifactKey: instance.buildArtifactKey || null,
          error: instance.buildError || null
        }
      };
    });
  }

  function requireBillingProvider() {
    ensure(billingProvider, "Billing provider not configured", 501);
    return billingProvider;
  }

  function findWorkspaceByBillingReference(
    state,
    { workspaceId = null, customerId = null, subscriptionId = null, checkoutSessionId = null }: any = {}
  ) {
    if (workspaceId) {
      const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
      if (workspace) {
        return workspace;
      }
    }

    const billingUser = state.users.find((entry) => {
      const billing = normalizeWorkspaceBilling(entry.billing);
      if (subscriptionId && billing.subscriptionId === subscriptionId) {
        return true;
      }
      if (customerId && billing.customerId === customerId) {
        return true;
      }
      if (checkoutSessionId && billing.lastCheckoutSessionId === checkoutSessionId) {
        return true;
      }
      return false;
    });
    if (billingUser) {
      return getUserWorkspace(state, billingUser.id);
    }

    return (
      state.workspaces.find((entry) => {
        const billing = normalizeWorkspaceBilling(entry.billing);
        if (subscriptionId && billing.subscriptionId === subscriptionId) {
          return true;
        }
        if (customerId && billing.customerId === customerId) {
          return true;
        }
        if (checkoutSessionId && billing.lastCheckoutSessionId === checkoutSessionId) {
          return true;
        }
        return false;
      }) || null
    );
  }

  function getReconcileCandidates(state, workspaceId = null, checkedAtMs = nowMs(clock)) {
    const runningSessions = [];
    const staleSleepingSessions = [];
    const deletedSessions = [];

    for (const session of state.sessions) {
      if (workspaceId && session.workspaceId !== workspaceId) {
        continue;
      }
      if (session.state === "running") {
        runningSessions.push(session);
        continue;
      }
      if (session.state === "deleted") {
        deletedSessions.push(session);
        continue;
      }
      if (session.state !== "sleeping") {
        continue;
      }
      if (!Number.isInteger(session.sleepTtlSeconds) || session.sleepTtlSeconds <= 0) {
        continue;
      }
      const referenceTime = session.lastStoppedAt || session.updatedAt || session.createdAt;
      if (!referenceTime) {
        continue;
      }
      if (checkedAtMs - new Date(referenceTime).getTime() >= session.sleepTtlSeconds * 1000) {
        staleSleepingSessions.push(session);
      }
    }

    return {
      checkedAt: new Date(checkedAtMs).toISOString(),
      runningSessions,
      staleSleepingSessions,
      deletedSessions,
      stuckBuilds: [],
      queuedBuilds: []
    };
  }

  function summarizeReconcileCandidates(candidates) {
    return {
      checkedAt: candidates.checkedAt,
      sleptSessions: candidates.runningSessions.length,
      recoveredStuckBuilds: candidates.stuckBuilds.length,
      processedBuilds: candidates.queuedBuilds.length,
      purgedDeletedSessions: candidates.deletedSessions.length,
      purgedStaleSleepingSessions: candidates.staleSleepingSessions.length,
      sessionIds: {
        running: candidates.runningSessions.map((entry) => entry.id),
        staleSleeping: candidates.staleSleepingSessions.map((entry) => entry.id),
        deleted: candidates.deletedSessions.map((entry) => entry.id)
      },
      buildIds: {
        stuck: candidates.stuckBuilds.map((entry) => entry.build.id),
        queued: candidates.queuedBuilds.map((entry) => entry.build.id)
      }
    };
  }

  async function sleepRunningSessionsInState(state, { workspaceId = null, reason = "reconcile" }: any = {}) {
    const sleptSessionIds = [];
    for (const session of state.sessions) {
      if (workspaceId && session.workspaceId !== workspaceId) {
        continue;
      }
      if (session.state !== "running") {
        continue;
      }
      session.state = "sleeping";
      session.lastStoppedAt = nowIso(clock);
      session.updatedAt = nowIso(clock);
      writeSessionEvent(state, clock, session.id, "sleeping", { reason });
      sleptSessionIds.push(session.id);
    }
    return {
      sleptSessions: sleptSessionIds.length,
      sessionIds: sleptSessionIds
    };
  }

  async function writeInstanceCommonStateInState(
    state,
    instance,
    workspace,
    { actorUserId = null, body, contentType = "application/octet-stream", auditAction = "instance.common_state_saved" }: any = {}
  ) {
    ensure(objects?.putCommonState, "Common state storage unavailable", 501);
    const payload = toUint8Array(body);
    ensure(payload.byteLength > 0, "Common state body is required");
    ensure(payload.byteLength <= MAX_COMMON_STATE_BYTES, "Common state exceeds size limit", 413);
    const currentStorage = summarizeStorage(state, workspace.id);
    const existingBytes = instance.commonStateBytes || 0;
    ensureStorageWithinLimit(state, workspace, currentStorage.totalBytes - existingBytes + payload.byteLength);

    instance.commonStateKey = instance.commonStateKey || `instances/${instance.id}/home-flare.json`;
    instance.commonStateBytes = payload.byteLength;
    instance.commonStateUpdatedAt = nowIso(clock);
    instance.updatedAt = instance.commonStateUpdatedAt;

    await objects.putCommonState({
      instance,
      body: payload,
      contentType
    });

    writeAudit(state, clock, {
      action: auditAction,
      actorUserId,
      workspaceId: workspace.id,
      targetType: "instance",
      targetId: instance.id,
      details: {
        bytes: payload.byteLength,
        key: instance.commonStateKey
      }
    });

    return {
      instance: formatInstance(instance),
      commonState: {
        key: instance.commonStateKey,
        bytes: instance.commonStateBytes,
        contentType,
        updatedAt: instance.commonStateUpdatedAt
      }
    };
  }

  async function readInstanceCommonStateInState(instance) {
    ensure(instance.commonStateKey, "Instance common state not found", 404);
    ensure(objects?.getCommonState, "Common state storage unavailable", 501);
    const content = await objects.getCommonState({ instance });
    ensure(content, "Instance common state not found", 404);
    return {
      key: instance.commonStateKey,
      body: content.body,
      contentType: content.contentType || "application/octet-stream",
      bytes: content.bytes ?? toUint8Array(content.body).byteLength
    };
  }

  async function purgeSessionsInState(
    state,
    sessions: any[],
    {
      actorUserId = null,
      auditAction = null,
      auditDetails = null,
      includeOrphanSnapshots = false,
      workspaceId = null
    }: any = {}
  ) {
    const sessionIds = sessions.map((entry) => entry.id);
    if (!sessionIds.length && !includeOrphanSnapshots) {
      return {
        purgedSessions: 0,
        purgedSnapshots: 0,
        sessionIds: []
      };
    }

    const sessionIdSet = new Set(sessionIds);
    const sessionMap = new Map(sessions.map((entry) => [entry.id, entry]));
    const existingSessionIds = includeOrphanSnapshots ? new Set(state.sessions.map((entry) => entry.id)) : null;

    if (auditAction) {
      for (const session of sessions) {
        writeAudit(state, clock, {
          action: auditAction,
          actorUserId,
          workspaceId: session.workspaceId,
          targetType: "session",
          targetId: session.id,
          details: typeof auditDetails === "function" ? auditDetails(session) : auditDetails || {}
        });
      }
    }

    let purgedSnapshots = 0;
    const retainedSnapshots = [];
    for (const snapshot of state.snapshots) {
      const session = sessionMap.get(snapshot.sessionId) || null;
      const orphanedInWorkspace =
        includeOrphanSnapshots &&
        !existingSessionIds.has(snapshot.sessionId) &&
        (!workspaceId || snapshot.objectKey.startsWith(`snapshots/${workspaceId}/`));
      const shouldPurge = sessionIdSet.has(snapshot.sessionId) || orphanedInWorkspace;

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

    if (sessionIds.length > 0) {
      state.sessions = state.sessions.filter((entry) => !sessionIdSet.has(entry.id));
      state.sessionEvents = state.sessionEvents.filter((entry) => !sessionIdSet.has(entry.sessionId));
      state.authTokens = state.authTokens.filter(
        (entry) => !(entry.sessionId && sessionIdSet.has(entry.sessionId))
      );
    }

    return {
      purgedSessions: sessionIds.length,
      purgedSnapshots,
      sessionIds
    };
  }

  return {
    sessionCookieName: SESSION_COOKIE,

    async registerUser({ email, name }) {
      return transact(AUTH_SCOPE, (state) => {
        const result = issueUserSession(state, clock, {
          email,
          name,
          kind: "browser",
          writeLoginAudit: false
        }, authSessionDeps);
        delete result.created;
        return result;
      });
    },

    async login({ email, kind = "browser", workspaceId = null }) {
      return transact(AUTH_SCOPE, (state) => {
        ensure(email, "Email is required");
        const user = findUserByEmail(state, email);
        ensure(user, "User not found", 404);
        const result = issueUserSession(state, clock, {
          email,
          kind,
          workspaceId,
          writeLoginAudit: true
        }, authSessionDeps);
        delete result.created;
        return result;
      });
    },

    async requestEmailAuthCode({ email, name = null, kind = "browser", workspaceId = null }: any = {}) {
      return transact(AUTH_DEVICE_SCOPE, (state) => {
        ensure(email, "Email is required");
        pruneEmailAuthCodes(state, clock);
        state.deviceCodes = state.deviceCodes.filter(
          (entry) =>
            !(
              entry.kind === "email_auth" &&
              entry.status === "pending" &&
              entry.email?.toLowerCase() === String(email).toLowerCase()
            )
        );
        const record = {
          code: createEmailAuthCode(),
          kind: "email_auth",
          email,
          name: name || null,
          accessKind: kind,
          requestedWorkspaceId: workspaceId || null,
          userId: null,
          workspaceId: null,
          status: "pending",
          createdAt: nowIso(clock),
          expiresAt: futureIso(clock, EMAIL_AUTH_CODE_TTL_MS)
        };
        state.deviceCodes.push(record);
        writeAudit(state, clock, {
          action: "auth.email_code_requested",
          actorUserId: null,
          workspaceId: null,
          targetType: "auth_email_code",
          targetId: record.email,
          details: {
            kind: record.accessKind
          }
        });
        return {
          email: record.email,
          code: record.code,
          expiresAt: record.expiresAt
        };
      });
    },

    async verifyEmailAuthCode({ email, code }: any = {}) {
      return transact(AUTH_DEVICE_SCOPE, (state) => {
        ensure(email, "Email is required");
        ensure(code, "Verification code is required");
        const pending = pruneEmailAuthCodes(state, clock).find(
          (entry) =>
            entry.kind === "email_auth" &&
            entry.status === "pending" &&
            entry.email?.toLowerCase() === String(email).toLowerCase() &&
            entry.code === String(code)
        );
        ensure(pending, "Verification code is invalid or expired", 401);
        pending.status = "approved";
        const result = issueUserSession(state, clock, {
          email,
          name: pending.name || null,
          kind: pending.accessKind || "browser",
          workspaceId: pending.requestedWorkspaceId || null,
          writeLoginAudit: true
        }, authSessionDeps);
        writeAudit(state, clock, {
          action: "auth.email_code_verified",
          actorUserId: result.user.id,
          workspaceId: result.workspace.id,
          targetType: "user",
          targetId: result.user.id,
          details: {
            created: result.created,
            kind: pending.accessKind || "browser"
          }
        });
        delete result.created;
        return result;
      });
    },

    async generateRecoveryCodes(token, { count = 8 }: { count?: number } = {}) {
      return transact(AUTH_SCOPE, (state) => {
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
      return transact(AUTH_SCOPE, (state) => {
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
          user: formatUser(user),
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async beginPasskeyRegistration(token) {
      return transact(AUTH_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        return {
          user: formatUser(auth.user),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          passkeys: getPasskeys(auth.user).map(toPasskeySummary)
        };
      });
    },

    async registerPasskey(
      token,
      { credentialId, label = "", publicKey, publicKeyAlgorithm, transports = [] }
    ) {
      return transact(AUTH_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        ensure(credentialId, "Passkey credential id is required");
        ensure(publicKey, "Passkey public key is required");
        ensure(Number.isInteger(publicKeyAlgorithm), "Passkey algorithm is required");
        const existingOwner = state.users.find((user) => getPasskeys(user).some((passkey) => passkey.id === credentialId));
        if (existingOwner && existingOwner.id !== auth.user.id) {
          fail("Passkey credential already registered", 409);
        }

        const passkeys = getPasskeys(auth.user);
        const existing = passkeys.find((entry) => entry.id === credentialId) || null;
        if (existing) {
          existing.label = label || existing.label || credentialId;
          existing.publicKey = publicKey;
          existing.algorithm = publicKeyAlgorithm;
          existing.transports = Array.isArray(transports) ? [...new Set(transports.filter(Boolean))] : [];
        } else {
          passkeys.push({
            id: credentialId,
            label: label || auth.user.name || auth.user.email,
            publicKey,
            algorithm: publicKeyAlgorithm,
            transports: Array.isArray(transports) ? [...new Set(transports.filter(Boolean))] : [],
            createdAt: nowIso(clock),
            lastUsedAt: null,
            signCount: 0
          });
        }

        writeAudit(state, clock, {
          action: existing ? "auth.passkey_updated" : "auth.passkey_registered",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "passkey",
          targetId: credentialId
        });

        return {
          passkeys: passkeys.map(toPasskeySummary)
        };
      });
    },

    async listPasskeys(token) {
      return transact(AUTH_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        return {
          passkeys: getPasskeys(auth.user).map(toPasskeySummary)
        };
      });
    },

    async deletePasskey(token, credentialId) {
      return transact(AUTH_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        const passkeys = getPasskeys(auth.user);
        const index = passkeys.findIndex((entry) => entry.id === credentialId);
        ensure(index >= 0, "Passkey not found", 404);
        passkeys.splice(index, 1);
        writeAudit(state, clock, {
          action: "auth.passkey_deleted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "passkey",
          targetId: credentialId
        });
        return {
          ok: true,
          credentialId,
          passkeys: passkeys.map(toPasskeySummary)
        };
      });
    },

    async beginPasskeyLogin({ email, workspaceId = null }) {
      return transact(AUTH_SCOPE, (state) => {
        ensure(email, "Email is required");
        const user = findUserByEmail(state, email);
        ensure(user, "User not found", 404);
        const workspace = workspaceId
          ? state.workspaces.find((entry) => entry.id === workspaceId)
          : getUserWorkspace(state, user.id);
        ensure(workspace, "Workspace not found", 404);
        const membership = getMembership(state, user.id, workspace.id);
        ensure(membership, "Unauthorized workspace", 403);
        const passkeys = getPasskeys(user);
        ensure(passkeys.length > 0, "No passkeys registered", 404);
        return {
          user: formatUser(user),
          workspace: formatWorkspace(state, workspace, membership.role),
          passkeys: passkeys.map(toPasskeySummary)
        };
      });
    },

    async getPasskeyAssertion({ userId, workspaceId, credentialId }) {
      return transact(AUTH_SCOPE, (state) => {
        const user = findUserById(state, userId);
        ensure(user, "User not found", 404);
        const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
        ensure(workspace, "Workspace not found", 404);
        const membership = getMembership(state, user.id, workspace.id);
        ensure(membership, "Unauthorized workspace", 403);
        const passkey = getPasskeys(user).find((entry) => entry.id === credentialId);
        ensure(passkey, "Passkey not found", 404);
        return {
          user: formatUser(user),
          workspace: formatWorkspace(state, workspace, membership.role),
          passkey: {
            ...toPasskeySummary(passkey),
            publicKey: passkey.publicKey
          }
        };
      });
    },

    async completePasskeyLogin({ userId, workspaceId, credentialId, signCount = null }) {
      return transact(AUTH_SCOPE, (state) => {
        const user = findUserById(state, userId);
        ensure(user, "User not found", 404);
        const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
        ensure(workspace, "Workspace not found", 404);
        const membership = getMembership(state, user.id, workspace.id);
        ensure(membership, "Unauthorized workspace", 403);
        const passkey = getPasskeys(user).find((entry) => entry.id === credentialId);
        ensure(passkey, "Passkey not found", 404);

        passkey.lastUsedAt = nowIso(clock);
        if (Number.isInteger(signCount) && signCount >= 0) {
          passkey.signCount = signCount;
        }

        const sessionTokens = issueSessionTokens(state, clock, {
          userId: user.id,
          workspaceId: workspace.id,
          accessKind: "browser"
        });

        writeAudit(state, clock, {
          action: "auth.passkey_login",
          actorUserId: user.id,
          workspaceId: workspace.id,
          targetType: "passkey",
          targetId: credentialId
        });

        return {
          user: formatUser(user),
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token,
          passkeys: getPasskeys(user).map(toPasskeySummary)
        };
      });
    },

    async switchWorkspace(token, workspaceId) {
      return transact(AUTH_SCOPE, (state) => {
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
          user: formatUser(auth.user),
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async deviceStart({ email, workspaceId = null }) {
      return transact(AUTH_DEVICE_SCOPE, (state) => {
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
      return transact(AUTH_DEVICE_SCOPE, (state) => {
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
      return transact(AUTH_DEVICE_SCOPE, (state) => {
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
          user: formatUser(user),
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async refreshSession(refreshTokenValue) {
      return transact(AUTH_SCOPE, (state) => {
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
          user: formatUser(user),
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async logout(token, refreshTokenValue = null) {
      return transact(AUTH_SCOPE, (state) => {
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
      return transact(AUTH_SCOPE, (state) => {
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
      return transact(AUTH_SCOPE, (state) => {
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
      return transact(AUTH_SCOPE, (state) => {
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
      return transact(AUTH_DEVICE_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        const pendingDevices = state.deviceCodes.filter(
          (entry) =>
            entry.workspaceId === auth.workspace.id &&
            entry.status === "pending" &&
            new Date(entry.expiresAt).getTime() > nowMs(clock)
        );
        return {
          user: formatUser(auth.user),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          membership: auth.membership,
          usage: summarizeUsage(state, auth.workspace.id),
          limits: getEffectiveLimits(auth.workspace),
          overrides: getWorkspaceQuotaOverrides(auth.workspace),
          pendingDeviceCodes: pendingDevices.length,
          pendingDevices: pendingDevices.map((entry) => ({
            id: entry.id,
            code: entry.code,
            expiresAt: entry.expiresAt
          })),
          passkeys: getPasskeys(auth.user).map(toPasskeySummary)
        };
      });
    },

    async listWorkspaces(token) {
      return transact(AUTH_SCOPE, (state) => {
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

    async setWorkspacePlan(token, plan) {
      return transact(WORKSPACE_SCOPE, (state) => {
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
          limits: getEffectiveLimits(auth.workspace)
        };
      });
    },

    async getWorkspaceBilling(token) {
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const billableUsage = summarizeBillableUsage(state, auth.workspace.id);
        const billingSource = getWorkspaceBillingSource(state, auth.workspace, auth.user);
        const billing = normalizeWorkspaceBilling(billingSource?.billing);
        const pendingUsage = diffBillableUsageTotals(billableUsage, billing.billedUsageTotals);
        return {
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          billing: formatWorkspaceBilling(billingSource),
          usage: billableUsage,
          pricing: priceUsageSummary(billableUsage, billingCatalog),
          pendingInvoiceEstimate: priceUsageSummary(pendingUsage, billingCatalog)
        };
      });
    },

    /**
     * @param {string} token
     * @param {CheckoutSessionOptions} [options]
     */
    async createWorkspaceCheckoutSession(token: string, options: CheckoutSessionOptions = {}) {
      const { successUrl, cancelUrl } = options;
      return transact(WORKSPACE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const provider = requireBillingProvider();
        ensure(typeof provider.createCheckoutSession === "function", "Billing provider does not support checkout", 501);
        const billingOwner = ensureWorkspaceBillingOwner(state, auth.workspace, auth.user);
        const currentBilling = normalizeWorkspaceBilling(billingOwner?.billing);
        const session = await provider.createCheckoutSession({
          successUrl: ensureAbsoluteHttpUrl(successUrl, "Success URL"),
          cancelUrl: ensureAbsoluteHttpUrl(cancelUrl, "Cancel URL"),
          user: formatUser(billingOwner),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          membership: auth.membership,
          billing: formatWorkspaceBilling(billingOwner),
          pricing: priceUsageSummary(summarizeBillableUsage(state, auth.workspace.id), billingCatalog)
        });
        ensure(session && typeof session === "object", "Billing provider returned an invalid checkout session", 502);
        ensure(typeof session.id === "string" && session.id, "Billing checkout session id missing", 502);
        ensure(typeof session.url === "string" && session.url, "Billing checkout session URL missing", 502);

        writeWorkspaceBilling(billingOwner, clock, {
          provider: session.provider || provider.providerName || currentBilling.provider || "external",
          customerId:
            typeof session.customerId === "string" && session.customerId ? session.customerId : currentBilling.customerId,
          billingStatus:
            typeof session.billingStatus === "string" && session.billingStatus
              ? session.billingStatus
              : currentBilling.billingStatus || "checkout_open",
          lastCheckoutSessionId: session.id,
          lastSetupIntentId:
            typeof session.setupIntentId === "string" && session.setupIntentId
              ? session.setupIntentId
              : currentBilling.lastSetupIntentId
        });

        writeAudit(state, clock, {
          action: "workspace.billing_checkout_created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "billing_checkout",
          targetId: session.id,
          details: {
            provider: session.provider || provider.providerName || "external",
            pricingModel: "usage"
          }
        });

        return {
          checkoutSession: {
            id: session.id,
            url: session.url
          },
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          billing: formatWorkspaceBilling(billingOwner)
        };
      });
    },

    /**
     * @param {string} token
     * @param {BillingPortalOptions} [options]
     */
    async createWorkspaceBillingPortalSession(token: string, options: BillingPortalOptions = {}) {
      const { returnUrl } = options;
      return transact(WORKSPACE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const provider = requireBillingProvider();
        ensure(typeof provider.createPortalSession === "function", "Billing provider does not support billing portal", 501);
        const billingOwner = ensureWorkspaceBillingOwner(state, auth.workspace, auth.user);
        const billing = normalizeWorkspaceBilling(billingOwner?.billing);
        ensure(billing.customerId, "Workspace is not linked to a billing customer", 409);

        const session = await provider.createPortalSession({
          returnUrl: ensureAbsoluteHttpUrl(returnUrl, "Return URL"),
          user: formatUser(billingOwner),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          membership: auth.membership,
          billing: formatWorkspaceBilling(billingOwner)
        });
        ensure(session && typeof session === "object", "Billing provider returned an invalid portal session", 502);
        ensure(typeof session.id === "string" && session.id, "Billing portal session id missing", 502);
        ensure(typeof session.url === "string" && session.url, "Billing portal session URL missing", 502);

        writeWorkspaceBilling(billingOwner, clock, {
          provider: session.provider || provider.providerName || billing.provider || "external",
          lastPortalSessionId: session.id
        });

        writeAudit(state, clock, {
          action: "workspace.billing_portal_created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "billing_portal",
          targetId: session.id,
          details: {
            provider: session.provider || provider.providerName || billing.provider || "external"
          }
        });

        return {
          portalSession: {
            id: session.id,
            url: session.url
          },
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          billing: formatWorkspaceBilling(billingOwner)
        };
      });
    },

    async createWorkspaceUsageInvoice(token) {
      return transact(WORKSPACE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const provider = requireBillingProvider();
        ensure(typeof provider.createUsageInvoice === "function", "Billing provider does not support usage invoices", 501);
        const billingOwner = ensureWorkspaceBillingOwner(state, auth.workspace, auth.user);
        const billing = normalizeWorkspaceBilling(billingOwner?.billing);
        ensure(billing.customerId, "Workspace is not linked to a billing customer", 409);

        const currentUsage = summarizeBillableUsage(state, auth.workspace.id);
        const pendingUsage = diffBillableUsageTotals(currentUsage, billing.billedUsageTotals);
        const estimate = priceUsageSummary(pendingUsage, billingCatalog);
        const hasBillableUsage = Object.values(pendingUsage).some((value) => value > 0);

        if (!hasBillableUsage) {
          return {
            invoice: null,
            billing: formatWorkspaceBilling(billingOwner),
            usage: currentUsage,
            pendingInvoiceEstimate: estimate
          };
        }

        const invoice = await provider.createUsageInvoice({
          user: formatUser(billingOwner),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          membership: auth.membership,
          billing: formatWorkspaceBilling(billingOwner),
          usage: pendingUsage,
          pricing: estimate
        });
        ensure(invoice && typeof invoice === "object", "Billing provider returned an invalid invoice", 502);
        ensure(typeof invoice.id === "string" && invoice.id, "Billing invoice id missing", 502);

        writeWorkspaceBilling(billingOwner, clock, {
          provider: invoice.provider || provider.providerName || billing.provider || "external",
          billingStatus:
            typeof invoice.billingStatus === "string" && invoice.billingStatus
              ? invoice.billingStatus
              : billing.billingStatus || "active",
          lastInvoiceId: invoice.id,
          lastInvoiceStatus: typeof invoice.status === "string" ? invoice.status : null,
          lastInvoiceCurrency: typeof invoice.currency === "string" ? invoice.currency : estimate.currency,
          lastInvoiceAmountUsd:
            Number.isFinite(invoice.amountUsd) ? Number(invoice.amountUsd) : Number(estimate.totalUsd.toFixed(4)),
          billedUsageTotals: currentUsage
        });

        writeAudit(state, clock, {
          action: "workspace.billing_usage_invoiced",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "billing_invoice",
          targetId: invoice.id,
          details: {
            amountUsd: Number(estimate.totalUsd.toFixed(4)),
            runtimeMinutes: pendingUsage.runtimeMinutes,
            storageGbDays: pendingUsage.storageGbDays
          }
        });

        return {
          invoice: {
            id: invoice.id,
            status: invoice.status || null,
            hostedInvoiceUrl: invoice.hostedInvoiceUrl || null,
            amountUsd: Number(
              (Number.isFinite(invoice.amountUsd) ? Number(invoice.amountUsd) : estimate.totalUsd).toFixed(4)
            ),
            currency: invoice.currency || estimate.currency
          },
          billing: formatWorkspaceBilling(billingOwner),
          usage: currentUsage,
          pendingInvoiceEstimate: priceUsageSummary(
            diffBillableUsageTotals(currentUsage, normalizeWorkspaceBilling(billingOwner?.billing).billedUsageTotals),
            billingCatalog
          )
        };
      });
    },

    async addWorkspacePaymentMethod(token: string, input: { paymentMethodId: string }) {
      return transact(WORKSPACE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const provider = requireBillingProvider();
        ensure(typeof provider.addPaymentMethod === "function", "Billing provider does not support adding payment methods", 501);
        ensure(typeof input?.paymentMethodId === "string" && input.paymentMethodId, "Payment method id is required", 400);
        const billingOwner = ensureWorkspaceBillingOwner(state, auth.workspace, auth.user);

        const customerId = await provider.ensureCustomer({
          user: formatUser(billingOwner),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          billing: formatWorkspaceBilling(billingOwner)
        });

        const result = await provider.addPaymentMethod({
          customerId,
          paymentMethodId: input.paymentMethodId
        });
        ensure(result && typeof result === "object", "Billing provider returned an invalid payment method result", 502);

        writeWorkspaceBilling(billingOwner, clock, {
          provider: result.provider || provider.providerName || "external",
          customerId,
          billingStatus: "active",
          defaultPaymentMethodId: result.paymentMethodId || input.paymentMethodId
        });

        writeAudit(state, clock, {
          action: "workspace.billing_payment_method_added",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "billing_payment_method",
          targetId: result.paymentMethodId || input.paymentMethodId,
          details: { provider: result.provider || provider.providerName || "external" }
        });

        return {
          billing: formatWorkspaceBilling(billingOwner),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role)
        };
      });
    },

    async chargeWorkspace(token: string, input: { amountUsd: number; description?: string }) {
      return transact(WORKSPACE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const provider = requireBillingProvider();
        ensure(typeof provider.chargeCustomer === "function", "Billing provider does not support direct charges", 501);
        const billingOwner = ensureWorkspaceBillingOwner(state, auth.workspace, auth.user);
        const billing = normalizeWorkspaceBilling(billingOwner?.billing);
        ensure(billing.customerId, "Workspace is not linked to a billing customer", 409);
        ensure(billing.defaultPaymentMethodId, "No default payment method on file. Add a card first.", 409);
        const amountUsd = Number(input?.amountUsd);
        ensure(Number.isFinite(amountUsd) && amountUsd > 0, "Charge amount must be a positive number", 400);

        const charge = await provider.chargeCustomer({
          customerId: billing.customerId,
          paymentMethodId: billing.defaultPaymentMethodId,
          amountUsd,
          description: typeof input?.description === "string" ? input.description : `BurstFlare charge for workspace ${auth.workspace.name || auth.workspace.id}`
        });
        ensure(charge && typeof charge === "object", "Billing provider returned an invalid charge result", 502);
        ensure(typeof charge.id === "string" && charge.id, "Charge id missing", 502);

        const currentBalance = billing.creditBalanceUsd;
        const nextBalance = Number((currentBalance + amountUsd).toFixed(4));

        writeWorkspaceBilling(billingOwner, clock, {
          provider: charge.provider || provider.providerName || billing.provider || "external",
          billingStatus: charge.billingStatus || billing.billingStatus || "active",
          creditBalanceUsd: nextBalance
        });

        writeAudit(state, clock, {
          action: "workspace.billing_charged",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "billing_charge",
          targetId: charge.id,
          details: {
            amountUsd,
            creditBalanceUsd: nextBalance,
            provider: charge.provider || provider.providerName || "external"
          }
        });

        return {
          charge: {
            id: charge.id,
            amountUsd,
            status: charge.status || null,
            currency: charge.currency || "usd"
          },
          creditBalanceUsd: nextBalance,
          billing: formatWorkspaceBilling(billingOwner),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role)
        };
      });
    },

    async getWorkspaceBalance(token: string) {
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const billingSource = getWorkspaceBillingSource(state, auth.workspace, auth.user);
        const billing = normalizeWorkspaceBilling(billingSource?.billing);
        const billableUsage = summarizeBillableUsage(state, auth.workspace.id);
        const pendingUsage = diffBillableUsageTotals(billableUsage, billing.billedUsageTotals);
        const pendingCost = priceUsageSummary(pendingUsage, billingCatalog);
        return {
          creditBalanceUsd: billing.creditBalanceUsd,
          pendingUsageCostUsd: Number(pendingCost.totalUsd.toFixed(4)),
          estimatedRemainingBalanceUsd: Number(Math.max(0, billing.creditBalanceUsd - pendingCost.totalUsd).toFixed(4)),
          billing: formatWorkspaceBilling(billingSource),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role)
        };
      });
    },

    async applyBillingWebhook(event: any = {}) {
      return transact(WORKSPACE_SCOPE, (state) => {
        ensure(event && typeof event === "object" && !Array.isArray(event), "Billing event payload is required");
        ensure(typeof event.type === "string" && event.type, "Billing event type is required");
        ensure(typeof event.id === "string" && event.id, "Billing event id is required");
        const payload = event.data?.object;
        ensure(payload && typeof payload === "object" && !Array.isArray(payload), "Billing event object is required");

        const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
        const workspace = findWorkspaceByBillingReference(state, {
          workspaceId: typeof metadata.workspaceId === "string" ? metadata.workspaceId : null,
          customerId: typeof payload.customer === "string" ? payload.customer : null,
          subscriptionId: typeof payload.subscription === "string" ? payload.subscription : typeof payload.id === "string" && event.type.startsWith("customer.subscription.") ? payload.id : null,
          checkoutSessionId: typeof payload.id === "string" && event.type.startsWith("checkout.session.") ? payload.id : null
        });
        ensure(workspace, "Workspace not found for billing event", 404);

        const billingOwner = ensureWorkspaceBillingOwner(state, workspace);
        const billingTarget = billingOwner || workspace;
        const eventState = trackBillingWebhookEvent(billingTarget, clock, event.id);
        if (eventState.duplicate) {
          return {
            ok: true,
            duplicate: true,
            eventId: event.id,
            eventType: event.type,
            workspace: formatWorkspace(state, workspace, getMembership(state, workspace.ownerUserId, workspace.id)?.role || "owner"),
            billing: formatWorkspaceBilling(billingTarget)
          };
        }

        const currentBilling = normalizeWorkspaceBilling(billingTarget?.billing);

        if (event.type.startsWith("checkout.session.")) {
          writeWorkspaceBilling(billingTarget, clock, {
            provider: currentBilling.provider || "stripe",
            customerId: typeof payload.customer === "string" && payload.customer ? payload.customer : currentBilling.customerId,
            billingStatus:
              event.type === "checkout.session.completed"
                ? "active"
                : event.type === "checkout.session.expired"
                  ? "checkout_expired"
                  : currentBilling.billingStatus,
            defaultPaymentMethodId:
              typeof payload.payment_method === "string" && payload.payment_method
                ? payload.payment_method
                : currentBilling.defaultPaymentMethodId,
            lastSetupIntentId:
              typeof payload.setup_intent === "string" && payload.setup_intent
                ? payload.setup_intent
                : currentBilling.lastSetupIntentId,
            lastCheckoutSessionId: typeof payload.id === "string" && payload.id ? payload.id : currentBilling.lastCheckoutSessionId,
            subscriptionId: null,
            subscriptionStatus: null,
            pendingPlan: null
          });
        } else if (event.type.startsWith("customer.subscription.")) {
          writeWorkspaceBilling(billingTarget, clock, {
            provider: currentBilling.provider || "stripe",
            customerId: typeof payload.customer === "string" && payload.customer ? payload.customer : currentBilling.customerId,
            subscriptionId: typeof payload.id === "string" && payload.id ? payload.id : currentBilling.subscriptionId,
            subscriptionStatus:
              typeof payload.status === "string" && payload.status ? payload.status : currentBilling.subscriptionStatus,
            currentPeriodEnd: toIsoFromUnixSeconds(Number(payload.current_period_end)),
            cancelAtPeriodEnd: Boolean(payload.cancel_at_period_end)
          });
        } else if (event.type === "invoice.paid") {
          writeWorkspaceBilling(billingTarget, clock, {
            provider: currentBilling.provider || "stripe",
            customerId: typeof payload.customer === "string" && payload.customer ? payload.customer : currentBilling.customerId,
            billingStatus: "active",
            lastInvoiceId: typeof payload.id === "string" ? payload.id : currentBilling.lastInvoiceId,
            lastInvoiceStatus: typeof payload.status === "string" ? payload.status : "paid",
            lastInvoiceCurrency:
              typeof payload.currency === "string" ? payload.currency : currentBilling.lastInvoiceCurrency,
            lastInvoiceAmountUsd:
              Number.isFinite(payload.amount_paid) ? Number((Number(payload.amount_paid) / 100).toFixed(4)) : currentBilling.lastInvoiceAmountUsd
          });
        } else if (event.type === "invoice.payment_failed") {
          writeWorkspaceBilling(billingTarget, clock, {
            provider: currentBilling.provider || "stripe",
            customerId: typeof payload.customer === "string" && payload.customer ? payload.customer : currentBilling.customerId,
            billingStatus: "delinquent",
            lastInvoiceId: typeof payload.id === "string" ? payload.id : currentBilling.lastInvoiceId,
            lastInvoiceStatus: typeof payload.status === "string" ? payload.status : "open",
            lastInvoiceCurrency:
              typeof payload.currency === "string" ? payload.currency : currentBilling.lastInvoiceCurrency,
            lastInvoiceAmountUsd:
              Number.isFinite(payload.amount_due) ? Number((Number(payload.amount_due) / 100).toFixed(4)) : currentBilling.lastInvoiceAmountUsd
          });
        }

        writeAudit(state, clock, {
          action: "workspace.billing_webhook_applied",
          actorUserId: null,
          workspaceId: workspace.id,
          targetType: "billing_event",
          targetId: event.id,
          details: {
            eventType: event.type
          }
        });

        return {
          ok: true,
          duplicate: false,
          eventId: event.id,
          eventType: event.type,
          workspace: formatWorkspace(state, workspace, getMembership(state, workspace.ownerUserId, workspace.id)?.role || "owner"),
          billing: formatWorkspaceBilling(billingTarget)
        };
      });
    },

    async setWorkspaceQuotaOverrides(token, overrides: any = {}) {
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const clear = Boolean(overrides.clear);
        const normalized = clear ? {} : normalizeQuotaOverrides(overrides);
        auth.workspace.quotaOverrides = Object.keys(normalized).length > 0 ? normalized : null;
        writeAudit(state, clock, {
          action: "workspace.quota_overrides_updated",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace",
          targetId: auth.workspace.id,
          details: {
            clear,
            overrides: auth.workspace.quotaOverrides || {}
          }
        });
        return {
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          limits: getEffectiveLimits(auth.workspace),
          overrides: getWorkspaceQuotaOverrides(auth.workspace)
        };
      });
    },

    async listWorkspaceSecrets(token) {
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        writeAudit(state, clock, {
          action: "workspace.secrets_viewed",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace",
          targetId: auth.workspace.id
        });
        return {
          secrets: listRuntimeSecretMetadata(auth.workspace)
        };
      });
    },

    async setWorkspaceSecret(token, name, value) {
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const normalizedName = normalizeSecretName(name);
        const normalizedValue = normalizeSecretValue(value);
        const secrets = getWorkspaceRuntimeSecrets(auth.workspace);
        const existing = secrets.find((entry) => entry.name === normalizedName) || null;
        if (!existing) {
          ensure(secrets.length < MAX_RUNTIME_SECRETS, "Runtime secret limit reached", 403);
        }
        const timestamp = nowIso(clock);
        if (existing) {
          existing.value = normalizedValue;
          existing.updatedAt = timestamp;
        } else {
          secrets.push({
            name: normalizedName,
            value: normalizedValue,
            createdAt: timestamp,
            updatedAt: timestamp
          });
        }
        writeAudit(state, clock, {
          action: existing ? "workspace.secret_rotated" : "workspace.secret_created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace_secret",
          targetId: normalizedName,
          details: {
            valueBytes: new TextEncoder().encode(normalizedValue).byteLength
          }
        });
        return {
          secret: listRuntimeSecretMetadata(auth.workspace).find((entry) => entry.name === normalizedName),
          secrets: listRuntimeSecretMetadata(auth.workspace)
        };
      });
    },

    async deleteWorkspaceSecret(token, name) {
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const normalizedName = normalizeSecretName(name);
        const secrets = getWorkspaceRuntimeSecrets(auth.workspace);
        const existing = secrets.find((entry) => entry.name === normalizedName) || null;
        ensure(existing, "Secret not found", 404);
        auth.workspace.runtimeSecrets = secrets.filter((entry) => entry.name !== normalizedName);
        writeAudit(state, clock, {
          action: "workspace.secret_deleted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace_secret",
          targetId: normalizedName
        });
        return {
          ok: true,
          secretName: normalizedName,
          secrets: listRuntimeSecretMetadata(auth.workspace)
        };
      });
    },

    async updateWorkspaceSettings(token, { name }) {
      return transact(WORKSPACE_SCOPE, (state) => {
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

    async createInstance(
      token,
      {
        name,
        description = "",
        baseImage = null,
        image = null,
        dockerfilePath = null,
        dockerContext = null,
        envVars = {},
        secrets = {},
        persistedPaths = [],
        sleepTtlSeconds = null
      }
    ) {
      const created = await transact(INSTANCE_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        ensure(typeof name === "string" && name.trim(), "Instance name is required");
        const nextName = name.trim();
        ensure(nextName.length >= 3, "Instance name must be at least 3 characters");
        ensure(nextName.length <= 80, "Instance name is too long");
        const runtimeSpec = resolveInstanceRuntimeSpec({
          baseImage: resolveInstanceBaseImage({ baseImage, image }),
          dockerfilePath,
          dockerContext
        });
        ensure(
          !state.instances.some(
            (entry) => entry.userId === auth.user.id && entry.name.toLowerCase() === nextName.toLowerCase()
          ),
          "Instance name already exists"
        );

        const timestamp = nowIso(clock);
        const instance = {
          id: createId("ins"),
          userId: auth.user.id,
          name: nextName,
          description: String(description || ""),
          image: runtimeSpec.baseImage,
          baseImage: runtimeSpec.baseImage,
          managedRuntimeImage: null,
          managedImageDigest: null,
          bootstrapVersion: runtimeSpec.bootstrapVersion,
          buildId: null,
          buildStatus: "pending",
          buildRequestedAt: null,
          buildCompletedAt: null,
          buildArtifactKey: null,
          buildError: null,
          dockerfilePath: dockerfilePath == null ? null : String(dockerfilePath),
          dockerContext: dockerContext == null ? null : String(dockerContext),
          envVars: normalizeInstanceEnvVars(envVars),
          secrets: normalizeInstanceSecrets(secrets),
          persistedPaths: normalizePersistedPaths(persistedPaths) || [],
          sleepTtlSeconds: normalizeSleepTtlSeconds(sleepTtlSeconds),
          commonStateKey: null,
          commonStateBytes: 0,
          commonStateUpdatedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        state.instances.push(instance);
        writeAudit(state, clock, {
          action: "instance.created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "instance",
          targetId: instance.id,
          details: {
            name: instance.name,
            baseImage: instance.baseImage
          }
        });
        return {
          instanceId: instance.id
        };
      });
      return queueManagedInstanceBuild(created.instanceId, "created");
    },

    async listInstances(token) {
      return transact(INSTANCE_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        const instances = state.instances
          .filter((entry) => entry.userId === auth.user.id)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map((entry) => formatInstance(entry));
        return { instances };
      });
    },

    async getInstance(token, instanceId) {
      return transact(INSTANCE_SCOPE, (state) => {
        const auth = requireInstanceAccess(state, token, instanceId, clock);
        return {
          instance: formatInstance(auth.instance)
        };
      });
    },

    async saveInstanceCommonState(token, instanceId, options: any = {}) {
      const { body, contentType = "application/octet-stream" } = options;
      return transact(INSTANCE_SCOPE, async (state) => {
        const auth = requireInstanceAccess(state, token, instanceId, clock);
        return writeInstanceCommonStateInState(state, auth.instance, auth.workspace, {
          actorUserId: auth.user.id,
          body,
          contentType
        });
      });
    },

    async getInstanceCommonState(token, instanceId) {
      return transact(INSTANCE_SCOPE, async (state) => {
        const auth = requireInstanceAccess(state, token, instanceId, clock);
        const content = await readInstanceCommonStateInState(auth.instance);
        return {
          instance: formatInstance(auth.instance),
          commonState: {
            key: content.key,
            bytes: content.bytes,
            updatedAt: auth.instance.commonStateUpdatedAt
          },
          body: content.body,
          contentType: content.contentType,
          bytes: content.bytes,
          fileName: `${auth.instance.name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase() || auth.instance.id}.home-flare.json`
        };
      });
    },

    async updateInstance(token, instanceId, updates: any = {}) {
      const result = await transact(INSTANCE_SCOPE, (state) => {
        const auth = requireInstanceAccess(state, token, instanceId, clock);
        let shouldRebuild = false;
        if (Object.prototype.hasOwnProperty.call(updates, "name")) {
          ensure(typeof updates.name === "string" && updates.name.trim(), "Instance name is required");
          const nextName = updates.name.trim();
          ensure(nextName.length >= 3, "Instance name must be at least 3 characters");
          ensure(nextName.length <= 80, "Instance name is too long");
          ensure(
            !state.instances.some(
              (entry) =>
                entry.id !== auth.instance.id &&
                entry.userId === auth.user.id &&
                entry.name.toLowerCase() === nextName.toLowerCase()
            ),
            "Instance name already exists"
          );
          auth.instance.name = nextName;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "description")) {
          auth.instance.description = String(updates.description || "");
        }
        if (
          Object.prototype.hasOwnProperty.call(updates, "image") ||
          Object.prototype.hasOwnProperty.call(updates, "baseImage") ||
          Object.prototype.hasOwnProperty.call(updates, "dockerfilePath") ||
          Object.prototype.hasOwnProperty.call(updates, "dockerContext")
        ) {
          shouldRebuild = true;
          const nextBaseImage = Object.prototype.hasOwnProperty.call(updates, "baseImage")
            ? updates.baseImage
            : Object.prototype.hasOwnProperty.call(updates, "image")
              ? updates.image
              : auth.instance.baseImage;
          const runtimeSpec = resolveInstanceRuntimeSpec({
            baseImage: resolveInstanceBaseImage({ baseImage: nextBaseImage, image: auth.instance.image }),
            dockerfilePath: Object.prototype.hasOwnProperty.call(updates, "dockerfilePath")
              ? updates.dockerfilePath
              : auth.instance.dockerfilePath,
            dockerContext: Object.prototype.hasOwnProperty.call(updates, "dockerContext")
              ? updates.dockerContext
              : auth.instance.dockerContext
          });
          auth.instance.image = runtimeSpec.baseImage;
          auth.instance.baseImage = runtimeSpec.baseImage;
          auth.instance.managedRuntimeImage = runtimeSpec.managedRuntimeImage;
          auth.instance.managedImageDigest = runtimeSpec.managedImageDigest;
          auth.instance.bootstrapVersion = runtimeSpec.bootstrapVersion;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "dockerfilePath")) {
          auth.instance.dockerfilePath = updates.dockerfilePath == null ? null : String(updates.dockerfilePath);
        }
        if (Object.prototype.hasOwnProperty.call(updates, "dockerContext")) {
          auth.instance.dockerContext = updates.dockerContext == null ? null : String(updates.dockerContext);
        }
        if (Object.prototype.hasOwnProperty.call(updates, "envVars")) {
          auth.instance.envVars = normalizeInstanceEnvVars(updates.envVars);
        }
        if (Object.prototype.hasOwnProperty.call(updates, "secrets")) {
          auth.instance.secrets = normalizeInstanceSecrets(updates.secrets);
        }
        if (Object.prototype.hasOwnProperty.call(updates, "persistedPaths")) {
          auth.instance.persistedPaths = normalizePersistedPaths(updates.persistedPaths) || [];
        }
        if (Object.prototype.hasOwnProperty.call(updates, "sleepTtlSeconds")) {
          auth.instance.sleepTtlSeconds = normalizeSleepTtlSeconds(updates.sleepTtlSeconds);
        }
        auth.instance.updatedAt = nowIso(clock);
        writeAudit(state, clock, {
          action: "instance.updated",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "instance",
          targetId: auth.instance.id
        });
        return {
          instance: formatInstance(auth.instance),
          shouldRebuild
        };
      });
      if (result.shouldRebuild) {
        return queueManagedInstanceBuild(instanceId, "updated");
      }
      return {
        instance: result.instance
      };
    },

    async deleteInstance(token, instanceId) {
      return transact(INSTANCE_SCOPE, async (state) => {
        const auth = requireInstanceAccess(state, token, instanceId, clock);
        const index = state.instances.findIndex((entry) => entry.id === auth.instance.id);
        ensure(index >= 0, "Instance not found", 404);
        if (auth.instance.commonStateKey && objects?.deleteCommonState) {
          await objects.deleteCommonState({
            instance: auth.instance
          });
        }
        state.instances.splice(index, 1);
        writeAudit(state, clock, {
          action: "instance.deleted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "instance",
          targetId: auth.instance.id
        });
        return {
          ok: true,
          instanceId: auth.instance.id
        };
      });
    },

    async saveSystemInstanceCommonState(sessionId, options: any = {}) {
      const { body, contentType = "application/octet-stream" } = options;
      return transact(INSTANCE_SCOPE, async (state) => {
        const session = state.sessions.find((entry) => entry.id === sessionId);
        ensure(session, "Session not found", 404);
        ensure(session.instanceId, "Session instance not found", 404);
        const instance = state.instances.find((entry) => entry.id === session.instanceId);
        ensure(instance, "Instance not found", 404);
        const workspace = state.workspaces.find((entry) => entry.id === session.workspaceId);
        ensure(workspace, "Workspace not found", 404);
        return writeInstanceCommonStateInState(state, instance, workspace, {
          actorUserId: null,
          body,
          contentType,
          auditAction: "instance.common_state_saved_system"
        });
      });
    },

    async processSystemInstanceBuild(instanceId, buildId = null, options: any = {}) {
      return runSystemInstanceBuild(instanceId, buildId, String(options?.reason || "system"));
    },

    async createTemplate() {
      failLegacyTemplateBackendRemoved();
    },

    async archiveTemplate() {
      failLegacyTemplateBackendRemoved();
    },

    async restoreTemplate() {
      failLegacyTemplateBackendRemoved();
    },

    async deleteTemplate() {
      failLegacyTemplateBackendRemoved();
    },

    async listTemplates() {
      failLegacyTemplateBackendRemoved();
    },

    async getTemplate() {
      failLegacyTemplateBackendRemoved();
    },

    async listTemplateBuilds() {
      failLegacyTemplateBackendRemoved();
    },

    async addTemplateVersion() {
      failLegacyTemplateBackendRemoved();
    },

    async uploadTemplateVersionBundle() {
      failLegacyTemplateBackendRemoved();
    },

    async createTemplateVersionBundleUploadGrant() {
      failLegacyTemplateBackendRemoved();
    },

    async getTemplateVersionBundle() {
      failLegacyTemplateBackendRemoved();
    },

    async processTemplateBuilds() {
      failLegacyTemplateBackendRemoved();
    },

    async processTemplateBuildById() {
      failLegacyTemplateBackendRemoved();
    },

    async markTemplateBuildWorkflow() {
      failLegacyTemplateBackendRemoved();
    },

    async getTemplateBuildLog() {
      failLegacyTemplateBackendRemoved();
    },

    async getTemplateBuildArtifact() {
      failLegacyTemplateBackendRemoved();
    },

    async retryTemplateBuild() {
      failLegacyTemplateBackendRemoved();
    },

    async retryDeadLetteredBuilds() {
      failLegacyTemplateBackendRemoved();
    },

    async promoteTemplateVersion() {
      failLegacyTemplateBackendRemoved();
    },

    async listBindingReleases() {
      failLegacyTemplateBackendRemoved();
    },

    async rollbackTemplate() {
      failLegacyTemplateBackendRemoved();
    },

    async createSession(token, { name, templateId = null, instanceId = null }) {
      return transact(SESSION_SCOPE, (state) => {
        let auth: any;
        let instance: any = null;
        ensure(name, "Session name is required");
        ensure(instanceId, "Instance is required");
        auth = requireInstanceAccess(state, token, instanceId, clock);
        instance = auth.instance;
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
          templateId: null,
          instanceId: instance?.id || null,
          name,
          state: "created",
          createdByUserId: auth.user.id,
          createdAt: nowIso(clock),
          updatedAt: nowIso(clock),
          lastStartedAt: null,
          lastStoppedAt: null,
          runtimeDesiredState: null,
          runtimeStatus: null,
          runtimeState: null,
          runtimeVersion: 0,
          runtimeOperationId: null,
          runtimeUpdatedAt: null,
          persistedPaths: [...(instance.persistedPaths || [])],
          sleepTtlSeconds: instance.sleepTtlSeconds || null,
          sshAuthorizedKeys: [],
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
          details: {
            name,
            templateId: null,
            instanceId: instance?.id || null
          }
        });
        return { session: formatSession(state, session) };
      });
    },

    async startSession(token, sessionId) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        return applySessionTransition({
          state,
          clock,
          auth,
          action: "start"
        });
      });
    },

    async stopSession(token, sessionId) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        return applySessionTransition({
          state,
          clock,
          auth,
          action: "stop"
        });
      });
    },

    async restartSession(token, sessionId) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        return applySessionTransition({
          state,
          clock,
          auth,
          action: "restart"
        });
      });
    },

    async deleteSession(token, sessionId) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        return applySessionTransition({
          state,
          clock,
          auth,
          action: "delete"
        });
      });
    },

    async transitionSessionWithRuntime(token, sessionId, action, applyRuntime) {
      ensure(typeof applyRuntime === "function", "Runtime transition handler is required");
      const session = await transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        return formatSession(state, auth.session);
      });
      const runtime = await applyRuntime(session);
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        if (isStaleRuntimeSnapshot(auth.session, runtime)) {
          return {
            session: formatSession(state, auth.session),
            runtime,
            stale: true
          };
        }
        return applySessionTransition({
          state,
          clock,
          auth,
          action,
          runtime
        });
      });
    },

    async listSessionsForRuntimeReconcile() {
      return transact(SESSION_SCOPE, (state) => {
        const sessions = state.sessions
          .filter((entry) => entry.state !== "deleted")
          .map((session) => formatSession(state, session));
        return { sessions };
      });
    },

    async applySystemSessionTransition(sessionId, action, runtime = null) {
      return transact(SESSION_SCOPE, (state) => {
        const session = state.sessions.find((entry) => entry.id === sessionId);
        ensure(session, "Session not found", 404);
        if (isStaleRuntimeSnapshot(session, runtime)) {
          return {
            session: formatSession(state, session),
            runtime,
            stale: true
          };
        }
        const workspace = state.workspaces.find((entry) => entry.id === session.workspaceId) || {
          id: session.workspaceId,
          plan: "free"
        };
        return applySessionTransition({
          state,
          clock,
          auth: {
            user: {
              id: null
            },
            session,
            workspace
          },
          action,
          runtime
        });
      });
    },

    async listSessions(token) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        const sessions = state.sessions
          .filter((entry) => entry.state !== "deleted")
          .filter((entry) => {
            const instance = getSessionInstance(state, entry);
            return entry.workspaceId === auth.workspace.id || (instance ? instance.userId === auth.user.id : false);
          })
          .map((session) => formatSession(state, session));
        return { sessions };
      });
    },

    async listSessionEvents(token, sessionId) {
      return transact(SESSION_SCOPE, (state) => {
        requireSessionAccess(state, token, sessionId, clock);
        const events = state.sessionEvents.filter((entry) => entry.sessionId === sessionId);
        return { events };
      });
    },

    async getSession(token, sessionId) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        const snapshots = listVisibleSessionSnapshots(state, auth.session.id);
        const events = state.sessionEvents.filter((entry) => entry.sessionId === auth.session.id);
        return {
          session: formatSession(state, auth.session),
          snapshots,
          events
        };
      });
    },

    async createSnapshot(token, sessionId, { label = "manual" }) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        const existing = getLatestSessionSnapshot(state, auth.session.id);
        const timestamp = nowIso(clock);
        const snapshot =
          existing ||
          ({
            id: createId("snap"),
            sessionId: auth.session.id,
            label,
            objectKey: `snapshots/${auth.workspace.id}/${auth.session.id}/latest.bin`,
            uploadedAt: null,
            contentType: null,
            bytes: 0,
            inlineContentBase64: null,
            createdAt: timestamp
          } as any);
        snapshot.label = label;
        snapshot.objectKey = snapshot.objectKey || `snapshots/${auth.workspace.id}/${auth.session.id}/latest.bin`;
        snapshot.uploadedAt = null;
        snapshot.contentType = null;
        snapshot.bytes = 0;
        snapshot.inlineContentBase64 = null;
        snapshot.createdAt = timestamp;
        if (!existing) {
          state.snapshots.push(snapshot);
        }
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
          details: { label, replacedExisting: Boolean(existing) }
        });
        return { snapshot };
      });
    },

    /**
     * @param {string} token
     * @param {string} sessionId
     * @param {string} snapshotId
     * @param {UploadBodyOptions} [options]
     */
    async uploadSnapshotContent(token: string, sessionId: string, snapshotId: string, options: UploadBodyOptions = {}) {
      const { body, contentType = "application/octet-stream" } = options;
      return transact(SESSION_SCOPE, async (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        const snapshot = requireLatestSnapshot(state, auth.session.id, snapshotId);
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
      { contentType = "application/octet-stream", bytes = null }: any = {}
    ) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        const snapshot = requireLatestSnapshot(state, auth.session.id, snapshotId);
        if (bytes !== null) {
          ensure(Number.isInteger(bytes) && bytes > 0, "Upload bytes must be a positive integer");
          ensure(bytes <= MAX_SNAPSHOT_BYTES, "Snapshot exceeds size limit", 413);
          const currentStorage = summarizeStorage(state, auth.workspace.id);
          ensureStorageWithinLimit(state, auth.workspace, currentStorage.totalBytes - (snapshot.bytes || 0) + bytes);
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

    /**
     * @param {string} grantId
     * @param {UploadBodyOptions} [options]
     */
    async consumeUploadGrant(grantId: string, options: UploadBodyOptions = {}) {
      const { body, contentType = "application/octet-stream" } = options;
      return transact(ADMIN_SCOPE, async (state) => {
        const grants = pruneUploadGrants(state, clock);
        const uploadGrant = grants.find((entry) => entry.id === grantId);
        ensure(uploadGrant, "Upload grant not found", 404);

        const payload = toUint8Array(body);
        ensure(payload.byteLength > 0, "Upload body is required");
        if (uploadGrant.expectedBytes !== null && uploadGrant.expectedBytes !== undefined) {
          ensure(payload.byteLength === uploadGrant.expectedBytes, "Upload body size does not match grant");
        }

        if (uploadGrant.kind === "template_bundle") {
          failLegacyTemplateBackendRemoved();
        }

        uploadGrant.usedAt = nowIso(clock);
        const effectiveContentType = contentType || uploadGrant.contentType || "application/octet-stream";

        if (uploadGrant.kind === "snapshot") {
          const workspace = state.workspaces.find((entry) => entry.id === uploadGrant.workspaceId);
          ensure(workspace, "Workspace not found", 404);
          const session = state.sessions.find(
            (entry) => entry.id === uploadGrant.sessionId && entry.workspaceId === uploadGrant.workspaceId
          );
          ensure(session, "Session not found", 404);
          ensure(session.state !== "deleted", "Session deleted", 409);
          const snapshot = requireLatestSnapshot(state, session.id, uploadGrant.snapshotId);
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
      return transact(SESSION_SCOPE, (state) => {
        requireSessionAccess(state, token, sessionId, clock);
        return {
          snapshots: listVisibleSessionSnapshots(state, sessionId)
        };
      });
    },

    async getSnapshotContent(token, sessionId, snapshotId) {
      return transact(SESSION_SCOPE, async (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        const snapshot = requireLatestSnapshot(state, auth.session.id, snapshotId);
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

    async getRuntimeSnapshotContent(token, sessionId, snapshotId) {
      return transact(SESSION_SCOPE, async (state) => {
        const access = requireRuntimeToken(state, token, sessionId, clock);
        const snapshot = requireLatestSnapshot(state, access.session.id, snapshotId);
        ensure(snapshot.uploadedAt, "Snapshot content not uploaded", 404);
        const workspace = state.workspaces.find((entry) => entry.id === access.session.workspaceId);
        ensure(workspace, "Workspace not found", 404);

        if (objects?.getSnapshot) {
          const content = await objects.getSnapshot({
            workspace,
            session: access.session,
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

    async restoreSnapshot(token, sessionId, snapshotId) {
      return transact(SESSION_SCOPE, async (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        ensure(["created", "running", "sleeping"].includes(auth.session.state), "Session cannot restore snapshots", 409);
        const snapshot = requireLatestSnapshot(state, auth.session.id, snapshotId);
        ensure(snapshot.uploadedAt, "Snapshot content not uploaded", 404);

        auth.session.lastRestoredSnapshotId = snapshot.id;
        auth.session.lastRestoredAt = nowIso(clock);
        auth.session.updatedAt = nowIso(clock);
        writeSessionEvent(state, clock, auth.session.id, "restored", {
          snapshotId: snapshot.id
        });
        writeAudit(state, clock, {
          action: "snapshot.restored",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "snapshot",
          targetId: snapshot.id,
          details: {
            sessionId: auth.session.id
          }
        });
        return {
          session: formatSession(state, auth.session),
          snapshot
        };
      });
    },

    async deleteSnapshot(token, sessionId, snapshotId) {
      return transact(SESSION_SCOPE, async (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        const snapshot = requireLatestSnapshot(state, auth.session.id, snapshotId);

        if (objects?.deleteSnapshot) {
          await objects.deleteSnapshot({
            workspace: auth.workspace,
            session: auth.session,
            snapshot
          });
        }

        state.snapshots = state.snapshots.filter((entry) => entry.sessionId !== auth.session.id);
        if (auth.session.lastRestoredSnapshotId === snapshot.id) {
          auth.session.lastRestoredSnapshotId = null;
          auth.session.lastRestoredAt = null;
        }
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

    async upsertSessionSshKey(token, sessionId, payload) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session is deleted", 409);
        const normalized = normalizeSessionSshKey(payload);
        const keys = getSessionSshKeys(auth.session);
        const existing = keys.find((entry) => entry.keyId === normalized.keyId && entry.userId === auth.user.id);
        const timestamp = nowIso(clock);
        if (existing) {
          existing.publicKey = normalized.publicKey;
          existing.label = normalized.label;
          existing.updatedAt = timestamp;
        } else {
          keys.push({
            keyId: normalized.keyId,
            label: normalized.label,
            publicKey: normalized.publicKey,
            userId: auth.user.id,
            createdAt: timestamp,
            updatedAt: timestamp
          });
        }
        auth.session.updatedAt = timestamp;
        writeAudit(state, clock, {
          action: "session.ssh_key_upserted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "session",
          targetId: auth.session.id,
          details: {
            keyId: normalized.keyId,
            keyCount: keys.length
          }
        });
        return {
          ok: true,
          sessionId: auth.session.id,
          sshKey: {
            keyId: normalized.keyId,
            label: normalized.label,
            createdAt: existing?.createdAt || timestamp,
            updatedAt: timestamp
          },
          sshKeyCount: keys.length
        };
      });
    },

    async issueRuntimeToken(token, sessionId) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state === "running", "Session is not running", 409);
        ensure(listSessionAuthorizedPublicKeys(auth.session).length > 0, "SSH key is not configured for this session", 409);
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
          sshUser: "flare",
          sshCommand:
            "ssh -i <local-key-path> -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null " +
            "-o IdentitiesOnly=yes -o PreferredAuthentications=publickey -p <local-port> flare@127.0.0.1",
          sshKeyCount: listSessionAuthorizedPublicKeys(auth.session).length
        };
      });
    },

    async validateRuntimeToken(token, sessionId) {
      return transact(SESSION_SCOPE, (state) => {
        const access = requireRuntimeToken(state, token, sessionId, clock);
        return {
          ok: true,
          sessionId,
          session: formatSession(state, access.session, { includeSshKeys: true })
        };
      });
    },

    async getUsage(token) {
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        writeAudit(state, clock, {
          action: "usage.viewed",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace",
          targetId: auth.workspace.id
        });
        return {
          usage: summarizeUsage(state, auth.workspace.id),
          limits: getEffectiveLimits(auth.workspace),
          overrides: getWorkspaceQuotaOverrides(auth.workspace),
          plan: auth.workspace.plan
        };
      });
    },

    async getAudit(token, { limit = 50 }: { limit?: number } = {}) {
      return transact(ADMIN_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        writeAudit(state, clock, {
          action: "audit.viewed",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace",
          targetId: auth.workspace.id,
          details: { limit }
        });
        const items = state.auditLogs
          .filter((entry) => entry.workspaceId === auth.workspace.id)
          .slice(-limit)
          .reverse();
        return { audit: items };
      });
    },

    async getAdminReport(token) {
      return transact(ADMIN_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        writeAudit(state, clock, {
          action: "admin.report_viewed",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace",
          targetId: auth.workspace.id
        });
        const reportAt = nowMs(clock);
        const reconcileCandidates = getReconcileCandidates(state, auth.workspace.id, reportAt);
        const report = {
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          members: state.memberships.filter((entry) => entry.workspaceId === auth.workspace.id).length,
          instances: state.instances.filter((entry) => entry.userId === auth.workspace.ownerUserId).length,
          templates: 0,
          templatesArchived: 0,
          buildsQueued: 0,
          buildsBuilding: 0,
          buildsStuck: 0,
          buildsFailed: 0,
          buildsDeadLettered: 0,
          sessionsRunning: getRunningSessionCount(state, auth.workspace.id),
          sessionsSleeping: state.sessions.filter(
            (entry) => entry.workspaceId === auth.workspace.id && entry.state === "sleeping"
          ).length,
          sessionsStaleEligible: reconcileCandidates.staleSleepingSessions.length,
          sessionsTotal: state.sessions.filter(
            (entry) => entry.workspaceId === auth.workspace.id && entry.state !== "deleted"
          ).length,
          activeUploadGrants: getUploadGrants(state).filter((entry) => {
            if (entry.workspaceId !== auth.workspace.id || entry.usedAt) {
              return false;
            }
            return new Date(entry.expiresAt).getTime() > reportAt;
          }).length,
          releases: 0,
          limits: getEffectiveLimits(auth.workspace),
          reconcileCandidates: {
            runningSessions: reconcileCandidates.runningSessions.length,
            stuckBuilds: reconcileCandidates.stuckBuilds.length,
            queuedBuilds: reconcileCandidates.queuedBuilds.length,
            staleSleepingSessions: reconcileCandidates.staleSleepingSessions.length,
            deletedSessions: reconcileCandidates.deletedSessions.length
          }
        };
        return { report };
      });
    },

    async previewReconcile(token) {
      return transact(ADMIN_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        writeAudit(state, clock, {
          action: "admin.reconcile_previewed",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace",
          targetId: auth.workspace.id
        });
        const candidates = getReconcileCandidates(state, auth.workspace.id);
        return {
          preview: summarizeReconcileCandidates(candidates)
        };
      });
    },

    async sleepRunningSessions(token) {
      return transact(ADMIN_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        return sleepRunningSessionsInState(state, {
          workspaceId: auth.workspace.id,
          reason: "operator"
        });
      });
    },

    async recoverStuckBuilds(token) {
      return transact(ADMIN_SCOPE, async (state) => {
        requireManageWorkspace(state, token, clock);
        failLegacyTemplateBackendRemoved();
      });
    },

    async purgeStaleSleepingSessions(token) {
      return transact(ADMIN_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const candidates = getReconcileCandidates(state, auth.workspace.id);
        const purged = await purgeSessionsInState(state, candidates.staleSleepingSessions, {
          actorUserId: auth.user.id,
          auditAction: "session.purged_stale",
          auditDetails: (session) => ({
            sleepTtlSeconds: session.sleepTtlSeconds,
            lastStoppedAt: session.lastStoppedAt,
            source: "operator"
          })
        });
        return {
          purgedStaleSleepingSessions: purged.purgedSessions,
          purgedSnapshots: purged.purgedSnapshots,
          sessionIds: purged.sessionIds
        };
      });
    },

    async purgeDeletedSessions(token) {
      return transact(ADMIN_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const candidates = getReconcileCandidates(state, auth.workspace.id);
        const purged = await purgeSessionsInState(state, candidates.deletedSessions, {
          actorUserId: auth.user.id,
          auditAction: "session.purged_deleted",
          auditDetails: (session) => ({
            deletedAt: session.updatedAt,
            source: "operator"
          })
        });
        return {
          purgedDeletedSessions: purged.purgedSessions,
          purgedSnapshots: purged.purgedSnapshots,
          sessionIds: purged.sessionIds
        };
      });
    },

    async exportWorkspace(token) {
      return transact(ADMIN_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const workspaceId = auth.workspace.id;
        const sessionIds = new Set(
          state.sessions.filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.id)
        );
        const artifacts = {
          templateBundles: [],
          buildArtifacts: [],
          snapshots: Array.from(sessionIds)
            .map((sessionId) => getLatestSessionSnapshot(state, sessionId))
            .filter(Boolean)
            .map((entry) => ({
              snapshotId: entry.id,
              sessionId: entry.sessionId,
              objectKey: entry.objectKey,
              contentType: entry.contentType,
              bytes: entry.bytes,
              uploadedAt: entry.uploadedAt
            }))
        };
        writeAudit(state, clock, {
          action: "admin.exported",
          actorUserId: auth.user.id,
          workspaceId,
          targetType: "workspace",
          targetId: workspaceId,
          details: {
            instances: state.instances.filter((entry) => entry.userId === auth.workspace.ownerUserId).length,
            sessions: sessionIds.size
          }
        });

        return {
          export: {
            exportedAt: nowIso(clock),
            workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
            members: state.memberships.filter((entry) => entry.workspaceId === workspaceId),
            instances: state.instances
              .filter((entry) => entry.userId === auth.workspace.ownerUserId)
              .map((entry) => formatInstance(entry)),
            templates: [],
            builds: [],
            releases: [],
            sessions: state.sessions
              .filter((entry) => entry.workspaceId === workspaceId)
              .map((entry) => formatSession(state, entry)),
            snapshots: Array.from(sessionIds)
              .map((sessionId) => getLatestSessionSnapshot(state, sessionId))
              .filter(Boolean),
            artifacts,
            security: {
              runtimeSecrets: listRuntimeSecretMetadata(auth.workspace)
            },
            usage: state.usageEvents.filter((entry) => entry.workspaceId === workspaceId),
            audit: state.auditLogs.filter((entry) => entry.workspaceId === workspaceId)
          }
        };
      });
    },

    async getSystemRuntimeSecrets(sessionId) {
      return transact(SESSION_SCOPE, (state) => {
        const session = state.sessions.find((entry) => entry.id === sessionId);
        ensure(session, "Session not found", 404);
        const workspace = state.workspaces.find((entry) => entry.id === session.workspaceId);
        ensure(workspace, "Workspace not found", 404);
        return {
          runtimeSecrets: getRuntimeSecretMap(workspace),
          secretNames: listRuntimeSecretMetadata(workspace).map((entry) => entry.name)
        };
      });
    },

    async reconcile(token) {
      return transact(ADMIN_SCOPE, async (state) => {
        const auth = token ? requireManageWorkspace(state, token, clock) : null;
        const workspaceId = auth?.workspace.id || null;

        const slept = await sleepRunningSessionsInState(state, {
          workspaceId,
          reason: "reconcile"
        });

        const candidates = getReconcileCandidates(state, workspaceId);
        const stalePurged = await purgeSessionsInState(state, candidates.staleSleepingSessions, {
          actorUserId: auth?.user.id || null,
          auditAction: "session.purged_stale",
          auditDetails: (session) => ({
            sleepTtlSeconds: session.sleepTtlSeconds,
            lastStoppedAt: session.lastStoppedAt
          }),
          includeOrphanSnapshots: true,
          workspaceId
        });
        const deletedPurged = await purgeSessionsInState(state, candidates.deletedSessions, {
          actorUserId: auth?.user.id || null,
          auditAction: "session.purged_deleted",
          auditDetails: (session) => ({
            deletedAt: session.updatedAt
          }),
          workspaceId
        });

        return {
          sleptSessions: slept.sleptSessions,
          recoveredStuckBuilds: 0,
          processedBuilds: 0,
          purgedDeletedSessions: deletedPurged.purgedSessions,
          purgedStaleSleepingSessions: stalePurged.purgedSessions,
          purgedSnapshots: stalePurged.purgedSnapshots + deletedPurged.purgedSnapshots
        };
      });
    },

    async enqueueReconcile(token) {
      return transact(ADMIN_SCOPE, async (state) => {
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
