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
    readBundleText(templateVersionId) {
      const entry = bundles.get(templateVersionId);
      return entry ? decoder.decode(entry.body) : null;
    }
  };
}

test("service covers invites, queued builds, releases, session events, usage, and audit", async () => {
  let tick = Date.parse("2026-02-27T00:00:00.000Z");
  const objects = createObjectStore();
  const service = createBurstFlareService({
    store: createMemoryStore(),
    objects,
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

  const template = await service.createTemplate(owner.token, {
    name: "node-dev",
    description: "Node runtime"
  });

  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: { image: "registry.cloudflare.com/test/node-dev:1.0.0" }
  });
  assert.equal(version.build.status, "queued");
  const uploaded = await service.uploadTemplateVersionBundle(owner.token, template.template.id, version.templateVersion.id, {
    body: "console.log('bundle');",
    contentType: "application/javascript"
  });
  assert.equal(uploaded.bundle.bytes, 22);
  assert.equal(objects.readBundleText(version.templateVersion.id), "console.log('bundle');");
  const bundle = await service.getTemplateVersionBundle(owner.token, template.template.id, version.templateVersion.id);
  assert.equal(new TextDecoder().decode(bundle.body), "console.log('bundle');");
  await assert.rejects(
    () => service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id),
    /build-ready/
  );

  const processed = await service.processTemplateBuilds(owner.token);
  assert.equal(processed.processed, 1);
  const buildLog = await service.getTemplateBuildLog(owner.token, version.build.id);
  assert.match(buildLog.text, /bundle_uploaded=true/);

  const promoted = await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);
  assert.equal(promoted.activeVersion.id, version.templateVersion.id);
  assert.ok(promoted.release.id);

  const session = await service.createSession(switched.token, {
    name: "demo",
    templateId: template.template.id
  });
  assert.equal(session.session.state, "created");

  const started = await service.startSession(switched.token, session.session.id);
  assert.equal(started.session.state, "running");

  const restarted = await service.restartSession(switched.token, session.session.id);
  assert.equal(restarted.session.state, "running");

  const runtime = await service.issueRuntimeToken(switched.token, session.session.id);
  assert.match(runtime.sshCommand, /ssh -o ProxyCommand=/);
  await service.validateRuntimeToken(runtime.token, session.session.id);

  const events = await service.listSessionEvents(switched.token, session.session.id);
  assert.ok(events.events.length >= 5);

  const snapshot = await service.createSnapshot(switched.token, session.session.id, {
    label: "manual-save"
  });
  assert.equal(snapshot.snapshot.label, "manual-save");
  const uploadedSnapshot = await service.uploadSnapshotContent(switched.token, session.session.id, snapshot.snapshot.id, {
    body: "workspace-state",
    contentType: "text/plain"
  });
  assert.equal(uploadedSnapshot.snapshot.bytes, 15);
  const downloadedSnapshot = await service.getSnapshotContent(switched.token, session.session.id, snapshot.snapshot.id);
  assert.equal(new TextDecoder().decode(downloadedSnapshot.body), "workspace-state");

  const usage = await service.getUsage(owner.token);
  assert.deepEqual(usage.usage, {
    runtimeMinutes: 2,
    snapshots: 1,
    templateBuilds: 1
  });

  const refreshed = await service.refreshSession(owner.refreshToken);
  assert.ok(refreshed.token);
  assert.ok(refreshed.refreshToken);
  await assert.rejects(() => service.refreshSession(owner.refreshToken), /Unauthorized/);
  const logout = await service.logout(refreshed.token, refreshed.refreshToken);
  assert.equal(logout.ok, true);
  await assert.rejects(() => service.authenticate(refreshed.token), /Unauthorized/);

  const report = await service.getAdminReport(owner.token);
  assert.equal(report.report.members, 2);
  assert.equal(report.report.releases, 1);

  const audit = await service.getAudit(owner.token);
  assert.ok(audit.audit.length >= 10);
});
