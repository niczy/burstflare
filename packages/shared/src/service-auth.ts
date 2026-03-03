import { createId, defaultNameFromEmail } from "./utils.js";

export const SESSION_COOKIE = "burstflare_session";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const RUNTIME_TOKEN_TTL_MS = 1000 * 60 * 15;

function nowMs(clock) {
  return clock();
}

function nowIso(clock) {
  return new Date(nowMs(clock)).toISOString();
}

function futureIso(clock, durationMs) {
  return new Date(nowMs(clock) + durationMs).toISOString();
}

export function findUserByEmail(state, email) {
  return state.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

export function getRecoveryCodes(user) {
  if (!Array.isArray(user.recoveryCodes)) {
    user.recoveryCodes = [];
  }
  return user.recoveryCodes;
}

export function getPasskeys(user) {
  if (!Array.isArray(user.passkeys)) {
    user.passkeys = [];
  }
  return user.passkeys;
}

export function toPasskeySummary(passkey) {
  return {
    id: passkey.id,
    label: passkey.label || passkey.id,
    algorithm: passkey.algorithm,
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt || null,
    transports: Array.isArray(passkey.transports) ? [...passkey.transports] : []
  };
}

export function createRecoveryCode() {
  const raw = globalThis.crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function createEmailAuthCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function findUserById(state, userId) {
  return state.users.find((user) => user.id === userId) || null;
}

export function getUserWorkspace(state, userId) {
  const membership = state.memberships.find((entry) => entry.userId === userId && entry.role === "owner");
  if (!membership) {
    return null;
  }
  return state.workspaces.find((workspace) => workspace.id === membership.workspaceId) || null;
}

export function getMembership(state, userId, workspaceId) {
  return state.memberships.find((entry) => entry.userId === userId && entry.workspaceId === workspaceId) || null;
}

export function getTokenRecord(state, token) {
  return state.authTokens.find((entry) => entry.token === token && !entry.revokedAt) || null;
}

export function createOrLoadUserWorkspace(state, clock, { email, name }, deps) {
  const { ensure, writeAudit } = deps;
  let user = findUserByEmail(state, email);
  let created = false;
  if (!user) {
    created = true;
    user = {
      id: createId("usr"),
      email,
      name: name || defaultNameFromEmail(email),
      billing: null,
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
  return {
    user,
    workspace,
    created
  };
}

export function issueUserSession(state, clock, { email, name = null, kind = "browser", workspaceId = null, writeLoginAudit = true }, deps) {
  const { ensure, writeAudit, formatUser, formatWorkspace } = deps;
  ensure(email, "Email is required");
  const identity = createOrLoadUserWorkspace(state, clock, { email, name }, deps);
  const workspace = workspaceId
    ? state.workspaces.find((entry) => entry.id === workspaceId)
    : identity.workspace;
  ensure(workspace, "Workspace not found", 404);
  const membership = getMembership(state, identity.user.id, workspace.id);
  ensure(membership, "Unauthorized workspace", 403);

  const sessionTokens = issueSessionTokens(state, clock, {
    userId: identity.user.id,
    workspaceId: workspace.id,
    accessKind: kind
  });

  if (writeLoginAudit && !identity.created) {
    writeAudit(state, clock, {
      action: "user.logged_in",
      actorUserId: identity.user.id,
      workspaceId: workspace.id,
      targetType: "workspace",
      targetId: workspace.id,
      details: { kind }
    });
  }

  return {
    user: formatUser(identity.user),
    workspace: formatWorkspace(state, workspace, membership.role),
    authSessionId: sessionTokens.accessToken.sessionGroupId,
    token: sessionTokens.accessToken.token,
    tokenKind: sessionTokens.accessToken.kind,
    refreshToken: sessionTokens.refreshToken.token,
    created: identity.created
  };
}

export function listEmailAuthCodes(state) {
  if (!Array.isArray(state.deviceCodes)) {
    state.deviceCodes = [];
  }
  return state.deviceCodes;
}

export function pruneEmailAuthCodes(state, clock) {
  const cutoff = nowMs(clock);
  state.deviceCodes = listEmailAuthCodes(state).filter((entry) => {
    if (entry.kind !== "email_auth") {
      return true;
    }
    if (entry.status !== "pending") {
      return false;
    }
    return new Date(entry.expiresAt).getTime() > cutoff;
  });
  return state.deviceCodes;
}

export function createToken(state, clock, { userId, workspaceId, kind, sessionId = null, grantKind = null, sessionGroupId = null }) {
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

export function issueSessionTokens(state, clock, { userId, workspaceId, accessKind }) {
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
