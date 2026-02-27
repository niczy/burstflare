import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/edge/src/worker.js";
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

test("worker serves health, auth, templates, sessions, and device flow", async () => {
  const service = createBurstFlareService({
    store: createMemoryStore()
  });
  const app = createApp({ service });

  const health = await requestJson(app, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.data.ok, true);

  const register = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "ops@example.com", name: "Ops" })
  });
  assert.equal(register.response.status, 200);

  const token = register.data.token;
  const authHeaders = {
    authorization: `Bearer ${token}`
  };

  const template = await requestJson(app, "/api/templates", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "python-dev", description: "Python toolchain" })
  });
  assert.equal(template.response.status, 200);

  const templateId = template.data.template.id;

  const version = await requestJson(app, `/api/templates/${templateId}/versions`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      version: "2.0.0",
      manifest: { image: "registry.cloudflare.com/test/python-dev:2.0.0" }
    })
  });
  assert.equal(version.response.status, 200);

  const promoted = await requestJson(app, `/api/templates/${templateId}/promote`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ versionId: version.data.templateVersion.id })
  });
  assert.equal(promoted.response.status, 200);

  const createdSession = await requestJson(app, "/api/sessions", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "feature-x", templateId })
  });
  assert.equal(createdSession.response.status, 200);

  const sessionId = createdSession.data.session.id;

  const started = await requestJson(app, `/api/sessions/${sessionId}/start`, {
    method: "POST",
    headers: authHeaders
  });
  assert.equal(started.data.session.state, "running");

  const ssh = await requestJson(app, `/api/sessions/${sessionId}/ssh-token`, {
    method: "POST",
    headers: authHeaders
  });
  assert.match(ssh.data.sshCommand, /ProxyCommand/);

  const deviceStart = await requestJson(app, "/api/cli/device/start", {
    method: "POST",
    body: JSON.stringify({ email: "ops@example.com" })
  });
  assert.equal(deviceStart.response.status, 200);

  const deviceApprove = await requestJson(app, "/api/cli/device/approve", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ deviceCode: deviceStart.data.deviceCode })
  });
  assert.equal(deviceApprove.response.status, 200);

  const deviceExchange = await requestJson(app, "/api/cli/device/exchange", {
    method: "POST",
    body: JSON.stringify({ deviceCode: deviceStart.data.deviceCode })
  });
  assert.equal(deviceExchange.data.tokenKind, "api");

  const usage = await requestJson(app, "/api/usage", {
    headers: authHeaders
  });
  assert.equal(usage.data.usage.runtimeMinutes, 1);
});
