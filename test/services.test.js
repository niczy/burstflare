import test from "node:test";
import assert from "node:assert/strict";
import { createBurstFlareService, createMemoryStore } from "../packages/shared/src/index.js";

function createObjectStore() {
  const bundles = new Map();
  const logs = new Map();
  const snapshots = new Map();
  const decoder = new TextDecoder();

  return {
    async putTemplateVersionBundle({ templateVersion, body, contentType }) {
      bundles.set(templateVersion.id, {
        key: templateVersion.bundleKey,
        body: body.slice(),
        contentType
      });
    },
    async getTemplateVersionBundle({ templateVersion }) {
      const entry = bundles.get(templateVersion.id);
      if (!entry) {
        return null;
      }
      return {
        body: entry.body.slice(),
        contentType: entry.contentType,
        bytes: entry.body.byteLength
      };
    },
    async deleteTemplateVersionBundle({ templateVersion }) {
      bundles.delete(templateVersion.id);
    },
    async putBuildLog({ templateVersion, log }) {
      logs.set(templateVersion.id, log);
    },
    async getBuildLog({ templateVersion }) {
      const text = logs.get(templateVersion.id);
      if (!text) {
        return null;
      }
      return {
        text,
        contentType: "text/plain; charset=utf-8",
        bytes: new TextEncoder().encode(text).byteLength
      };
    },
    async deleteBuildLog({ templateVersion }) {
      logs.delete(templateVersion.id);
    },
    async putSnapshot({ snapshot, body, contentType }) {
      snapshots.set(snapshot.id, {
        body: body.slice(),
        contentType
      });
    },
    async getSnapshot({ snapshot }) {
      const entry = snapshots.get(snapshot.id);
      if (!entry) {
        return null;
      }
      return {
        body: entry.body.slice(),
        contentType: entry.contentType,
        bytes: entry.body.byteLength
      };
    },
    async deleteSnapshot({ snapshot }) {
      snapshots.delete(snapshot.id);
    },
    readBundleText(templateVersionId) {
      const entry = bundles.get(templateVersionId);
      return entry ? decoder.decode(entry.body) : null;
    },
    readBuildLogText(templateVersionId) {
      return logs.get(templateVersionId) || null;
    }
  };
}

test("service covers invites, queued builds, releases, session events, usage, and audit", async () => {
  let tick = Date.parse("2026-02-27T00:00:00.000Z");
  const objects = createObjectStore();
  const queuedBuilds = [];
  let reconcileJobs = 0;
  const store = createMemoryStore();
  const service = createBurstFlareService({
    store,
    objects,
    jobs: {
      async enqueueBuild(buildId) {
        queuedBuilds.push(buildId);
      },
      async enqueueReconcile() {
        reconcileJobs += 1;
      }
    },
    clock: () => {
      tick += 1000;
      return tick;
    }
  });

  const owner = await service.registerUser({
    email: "owner@example.com",
    name: "Owner User"
  });
  assert.ok(owner.refreshToken);
  const ownerRecovery = await service.generateRecoveryCodes(owner.token);
  assert.equal(ownerRecovery.recoveryCodes.length, 8);
  const recoveredOwner = await service.recoverWithCode({
    email: "owner@example.com",
    code: ownerRecovery.recoveryCodes[0]
  });
  assert.ok(recoveredOwner.refreshToken);
  assert.ok(recoveredOwner.authSessionId);
  await assert.rejects(
    () =>
      service.recoverWithCode({
        email: "owner@example.com",
        code: ownerRecovery.recoveryCodes[0]
      }),
    /Recovery code invalid/
  );
  const teammate = await service.registerUser({
    email: "teammate@example.com",
    name: "Teammate User"
  });

  const invite = await service.createWorkspaceInvite(owner.token, {
    email: "teammate@example.com",
    role: "member"
  });
  await service.acceptWorkspaceInvite(teammate.token, invite.invite.code);
  const switched = await service.switchWorkspace(teammate.token, owner.workspace.id);
  assert.equal(switched.workspace.id, owner.workspace.id);

  const plan = await service.setWorkspacePlan(owner.token, "pro");
  assert.equal(plan.workspace.plan, "pro");
  const renamedWorkspace = await service.updateWorkspaceSettings(owner.token, {
    name: "Burst Operations"
  });
  assert.equal(renamedWorkspace.workspace.name, "Burst Operations");

  const template = await service.createTemplate(owner.token, {
    name: "node-dev",
    description: "Node runtime"
  });

  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/test/node-dev:1.0.0",
      persistedPaths: ["/workspace", "/home/dev/.cache"],
      sleepTtlSeconds: 1
    }
  });
  assert.equal(version.build.status, "queued");
  assert.deepEqual(version.templateVersion.manifest.persistedPaths, ["/workspace", "/home/dev/.cache"]);
  assert.deepEqual(queuedBuilds, [version.build.id]);
  await assert.rejects(
    () =>
      service.addTemplateVersion(owner.token, template.template.id, {
        version: "invalid",
        manifest: { image: "registry.cloudflare.com/test/node-dev:invalid", features: ["invalid-feature"] }
      }),
    /Unsupported manifest feature/
  );
  const uploaded = await service.uploadTemplateVersionBundle(owner.token, template.template.id, version.templateVersion.id, {
    body: "console.log('bundle');",
    contentType: "application/javascript"
  });
  assert.equal(uploaded.bundle.bytes, 22);
  const signedBundleBody = "bundle-via-grant";
  const bundleGrant = await service.createTemplateVersionBundleUploadGrant(owner.token, template.template.id, version.templateVersion.id, {
    contentType: "text/plain",
    bytes: signedBundleBody.length
  });
  assert.match(bundleGrant.uploadGrant.id, /^upg_/);
  const grantUploaded = await service.consumeUploadGrant(bundleGrant.uploadGrant.id, {
    body: signedBundleBody,
    contentType: "text/plain"
  });
  assert.equal(grantUploaded.target, "template_bundle");
  assert.equal(objects.readBundleText(version.templateVersion.id), signedBundleBody);
  await assert.rejects(
    () => service.consumeUploadGrant(bundleGrant.uploadGrant.id, { body: signedBundleBody, contentType: "text/plain" }),
    /Upload grant not found/
  );
  await assert.rejects(
    () =>
      service.uploadTemplateVersionBundle(owner.token, template.template.id, version.templateVersion.id, {
        body: "x".repeat(300_000),
        contentType: "application/octet-stream"
      }),
    /Bundle exceeds size limit/
  );
  assert.equal(objects.readBundleText(version.templateVersion.id), signedBundleBody);
  const bundle = await service.getTemplateVersionBundle(owner.token, template.template.id, version.templateVersion.id);
  assert.equal(new TextDecoder().decode(bundle.body), signedBundleBody);
  await assert.rejects(
    () => service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id),
    /build-ready/
  );

  const secondVersion = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.1.0",
    manifest: { image: "registry.cloudflare.com/test/node-dev:1.1.0" }
  });
  const queuedProcessed = await service.processTemplateBuildById(secondVersion.build.id);
  assert.equal(queuedProcessed.processed, 1);

  const processed = await service.processTemplateBuilds(owner.token);
  assert.equal(processed.processed, 1);
  const buildLog = await service.getTemplateBuildLog(owner.token, version.build.id);
  assert.match(buildLog.text, /bundle_uploaded=true/);

  const stuckVersion = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.1.1",
    manifest: { image: "registry.cloudflare.com/test/node-dev:1.1.1" }
  });
  await store.transact((state) => {
    const build = state.templateBuilds.find((entry) => entry.id === stuckVersion.build.id);
    assert.ok(build);
    build.status = "building";
    build.startedAt = new Date(tick - 1000 * 60 * 10).toISOString();
    build.updatedAt = build.startedAt;
  });
  const recoveredStuck = await service.reconcile(owner.token);
  assert.equal(recoveredStuck.recoveredStuckBuilds, 1);
  assert.equal(recoveredStuck.processedBuilds, 1);

  const failingVersion = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.2.0",
    manifest: {
      image: "registry.cloudflare.com/test/node-dev:1.2.0",
      simulateFailure: true
    }
  });
  const failedOnce = await service.processTemplateBuildById(failingVersion.build.id, {
    source: "manual",
    actorUserId: owner.user.id
  });
  assert.equal(failedOnce.build.status, "failed");
  assert.match(failedOnce.build.lastError, /Simulated builder failure/);

  await service.retryTemplateBuild(owner.token, failingVersion.build.id);
  const failedTwice = await service.processTemplateBuildById(failingVersion.build.id, {
    source: "manual",
    actorUserId: owner.user.id
  });
  assert.equal(failedTwice.build.status, "failed");

  await service.retryTemplateBuild(owner.token, failingVersion.build.id);
  const deadLettered = await service.processTemplateBuildById(failingVersion.build.id, {
    source: "manual",
    actorUserId: owner.user.id
  });
  assert.equal(deadLettered.build.status, "dead_lettered");

  const failedBuildLog = await service.getTemplateBuildLog(owner.token, failingVersion.build.id);
  assert.match(failedBuildLog.text, /build_status=dead_lettered/);
  const bulkRetried = await service.retryDeadLetteredBuilds(owner.token);
  assert.equal(bulkRetried.recovered, 1);
  assert.deepEqual(bulkRetried.buildIds, [failingVersion.build.id]);
  await assert.rejects(() => service.retryTemplateBuild(owner.token, version.build.id), /Build is not retryable/);

  const promoted = await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);
  assert.equal(promoted.activeVersion.id, version.templateVersion.id);
  assert.ok(promoted.release.id);
  const archived = await service.archiveTemplate(owner.token, template.template.id);
  assert.ok(archived.template.archivedAt);
  await assert.rejects(
    () =>
      service.createSession(switched.token, {
        name: "blocked",
        templateId: template.template.id
      }),
    /Template is archived/
  );
  const restoredTemplate = await service.restoreTemplate(owner.token, template.template.id);
  assert.equal(restoredTemplate.template.archivedAt, null);

  const disposableTemplate = await service.createTemplate(owner.token, {
    name: "trash-dev",
    description: "Disposable runtime"
  });
  const disposableVersion = await service.addTemplateVersion(owner.token, disposableTemplate.template.id, {
    version: "0.1.0",
    manifest: { image: "registry.cloudflare.com/test/trash-dev:0.1.0" }
  });
  await service.uploadTemplateVersionBundle(owner.token, disposableTemplate.template.id, disposableVersion.templateVersion.id, {
    body: "trash bundle",
    contentType: "text/plain"
  });
  await service.processTemplateBuildById(disposableVersion.build.id);
  const deletedTemplate = await service.deleteTemplate(owner.token, disposableTemplate.template.id);
  assert.equal(deletedTemplate.ok, true);
  assert.equal(deletedTemplate.deletedVersions, 1);
  assert.equal(objects.readBundleText(disposableVersion.templateVersion.id), null);
  assert.equal(objects.readBuildLogText(disposableVersion.templateVersion.id), null);
  const templateList = await service.listTemplates(owner.token);
  assert.equal(
    templateList.templates.some((entry) => entry.id === disposableTemplate.template.id),
    false
  );

  const session = await service.createSession(switched.token, {
    name: "demo",
    templateId: template.template.id
  });
  assert.equal(session.session.state, "created");

  const started = await service.startSession(switched.token, session.session.id);
  assert.equal(started.session.state, "running");

  const restarted = await service.restartSession(switched.token, session.session.id);
  assert.equal(restarted.session.state, "running");

  const staleSession = await service.createSession(switched.token, {
    name: "stale-demo",
    templateId: template.template.id
  });
  await service.startSession(switched.token, staleSession.session.id);
  await service.stopSession(switched.token, staleSession.session.id);

  const runtime = await service.issueRuntimeToken(switched.token, session.session.id);
  assert.match(runtime.sshCommand, /ssh -o ProxyCommand=/);
  await service.validateRuntimeToken(runtime.token, session.session.id);

  const events = await service.listSessionEvents(switched.token, session.session.id);
  assert.ok(events.events.length >= 5);

  const snapshot = await service.createSnapshot(switched.token, session.session.id, {
    label: "manual-save"
  });
  assert.equal(snapshot.snapshot.label, "manual-save");
  const snapshotBody = "workspace-state";
  const snapshotGrant = await service.createSnapshotUploadGrant(switched.token, session.session.id, snapshot.snapshot.id, {
    contentType: "text/plain",
    bytes: snapshotBody.length
  });
  const uploadedSnapshot = await service.consumeUploadGrant(snapshotGrant.uploadGrant.id, {
    body: snapshotBody,
    contentType: "text/plain"
  });
  assert.equal(uploadedSnapshot.target, "snapshot");
  assert.equal(uploadedSnapshot.snapshot.bytes, 15);
  const downloadedSnapshot = await service.getSnapshotContent(switched.token, session.session.id, snapshot.snapshot.id);
  assert.equal(new TextDecoder().decode(downloadedSnapshot.body), "workspace-state");
  const deletedSnapshot = await service.deleteSnapshot(switched.token, session.session.id, snapshot.snapshot.id);
  assert.equal(deletedSnapshot.ok, true);
  await assert.rejects(() => service.getSnapshotContent(switched.token, session.session.id, snapshot.snapshot.id), /Snapshot not found/);

  const cleanupSnapshot = await service.createSnapshot(switched.token, session.session.id, {
    label: "cleanup"
  });
  await service.uploadSnapshotContent(switched.token, session.session.id, cleanupSnapshot.snapshot.id, {
    body: "cleanup-state",
    contentType: "text/plain"
  });
  await service.deleteSession(switched.token, session.session.id);
  const cleanup = await service.reconcile(owner.token);
  assert.equal(cleanup.purgedDeletedSessions, 1);
  assert.equal(cleanup.purgedStaleSleepingSessions, 1);
  assert.equal(cleanup.purgedSnapshots, 1);
  await assert.rejects(() => service.getSession(switched.token, session.session.id), /Session not found/);
  await assert.rejects(() => service.getSession(switched.token, staleSession.session.id), /Session not found/);

  const logoutAll = await service.logoutAllSessions(switched.token);
  assert.equal(logoutAll.ok, true);
  assert.ok(logoutAll.revokedTokens >= 2);
  await assert.rejects(() => service.authenticate(switched.token), /Unauthorized/);
  await assert.rejects(() => service.authenticate(teammate.token), /Unauthorized/);

  const ownerSecondLogin = await service.login({
    email: "owner@example.com",
    kind: "browser"
  });
  const authSessions = await service.listAuthSessions(ownerSecondLogin.token);
  assert.ok(authSessions.sessions.length >= 3);
  assert.ok(authSessions.sessions.some((entry) => entry.id === owner.authSessionId));
  const revokeSession = await service.revokeAuthSession(ownerSecondLogin.token, owner.authSessionId);
  assert.equal(revokeSession.ok, true);
  const afterRevoke = await service.listAuthSessions(ownerSecondLogin.token);
  assert.equal(afterRevoke.sessions.some((entry) => entry.id === owner.authSessionId), false);
  await assert.rejects(() => service.authenticate(owner.token), /Unauthorized/);
  await assert.rejects(() => service.refreshSession(owner.refreshToken), /Unauthorized/);
  assert.ok((await service.authenticate(ownerSecondLogin.token)).user.id);

  const usage = await service.getUsage(ownerSecondLogin.token);
  assert.deepEqual(usage.usage, {
    runtimeMinutes: 3,
    snapshots: 2,
    templateBuilds: 4
  });

  const refreshed = await service.refreshSession(ownerSecondLogin.refreshToken);
  assert.ok(refreshed.token);
  assert.ok(refreshed.refreshToken);
  await assert.rejects(() => service.refreshSession(ownerSecondLogin.refreshToken), /Unauthorized/);
  const logout = await service.logout(refreshed.token, refreshed.refreshToken);
  assert.equal(logout.ok, true);
  await assert.rejects(() => service.authenticate(refreshed.token), /Unauthorized/);

  const enqueued = await service.enqueueReconcile(ownerSecondLogin.token);
  assert.equal(enqueued.queued, true);
  assert.equal(reconcileJobs, 1);

  const report = await service.getAdminReport(ownerSecondLogin.token);
  assert.equal(report.report.members, 2);
  assert.equal(report.report.releases, 1);
  assert.equal(report.report.buildsQueued, 0);
  assert.equal(report.report.buildsBuilding, 0);
  assert.equal(report.report.buildsStuck, 0);
  assert.equal(report.report.buildsFailed, 1);
  assert.equal(report.report.buildsDeadLettered, 0);
  assert.equal(report.report.sessionsTotal, 0);
  assert.equal(report.report.sessionsSleeping, 0);
  assert.equal(report.report.activeUploadGrants, 0);

  const exported = await service.exportWorkspace(ownerSecondLogin.token);
  assert.equal(exported.export.workspace.id, owner.workspace.id);
  assert.equal(exported.export.members.length, 2);
  assert.equal(exported.export.templates.length >= 1, true);
  assert.equal(exported.export.audit.length >= 1, true);

  const audit = await service.getAudit(ownerSecondLogin.token);
  assert.ok(audit.audit.length >= 10);
});
