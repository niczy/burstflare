import { createMemoryStore } from "./memory-store.js";
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

function findUserByEmail(state, email) {
  return state.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
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

function createToken(state, clock, { userId, workspaceId, kind, sessionId = null }) {
  const record = {
    id: createId("tok"),
    token: createId(kind),
    userId,
    workspaceId,
    kind,
    sessionId,
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
  if (!template || !template.activeVersionId) {
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

export function createBurstFlareService(options = {}) {
  const store = options.store || createMemoryStore();
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
          workspace: formatWorkspace(state, workspace, "owner"),
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
        const membership = getMembership(state, user.id, workspace.id);
        ensure(membership, "Unauthorized workspace", 403);

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
          workspace: formatWorkspace(state, workspace, membership.role),
          token: sessionToken.token,
          tokenKind: sessionToken.kind
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
        const sessionToken = createToken(state, clock, {
          userId: auth.user.id,
          workspaceId: workspace.id,
          kind: auth.auth.kind === "browser" ? "browser" : "api"
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

        const token = createToken(state, clock, {
          userId: deviceCode.userId,
          workspaceId: deviceCode.workspaceId,
          kind: "api"
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
          token: token.token,
          tokenKind: token.kind
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
      return store.transact((state) => {
        const auth = requireTemplateAccess(state, token, templateId, clock);
        ensure(canWrite(auth.membership.role), "Insufficient permissions", 403);
        ensure(version, "Version is required");
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

        return { templateVersion, build };
      });
    },

    async processTemplateBuilds(token) {
      return store.transact((state) => {
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
          if (!["queued", "retrying"].includes(build.status)) {
            continue;
          }
          build.status = "building";
          build.startedAt = nowIso(clock);
          build.updatedAt = nowIso(clock);
          build.attempts += 1;
          version.status = "building";

          build.status = "succeeded";
          build.finishedAt = nowIso(clock);
          build.updatedAt = nowIso(clock);
          version.status = "ready";
          version.builtAt = nowIso(clock);
          writeUsage(state, clock, {
            workspaceId: auth.workspace.id,
            kind: "template_build",
            value: 1,
            details: { templateId: template.id, templateVersionId: version.id }
          });
          writeAudit(state, clock, {
            action: "template.build_succeeded",
            actorUserId: auth.user.id,
            workspaceId: auth.workspace.id,
            targetType: "template_build",
            targetId: build.id,
            details: { templateId: template.id, templateVersionId: version.id }
          });
          builds.push({
            ...build,
            templateId: template.id,
            templateVersionId: version.id
          });
        }
        return { builds, processed: builds.length };
      });
    },

    async retryTemplateBuild(token, buildId) {
      return store.transact((state) => {
        const auth = requireManageWorkspace(state, token, clock);
        const build = state.templateBuilds.find((entry) => entry.id === buildId);
        ensure(build, "Build not found", 404);
        const version = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
        ensure(version, "Template version missing", 404);
        const template = state.templates.find((entry) => entry.id === version.templateId);
        ensure(template && template.workspaceId === auth.workspace.id, "Build not found", 404);
        build.status = "retrying";
        build.updatedAt = nowIso(clock);
        version.status = "queued";
        writeAudit(state, clock, {
          action: "template.build_retried",
          actorUserId: auth.user.id,
          workspaceId: auth.workspace.id,
          targetType: "template_build",
          targetId: build.id
        });
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
        ensure(getActiveVersion(state, template.id), "Template has no promoted version", 409);
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
        requireSessionAccess(state, token, sessionId, clock);
        return {
          snapshots: state.snapshots.filter((entry) => entry.sessionId === sessionId)
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
        const report = {
          workspace: formatWorkspace(state, auth.workspace, auth.membership.role),
          members: state.memberships.filter((entry) => entry.workspaceId === auth.workspace.id).length,
          templates: state.templates.filter((entry) => entry.workspaceId === auth.workspace.id).length,
          buildsQueued: state.templateBuilds.filter((build) => {
            const version = state.templateVersions.find((entry) => entry.id === build.templateVersionId);
            const template = version && state.templates.find((entry) => entry.id === version.templateId);
            return template && template.workspaceId === auth.workspace.id && ["queued", "retrying"].includes(build.status);
          }).length,
          sessionsRunning: getRunningSessionCount(state, auth.workspace.id),
          sessionsTotal: state.sessions.filter(
            (entry) => entry.workspaceId === auth.workspace.id && entry.state !== "deleted"
          ).length,
          releases: state.bindingReleases.filter((entry) => entry.workspaceId === auth.workspace.id).length
        };
        return { report };
      });
    },

    async reconcile(token) {
      return store.transact((state) => {
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
          build.status = "succeeded";
          build.attempts += 1;
          build.startedAt = build.startedAt || nowIso(clock);
          build.finishedAt = nowIso(clock);
          build.updatedAt = nowIso(clock);
          version.status = "ready";
          version.builtAt = nowIso(clock);
          writeUsage(state, clock, {
            workspaceId: template.workspaceId,
            kind: "template_build",
            value: 1,
            details: { templateId: template.id, templateVersionId: version.id, source: "reconcile" }
          });
          processedBuilds += 1;
        }

        return {
          sleptSessions,
          processedBuilds
        };
      });
    }
  };
}
