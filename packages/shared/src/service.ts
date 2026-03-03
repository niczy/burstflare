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
import { createId } from "./utils.js";

const DEVICE_CODE_TTL_MS = 1000 * 60 * 10;
const EMAIL_AUTH_CODE_TTL_MS = 1000 * 60 * 10;
const UPLOAD_GRANT_TTL_MS = 1000 * 60 * 10;
const MAX_BUILD_ATTEMPTS = 3;
const STUCK_BUILD_TTL_MS = 1000 * 60 * 5;
const MAX_TEMPLATE_BUNDLE_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_COMMON_STATE_BYTES = 512 * 1024;
const MAX_RUNTIME_SECRETS = 32;
const MAX_RUNTIME_SECRET_VALUE_BYTES = 4096;
const ALLOWED_TEMPLATE_FEATURES = new Set(["ssh", "browser", "snapshots"]);

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

function createBindingManifest(template, templateVersion, build) {
  return {
    image: templateVersion?.manifest?.image || null,
    imageReference: build?.artifactImageReference || null,
    imageDigest: build?.artifactImageDigest || null,
    configDigest: build?.artifactConfigDigest || null,
    layerCount: build?.artifactLayerCount || 0,
    features: templateVersion?.manifest?.features || [],
    persistedPaths: templateVersion?.manifest?.persistedPaths || [],
    bundleUploaded: Boolean(templateVersion?.bundleUploadedAt),
    artifactKey: build?.artifactKey || null,
    artifactSource: build?.artifactSource || null,
    artifactDigest: build?.artifactDigest || null,
    artifactBuiltAt: build?.artifactBuiltAt || null,
    templateName: template?.name || "unknown"
  };
}

function writeBindingRelease(state, clock, workspaceId, templateId, templateVersionId, binding = null, extra = {}) {
  const release = {
    id: createId("rel"),
    workspaceId,
    templateId,
    templateVersionId,
    binding,
    ...extra,
    createdAt: nowIso(clock)
  };
  state.bindingReleases.push(release);
  return release;
}

function formatBindingRelease(state, release) {
  const version = state.templateVersions.find((candidate) => candidate.id === release.templateVersionId);
  const template = state.templates.find((candidate) => candidate.id === release.templateId);
  const build = version ? state.templateBuilds.find((candidate) => candidate.templateVersionId === version.id) : null;
  return {
    ...release,
    binding: release.binding || createBindingManifest(template, version, build),
    templateName: template?.name || "unknown",
    version: version?.version || "unknown"
  };
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

function requireTemplateAccess(state, authToken, templateId, clock) {
  const auth = requireAuth(state, authToken, clock);
  const template = state.templates.find((entry) => entry.id === templateId && entry.workspaceId === auth.workspace.id);
  ensure(template, "Template not found", 404);
  return { ...auth, template };
}

function requireInstanceAccess(state, authToken, instanceId, clock) {
  const auth = requireAuth(state, authToken, clock);
  const instance = state.instances.find((entry) => entry.id === instanceId && entry.userId === auth.user.id);
  ensure(instance, "Instance not found", 404);
  return { ...auth, instance };
}

function getSessionInstance(state, session) {
  if (!session?.instanceId) {
    return null;
  }
  return state.instances.find((entry) => entry.id === session.instanceId) || null;
}

function listSessionSnapshots(state, sessionId) {
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

function getLatestSessionSnapshot(state, sessionId) {
  return listSessionSnapshots(state, sessionId)[0] || null;
}

function listVisibleSessionSnapshots(state, sessionId) {
  const snapshot = getLatestSessionSnapshot(state, sessionId);
  return snapshot ? [snapshot] : [];
}

function requireLatestSnapshot(state, sessionId, snapshotId) {
  const snapshot = getLatestSessionSnapshot(state, sessionId);
  ensure(snapshot && snapshot.id === snapshotId, "Snapshot not found", 404);
  return snapshot;
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

function getTemplateReleases(state, templateId) {
  return state.bindingReleases
    .filter((entry) => entry.templateId === templateId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function summarizeTemplateBuilds(versions) {
  const summary = {
    queued: 0,
    building: 0,
    succeeded: 0,
    failed: 0,
    deadLettered: 0,
    other: 0
  };
  for (const version of versions) {
    const status = version.build?.status || null;
    if (!status) {
      continue;
    }
    if (status === "dead_lettered") {
      summary.deadLettered += 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(summary, status)) {
      summary[status] += 1;
      continue;
    }
    summary.other += 1;
  }
  return summary;
}

function summarizeTemplateArtifacts(versions) {
  return versions.reduce(
    (summary, version) => {
      summary.bundleBytes += version.bundleBytes || 0;
      summary.buildArtifactBytes += version.build?.artifactBytes || 0;
      if (version.bundleUploadedAt) {
        summary.versionBundles += 1;
      }
      if (version.build?.artifactBuiltAt) {
        summary.buildArtifacts += 1;
      }
      return summary;
    },
    {
      bundleBytes: 0,
      buildArtifactBytes: 0,
      versionBundles: 0,
      buildArtifacts: 0
    }
  );
}

function formatTemplate(state, template) {
  const versions = state.templateVersions
    .filter((entry) => entry.templateId === template.id)
    .map((version) => {
      const build = state.templateBuilds.find((entry) => entry.templateVersionId === version.id) || null;
      return { ...version, build };
    });
  const releases = getTemplateReleases(state, template.id);
  const activeVersion = versions.find((entry) => entry.id === template.activeVersionId) || null;
  return {
    ...template,
    activeVersion,
    versions,
    releaseCount: releases.length,
    latestRelease: releases.length ? releases[releases.length - 1] : null,
    buildSummary: summarizeTemplateBuilds(versions),
    storageSummary: summarizeTemplateArtifacts(versions)
  };
}

function formatTemplateDetail(state, template) {
  return {
    ...formatTemplate(state, template),
    releases: getTemplateReleases(state, template.id)
  };
}

function formatInstance(instance) {
  const { secrets: _secrets, ...baseInstance } = instance;
  const secretNames = Object.keys(instance.secrets || {}).sort();
  return {
    ...baseInstance,
    envVars: { ...(instance.envVars || {}) },
    persistedPaths: Array.isArray(instance.persistedPaths) ? [...instance.persistedPaths] : [],
    secretNames,
    secretCount: secretNames.length
  };
}

function formatSession(state, session, { includeSshKeys = false }: { includeSshKeys?: boolean } = {}) {
  const instance = getSessionInstance(state, session);
  const events = state.sessionEvents.filter((entry) => entry.sessionId === session.id);
  const snapshots = listVisibleSessionSnapshots(state, session.id);
  const { sshAuthorizedKeys: _sshAuthorizedKeys, ...baseSession } = session;
  const sshKeyCount = getSessionSshKeys(session).length;
  return {
    ...baseSession,
    instanceId: session.instanceId || null,
    instanceName: instance?.name || null,
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

function syncSessionRuntimeSnapshot(session, runtime, clock) {
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

function syncLatestRestoredSnapshot(state, session, timestamp) {
  const snapshot = getLatestSessionSnapshot(state, session.id);
  if (!snapshot) {
    session.lastRestoredSnapshotId = null;
    session.lastRestoredAt = null;
    return;
  }
  session.lastRestoredSnapshotId = snapshot.id;
  session.lastRestoredAt = timestamp;
}

function isStaleRuntimeSnapshot(session, runtime) {
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

function resolveSessionStateFromRuntime(action, runtime) {
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

function applySessionTransition({ state, clock, auth, action, runtime = null }) {
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
    `dispatch_mode=${build.dispatchMode || ""}`,
    `execution_source=${build.executionSource || ""}`,
    `attempts=${build.attempts}`,
    `last_error=${build.lastError || ""}`,
    `last_failure_at=${build.lastFailureAt || ""}`,
    `dead_lettered_at=${build.deadLetteredAt || ""}`,
    `workflow_name=${build.workflowName || ""}`,
    `workflow_instance_id=${build.workflowInstanceId || ""}`,
    `workflow_status=${build.workflowStatus || ""}`,
    `workflow_queued_at=${build.workflowQueuedAt || ""}`,
    `workflow_started_at=${build.workflowStartedAt || ""}`,
    `workflow_finished_at=${build.workflowFinishedAt || ""}`,
    `artifact_key=${build.artifactKey || ""}`,
    `artifact_source=${build.artifactSource || ""}`,
    `artifact_digest=${build.artifactDigest || ""}`,
    `artifact_image_reference=${build.artifactImageReference || ""}`,
    `artifact_image_digest=${build.artifactImageDigest || ""}`,
    `artifact_config_digest=${build.artifactConfigDigest || ""}`,
    `artifact_layer_count=${build.artifactLayerCount || 0}`,
    `artifact_bytes=${build.artifactBytes || 0}`,
    `artifact_built_at=${build.artifactBuiltAt || ""}`,
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

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(toUint8Array(value)));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function tryDecodeText(value) {
  try {
    return new TextDecoder().decode(toUint8Array(value));
  } catch (_error) {
    return "";
  }
}

async function loadBuildInput({ objects, template, templateVersion }) {
  if (templateVersion.bundleUploadedAt && objects?.getTemplateVersionBundle) {
    const bundle = await objects.getTemplateVersionBundle({
      workspace: { id: template.workspaceId },
      template,
      templateVersion
    });
    if (bundle?.body) {
      return {
        source: "bundle",
        body: bundle.body,
        bytes: bundle.bytes ?? toUint8Array(bundle.body).byteLength,
        contentType: bundle.contentType || templateVersion.bundleContentType || "application/octet-stream"
      };
    }
  }

  const fallback = JSON.stringify(
    {
      image: templateVersion.manifest?.image || null,
      features: templateVersion.manifest?.features || [],
      persistedPaths: templateVersion.manifest?.persistedPaths || []
    },
    null,
    2
  );
  return {
    source: "manifest",
    body: fallback,
    bytes: new TextEncoder().encode(fallback).byteLength,
    contentType: "application/json; charset=utf-8"
  };
}

function parseImageReference(image) {
  const raw = String(image || "").trim();
  if (!raw) {
    return {
      repository: null,
      tag: null
    };
  }

  const withoutDigest = raw.split("@")[0];
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  if (lastColon > lastSlash) {
    return {
      repository: withoutDigest.slice(0, lastColon),
      tag: withoutDigest.slice(lastColon + 1)
    };
  }
  return {
    repository: withoutDigest,
    tag: "latest"
  };
}

async function buildTemplateArtifact({ template, templateVersion, build, input, clock }) {
  const text = tryDecodeText(input.body);
  const lineCount = text ? text.split(/\r?\n/).length : 0;
  const sourceSha256 = await sha256Hex(input.body);
  const manifestJson = JSON.stringify(templateVersion.manifest || {}, null, 2);
  const manifestSha256 = await sha256Hex(manifestJson);
  const imageParts = parseImageReference(templateVersion.manifest?.image);
  const imageRepository = imageParts.repository || `registry.cloudflare.com/burstflare/${template.id}`;
  const imageTag = imageParts.tag || templateVersion.version || "latest";
  const imageDigest = `sha256:${await sha256Hex(`${sourceSha256}:${manifestSha256}:image`)}`;
  const configDigest = `sha256:${await sha256Hex(`${manifestSha256}:${templateVersion.id}:config`)}`;
  const layerDigests = [
    `sha256:${await sha256Hex(`${sourceSha256}:bundle-layer`)}`,
    `sha256:${await sha256Hex(`${manifestSha256}:manifest-layer`)}`
  ];
  const buildReference = `${imageRepository}:${imageTag}`;
  const artifact = {
    buildId: build.id,
    templateId: template.id,
    templateName: template.name,
    templateVersionId: templateVersion.id,
    version: templateVersion.version,
    image: templateVersion.manifest?.image || null,
    imageRepository,
    imageTag,
    imageReference: `${imageRepository}@${imageDigest}`,
    imageDigest,
    configDigest,
    layerDigests,
    layerCount: layerDigests.length,
    buildReference,
    buildStrategy: "simulated-oci",
    features: templateVersion.manifest?.features || [],
    persistedPaths: templateVersion.manifest?.persistedPaths || [],
    source: input.source,
    sourceContentType: input.contentType,
    sourceBytes: input.bytes,
    sourceSha256,
    manifestSha256,
    lineCount,
    labels: {
      "org.opencontainers.image.title": template.name,
      "org.opencontainers.image.version": templateVersion.version,
      "org.opencontainers.image.revision": build.id,
      "org.opencontainers.image.source": buildReference
    },
    builtAt: nowIso(clock)
  };
  return {
    json: JSON.stringify(artifact, null, 2),
    artifact
  };
}

async function persistBuildArtifact({ objects, build, artifactJson }) {
  if (!objects?.putBuildArtifact) {
    return;
  }
  await objects.putBuildArtifact({
    build,
    artifact: artifactJson
  });
}

async function clearBuildArtifact({ objects, build }) {
  if (!objects?.deleteBuildArtifact || !build?.artifactKey) {
    return;
  }
  await objects.deleteBuildArtifact({ build });
}

function isAsyncBuildSource(source) {
  return source === "queue" || source === "workflow";
}

function applyBuildDispatch(build, dispatch, clock) {
  if (!dispatch) {
    return;
  }
  build.dispatchMode = dispatch.dispatch || build.dispatchMode || null;
  build.lastQueuedAt = dispatch.dispatchedAt || nowIso(clock);

  if (dispatch.workflow) {
    build.workflowName = dispatch.workflow.name || build.workflowName || null;
    build.workflowInstanceId = dispatch.workflow.instanceId || build.workflowInstanceId || null;
    build.workflowStatus = "queued";
    build.workflowQueuedAt = dispatch.workflow.dispatchedAt || dispatch.dispatchedAt || nowIso(clock);
    build.workflowStartedAt = null;
    build.workflowFinishedAt = null;
  } else if (dispatch.dispatch === "queue") {
    build.workflowStatus = null;
    build.workflowQueuedAt = null;
    build.workflowStartedAt = null;
    build.workflowFinishedAt = null;
  }
}

function markBuildWorkflowState(build, status, clock) {
  if (!status) {
    return;
  }
  build.workflowStatus = status;
  if (status === "running") {
    build.workflowStartedAt = build.startedAt || nowIso(clock);
    build.workflowFinishedAt = null;
    return;
  }
  if (["succeeded", "failed", "dead_lettered"].includes(status)) {
    build.workflowFinishedAt = build.finishedAt || nowIso(clock);
  }
}

async function enqueueBuildDispatch({ jobs, build, clock }) {
  if (!jobs?.enqueueBuild) {
    return null;
  }
  const dispatch = await jobs.enqueueBuild(build.id);
  applyBuildDispatch(build, dispatch, clock);
  return dispatch;
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
  build.executionSource = source;
  templateVersion.status = "building";
  if (source === "workflow") {
    markBuildWorkflowState(build, "running", clock);
  }

  const failureReason = getBuildFailureReason(templateVersion);
  if (failureReason) {
    build.finishedAt = nowIso(clock);
    build.updatedAt = nowIso(clock);
    build.lastError = failureReason;
    build.lastFailureAt = build.finishedAt;
    build.artifactDigest = null;
    build.artifactBytes = 0;
    build.artifactBuiltAt = null;
    build.artifactSource = null;
    build.artifactImageReference = null;
    build.artifactImageDigest = null;
    build.artifactConfigDigest = null;
    build.artifactLayerCount = 0;
    templateVersion.status = "failed";
    templateVersion.builtAt = null;
    await clearBuildArtifact({ objects, build });

    if (isAsyncBuildSource(source) && build.attempts < MAX_BUILD_ATTEMPTS) {
      build.status = "retrying";
      await enqueueBuildDispatch({ jobs, build, clock });
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
      if (source === "workflow" || build.dispatchMode === "workflow") {
        markBuildWorkflowState(build, "dead_lettered", clock);
      }
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
      if (source === "workflow" || build.dispatchMode === "workflow") {
        markBuildWorkflowState(build, "failed", clock);
      }
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
  if (source === "workflow" || build.dispatchMode === "workflow") {
    markBuildWorkflowState(build, "succeeded", clock);
  }

  const buildInput = await loadBuildInput({
    objects,
    template,
    templateVersion
  });
  const builtArtifact = await buildTemplateArtifact({
    template,
    templateVersion,
    build,
    input: buildInput,
    clock
  });
  build.artifactSource = builtArtifact.artifact.source;
  build.artifactDigest = builtArtifact.artifact.sourceSha256;
  build.artifactBytes = new TextEncoder().encode(builtArtifact.json).byteLength;
  build.artifactBuiltAt = builtArtifact.artifact.builtAt;
  build.artifactImageReference = builtArtifact.artifact.imageReference;
  build.artifactImageDigest = builtArtifact.artifact.imageDigest;
  build.artifactConfigDigest = builtArtifact.artifact.configDigest;
  build.artifactLayerCount = builtArtifact.artifact.layerCount;
  await persistBuildArtifact({
    objects,
    build,
    artifactJson: builtArtifact.json
  });

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
  const TEMPLATE_SCOPE = [...AUTH_SCOPE, "instances", "templates", "templateVersions", "templateBuilds", "bindingReleases", "sessions", "uploadGrants"];
  const SESSION_SCOPE = [...AUTH_SCOPE, "instances", "templates", "templateVersions", "sessions", "sessionEvents", "snapshots", "usageEvents"];
  const ADMIN_SCOPE = [...TEMPLATE_SCOPE, "deviceCodes", "sessionEvents", "snapshots", "usageEvents"];
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

function getWorkspaceBuildRecords(state, workspaceId = null) {
    void state;
    void workspaceId;
    return [];
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

    const buildRecords = getWorkspaceBuildRecords(state, workspaceId);
    const stuckBuilds = [];
    const queuedBuilds = [];

    for (const record of buildRecords) {
      if (["queued", "retrying"].includes(record.build.status)) {
        queuedBuilds.push(record);
      }
      if (record.build.status !== "building") {
        continue;
      }
      const referenceTime = record.build.startedAt || record.build.updatedAt || record.build.createdAt;
      if (!referenceTime) {
        continue;
      }
      if (checkedAtMs - new Date(referenceTime).getTime() >= STUCK_BUILD_TTL_MS) {
        stuckBuilds.push(record);
      }
    }

    return {
      checkedAt: new Date(checkedAtMs).toISOString(),
      runningSessions,
      staleSleepingSessions,
      deletedSessions,
      stuckBuilds,
      queuedBuilds
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

  async function recoverStuckBuildsInState(
    state,
    { workspaceId = null, actorUserId = null, source = "reconcile" }: any = {}
  ) {
    const candidates = getReconcileCandidates(state, workspaceId);
    const recoveredBuildIds = [];

    for (const record of candidates.stuckBuilds) {
      const recoveredAt = nowIso(clock);
      record.build.updatedAt = recoveredAt;
      record.build.lastError = "Reconcile recovered stuck build";
      record.build.lastFailureAt = recoveredAt;
      record.version.status = "queued";

      if (record.build.attempts >= MAX_BUILD_ATTEMPTS) {
        record.build.status = "dead_lettered";
        record.build.deadLetteredAt = recoveredAt;
        if (record.build.dispatchMode === "workflow") {
          record.build.workflowStatus = "dead_lettered";
          record.build.workflowFinishedAt = recoveredAt;
        }
        writeAudit(state, clock, {
          action: "template.build_dead_lettered",
          actorUserId,
          workspaceId: record.template.workspaceId,
          targetType: "template_build",
          targetId: record.build.id,
          details: {
            templateId: record.template.id,
            templateVersionId: record.version.id,
            source,
            attempts: record.build.attempts,
            maxAttempts: MAX_BUILD_ATTEMPTS,
            error: record.build.lastError
          }
        });
      } else {
        record.build.status = "retrying";
        record.build.deadLetteredAt = null;
        await enqueueBuildDispatch({ jobs, build: record.build, clock });
        writeAudit(state, clock, {
          action: "template.build_recovered",
          actorUserId,
          workspaceId: record.template.workspaceId,
          targetType: "template_build",
          targetId: record.build.id,
          details: {
            templateId: record.template.id,
            templateVersionId: record.version.id,
            source,
            attempts: record.build.attempts,
            maxAttempts: MAX_BUILD_ATTEMPTS
          }
        });
      }
      recoveredBuildIds.push(record.build.id);
    }

    return {
      recoveredStuckBuilds: recoveredBuildIds.length,
      buildIds: recoveredBuildIds
    };
  }

  async function processQueuedBuildsInState(
    state,
    { workspaceId = null, actorUserId = null, source = "reconcile" }: any = {}
  ) {
    const processedBuildIds = [];

    for (const record of getWorkspaceBuildRecords(state, workspaceId)) {
      if (!["queued", "retrying"].includes(record.build.status)) {
        continue;
      }
      if (jobs?.buildStrategy === "workflow") {
        if (["queued", "running"].includes(record.build.workflowStatus)) {
          continue;
        }
        const dispatched = await enqueueBuildDispatch({ jobs, build: record.build, clock });
        if (dispatched) {
          processedBuildIds.push(record.build.id);
        }
        continue;
      }
      const processedBuild = await processBuildRecord({
        state,
        clock,
        objects,
        jobs,
        build: record.build,
        template: record.template,
        templateVersion: record.version,
        source,
        actorUserId
      });
      if (processedBuild) {
        processedBuildIds.push(record.build.id);
      }
    }

    return {
      processedBuilds: processedBuildIds.length,
      buildIds: processedBuildIds
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
        image,
        dockerfilePath = null,
        dockerContext = null,
        envVars = {},
        secrets = {},
        persistedPaths = [],
        sleepTtlSeconds = null
      }
    ) {
      return transact(INSTANCE_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        ensure(typeof name === "string" && name.trim(), "Instance name is required");
        const nextName = name.trim();
        ensure(nextName.length >= 3, "Instance name must be at least 3 characters");
        ensure(nextName.length <= 80, "Instance name is too long");
        ensure(typeof image === "string" && image.trim(), "Instance image is required");
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
          image: image.trim(),
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
            image: instance.image
          }
        });
        return {
          instance: formatInstance(instance)
        };
      });
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
      return transact(INSTANCE_SCOPE, (state) => {
        const auth = requireInstanceAccess(state, token, instanceId, clock);
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
        if (Object.prototype.hasOwnProperty.call(updates, "image")) {
          ensure(typeof updates.image === "string" && updates.image.trim(), "Instance image is required");
          auth.instance.image = updates.image.trim();
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
          instance: formatInstance(auth.instance)
        };
      });
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
      return {
        recovered: 0,
        buildIds: []
      };
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
        const workspaceBuilds = getWorkspaceBuildRecords(state, auth.workspace.id);
        const reconcileCandidates = getReconcileCandidates(state, auth.workspace.id, reportAt);
        const report = {
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          members: state.memberships.filter((entry) => entry.workspaceId === auth.workspace.id).length,
          instances: state.instances.filter((entry) => entry.userId === auth.workspace.ownerUserId).length,
          templates: 0,
          templatesArchived: 0,
          buildsQueued: workspaceBuilds.filter((entry) => ["queued", "retrying"].includes(entry.build.status)).length,
          buildsBuilding: workspaceBuilds.filter((entry) => entry.build.status === "building").length,
          buildsStuck: reconcileCandidates.stuckBuilds.length,
          buildsFailed: workspaceBuilds.filter((entry) => entry.build.status === "failed").length,
          buildsDeadLettered: workspaceBuilds.filter((entry) => entry.build.status === "dead_lettered").length,
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
        const auth = requireManageWorkspace(state, token, clock);
        return recoverStuckBuildsInState(state, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          source: "operator"
        });
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

        const recovered = await recoverStuckBuildsInState(state, {
          workspaceId,
          actorUserId: auth?.user.id || null,
          source: "reconcile"
        });

        const processed = await processQueuedBuildsInState(state, {
          workspaceId,
          actorUserId: auth?.user.id || null,
          source: "reconcile"
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
          recoveredStuckBuilds: recovered.recoveredStuckBuilds,
          processedBuilds: processed.processedBuilds,
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
