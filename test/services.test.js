import test from "node:test";
import assert from "node:assert/strict";
import { createBurstFlareService, createMemoryStore } from "../packages/shared/src/index.js";

test("service covers account, template, session, snapshot, usage, and audit flows", async () => {
  let tick = Date.parse("2026-02-27T00:00:00.000Z");
  const service = createBurstFlareService({
    store: createMemoryStore(),
    clock: () => {
      tick += 1000;
      return tick;
    }
  });

  const registered = await service.registerUser({
    email: "dev@example.com",
    name: "Dev User"
  });

  assert.equal(registered.user.email, "dev@example.com");
  assert.equal(registered.workspace.plan, "free");

  const template = await service.createTemplate(registered.token, {
    name: "node-dev",
    description: "Node runtime"
  });
  assert.equal(template.template.name, "node-dev");

  const version = await service.addTemplateVersion(registered.token, template.template.id, {
    version: "1.0.0",
    manifest: { image: "registry.cloudflare.com/test/node-dev:1.0.0" }
  });
  assert.equal(version.build.status, "succeeded");

  const promoted = await service.promoteTemplateVersion(
    registered.token,
    template.template.id,
    version.templateVersion.id
  );
  assert.equal(promoted.activeVersion.id, version.templateVersion.id);

  const session = await service.createSession(registered.token, {
    name: "demo",
    templateId: template.template.id
  });
  assert.equal(session.session.state, "creating");

  const started = await service.startSession(registered.token, session.session.id);
  assert.equal(started.session.state, "running");

  const runtime = await service.issueRuntimeToken(registered.token, session.session.id);
  assert.match(runtime.sshCommand, /ssh -o ProxyCommand=/);

  const snapshot = await service.createSnapshot(registered.token, session.session.id, {
    label: "manual-save"
  });
  assert.equal(snapshot.snapshot.label, "manual-save");

  const usage = await service.getUsage(registered.token);
  assert.deepEqual(usage.usage, {
    runtimeMinutes: 1,
    snapshots: 1,
    templateBuilds: 1
  });

  const audit = await service.getAudit(registered.token);
  assert.ok(audit.audit.length >= 6);
});
