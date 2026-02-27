import { createFileStore } from "./store.js";
import { createId, defaultNameFromEmail } from "./utils.js";

const SESSION_COOKIE = "burstflare_session";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RUNTIME_TOKEN_TTL_MS = 1000 * 60 * 15;
const DEVICE_CODE_TTL_MS = 1000 * 60 * 10;

const PLANS = {
  free: {
    maxTemplates: 10,
    maxRunningSessions: 3
  },
  pro: {
    maxTemplates: 100,
    maxRunningSessions: 20
  }
};

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function futureIso(clock, durationMs) {
  return new Date(clock() + durationMs).toISOString();
}

function getPlan(name) {
  return PLANS[name] || PLANS.free;
}

function ensure(condition, message, status = 400) {
  if (!condition) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }
}

function findUserByEmail(state, email) {
  return state.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
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
  const now = Date.now();
  return (
    state.authTokens.find((entry) => {
      if (entry.token !== token || entry.revokedAt) {
        return false;
      }
      return new Date(entry.expiresAt).getTime() > now;
    }) || null
  );
}

function createToken(state, clock, { userId, workspaceId, kind }) {
  const record = {
    id: createId("tok"),
    token: createId(kind),
    userId,
    workspaceId,
    kind,
    createdAt: nowIso(clock),
    expiresAt: futureIso(clock, kind === "runtime" ? RUNTIME_TOKEN_TTL_MS : TOKEN_TTL_MS),
    revokedAt: null
  };
  state.authTokens.push(record);
  return record;
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

function requireAuth(state, token) {
  const auth = getTokenRecord(state, token);
  ensure(auth, "Unauthorized", 401);
  const user = state.users.find((entry) => entry.id === auth.userId);
  const workspace = state.workspaces.find((entry) => entry.id === auth.workspaceId);
  ensure(user && workspace, "Unauthorized", 401);
  const membership = getMembership(state, user.id, workspace.id);
  ensure(membership, "Unauthorized", 401);
  return { auth, user, workspace, membership };
}

function requireTemplateAccess(state, authToken, templateId) {
  const auth = requireAuth(state, authToken);
  const template = state.templates.find((entry) => entry.id === templateId && entry.workspaceId === auth.workspace.id);
  ensure(template, "Template not found", 404);
  return { ...auth, template };
}

function requireSessionAccess(state, authToken, sessionId) {
  const auth = requireAuth(state, authToken);
  const session = state.sessions.find((entry) => entry.id === sessionId && entry.workspaceId === auth.workspace.id);
  ensure(session, "Session not found", 404);
  return { ...auth, session };
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
  if (!template || !template.activeVersionId) {
    return null;
  }
  return state.templateVersions.find((entry) => entry.id === template.activeVersionId) || null;
}

export function createBurstFlareService(options = {}) {
  const store = options.store || createFileStore(options.dataFile || ".local/burstflare-data.json");
  const clock = options.clock || (() => Date.now());

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
        const sessionToken = createToken(state, clock, {
          userId: user.id,
          workspaceId: workspace.id,
          kind: "browser"
        });

        return {
          user,
          workspace,
          token: sessionToken.token,
          tokenKind: sessionToken.kind
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
        ensure(getMembership(state, user.id, workspace.id), "Unauthorized workspace", 403);

        const sessionToken = createToken(state, clock, {
          userId: user.id,
          workspaceId: workspace.id,
          kind
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
          workspace,
          token: sessionToken.token,
          tokenKind: sessionToken.kind
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
        return {
          deviceCode: deviceCode.code,
          verificationUri: "/device",
          expiresAt: deviceCode.expiresAt
        };
      });
    },

    async deviceApprove(browserToken, deviceCodeValue) {
      return store.transact((state) => {
        const auth = requireAuth(state, browserToken);
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
        ensure(new Date(deviceCode.expiresAt).getTime() > clock(), "Device code expired", 400);
        ensure(deviceCode.status === "approved", "Device code not approved", 409);

        const token = createToken(state, clock, {
          userId: deviceCode.userId,
          workspaceId: deviceCode.workspaceId,
          kind: "api"
        });
        const user = state.users.find((entry) => entry.id === deviceCode.userId);
        const workspace = state.workspaces.find((entry) => entry.id === deviceCode.workspaceId);
        ensure(user && workspace, "User or workspace missing", 500);

        writeAudit(state, clock, {
          action: "device.exchanged",
          actorUserId: user.id,
          workspaceId: workspace.id,
          targetType: "device_code",
          targetId: deviceCode.id
        });

        return {
          user,
          workspace,
          token: token.token,
          tokenKind: token.kind
        };
      });
    },

    async authenticate(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token);
        return {
          user: auth.user,
          workspace: auth.workspace,
          membership: auth.membership,
          usage: summarizeUsage(state, auth.workspace.id)
        };
      });
    },

    async listWorkspaces(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token);
        const workspaces = state.memberships
          .filter((entry) => entry.userId === auth.user.id)
          .map((entry) => {
            const workspace = state.workspaces.find((candidate) => candidate.id === entry.workspaceId);
            return workspace ? { ...workspace, role: entry.role } : null;
          })
          .filter(Boolean);
        return { workspaces };
      });
    },

    async createTemplate(token, { name, description = "" }) {
      return store.transact((state) => {
        const auth = requireAuth(state, token);
        ensure(auth.membership.role !== "viewer", "Insufficient permissions", 403);
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
        return { template };
      });
    },

    async listTemplates(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token);
        const templates = state.templates
          .filter((entry) => entry.workspaceId === auth.workspace.id)
          .map((template) => {
            const versions = state.templateVersions.filter((entry) => entry.templateId === template.id);
            const activeVersion = versions.find((entry) => entry.id === template.activeVersionId) || null;
            return {
              ...template,
              activeVersion,
              versions
            };
          });
        return { templates };
      });
    },

    async addTemplateVersion(token, templateId, { version, manifest = {}, notes = "" }) {
      return store.transact((state) => {
        const auth = requireTemplateAccess(state, token, templateId);
        ensure(auth.membership.role !== "viewer", "Insufficient permissions", 403);
        ensure(version, "Version is required");
        ensure(
          !state.templateVersions.some((entry) => entry.templateId === templateId && entry.version === version),
          "Version already exists"
        );

        const templateVersion = {
          id: createId("tplv"),
          templateId,
          version,
          status: "ready",
          notes,
          manifest,
          buildLogKey: `builds/${templateId}/${version}.log`,
          createdAt: nowIso(clock)
        };
        const build = {
          id: createId("bld"),
          templateVersionId: templateVersion.id,
          status: "succeeded",
          builderImage: "burstflare/builder:local",
          createdAt: nowIso(clock),
          updatedAt: nowIso(clock)
        };

        state.templateVersions.push(templateVersion);
        state.templateBuilds.push(build);
        writeUsage(state, clock, {
          workspaceId: auth.workspace.id,
          kind: "template_build",
          value: 1,
          details: { templateId, templateVersionId: templateVersion.id }
        });
        writeAudit(state, clock, {
          action: "template.version_added",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template_version",
          targetId: templateVersion.id,
          details: { version }
        });

        return { templateVersion, build };
      });
    },

    async promoteTemplateVersion(token, templateId, versionId) {
      return store.transact((state) => {
        const auth = requireTemplateAccess(state, token, templateId);
        ensure(auth.membership.role !== "viewer", "Insufficient permissions", 403);
        const version = state.templateVersions.find((entry) => entry.id === versionId && entry.templateId === templateId);
        ensure(version, "Template version not found", 404);
        auth.template.activeVersionId = version.id;
        writeAudit(state, clock, {
          action: "template.promoted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template",
          targetId: auth.template.id,
          details: { versionId }
        });
        return { template: auth.template, activeVersion: version };
      });
    },

    async createSession(token, { name, templateId }) {
      return store.transact((state) => {
        const auth = requireAuth(state, token);
        ensure(auth.membership.role !== "viewer", "Insufficient permissions", 403);
        ensure(name, "Session name is required");
        const template = state.templates.find((entry) => entry.id === templateId && entry.workspaceId === auth.workspace.id);
        ensure(template, "Template not found", 404);
        ensure(getActiveVersion(state, template.id), "Template has no promoted version", 409);
        const runningCount = state.sessions.filter(
          (entry) => entry.workspaceId === auth.workspace.id && entry.state === "running"
        ).length;
        ensure(runningCount < getPlan(auth.workspace.plan).maxRunningSessions, "Running session limit reached", 403);

        const session = {
          id: createId("ses"),
          workspaceId: auth.workspace.id,
          templateId: template.id,
          name,
          state: "creating",
          createdByUserId: auth.user.id,
          createdAt: nowIso(clock),
          updatedAt: nowIso(clock),
          lastStartedAt: null,
          lastStoppedAt: null
        };
        state.sessions.push(session);
        writeAudit(state, clock, {
          action: "session.created",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "session",
          targetId: session.id,
          details: { name, templateId }
        });
        return { session };
      });
    },

    async startSession(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        auth.session.state = "running";
        auth.session.lastStartedAt = nowIso(clock);
        auth.session.updatedAt = nowIso(clock);
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
        return { session: auth.session };
      });
    },

    async stopSession(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        auth.session.state = "sleeping";
        auth.session.lastStoppedAt = nowIso(clock);
        auth.session.updatedAt = nowIso(clock);
        writeAudit(state, clock, {
          action: "session.stopped",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "session",
          targetId: auth.session.id
        });
        return { session: auth.session };
      });
    },

    async deleteSession(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId);
        auth.session.state = "deleted";
        auth.session.updatedAt = nowIso(clock);
        writeAudit(state, clock, {
          action: "session.deleted",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "session",
          targetId: auth.session.id
        });
        return { session: auth.session };
      });
    },

    async listSessions(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token);
        const sessions = state.sessions
          .filter((entry) => entry.workspaceId === auth.workspace.id && entry.state !== "deleted")
          .map((session) => {
            const template = state.templates.find((entry) => entry.id === session.templateId);
            return {
              ...session,
              templateName: template?.name || "unknown"
            };
          });
        return { sessions };
      });
    },

    async getSession(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId);
        const snapshots = state.snapshots.filter((entry) => entry.sessionId === auth.session.id);
        return {
          session: auth.session,
          snapshots
        };
      });
    },

    async createSnapshot(token, sessionId, { label = "manual" }) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId);
        ensure(auth.session.state !== "deleted", "Session deleted", 409);
        const snapshot = {
          id: createId("snap"),
          sessionId: auth.session.id,
          label,
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

    async listSnapshots(token, sessionId) {
      return store.transact((state) => {
        requireSessionAccess(state, token, sessionId);
        return {
          snapshots: state.snapshots.filter((entry) => entry.sessionId === sessionId)
        };
      });
    },

    async issueRuntimeToken(token, sessionId) {
      return store.transact((state) => {
        const auth = requireSessionAccess(state, token, sessionId);
        ensure(auth.session.state === "running", "Session is not running", 409);
        const runtimeToken = createToken(state, clock, {
          userId: auth.user.id,
          workspaceId: auth.workspace.id,
          kind: "runtime"
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

    async getUsage(token) {
      return store.transact((state) => {
        const auth = requireAuth(state, token);
        return {
          usage: summarizeUsage(state, auth.workspace.id)
        };
      });
    },

    async getAudit(token, { limit = 50 } = {}) {
      return store.transact((state) => {
        const auth = requireAuth(state, token);
        const items = state.auditLogs
          .filter((entry) => entry.workspaceId === auth.workspace.id)
          .slice(-limit)
          .reverse();
        return { audit: items };
      });
    },

    async reconcile() {
      return store.transact((state) => {
        let updated = 0;
        for (const session of state.sessions) {
          if (session.state === "running") {
            session.state = "sleeping";
            session.updatedAt = nowIso(clock);
            updated += 1;
          }
        }
        return { updated };
      });
    }
  };
}
