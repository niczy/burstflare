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

const DEFAULT_BILLING_CATALOG = {
  currency: "usd",
  runtimeMinuteUsd: 0.03,
  snapshotUsd: 0.02,
  templateBuildUsd: 0.1
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

function normalizeQuotaOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return {};
  }
  const normalized = {};
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

function normalizeUsageTotals(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    runtimeMinutes: Number.isFinite(source.runtimeMinutes) ? Math.max(0, Number(source.runtimeMinutes)) : 0,
    snapshots: Number.isFinite(source.snapshots) ? Math.max(0, Number(source.snapshots)) : 0,
    templateBuilds: Number.isFinite(source.templateBuilds) ? Math.max(0, Number(source.templateBuilds)) : 0
  };
}

function normalizeWorkspaceBilling(billing) {
  const source = billing && typeof billing === "object" && !Array.isArray(billing) ? billing : {};
  return {
    pricingModel: typeof source.pricingModel === "string" ? source.pricingModel : "usage",
    provider: typeof source.provider === "string" ? source.provider : null,
    customerId: typeof source.customerId === "string" ? source.customerId : null,
    billingStatus: typeof source.billingStatus === "string" ? source.billingStatus : null,
    defaultPaymentMethodId: typeof source.defaultPaymentMethodId === "string" ? source.defaultPaymentMethodId : null,
    lastSetupIntentId: typeof source.lastSetupIntentId === "string" ? source.lastSetupIntentId : null,
    lastInvoiceId: typeof source.lastInvoiceId === "string" ? source.lastInvoiceId : null,
    lastInvoiceStatus: typeof source.lastInvoiceStatus === "string" ? source.lastInvoiceStatus : null,
    lastInvoiceCurrency: typeof source.lastInvoiceCurrency === "string" ? source.lastInvoiceCurrency : null,
    lastInvoiceAmountUsd:
      Number.isFinite(source.lastInvoiceAmountUsd) ? Math.max(0, Number(source.lastInvoiceAmountUsd)) : null,
    billedUsageTotals: normalizeUsageTotals(source.billedUsageTotals),
    subscriptionId: typeof source.subscriptionId === "string" ? source.subscriptionId : null,
    subscriptionStatus: typeof source.subscriptionStatus === "string" ? source.subscriptionStatus : null,
    pendingPlan: typeof source.pendingPlan === "string" ? source.pendingPlan : null,
    currentPeriodEnd: typeof source.currentPeriodEnd === "string" ? source.currentPeriodEnd : null,
    cancelAtPeriodEnd: Boolean(source.cancelAtPeriodEnd),
    lastCheckoutSessionId: typeof source.lastCheckoutSessionId === "string" ? source.lastCheckoutSessionId : null,
    lastPortalSessionId: typeof source.lastPortalSessionId === "string" ? source.lastPortalSessionId : null,
    recentWebhookEventIds: Array.isArray(source.recentWebhookEventIds)
      ? source.recentWebhookEventIds.filter((entry) => typeof entry === "string").slice(-25)
      : [],
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null
  };
}

function formatWorkspaceBilling(workspace) {
  const billing = normalizeWorkspaceBilling(workspace?.billing);
  return {
    pricingModel: billing.pricingModel,
    provider: billing.provider,
    customerId: billing.customerId,
    billingStatus: billing.billingStatus,
    defaultPaymentMethodId: billing.defaultPaymentMethodId,
    lastSetupIntentId: billing.lastSetupIntentId,
    lastInvoiceId: billing.lastInvoiceId,
    lastInvoiceStatus: billing.lastInvoiceStatus,
    lastInvoiceCurrency: billing.lastInvoiceCurrency,
    lastInvoiceAmountUsd: billing.lastInvoiceAmountUsd,
    billedUsageTotals: billing.billedUsageTotals,
    subscriptionId: billing.subscriptionId,
    subscriptionStatus: billing.subscriptionStatus,
    pendingPlan: billing.pendingPlan,
    currentPeriodEnd: billing.currentPeriodEnd,
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
    lastCheckoutSessionId: billing.lastCheckoutSessionId,
    lastPortalSessionId: billing.lastPortalSessionId,
    updatedAt: billing.updatedAt
  };
}

function writeWorkspaceBilling(workspace, clock, updates = {}) {
  const current = normalizeWorkspaceBilling(workspace?.billing);
  const next = {
    ...current,
    ...updates,
    pricingModel: "usage",
    billedUsageTotals:
      updates.billedUsageTotals !== undefined ? normalizeUsageTotals(updates.billedUsageTotals) : current.billedUsageTotals,
    recentWebhookEventIds: Array.isArray(updates.recentWebhookEventIds)
      ? updates.recentWebhookEventIds.filter((entry) => typeof entry === "string").slice(-25)
      : current.recentWebhookEventIds,
    updatedAt: nowIso(clock)
  };
  workspace.billing = next;
  return next;
}

function trackBillingWebhookEvent(workspace, clock, eventId) {
  if (!eventId) {
    return { duplicate: false, billing: normalizeWorkspaceBilling(workspace?.billing) };
  }
  const current = normalizeWorkspaceBilling(workspace?.billing);
  if (current.recentWebhookEventIds.includes(eventId)) {
    return { duplicate: true, billing: current };
  }
  return {
    duplicate: false,
    billing: writeWorkspaceBilling(workspace, clock, {
      recentWebhookEventIds: [...current.recentWebhookEventIds, eventId]
    })
  };
}

function toIsoFromUnixSeconds(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function normalizeBillingCatalog(catalog = {}) {
  const source = catalog && typeof catalog === "object" && !Array.isArray(catalog) ? catalog : {};
  const currency =
    typeof source.currency === "string" && source.currency.trim() ? source.currency.trim().toLowerCase() : "usd";
  const runtimeMinuteUsd = Number.isFinite(source.runtimeMinuteUsd)
    ? Math.max(0, Number(source.runtimeMinuteUsd))
    : DEFAULT_BILLING_CATALOG.runtimeMinuteUsd;
  const snapshotUsd = Number.isFinite(source.snapshotUsd)
    ? Math.max(0, Number(source.snapshotUsd))
    : DEFAULT_BILLING_CATALOG.snapshotUsd;
  const templateBuildUsd = Number.isFinite(source.templateBuildUsd)
    ? Math.max(0, Number(source.templateBuildUsd))
    : DEFAULT_BILLING_CATALOG.templateBuildUsd;
  return {
    currency,
    runtimeMinuteUsd,
    snapshotUsd,
    templateBuildUsd
  };
}

function priceUsageSummary(usage, catalog) {
  const normalizedUsage = normalizeUsageTotals(usage);
  const normalizedCatalog = normalizeBillingCatalog(catalog);
  const runtimeUsd = normalizedUsage.runtimeMinutes * normalizedCatalog.runtimeMinuteUsd;
  const snapshotsUsd = normalizedUsage.snapshots * normalizedCatalog.snapshotUsd;
  const templateBuildsUsd = normalizedUsage.templateBuilds * normalizedCatalog.templateBuildUsd;
  const totalUsd = runtimeUsd + snapshotsUsd + templateBuildsUsd;
  return {
    currency: normalizedCatalog.currency,
    usage: normalizedUsage,
    rates: {
      runtimeMinuteUsd: normalizedCatalog.runtimeMinuteUsd,
      snapshotUsd: normalizedCatalog.snapshotUsd,
      templateBuildUsd: normalizedCatalog.templateBuildUsd
    },
    lineItems: [
      {
        metric: "runtimeMinutes",
        quantity: normalizedUsage.runtimeMinutes,
        unitAmountUsd: normalizedCatalog.runtimeMinuteUsd,
        amountUsd: Number(runtimeUsd.toFixed(4))
      },
      {
        metric: "snapshots",
        quantity: normalizedUsage.snapshots,
        unitAmountUsd: normalizedCatalog.snapshotUsd,
        amountUsd: Number(snapshotsUsd.toFixed(4))
      },
      {
        metric: "templateBuilds",
        quantity: normalizedUsage.templateBuilds,
        unitAmountUsd: normalizedCatalog.templateBuildUsd,
        amountUsd: Number(templateBuildsUsd.toFixed(4))
      }
    ],
    totalUsd: Number(totalUsd.toFixed(4))
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

function normalizeSessionSshKey(payload = {}) {
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
  const error = new Error(message);
  error.status = status;
  throw error;
}

function auditAndThrow(_state, _clock, audit, message, status = 400) {
  const error = new Error(message);
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

function findUserByEmail(state, email) {
  return state.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

function getRecoveryCodes(user) {
  if (!Array.isArray(user.recoveryCodes)) {
    user.recoveryCodes = [];
  }
  return user.recoveryCodes;
}

function getPasskeys(user) {
  if (!Array.isArray(user.passkeys)) {
    user.passkeys = [];
  }
  return user.passkeys;
}

function toPasskeySummary(passkey) {
  return {
    id: passkey.id,
    label: passkey.label || passkey.id,
    algorithm: passkey.algorithm,
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt || null,
    transports: Array.isArray(passkey.transports) ? [...passkey.transports] : []
  };
}

function createRecoveryCode() {
  const raw = globalThis.crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function findUserById(state, userId) {
  return state.users.find((user) => user.id === userId) || null;
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

function summarizeStorage(state, workspaceId) {
  const storage = {
    templateBundlesBytes: 0,
    snapshotBytes: 0,
    buildArtifactBytes: 0,
    totalBytes: 0
  };

  for (const version of state.templateVersions) {
    const template = state.templates.find((entry) => entry.id === version.templateId);
    if (!template || template.workspaceId !== workspaceId) {
      continue;
    }
    storage.templateBundlesBytes += version.bundleBytes || 0;
  }

  for (const snapshot of state.snapshots) {
    const session = state.sessions.find((entry) => entry.id === snapshot.sessionId);
    if (!session || session.workspaceId !== workspaceId) {
      continue;
    }
    storage.snapshotBytes += snapshot.bytes || 0;
  }

  for (const build of state.templateBuilds) {
    const version = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
    const template = version ? state.templates.find((entry) => entry.id === version.templateId) : null;
    if (!template || template.workspaceId !== workspaceId) {
      continue;
    }
    storage.buildArtifactBytes += build.artifactBytes || 0;
  }

  storage.totalBytes = storage.templateBundlesBytes + storage.snapshotBytes + storage.buildArtifactBytes;
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
  const templates = state.templates.filter((entry) => entry.workspaceId === workspaceId);
  const templateIds = new Set(templates.map((entry) => entry.id));
  const templateVersions = state.templateVersions.filter((entry) => templateIds.has(entry.templateId));
  const snapshots = state.snapshots.filter((entry) => sessions.some((session) => session.id === entry.sessionId));

  return {
    ...usage,
    storage: summarizeStorage(state, workspaceId),
    inventory: {
      templates: templates.length,
      templateVersions: templateVersions.length,
      sessions: sessions.length,
      snapshots: snapshots.length
    }
  };
}

function summarizeBillableUsage(state, workspaceId) {
  const usage = summarizeUsage(state, workspaceId);
  return normalizeUsageTotals(usage);
}

function diffBillableUsageTotals(current, previous) {
  const next = normalizeUsageTotals(current);
  const prior = normalizeUsageTotals(previous);
  return {
    runtimeMinutes: Math.max(0, next.runtimeMinutes - prior.runtimeMinutes),
    snapshots: Math.max(0, next.snapshots - prior.snapshots),
    templateBuilds: Math.max(0, next.templateBuilds - prior.templateBuilds)
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
  return {
    id: workspace.id,
    name: workspace.name,
    ownerUserId: workspace.ownerUserId,
    plan: workspace.plan,
    billing: formatWorkspaceBilling(workspace),
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

function formatSession(state, session, { includeSshKeys = false } = {}) {
  const template = state.templates.find((entry) => entry.id === session.templateId);
  const events = state.sessionEvents.filter((entry) => entry.sessionId === session.id);
  const snapshots = state.snapshots.filter((entry) => entry.sessionId === session.id);
  const { sshAuthorizedKeys: _sshAuthorizedKeys, ...baseSession } = session;
  const sshKeyCount = getSessionSshKeys(session).length;
  return {
    ...baseSession,
    templateName: template?.name || "unknown",
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
  const digest = await globalThis.crypto.subtle.digest("SHA-256", toUint8Array(value));
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

export function createBurstFlareService(options = {}) {
  const store = options.store || createMemoryStore();
  const clock = options.clock || (() => Date.now());
  const objects = options.objects || null;
  const jobs = options.jobs || null;
  const billingProvider = options.billing || null;
  const billingCatalog = normalizeBillingCatalog(options.billingCatalog);
  const AUTH_SCOPE = ["users", "workspaces", "memberships", "authTokens", "auditLogs"];
  const AUTH_DEVICE_SCOPE = [...AUTH_SCOPE, "deviceCodes", "usageEvents"];
  const WORKSPACE_SCOPE = [...AUTH_DEVICE_SCOPE, "workspaceInvites"];
  const TEMPLATE_SCOPE = [...AUTH_SCOPE, "templates", "templateVersions", "templateBuilds", "bindingReleases", "sessions", "uploadGrants"];
  const SESSION_SCOPE = [...AUTH_SCOPE, "templates", "templateVersions", "sessions", "sessionEvents", "snapshots", "usageEvents"];
  const ADMIN_SCOPE = [...TEMPLATE_SCOPE, "deviceCodes", "workspaceInvites", "sessionEvents", "snapshots", "usageEvents"];
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
    { workspaceId = null, customerId = null, subscriptionId = null, checkoutSessionId = null } = {}
  ) {
    if (workspaceId) {
      const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
      if (workspace) {
        return workspace;
      }
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
    const records = [];
    for (const build of state.templateBuilds) {
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
      records.push({ build, version, template });
    }
    return records;
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

  async function sleepRunningSessionsInState(state, { workspaceId = null, reason = "reconcile" } = {}) {
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

  async function recoverStuckBuildsInState(state, { workspaceId = null, actorUserId = null, source = "reconcile" } = {}) {
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

  async function processQueuedBuildsInState(state, { workspaceId = null, actorUserId = null, source = "reconcile" } = {}) {
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

  async function purgeSessionsInState(
    state,
    sessions,
    { actorUserId = null, auditAction = null, auditDetails = null, includeOrphanSnapshots = false, workspaceId = null } = {}
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
          user: formatUser(user),
          workspace: formatWorkspace(state, workspace, "owner"),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async login({ email, kind = "browser", workspaceId = null }) {
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
          user: formatUser(user),
          workspace: formatWorkspace(state, workspace, membership.role),
          authSessionId: sessionTokens.accessToken.sessionGroupId,
          token: sessionTokens.accessToken.token,
          tokenKind: sessionTokens.accessToken.kind,
          refreshToken: sessionTokens.refreshToken.token
        };
      });
    },

    async generateRecoveryCodes(token, { count = 8 } = {}) {
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
          const error = new Error("Passkey credential already registered");
          error.status = 409;
          throw error;
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

    async listWorkspaceMembers(token) {
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        const members = state.memberships
          .filter((entry) => entry.workspaceId === auth.workspace.id)
          .map((entry) => ({
            ...entry,
            user: formatUser(findUserById(state, entry.userId))
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
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        ensure(email, "Email is required");
        ensure(["admin", "member", "viewer"].includes(role), "Invalid role");
        const inviteEmail = email.toLowerCase();
        const existing = findUserByEmail(state, inviteEmail);
        if (existing) {
          if (getMembership(state, existing.id, auth.workspace.id)) {
            auditAndThrow(
              state,
              clock,
              {
                action: "workspace.invite_rejected_existing_member",
                actorUserId: auth.user.id,
                workspaceId: auth.workspace.id,
                targetType: "workspace",
                targetId: auth.workspace.id,
                details: {
                  email: inviteEmail,
                  existingUserId: existing.id
                }
              },
              "User is already a member",
              409
            );
          }
        }
        const existingPendingInvite = state.workspaceInvites.find(
          (entry) =>
            entry.workspaceId === auth.workspace.id &&
            entry.email === inviteEmail &&
            entry.status === "pending" &&
            new Date(entry.expiresAt).getTime() > nowMs(clock)
        );
        if (existingPendingInvite) {
          auditAndThrow(
            state,
            clock,
            {
              action: "workspace.invite_rejected_duplicate",
              actorUserId: auth.user.id,
              workspaceId: auth.workspace.id,
              targetType: "workspace_invite",
              targetId: existingPendingInvite.id,
              details: {
                email: inviteEmail,
                role: existingPendingInvite.role
              }
            },
            "Invite already pending",
            409
          );
        }
        const invite = {
          id: createId("inv"),
          code: createId("invite"),
          workspaceId: auth.workspace.id,
          email: inviteEmail,
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
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        const invite = state.workspaceInvites.find((entry) => entry.code === inviteCode);
        if (!invite) {
          auditAndThrow(
            state,
            clock,
            {
              action: "workspace.invite_accept_failed",
              actorUserId: auth.user.id,
              workspaceId: null,
              targetType: "workspace_invite_code",
              targetId: inviteCode || "unknown",
              details: { reason: "not_found" }
            },
            "Invite not found",
            404
          );
        }
        if (invite.status !== "pending") {
          auditAndThrow(
            state,
            clock,
            {
              action: "workspace.invite_accept_failed",
              actorUserId: auth.user.id,
              workspaceId: invite.workspaceId,
              targetType: "workspace_invite",
              targetId: invite.id,
              details: { reason: "already_used", status: invite.status }
            },
            "Invite already used",
            409
          );
        }
        if (new Date(invite.expiresAt).getTime() <= nowMs(clock)) {
          auditAndThrow(
            state,
            clock,
            {
              action: "workspace.invite_accept_failed",
              actorUserId: auth.user.id,
              workspaceId: invite.workspaceId,
              targetType: "workspace_invite",
              targetId: invite.id,
              details: { reason: "expired" }
            },
            "Invite expired",
            400
          );
        }
        if (invite.email !== auth.user.email.toLowerCase()) {
          auditAndThrow(
            state,
            clock,
            {
              action: "workspace.invite_accept_failed",
              actorUserId: auth.user.id,
              workspaceId: invite.workspaceId,
              targetType: "workspace_invite",
              targetId: invite.id,
              details: {
                reason: "email_mismatch",
                inviteEmail: invite.email,
                actorEmail: auth.user.email.toLowerCase()
              }
            },
            "Invite email mismatch",
            403
          );
        }
        if (getMembership(state, auth.user.id, invite.workspaceId)) {
          auditAndThrow(
            state,
            clock,
            {
              action: "workspace.invite_accept_failed",
              actorUserId: auth.user.id,
              workspaceId: invite.workspaceId,
              targetType: "workspace_invite",
              targetId: invite.id,
              details: { reason: "already_joined" }
            },
            "Already joined",
            409
          );
        }

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
          targetId: invite.id,
          details: {
            role: invite.role,
            email: invite.email
          }
        });
        return {
          workspace: formatWorkspace(state, workspace, invite.role)
        };
      });
    },

    async updateWorkspaceMemberRole(token, userId, role) {
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        ensure(["admin", "member", "viewer"].includes(role), "Invalid role");
        const membership = getMembership(state, userId, auth.workspace.id);
        if (!membership) {
          auditAndThrow(
            state,
            clock,
            {
              action: "workspace.member_role_update_failed",
              actorUserId: auth.user.id,
              workspaceId: auth.workspace.id,
              targetType: "workspace_membership",
              targetId: `${auth.workspace.id}:${userId}`,
              details: {
                requestedRole: role,
                reason: "missing_membership"
              }
            },
            "Membership not found",
            404
          );
        }
        if (membership.role === "owner") {
          auditAndThrow(
            state,
            clock,
            {
              action: "workspace.member_role_update_failed",
              actorUserId: auth.user.id,
              workspaceId: auth.workspace.id,
              targetType: "workspace_membership",
              targetId: `${auth.workspace.id}:${userId}`,
              details: {
                requestedRole: role,
                reason: "owner_locked"
              }
            },
            "Cannot change owner role",
            409
          );
        }
        if (membership.role === role) {
          writeAudit(state, clock, {
            action: "workspace.member_role_reaffirmed",
            actorUserId: auth.user.id,
            workspaceId: auth.workspace.id,
            targetType: "workspace_membership",
            targetId: `${auth.workspace.id}:${userId}`,
            details: { role }
          });
          return { membership };
        }
        const previousRole = membership.role;
        membership.role = role;
        writeAudit(state, clock, {
          action: "workspace.member_role_updated",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "workspace_membership",
          targetId: `${auth.workspace.id}:${userId}`,
          details: {
            previousRole,
            role
          }
        });
        return { membership };
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
        const usage = summarizeUsage(state, auth.workspace.id);
        const billableUsage = summarizeBillableUsage(state, auth.workspace.id);
        const billing = normalizeWorkspaceBilling(auth.workspace.billing);
        const pendingUsage = diffBillableUsageTotals(billableUsage, billing.billedUsageTotals);
        return {
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          billing: formatWorkspaceBilling(auth.workspace),
          usage,
          pricing: priceUsageSummary(billableUsage, billingCatalog),
          pendingInvoiceEstimate: priceUsageSummary(pendingUsage, billingCatalog)
        };
      });
    },

    async createWorkspaceCheckoutSession(token, { successUrl, cancelUrl } = {}) {
      return transact(WORKSPACE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const provider = requireBillingProvider();
        ensure(typeof provider.createCheckoutSession === "function", "Billing provider does not support checkout", 501);
        const currentBilling = normalizeWorkspaceBilling(auth.workspace.billing);
        const session = await provider.createCheckoutSession({
          successUrl: ensureAbsoluteHttpUrl(successUrl, "Success URL"),
          cancelUrl: ensureAbsoluteHttpUrl(cancelUrl, "Cancel URL"),
          user: formatUser(auth.user),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          membership: auth.membership,
          billing: formatWorkspaceBilling(auth.workspace),
          pricing: priceUsageSummary(summarizeBillableUsage(state, auth.workspace.id), billingCatalog)
        });
        ensure(session && typeof session === "object", "Billing provider returned an invalid checkout session", 502);
        ensure(typeof session.id === "string" && session.id, "Billing checkout session id missing", 502);
        ensure(typeof session.url === "string" && session.url, "Billing checkout session URL missing", 502);

        writeWorkspaceBilling(auth.workspace, clock, {
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
          billing: formatWorkspaceBilling(auth.workspace)
        };
      });
    },

    async createWorkspaceBillingPortalSession(token, { returnUrl } = {}) {
      return transact(WORKSPACE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const provider = requireBillingProvider();
        ensure(typeof provider.createPortalSession === "function", "Billing provider does not support billing portal", 501);
        const billing = normalizeWorkspaceBilling(auth.workspace.billing);
        ensure(billing.customerId, "Workspace is not linked to a billing customer", 409);

        const session = await provider.createPortalSession({
          returnUrl: ensureAbsoluteHttpUrl(returnUrl, "Return URL"),
          user: formatUser(auth.user),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          membership: auth.membership,
          billing: formatWorkspaceBilling(auth.workspace)
        });
        ensure(session && typeof session === "object", "Billing provider returned an invalid portal session", 502);
        ensure(typeof session.id === "string" && session.id, "Billing portal session id missing", 502);
        ensure(typeof session.url === "string" && session.url, "Billing portal session URL missing", 502);

        writeWorkspaceBilling(auth.workspace, clock, {
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
          billing: formatWorkspaceBilling(auth.workspace)
        };
      });
    },

    async createWorkspaceUsageInvoice(token) {
      return transact(WORKSPACE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const provider = requireBillingProvider();
        ensure(typeof provider.createUsageInvoice === "function", "Billing provider does not support usage invoices", 501);
        const billing = normalizeWorkspaceBilling(auth.workspace.billing);
        ensure(billing.customerId, "Workspace is not linked to a billing customer", 409);

        const currentUsage = summarizeBillableUsage(state, auth.workspace.id);
        const pendingUsage = diffBillableUsageTotals(currentUsage, billing.billedUsageTotals);
        const estimate = priceUsageSummary(pendingUsage, billingCatalog);
        const hasBillableUsage = Object.values(pendingUsage).some((value) => value > 0);

        if (!hasBillableUsage) {
          return {
            invoice: null,
            billing: formatWorkspaceBilling(auth.workspace),
            usage: summarizeUsage(state, auth.workspace.id),
            pendingInvoiceEstimate: estimate
          };
        }

        const invoice = await provider.createUsageInvoice({
          user: formatUser(auth.user),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          membership: auth.membership,
          billing: formatWorkspaceBilling(auth.workspace),
          usage: pendingUsage,
          pricing: estimate
        });
        ensure(invoice && typeof invoice === "object", "Billing provider returned an invalid invoice", 502);
        ensure(typeof invoice.id === "string" && invoice.id, "Billing invoice id missing", 502);

        writeWorkspaceBilling(auth.workspace, clock, {
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
            snapshots: pendingUsage.snapshots,
            templateBuilds: pendingUsage.templateBuilds
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
          billing: formatWorkspaceBilling(auth.workspace),
          usage: summarizeUsage(state, auth.workspace.id),
          pendingInvoiceEstimate: priceUsageSummary(
            diffBillableUsageTotals(currentUsage, normalizeWorkspaceBilling(auth.workspace.billing).billedUsageTotals),
            billingCatalog
          )
        };
      });
    },

    async applyBillingWebhook(event = {}) {
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

        const eventState = trackBillingWebhookEvent(workspace, clock, event.id);
        if (eventState.duplicate) {
          return {
            ok: true,
            duplicate: true,
            eventId: event.id,
            eventType: event.type,
            workspace: formatWorkspace(state, workspace, getMembership(state, workspace.ownerUserId, workspace.id)?.role || "owner"),
            billing: formatWorkspaceBilling(workspace)
          };
        }

        const currentBilling = normalizeWorkspaceBilling(workspace.billing);

        if (event.type.startsWith("checkout.session.")) {
          writeWorkspaceBilling(workspace, clock, {
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
          writeWorkspaceBilling(workspace, clock, {
            provider: currentBilling.provider || "stripe",
            customerId: typeof payload.customer === "string" && payload.customer ? payload.customer : currentBilling.customerId,
            subscriptionId: typeof payload.id === "string" && payload.id ? payload.id : currentBilling.subscriptionId,
            subscriptionStatus:
              typeof payload.status === "string" && payload.status ? payload.status : currentBilling.subscriptionStatus,
            currentPeriodEnd: toIsoFromUnixSeconds(Number(payload.current_period_end)),
            cancelAtPeriodEnd: Boolean(payload.cancel_at_period_end)
          });
        } else if (event.type === "invoice.paid") {
          writeWorkspaceBilling(workspace, clock, {
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
          writeWorkspaceBilling(workspace, clock, {
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
          billing: formatWorkspaceBilling(workspace)
        };
      });
    },

    async setWorkspaceQuotaOverrides(token, overrides = {}) {
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

    async createTemplate(token, { name, description = "" }) {
      return transact(TEMPLATE_SCOPE, (state) => {
        const auth = requireWriteAccess(state, token, clock);
        ensure(name, "Template name is required");
        const limits = getEffectiveLimits(auth.workspace);
        ensure(
          state.templates.filter((entry) => entry.workspaceId === auth.workspace.id).length < limits.maxTemplates,
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
      return transact(TEMPLATE_SCOPE, (state) => {
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
      return transact(TEMPLATE_SCOPE, (state) => {
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
      return transact(TEMPLATE_SCOPE, async (state) => {
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
          const build = state.templateBuilds.find((entry) => entry.templateVersionId === templateVersion.id);
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
          if (build && objects?.deleteBuildArtifact) {
            await objects.deleteBuildArtifact({
              workspace: auth.workspace,
              template: auth.template,
              templateVersion,
              build
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
      return transact(TEMPLATE_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        const templates = state.templates
          .filter((entry) => entry.workspaceId === auth.workspace.id)
          .map((template) => formatTemplate(state, template));
        return { templates };
      });
    },

    async getTemplate(token, templateId) {
      return transact(TEMPLATE_SCOPE, (state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        return {
          template: formatTemplateDetail(state, auth.template)
        };
      });
    },

    async listTemplateBuilds(token) {
      return transact(TEMPLATE_SCOPE, (state) => {
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
      return transact(TEMPLATE_SCOPE, async (state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canWrite(auth.membership.role), "Insufficient permissions", 403);
        ensure(version, "Version is required");
        const limits = getEffectiveLimits(auth.workspace);
        const usage = summarizeUsage(state, auth.workspace.id);
        validateTemplateManifest(manifest);
        ensure(
          !state.templateVersions.some((entry) => entry.templateId === templateId && entry.version === version),
          "Version already exists"
        );
        ensure(
          state.templateVersions.filter((entry) => entry.templateId === templateId).length < limits.maxTemplateVersionsPerTemplate,
          "Template version limit reached",
          403
        );
        ensure(usage.templateBuilds < limits.maxTemplateBuilds, "Template build limit reached", 403);

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
          artifactKey: `artifacts/${templateId}/${version}.json`,
          artifactSource: null,
          artifactDigest: null,
          artifactImageReference: null,
          artifactImageDigest: null,
          artifactConfigDigest: null,
          artifactLayerCount: 0,
          artifactBytes: 0,
          artifactBuiltAt: null,
          dispatchMode: jobs?.buildStrategy || null,
          executionSource: null,
          lastQueuedAt: null,
          workflowName: null,
          workflowInstanceId: null,
          workflowStatus: null,
          workflowQueuedAt: null,
          workflowStartedAt: null,
          workflowFinishedAt: null,
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

        await enqueueBuildDispatch({ jobs, build, clock });

        return { templateVersion, build };
      });
    },

    async uploadTemplateVersionBundle(token, templateId, versionId, { body, contentType = "application/octet-stream" } = {}) {
      return transact(TEMPLATE_SCOPE, async (state) => {
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
      return transact(TEMPLATE_SCOPE, (state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canWrite(auth.membership.role), "Insufficient permissions", 403);
        const templateVersion = state.templateVersions.find((entry) => entry.id === versionId && entry.templateId === templateId);
        ensure(templateVersion, "Template version not found", 404);
        if (bytes !== null) {
          ensure(Number.isInteger(bytes) && bytes > 0, "Upload bytes must be a positive integer");
          ensure(bytes <= MAX_TEMPLATE_BUNDLE_BYTES, "Bundle exceeds size limit", 413);
          const currentStorage = summarizeStorage(state, auth.workspace.id);
          ensureStorageWithinLimit(state, auth.workspace, currentStorage.totalBytes - (templateVersion.bundleBytes || 0) + bytes);
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
            transport: "worker_upload_grant",
            storage: "r2",
            expiresAt: uploadGrant.expiresAt,
            contentType: uploadGrant.contentType,
            expectedBytes: uploadGrant.expectedBytes
          }
        };
      });
    },

    async getTemplateVersionBundle(token, templateId, versionId) {
      return transact(TEMPLATE_SCOPE, async (state) => {
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
      return transact(TEMPLATE_SCOPE, async (state) => {
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
      return transact(TEMPLATE_SCOPE, async (state) => {
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

    async markTemplateBuildWorkflow(buildId, patch = {}) {
      return transact(TEMPLATE_SCOPE, (state) => {
        const build = state.templateBuilds.find((entry) => entry.id === buildId);
        ensure(build, "Build not found", 404);
        const timestamp = patch.timestamp || nowIso(clock);
        if (patch.instanceId !== undefined) {
          build.workflowInstanceId = patch.instanceId;
        }
        if (patch.name !== undefined) {
          build.workflowName = patch.name;
        }
        if (patch.status) {
          markBuildWorkflowState(build, patch.status, clock);
        }
        if (patch.status === "running") {
          build.executionSource = "workflow";
          build.dispatchMode = "workflow";
          build.workflowQueuedAt = build.workflowQueuedAt || timestamp;
          build.workflowStartedAt = timestamp;
          build.workflowFinishedAt = null;
        }
        if (["succeeded", "failed", "dead_lettered"].includes(patch.status)) {
          build.workflowFinishedAt = timestamp;
        }
        build.updatedAt = timestamp;
        return { build };
      });
    },

    async getTemplateBuildLog(token, buildId) {
      return transact(TEMPLATE_SCOPE, async (state) => {
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

    async getTemplateBuildArtifact(token, buildId) {
      return transact(TEMPLATE_SCOPE, async (state) => {
        const auth = requireAuth(state, token, clock);
        const build = state.templateBuilds.find((entry) => entry.id === buildId);
        ensure(build, "Build not found", 404);
        const templateVersion = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
        ensure(templateVersion, "Template version missing", 404);
        const template = state.templates.find((entry) => entry.id === templateVersion.templateId);
        ensure(template && template.workspaceId === auth.workspace.id, "Build not found", 404);

        if (objects?.getBuildArtifact) {
          const artifact = await objects.getBuildArtifact({
            workspace: auth.workspace,
            template,
            templateVersion,
            build
          });
          if (artifact?.text) {
            return {
              buildId,
              artifactKey: build.artifactKey,
              contentType: artifact.contentType || "application/json; charset=utf-8",
              text: artifact.text
            };
          }
        }

        const fallback = JSON.stringify(
          {
            buildId,
            templateId: template.id,
            templateVersionId: templateVersion.id,
            source: build.artifactSource || "unknown",
            sourceSha256: build.artifactDigest || null,
            imageReference: build.artifactImageReference || null,
            imageDigest: build.artifactImageDigest || null,
            configDigest: build.artifactConfigDigest || null,
            layerCount: build.artifactLayerCount || 0,
            builtAt: build.artifactBuiltAt || null
          },
          null,
          2
        );
        return {
          buildId,
          artifactKey: build.artifactKey,
          contentType: "application/json; charset=utf-8",
          text: fallback
        };
      });
    },

    async retryTemplateBuild(token, buildId) {
      return transact(TEMPLATE_SCOPE, async (state) => {
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
        await enqueueBuildDispatch({ jobs, build, clock });
        return { build };
      });
    },

    async retryDeadLetteredBuilds(token) {
      return transact(TEMPLATE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const buildIds = [];
        for (const build of state.templateBuilds) {
          if (build.status !== "dead_lettered") {
            continue;
          }
          const version = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
          if (!version) {
            continue;
          }
          const template = state.templates.find((entry) => entry.id === version.templateId);
          if (!template || template.workspaceId !== auth.workspace.id) {
            continue;
          }
          build.status = "retrying";
          build.attempts = 0;
          build.updatedAt = nowIso(clock);
          build.deadLetteredAt = null;
          version.status = "queued";
          buildIds.push(build.id);
          writeAudit(state, clock, {
            action: "template.build_retried_bulk",
            actorUserId: auth.user.id,
            workspaceId: auth.workspace.id,
            targetType: "template_build",
            targetId: build.id
          });
          await enqueueBuildDispatch({ jobs, build, clock });
        }
        return {
          recovered: buildIds.length,
          buildIds
        };
      });
    },

    async promoteTemplateVersion(token, templateId, versionId) {
      return transact(TEMPLATE_SCOPE, (state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canManageWorkspace(auth.membership.role), "Insufficient permissions", 403);
        const version = state.templateVersions.find((entry) => entry.id === versionId && entry.templateId === templateId);
        ensure(version, "Template version not found", 404);
        ensure(version.status === "ready", "Template version is not build-ready", 409);
        const build = state.templateBuilds.find((entry) => entry.templateVersionId === version.id) || null;
        auth.template.activeVersionId = version.id;
        const release = writeBindingRelease(
          state,
          clock,
          auth.workspace.id,
          auth.template.id,
          version.id,
          createBindingManifest(auth.template, version, build)
        );
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
      return transact(TEMPLATE_SCOPE, (state) => {
        const auth = requireAuth(state, token, clock);
        const releases = state.bindingReleases
          .filter((entry) => entry.workspaceId === auth.workspace.id)
          .map((entry) => formatBindingRelease(state, entry));
        return { releases };
      });
    },

    async rollbackTemplate(token, templateId, releaseId = null) {
      return transact(TEMPLATE_SCOPE, (state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canManageWorkspace(auth.membership.role), "Insufficient permissions", 403);
        const releases = state.bindingReleases.filter(
          (entry) => entry.workspaceId === auth.workspace.id && entry.templateId === auth.template.id
        );
        ensure(releases.length > 0, "Template has no releases", 409);
        const targetRelease = releaseId
          ? releases.find((entry) => entry.id === releaseId)
          : [...releases].reverse().find((entry) => entry.templateVersionId !== auth.template.activeVersionId);
        ensure(targetRelease, releaseId ? "Release not found" : "No prior release available for rollback", releaseId ? 404 : 409);
        ensure(targetRelease.templateVersionId !== auth.template.activeVersionId, "Release is already active", 409);
        const version = state.templateVersions.find(
          (entry) => entry.id === targetRelease.templateVersionId && entry.templateId === auth.template.id
        );
        ensure(version, "Template version not found", 404);
        const build = state.templateBuilds.find((entry) => entry.templateVersionId === version.id) || null;
        const previousVersionId = auth.template.activeVersionId || null;
        auth.template.activeVersionId = version.id;
        const release = writeBindingRelease(
          state,
          clock,
          auth.workspace.id,
          auth.template.id,
          version.id,
          targetRelease.binding || createBindingManifest(auth.template, version, build),
          {
            mode: "rollback",
            sourceReleaseId: targetRelease.id
          }
        );
        writeAudit(state, clock, {
          action: "template.rolled_back",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template",
          targetId: auth.template.id,
          details: {
            previousVersionId,
            versionId: version.id,
            sourceReleaseId: targetRelease.id,
            releaseId: release.id
          }
        });
        return {
          template: formatTemplate(state, auth.template),
          activeVersion: version,
          targetRelease: formatBindingRelease(state, targetRelease),
          release: formatBindingRelease(state, release)
        };
      });
    },

    async createSession(token, { name, templateId }) {
      return transact(SESSION_SCOPE, (state) => {
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
          runtimeDesiredState: null,
          runtimeStatus: null,
          runtimeState: null,
          runtimeVersion: 0,
          runtimeOperationId: null,
          runtimeUpdatedAt: null,
          persistedPaths: [...(activeVersion.manifest?.persistedPaths || [])],
          sleepTtlSeconds: activeVersion.manifest?.sleepTtlSeconds || null,
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
          details: { name, templateId }
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
          .filter((entry) => entry.workspaceId === auth.workspace.id && entry.state !== "deleted")
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
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        const limits = getEffectiveLimits(auth.workspace);
        ensure(
          state.snapshots.filter((entry) => entry.sessionId === auth.session.id).length < limits.maxSnapshotsPerSession,
          "Snapshot limit reached",
          403
        );
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
      return transact(SESSION_SCOPE, async (state) => {
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
      return transact(SESSION_SCOPE, (state) => {
        const auth = requireSessionAccess(state, token, sessionId, clock);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        const snapshot = state.snapshots.find((entry) => entry.id === snapshotId && entry.sessionId === auth.session.id);
        ensure(snapshot, "Snapshot not found", 404);
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

    async consumeUploadGrant(grantId, { body, contentType = "application/octet-stream" } = {}) {
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
      return transact(SESSION_SCOPE, (state) => {
        requireSessionAccess(state, token, sessionId, clock);
        return {
          snapshots: state.snapshots.filter((entry) => entry.sessionId === sessionId)
        };
      });
    },

    async getSnapshotContent(token, sessionId, snapshotId) {
      return transact(SESSION_SCOPE, async (state) => {
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

    async getRuntimeSnapshotContent(token, sessionId, snapshotId) {
      return transact(SESSION_SCOPE, async (state) => {
        const access = requireRuntimeToken(state, token, sessionId, clock);
        const snapshot = state.snapshots.find((entry) => entry.id === snapshotId && entry.sessionId === access.session.id);
        ensure(snapshot, "Snapshot not found", 404);
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
        const snapshot = state.snapshots.find((entry) => entry.id === snapshotId && entry.sessionId === auth.session.id);
        ensure(snapshot, "Snapshot not found", 404);
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
          sshUser: "dev",
          sshCommand:
            "ssh -i <local-key-path> -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null " +
            "-o IdentitiesOnly=yes -o PreferredAuthentications=publickey -p <local-port> dev@127.0.0.1",
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

    async getAudit(token, { limit = 50 } = {}) {
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
          templates: state.templates.filter((entry) => entry.workspaceId === auth.workspace.id).length,
          templatesArchived: state.templates.filter(
            (entry) => entry.workspaceId === auth.workspace.id && entry.archivedAt
          ).length,
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
          releases: state.bindingReleases.filter((entry) => entry.workspaceId === auth.workspace.id).length,
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
        const templateIds = new Set(
          state.templates.filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.id)
        );
        const templateVersionIds = new Set(
          state.templateVersions.filter((entry) => templateIds.has(entry.templateId)).map((entry) => entry.id)
        );
        const sessionIds = new Set(
          state.sessions.filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.id)
        );
        const artifacts = {
          templateBundles: state.templateVersions
            .filter((entry) => templateIds.has(entry.templateId) && entry.bundleUploadedAt)
            .map((entry) => ({
              templateVersionId: entry.id,
              bundleKey: entry.bundleKey,
              contentType: entry.bundleContentType,
              bytes: entry.bundleBytes,
              uploadedAt: entry.bundleUploadedAt
            })),
          buildArtifacts: state.templateBuilds
            .filter((entry) => templateVersionIds.has(entry.templateVersionId) && entry.artifactBuiltAt)
            .map((entry) => ({
              buildId: entry.id,
              artifactKey: entry.artifactKey,
              imageReference: entry.artifactImageReference,
              imageDigest: entry.artifactImageDigest,
              bytes: entry.artifactBytes,
              builtAt: entry.artifactBuiltAt
            })),
          snapshots: state.snapshots
            .filter((entry) => sessionIds.has(entry.sessionId))
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
            templates: templateIds.size,
            templateVersions: templateVersionIds.size,
            sessions: sessionIds.size
          }
        });

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
