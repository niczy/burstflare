import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/edge/src/app.js";
import { createBurstFlareService, createMemoryStore } from "../packages/shared/src/index.js";

async function requestJson(app, path, init = {}) {
  const response = await app.fetch(
    new Request(`http://example.test${path}`, {
      ...init
    })
  );
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

test("worker serves invite flow, build queue flow, session events, and runtime validation", async () => {
  const service = createBurstFlareService({
    store: createMemoryStore()
  });
  const app = createApp({ service });

  const health = await requestJson(app, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.data.ok, true);

  const owner = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "ops@example.com", name: "Ops" })
  });
  const ownerToken = owner.data.token;
  const ownerHeaders = { authorization: `Bearer ${ownerToken}` };

  const teammate = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "dev@example.com", name: "Dev" })
  });
  const teammateToken = teammate.data.token;
  const teammateHeaders = { authorization: `Bearer ${teammateToken}` };

  const invite = await requestJson(app, "/api/workspaces/current/invites", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ email: "dev@example.com", role: "member" })
  });
  assert.equal(invite.response.status, 200);

  const accepted = await requestJson(app, "/api/workspaces/current/invites/accept", {
    method: "POST",
    headers: teammateHeaders,
    body: JSON.stringify({ inviteCode: invite.data.invite.code })
  });
  assert.equal(accepted.response.status, 200);

  const switched = await requestJson(app, "/api/auth/switch-workspace", {
    method: "POST",
    headers: teammateHeaders,
    body: JSON.stringify({ workspaceId: owner.data.workspace.id })
  });
  assert.equal(switched.response.status, 200);
  const switchedToken = switched.data.token;
  const switchedHeaders = { authorization: `Bearer ${switchedToken}` };

  const template = await requestJson(app, "/api/templates", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ name: "python-dev", description: "Python toolchain" })
  });
  const templateId = template.data.template.id;

  const version = await requestJson(app, `/api/templates/${templateId}/versions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      version: "2.0.0",
      manifest: { image: "registry.cloudflare.com/test/python-dev:2.0.0" }
    })
  });
  assert.equal(version.data.build.status, "queued");

  const prematurePromote = await requestJson(app, `/api/templates/${templateId}/promote`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ versionId: version.data.templateVersion.id })
  });
  assert.equal(prematurePromote.response.status, 409);

  const buildProcess = await requestJson(app, "/api/template-builds/process", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(buildProcess.data.processed, 1);

  const promoted = await requestJson(app, `/api/templates/${templateId}/promote`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ versionId: version.data.templateVersion.id })
  });
  assert.equal(promoted.response.status, 200);

  const session = await requestJson(app, "/api/sessions", {
    method: "POST",
    headers: switchedHeaders,
    body: JSON.stringify({ name: "feature-x", templateId })
  });
  const sessionId = session.data.session.id;

  const started = await requestJson(app, `/api/sessions/${sessionId}/start`, {
    method: "POST",
    headers: switchedHeaders
  });
  assert.equal(started.data.session.state, "running");

  const restarted = await requestJson(app, `/api/sessions/${sessionId}/restart`, {
    method: "POST",
    headers: switchedHeaders
  });
  assert.equal(restarted.data.session.state, "running");

  const events = await requestJson(app, `/api/sessions/${sessionId}/events`, {
    headers: switchedHeaders
  });
  assert.ok(events.data.events.length >= 5);

  const ssh = await requestJson(app, `/api/sessions/${sessionId}/ssh-token`, {
    method: "POST",
    headers: switchedHeaders
  });
  assert.match(ssh.data.sshCommand, /ProxyCommand/);

  const runtimeInvalid = await app.fetch(
    new Request(`http://example.test/runtime/sessions/${sessionId}/ssh?token=${switchedToken}`)
  );
  assert.equal(runtimeInvalid.status, 401);

  const runtimeValid = await app.fetch(
    new Request(`http://example.test/runtime/sessions/${sessionId}/ssh?token=${ssh.data.token}`)
  );
  assert.equal(runtimeValid.status, 200);

  const deviceStart = await requestJson(app, "/api/cli/device/start", {
    method: "POST",
    body: JSON.stringify({ email: "ops@example.com" })
  });
  const deviceApprove = await requestJson(app, "/api/cli/device/approve", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ deviceCode: deviceStart.data.deviceCode })
  });
  assert.equal(deviceApprove.response.status, 200);
  const deviceExchange = await requestJson(app, "/api/cli/device/exchange", {
    method: "POST",
    body: JSON.stringify({ deviceCode: deviceStart.data.deviceCode })
  });
  assert.equal(deviceExchange.data.tokenKind, "api");

  const report = await requestJson(app, "/api/admin/report", {
    headers: ownerHeaders
  });
  assert.equal(report.data.report.releases, 1);
});
