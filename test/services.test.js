import test from "node:test";
import assert from "node:assert/strict";
import { createBurstFlareService, createMemoryStore } from "../packages/shared/src/index.js";

function createObjectStore() {
  const bundles = new Map();
  const logs = new Map();
  const artifacts = new Map();
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
    async putBuildArtifact({ build, artifact }) {
      artifacts.set(build.id, artifact);
    },
    async getBuildArtifact({ build }) {
      const text = artifacts.get(build.id);
      if (!text) {
        return null;
      }
      return {
        text,
        contentType: "application/json; charset=utf-8",
        bytes: new TextEncoder().encode(text).byteLength
      };
    },
    async deleteBuildArtifact({ build }) {
      artifacts.delete(build.id);
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
    },
    readBuildArtifactText(buildId) {
      return artifacts.get(buildId) || null;
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
      buildStrategy: "queue",
      async enqueueBuild(buildId) {
        queuedBuilds.push(buildId);
        return {
          buildId,
          dispatch: "queue",
          dispatchedAt: new Date(tick + 1).toISOString()
        };
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
  const passkeyRegistration = await service.beginPasskeyRegistration(owner.token);
  assert.equal(passkeyRegistration.passkeys.length, 0);
  const registeredPasskey = await service.registerPasskey(owner.token, {
    credentialId: "credential-owner-1",
    label: "Owner Laptop",
    publicKey: "spki-owner-key",
    publicKeyAlgorithm: -7,
    transports: ["internal", "hybrid"]
  });
  assert.equal(registeredPasskey.passkeys.length, 1);
  const listedPasskeys = await service.listPasskeys(owner.token);
  assert.equal(listedPasskeys.passkeys[0].label, "Owner Laptop");
  const passkeyLoginStart = await service.beginPasskeyLogin({
    email: "owner@example.com"
  });
  assert.equal(passkeyLoginStart.passkeys.length, 1);
  const passkeyAssertion = await service.getPasskeyAssertion({
    userId: owner.user.id,
    workspaceId: owner.workspace.id,
    credentialId: "credential-owner-1"
  });
  assert.equal(passkeyAssertion.passkey.publicKey, "spki-owner-key");
  const passkeyLogin = await service.completePasskeyLogin({
    userId: owner.user.id,
    workspaceId: owner.workspace.id,
    credentialId: "credential-owner-1",
    signCount: 7
  });
  assert.ok(passkeyLogin.refreshToken);
  const postLoginPasskeys = await service.listPasskeys(passkeyLogin.token);
  assert.equal(postLoginPasskeys.passkeys[0].lastUsedAt !== null, true);
  const teammate = await service.registerUser({
    email: "teammate@example.com",
    name: "Teammate User"
  });
  await assert.rejects(
    () =>
      service.registerPasskey(teammate.token, {
        credentialId: "credential-owner-1",
        label: "Duplicate",
        publicKey: "spki-duplicate",
        publicKeyAlgorithm: -7
      }),
    /already registered/
  );

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
  assert.match(buildLog.text, /artifact_source=bundle/);
  const buildArtifact = await service.getTemplateBuildArtifact(owner.token, version.build.id);
  const parsedBuildArtifact = JSON.parse(buildArtifact.text);
  assert.equal(parsedBuildArtifact.source, "bundle");
  assert.equal(parsedBuildArtifact.sourceBytes, signedBundleBody.length);
  assert.equal(parsedBuildArtifact.templateVersionId, version.templateVersion.id);
  assert.equal(objects.readBuildArtifactText(version.build.id) !== null, true);

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
  assert.equal(promoted.release.binding.templateName, "node-dev");
  assert.equal(promoted.release.binding.artifactSource, "bundle");
  assert.equal(promoted.release.binding.artifactDigest, parsedBuildArtifact.sourceSha256);
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
  assert.equal(objects.readBuildArtifactText(disposableVersion.build.id), null);
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
  assert.match(runtime.sshCommand, /wstunnel client/);
  assert.match(runtime.sshCommand, /ssh -p 2222 dev@127\.0\.0\.1/);
  await service.validateRuntimeToken(runtime.token, session.session.id);

  const events = await service.listSessionEvents(switched.token, session.session.id);
  assert.ok(events.events.length >= 5);

  const snapshot = await service.createSnapshot(switched.token, session.session.id, {
    label: "manual-save"
  });
  assert.equal(snapshot.snapshot.label, "manual-save");
  const emptySnapshot = await service.createSnapshot(switched.token, session.session.id, {
    label: "empty"
  });
  await assert.rejects(
    () => service.restoreSnapshot(switched.token, session.session.id, emptySnapshot.snapshot.id),
    /Snapshot content not uploaded/
  );
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
  const restoredSnapshot = await service.restoreSnapshot(switched.token, session.session.id, snapshot.snapshot.id);
  assert.equal(restoredSnapshot.session.lastRestoredSnapshotId, snapshot.snapshot.id);
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
  assert.equal(cleanup.purgedSnapshots, 2);
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
    snapshots: 3,
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

test("service records workflow dispatch metadata and workflow-driven build completion", async () => {
  const workflowRuns = [];
  const service = createBurstFlareService({
    jobs: {
      buildStrategy: "workflow",
      async enqueueBuild(buildId) {
        const instanceId = `bwf_${buildId}_${workflowRuns.length + 1}`;
        workflowRuns.push({ buildId, instanceId });
        return {
          buildId,
          dispatch: "workflow",
          dispatchedAt: "2026-02-28T00:00:00.000Z",
          workflow: {
            name: "burstflare-builds",
            instanceId,
            dispatchedAt: "2026-02-28T00:00:00.000Z"
          }
        };
      }
    }
  });

  const owner = await service.registerUser({
    email: "workflow-owner@example.com",
    name: "Workflow Owner"
  });
  const template = await service.createTemplate(owner.token, {
    name: "workflow-template",
    description: "Workflow template"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/workflow:1.0.0"
    }
  });

  assert.equal(version.build.dispatchMode, "workflow");
  assert.equal(version.build.workflowStatus, "queued");
  assert.match(version.build.workflowInstanceId, /^bwf_/);
  assert.equal(workflowRuns.length, 1);

  const marked = await service.markTemplateBuildWorkflow(version.build.id, {
    status: "running",
    instanceId: version.build.workflowInstanceId,
    name: "burstflare-builds",
    timestamp: "2026-02-28T00:00:01.000Z"
  });
  assert.equal(marked.build.workflowStatus, "running");

  const processed = await service.processTemplateBuildById(version.build.id, {
    source: "workflow"
  });
  assert.equal(processed.build.status, "succeeded");
  assert.equal(processed.build.workflowStatus, "succeeded");
  assert.equal(processed.build.dispatchMode, "workflow");
});

test("service can persist runtime state from a durable-object-driven session transition", async () => {
  const service = createBurstFlareService();
  const owner = await service.registerUser({
    email: "runtime-sync@example.com",
    name: "Runtime Sync"
  });
  const template = await service.createTemplate(owner.token, {
    name: "runtime-sync",
    description: "Runtime sync template"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/runtime-sync:1.0.0"
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);
  const created = await service.createSession(owner.token, {
    name: "runtime-sync-session",
    templateId: template.template.id
  });

  const started = await service.transitionSessionWithRuntime(owner.token, created.session.id, "start", async () => ({
    desiredState: "running",
    status: "running",
    runtimeState: "healthy"
  }));
  assert.equal(started.session.state, "running");
  assert.equal(started.runtime.status, "running");
  assert.equal(started.session.runtimeStatus, "running");
  assert.equal(started.session.runtimeState, "healthy");

  const detail = await service.getSession(owner.token, created.session.id);
  assert.equal(detail.session.runtimeStatus, "running");
  assert.equal(detail.session.runtimeState, "healthy");
});

test("service can roll back a template to a prior release", async () => {
  const service = createBurstFlareService();
  const owner = await service.registerUser({
    email: "rollback@example.com",
    name: "Rollback User"
  });
  const template = await service.createTemplate(owner.token, {
    name: "rollback-template",
    description: "Rollback coverage"
  });

  const versionOne = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/rollback-template:1.0.0"
    }
  });
  await service.processTemplateBuildById(versionOne.build.id);
  const firstPromotion = await service.promoteTemplateVersion(owner.token, template.template.id, versionOne.templateVersion.id);

  const versionTwo = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "2.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/rollback-template:2.0.0"
    }
  });
  await service.processTemplateBuildById(versionTwo.build.id);
  const secondPromotion = await service.promoteTemplateVersion(owner.token, template.template.id, versionTwo.templateVersion.id);
  assert.equal(secondPromotion.activeVersion.id, versionTwo.templateVersion.id);

  const rolledBack = await service.rollbackTemplate(owner.token, template.template.id);
  assert.equal(rolledBack.activeVersion.id, versionOne.templateVersion.id);
  assert.equal(rolledBack.targetRelease.id, firstPromotion.release.id);
  assert.equal(rolledBack.release.mode, "rollback");
  assert.equal(rolledBack.release.sourceReleaseId, firstPromotion.release.id);
  assert.equal(rolledBack.release.binding.templateName, "rollback-template");

  const releases = await service.listBindingReleases(owner.token);
  const templateReleases = releases.releases.filter((entry) => entry.templateId === template.template.id);
  assert.equal(templateReleases.length, 3);
  assert.equal(templateReleases.at(-1).mode, "rollback");
  assert.equal(templateReleases.at(-1).templateVersionId, versionOne.templateVersion.id);
});

test("service ignores stale runtime transitions that arrive after a newer runtime state", async () => {
  const service = createBurstFlareService();
  const owner = await service.registerUser({
    email: "runtime-stale@example.com",
    name: "Runtime Stale"
  });
  const template = await service.createTemplate(owner.token, {
    name: "runtime-stale",
    description: "Runtime stale template"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/runtime-stale:1.0.0"
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);

  const created = await service.createSession(owner.token, {
    name: "runtime-stale-session",
    templateId: template.template.id
  });

  const started = await service.transitionSessionWithRuntime(owner.token, created.session.id, "start", async () => ({
    desiredState: "running",
    status: "running",
    runtimeState: "healthy",
    version: 2,
    operationId: "op_new"
  }));
  assert.equal(started.session.state, "running");
  assert.equal(started.session.runtimeVersion, 2);
  assert.equal(started.session.runtimeOperationId, "op_new");

  const staleStop = await service.transitionSessionWithRuntime(owner.token, created.session.id, "stop", async () => ({
    desiredState: "sleeping",
    status: "sleeping",
    runtimeState: "stopped",
    version: 1,
    operationId: "op_old"
  }));
  assert.equal(staleStop.stale, true);
  assert.equal(staleStop.session.state, "running");
  assert.equal(staleStop.session.runtimeVersion, 2);
  assert.equal(staleStop.session.runtimeOperationId, "op_new");

  const detail = await service.getSession(owner.token, created.session.id);
  assert.equal(detail.session.state, "running");
  assert.equal(detail.session.runtimeVersion, 2);
  assert.equal(detail.session.runtimeOperationId, "op_new");
});
