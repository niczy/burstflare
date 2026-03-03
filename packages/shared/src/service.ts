import { createMemoryStore } from "./memory-store.js";
import { createId, defaultNameFromEmail } from "./utils.js";

const SESSION_COOKIE = "burstflare_session";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const RUNTIME_TOKEN_TTL_MS = 1000 * 60 * 15;
const DEVICE_CODE_TTL_MS = 1000 * 60 * 10;
const UPLOAD_GRANT_TTL_MS = 1000 * 60 * 10;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_RUNTIME_SECRETS = 32;
const MAX_RUNTIME_SECRET_VALUE_BYTES = 4096;

const PLANS = {
  free: {
    maxInstances: 10,
    maxRunningSessions: 3,
    maxStorageBytes: 25 * 1024 * 1024,
    maxRuntimeMinutes: 500
  },
  pro: {
    maxInstances: 100,
    maxRunningSessions: 20,
    maxStorageBytes: 250 * 1024 * 1024,
    maxRuntimeMinutes: 10_000
  },
  enterprise: {
    maxInstances: 1000,
    maxRunningSessions: 200,
    maxStorageBytes: 2_500 * 1024 * 1024,
    maxRuntimeMinutes: 100_000
  }
};

const DEFAULT_BILLING_CATALOG = {
  currency: "usd",
  runtimeMinuteUsd: 0.03,
  storageGbMonthUsd: 0.015
};

type BillingCatalogInput = {
  currency?: string;
  runtimeMinuteUsd?: number;
  storageGbMonthUsd?: number;
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
  "maxInstances",
  "maxRunningSessions",
  "maxStorageBytes",
  "maxRuntimeMinutes"
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

function normalizeUsageTotals(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    runtimeMinutes: Number.isFinite(source.runtimeMinutes) ? Math.max(0, Number(source.runtimeMinutes)) : 0,
    storageGbDays: Number.isFinite(source.storageGbDays) ? Math.max(0, Number(source.storageGbDays)) : 0
  };
}





function toIsoFromUnixSeconds(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function normalizeBillingCatalog(catalog: BillingCatalogInput | null | undefined = {}) {
  const source: BillingCatalogInput = catalog && typeof catalog === "object" && !Array.isArray(catalog) ? catalog : {};
  const currency =
    typeof source.currency === "string" && source.currency.trim() ? source.currency.trim().toLowerCase() : "usd";
  const runtimeMinuteUsd = Number.isFinite(source.runtimeMinuteUsd)
    ? Math.max(0, Number(source.runtimeMinuteUsd))
    : DEFAULT_BILLING_CATALOG.runtimeMinuteUsd;
  const storageGbMonthUsd = Number.isFinite(source.storageGbMonthUsd)
    ? Math.max(0, Number(source.storageGbMonthUsd))
    : DEFAULT_BILLING_CATALOG.storageGbMonthUsd;
  return {
    currency,
    runtimeMinuteUsd,
    storageGbMonthUsd
  };
}

function priceUsageSummary(usage, catalog) {
  const normalizedUsage = normalizeUsageTotals(usage);
  const normalizedCatalog = normalizeBillingCatalog(catalog);
  const runtimeUsd = normalizedUsage.runtimeMinutes * normalizedCatalog.runtimeMinuteUsd;
  const storageGbMonths = normalizedUsage.storageGbDays / 30;
  const storageUsd = storageGbMonths * normalizedCatalog.storageGbMonthUsd;
  const totalUsd = runtimeUsd + storageUsd;
  return {
    currency: normalizedCatalog.currency,
    usage: { ...normalizedUsage, storageGbMonths: Number(storageGbMonths.toFixed(4)) },
    rates: {
      runtimeMinuteUsd: normalizedCatalog.runtimeMinuteUsd,
      storageGbMonthUsd: normalizedCatalog.storageGbMonthUsd
    },
    lineItems: [
      {
        metric: "runtimeMinutes",
        quantity: normalizedUsage.runtimeMinutes,
        unitAmountUsd: normalizedCatalog.runtimeMinuteUsd,
        amountUsd: Number(runtimeUsd.toFixed(4))
      },
      {
        metric: "storageGbMonths",
        quantity: Number(storageGbMonths.toFixed(4)),
        unitAmountUsd: normalizedCatalog.storageGbMonthUsd,
        amountUsd: Number(storageUsd.toFixed(4))
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

function auditAndThrow(_state, _clock, audit, message, status = 400) {
  const error = new Error(message) as ServiceError;
  error.status = status;
  error.auditEvent = {
    ...audit,
    details: audit?.details || {}
  };
  throw error;
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

export function createBurstFlareService(options: any = {}) {
  const store = options.store || createMemoryStore();
  const clock = options.clock || (() => Date.now());
  const objects = options.objects || null;
  const jobs = options.jobs || null;
  const billingProvider = options.billing || null;
  const billingCatalog = normalizeBillingCatalog(options.billingCatalog);
  const AUTH_SCOPE = ["users", "authTokens", "auditLogs"];
  const AUTH_DEVICE_SCOPE = [...AUTH_SCOPE, "deviceCodes", "usageEvents"];
  const INSTANCE_SCOPE = [...AUTH_SCOPE, "instances", "sessions", "sessionEvents", "uploadGrants", "usageEvents"];
  const SESSION_SCOPE = [...AUTH_SCOPE, "instances", "sessions", "sessionEvents", "usageEvents"];
  const ADMIN_SCOPE = [...INSTANCE_SCOPE, "deviceCodes"];
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

    async addWorkspacePaymentMethod(token: string, input: { paymentMethodId: string }) {
      return transact(WORKSPACE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const provider = requireBillingProvider();
        ensure(typeof provider.addPaymentMethod === "function", "Billing provider does not support adding payment methods", 501);
        ensure(typeof input?.paymentMethodId === "string" && input.paymentMethodId, "Payment method id is required", 400);

        const customerId = await provider.ensureCustomer({
          user: formatUser(auth.user),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          billing: formatWorkspaceBilling(auth.workspace)
        });

        const result = await provider.addPaymentMethod({
          customerId,
          paymentMethodId: input.paymentMethodId
        });
        ensure(result && typeof result === "object", "Billing provider returned an invalid payment method result", 502);

        writeWorkspaceBilling(auth.workspace, clock, {
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
          billing: formatWorkspaceBilling(auth.workspace),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role)
        };
      });
    },

    async chargeWorkspace(token: string, input: { amountUsd: number; description?: string }) {
      return transact(WORKSPACE_SCOPE, async (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const provider = requireBillingProvider();
        ensure(typeof provider.chargeCustomer === "function", "Billing provider does not support direct charges", 501);
        const billing = normalizeWorkspaceBilling(auth.workspace.billing);
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

        writeWorkspaceBilling(auth.workspace, clock, {
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
          billing: formatWorkspaceBilling(auth.workspace),
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role)
        };
      });
    },

    async getWorkspaceBalance(token: string) {
      return transact(WORKSPACE_SCOPE, (state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const billing = normalizeWorkspaceBilling(auth.workspace.billing);
        const billableUsage = summarizeBillableUsage(state, auth.workspace.id);
        const pendingUsage = diffBillableUsageTotals(billableUsage, billing.billedUsageTotals);
        const pendingCost = priceUsageSummary(pendingUsage, billingCatalog);
        return {
          creditBalanceUsd: billing.creditBalanceUsd,
          pendingUsageCostUsd: Number(pendingCost.totalUsd.toFixed(4)),
          estimatedRemainingBalanceUsd: Number(Math.max(0, billing.creditBalanceUsd - pendingCost.totalUsd).toFixed(4)),
          billing: formatWorkspaceBilling(auth.workspace),
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














    /**
     * @param {string} token
     * @param {string} templateId
     * @param {string} versionId
     * @param {UploadBodyOptions} [options]
     */

      templateId,
      versionId,
      { contentType = "application/octet-stream", bytes = null }: any = {}
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
      { contentType = "application/octet-stream", bytes = null }: any = {}
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
