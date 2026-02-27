import test from "node:test";
import assert from "node:assert/strict";
import { createBurstFlareService, createMemoryStore } from "../packages/shared/src/index.js";

test("service covers invites, queued builds, releases, session events, usage, and audit", async () => {
  let tick = Date.parse("2026-02-27T00:00:00.000Z");
  const service = createBurstFlareService({
    store: createMemoryStore(),
    clock: () => {
      tick += 1000;
      return tick;
    }
  });

  const owner = await service.registerUser({
    email: "owner@example.com",
    name: "Owner User"
  });
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
  await assert.rejects(
    () => service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id),
    /build-ready/
  );

  const processed = await service.processTemplateBuilds(owner.token);
  assert.equal(processed.processed, 1);

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

  const usage = await service.getUsage(owner.token);
  assert.deepEqual(usage.usage, {
    runtimeMinutes: 2,
    snapshots: 1,
    templateBuilds: 1
  });

  const report = await service.getAdminReport(owner.token);
  assert.equal(report.report.members, 2);
  assert.equal(report.report.releases, 1);

  const audit = await service.getAudit(owner.token);
  assert.ok(audit.audit.length >= 10);
});
