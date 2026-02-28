import test from "node:test";
import assert from "node:assert/strict";
import { createApp, createWorkerService, handleScheduled } from "../apps/edge/src/app.js";

function toBytes(value) {
  if (value instanceof Uint8Array) {
    return value.slice();
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return new Uint8Array();
}

function createBucket() {
  const values = new Map();

  return {
    async put(key, value, options = {}) {
      values.set(key, {
        body: toBytes(value),
        contentType: options.httpMetadata?.contentType || "application/octet-stream"
      });
    },
    async delete(key) {
      values.delete(key);
    },
    async get(key) {
      const entry = values.get(key);
      if (!entry) {
        return null;
      }
      return {
        size: entry.body.byteLength,
        httpMetadata: { contentType: entry.contentType },
        async arrayBuffer() {
          return entry.body.slice().buffer;
        },
        async text() {
          return new TextDecoder().decode(entry.body);
        }
      };
    }
  };
}

function bytesToBase64Url(value) {
  const bytes = toBytes(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concatBytes(...parts) {
  const arrays = parts.map((value) => toBytes(value));
  const total = arrays.reduce((sum, entry) => sum + entry.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const entry of arrays) {
    merged.set(entry, offset);
    offset += entry.byteLength;
  }
  return merged;
}

async function requestJson(app, path, init = {}) {
  const url = path.startsWith("http://") || path.startsWith("https://") ? path : `http://example.test${path}`;
  const response = await app.fetch(
    new Request(url, {
      ...init
    })
  );
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

test("worker serves invite flow, bundle upload, build logs, session events, and runtime validation", async () => {
  const queuedBuilds = [];
  const queuedReconcile = [];
  const app = createApp({
    TEMPLATE_BUCKET: createBucket(),
    BUILD_QUEUE: {
      async send(body) {
        queuedBuilds.push(body);
      }
    },
    RECONCILE_QUEUE: {
      async send(body) {
        queuedReconcile.push(body);
      }
    },
    BUILD_BUCKET: createBucket(),
    SNAPSHOT_BUCKET: createBucket()
  });

  const health = await requestJson(app, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.runtime.turnstileEnabled, false);

  const rootResponse = await app.fetch(new Request("http://example.test/"));
  assert.equal(rootResponse.status, 200);
  const rootHtml = await rootResponse.text();
  assert.match(rootHtml, /Browser Terminal/);
  assert.match(rootHtml, /Approve Device Code/);
  assert.match(rootHtml, /Recovery Code/);
  assert.match(rootHtml, /New Recovery Codes/);
  assert.match(rootHtml, /Passkey Login/);
  assert.match(rootHtml, /Register Passkey/);
  assert.match(rootHtml, /id="passkeys"/);
  assert.match(rootHtml, /Turnstile is not configured for this deployment/);
  assert.match(rootHtml, /deviceStatus/);
  assert.match(rootHtml, /pendingDevices/);
  assert.match(rootHtml, /lastRefresh/);
  assert.match(rootHtml, /terminalOutput/);
  assert.match(rootHtml, /persistedPaths/);
  assert.match(rootHtml, /snapshotList/);
  assert.match(rootHtml, /snapshotContentPreview/);

  const appScriptResponse = await app.fetch(new Request("http://example.test/app.js"));
  assert.equal(appScriptResponse.status, 200);
  const appScript = await appScriptResponse.text();
  assert.match(appScript, /burstflare_refresh_token/);
  assert.match(appScript, /x-burstflare-csrf/);
  assert.match(appScript, /api\/auth\/recover/);
  assert.match(appScript, /api\/auth\/recovery-codes\/generate/);
  assert.match(appScript, /api\/auth\/passkeys\/login\/start/);
  assert.match(appScript, /api\/auth\/passkeys\/register\/start/);
  assert.match(appScript, /turnstileWidget/);
  assert.match(appScript, /api\/auth\/sessions/);
  assert.match(appScript, /api\/cli\/device\/approve/);
  assert.match(appScript, /navigator\.credentials\.create/);
  assert.match(appScript, /navigator\.credentials\.get/);
  assert.match(appScript, /api\/workspaces\/current\/settings/);
  assert.match(appScript, /new WebSocket/);
  assert.match(appScript, /pendingDeviceCodes/);
  assert.match(appScript, /setLastRefresh/);
  assert.match(appScript, /setRecoveryCodes/);
  assert.match(appScript, /mountTurnstile/);
  assert.match(appScript, /startAutoRefresh/);
  assert.match(appScript, /setInterval/);
  assert.match(appScript, /terminalSendButton/);
  assert.match(appScript, /parsePersistedPaths/);
  assert.match(appScript, /refreshSnapshots/);
  assert.match(appScript, /data-snapshot-download/);
  assert.match(appScript, /data-snapshot-restore/);
  assert.match(appScript, /logout-all/);
  assert.doesNotMatch(appScript, /headers\.set\("authorization"/);
  assert.doesNotMatch(appScript, /state\.token/);

  const turnstileApp = createApp({
    TURNSTILE_SECRET: "secret",
    TURNSTILE_SITE_KEY: "sitekey",
    fetchImpl: async (_url, init) => {
      const params = new URLSearchParams(init.body);
      const success = params.get("response") === "valid-turnstile";
      return new Response(
        JSON.stringify(success ? { success: true } : { success: false, "error-codes": ["invalid-input-response"] }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    }
  });

  const strictHealth = await requestJson(turnstileApp, "/api/health");
  assert.equal(strictHealth.response.status, 200);
  assert.equal(strictHealth.data.runtime.turnstileEnabled, true);

  const strictRootResponse = await turnstileApp.fetch(new Request("http://example.test/"));
  assert.equal(strictRootResponse.status, 200);
  const strictRootHtml = await strictRootResponse.text();
  assert.match(strictRootHtml, /challenges\.cloudflare\.com\/turnstile/);

  const strictAppScriptResponse = await turnstileApp.fetch(new Request("http://example.test/app.js"));
  assert.equal(strictAppScriptResponse.status, 200);
  const strictAppScript = await strictAppScriptResponse.text();
  assert.match(strictAppScript, /const TURNSTILE_SITE_KEY = "sitekey"/);

  const strictMissing = await requestJson(turnstileApp, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "strict-missing@example.com", name: "Strict Missing" })
  });
  assert.equal(strictMissing.response.status, 400);

  const strictAllowed = await requestJson(turnstileApp, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: "strict-ok@example.com",
      name: "Strict Ok",
      turnstileToken: "valid-turnstile"
    })
  });
  assert.equal(strictAllowed.response.status, 200);

  const owner = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "ops@example.com", name: "Ops" })
  });
  assert.match(owner.data.csrfToken, /^[0-9a-f-]+$/);
  const ownerSetCookies = owner.response.headers.getSetCookie
    ? owner.response.headers.getSetCookie()
    : [owner.response.headers.get("set-cookie")].filter(Boolean);
  const ownerCookieHeader = ownerSetCookies
    .map((entry) => entry.split(";")[0])
    .join("; ");
  const ownerToken = owner.data.token;
  const ownerRefreshToken = owner.data.refreshToken;
  const ownerHeaders = { authorization: `Bearer ${ownerToken}` };

  const passkeyKeyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    true,
    ["sign", "verify"]
  );
  const passkeyPublicKey = await globalThis.crypto.subtle.exportKey("spki", passkeyKeyPair.publicKey);

  const passkeyRegisterStart = await requestJson(app, "/api/auth/passkeys/register/start", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(passkeyRegisterStart.response.status, 200);

  const passkeyRegisterClientDataText = JSON.stringify({
    type: "webauthn.create",
    challenge: passkeyRegisterStart.data.publicKey.challenge,
    origin: "http://example.test"
  });
  const passkeyRegisterFinish = await requestJson(app, "/api/auth/passkeys/register/finish", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      challengeId: passkeyRegisterStart.data.challengeId,
      label: "Ops Laptop",
      credential: {
        id: "test-passkey-1",
        response: {
          clientDataJSON: bytesToBase64Url(passkeyRegisterClientDataText),
          publicKey: bytesToBase64Url(passkeyPublicKey),
          publicKeyAlgorithm: -7,
          transports: ["internal"],
          authenticatorData: bytesToBase64Url(new Uint8Array(37))
        }
      }
    })
  });
  assert.equal(passkeyRegisterFinish.response.status, 200);
  assert.equal(passkeyRegisterFinish.data.passkeys.length, 1);

  const passkeys = await requestJson(app, "/api/auth/passkeys", {
    headers: ownerHeaders
  });
  assert.equal(passkeys.response.status, 200);
  assert.equal(passkeys.data.passkeys.length, 1);

  const passkeyLoginStart = await requestJson(app, "/api/auth/passkeys/login/start", {
    method: "POST",
    body: JSON.stringify({ email: "ops@example.com" })
  });
  assert.equal(passkeyLoginStart.response.status, 200);

  const passkeyAuthenticatorData = new Uint8Array(37);
  passkeyAuthenticatorData[36] = 9;
  const passkeyLoginClientDataText = JSON.stringify({
    type: "webauthn.get",
    challenge: passkeyLoginStart.data.publicKey.challenge,
    origin: "http://example.test"
  });
  const passkeyLoginClientData = new TextEncoder().encode(passkeyLoginClientDataText);
  const passkeyLoginClientHash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", passkeyLoginClientData));
  const passkeySignature = await globalThis.crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256"
    },
    passkeyKeyPair.privateKey,
    concatBytes(passkeyAuthenticatorData, passkeyLoginClientHash)
  );

  const passkeyLoginFinish = await requestJson(app, "/api/auth/passkeys/login/finish", {
    method: "POST",
    body: JSON.stringify({
      challengeId: passkeyLoginStart.data.challengeId,
      credential: {
        id: "test-passkey-1",
        response: {
          clientDataJSON: bytesToBase64Url(passkeyLoginClientData),
          authenticatorData: bytesToBase64Url(passkeyAuthenticatorData),
          signature: bytesToBase64Url(passkeySignature)
        }
      }
    })
  });
  assert.equal(passkeyLoginFinish.response.status, 200);
  assert.ok(passkeyLoginFinish.data.refreshToken);

  const deletedPasskey = await requestJson(app, "/api/auth/passkeys/test-passkey-1", {
    method: "DELETE",
    headers: ownerHeaders,
    body: JSON.stringify({})
  });
  assert.equal(deletedPasskey.response.status, 200);
  assert.equal(deletedPasskey.data.ok, true);

  const renamedWorkspace = await requestJson(app, "/api/workspaces/current/settings", {
    method: "PATCH",
    headers: ownerHeaders,
    body: JSON.stringify({ name: "Burst Ops" })
  });
  assert.equal(renamedWorkspace.response.status, 200);
  assert.equal(renamedWorkspace.data.workspace.name, "Burst Ops");

  const ownerRecovery = await requestJson(app, "/api/auth/recovery-codes/generate", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({})
  });
  assert.equal(ownerRecovery.response.status, 200);
  assert.equal(ownerRecovery.data.recoveryCodes.length, 8);

  const recoveredOwner = await requestJson(app, "/api/auth/recover", {
    method: "POST",
    body: JSON.stringify({
      email: "ops@example.com",
      code: ownerRecovery.data.recoveryCodes[0]
    })
  });
  assert.equal(recoveredOwner.response.status, 200);

  const rejectedRecovery = await requestJson(app, "/api/auth/recover", {
    method: "POST",
    body: JSON.stringify({
      email: "ops@example.com",
      code: ownerRecovery.data.recoveryCodes[0]
    })
  });
  assert.equal(rejectedRecovery.response.status, 401);

  const csrfBlocked = await requestJson(app, "/api/templates", {
    method: "POST",
    headers: {
      cookie: ownerCookieHeader
    },
    body: JSON.stringify({ name: "blocked-cookie", description: "blocked without csrf" })
  });
  assert.equal(csrfBlocked.response.status, 403);

  const csrfAllowed = await requestJson(app, "/api/templates", {
    method: "POST",
    headers: {
      cookie: ownerCookieHeader,
      "x-burstflare-csrf": owner.data.csrfToken
    },
    body: JSON.stringify({ name: "cookie-template", description: "allowed with csrf" })
  });
  assert.equal(csrfAllowed.response.status, 200);

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
      manifest: {
        image: "registry.cloudflare.com/test/python-dev:2.0.0",
        persistedPaths: ["/workspace"],
        sleepTtlSeconds: 1
      }
    })
  });
  assert.equal(version.data.build.status, "queued");
  assert.deepEqual(version.data.templateVersion.manifest.persistedPaths, ["/workspace"]);
  assert.equal(queuedBuilds.length, 1);
  assert.equal(queuedBuilds[0].type, "build");
  assert.equal(queuedBuilds[0].buildId, version.data.build.id);
  assert.match(queuedBuilds[0].dispatchedAt, /\d{4}-\d{2}-\d{2}T/);

  const invalidVersion = await requestJson(app, `/api/templates/${templateId}/versions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      version: "invalid",
      manifest: {
        image: "registry.cloudflare.com/test/python-dev:invalid",
        features: ["invalid-feature"]
      }
    })
  });
  assert.equal(invalidVersion.response.status, 400);

  const bundleBody = "print('hello from bundle')";
  const bundleGrant = await requestJson(app, `/api/templates/${templateId}/versions/${version.data.templateVersion.id}/bundle/upload`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      contentType: "text/x-python",
      bytes: bundleBody.length
    })
  });
  assert.equal(bundleGrant.response.status, 200);
  const bundleUpload = await requestJson(app, bundleGrant.data.uploadGrant.url, {
    method: "PUT",
    headers: {
      "content-type": "text/x-python"
    },
    body: bundleBody
  });
  assert.equal(bundleUpload.response.status, 200);
  assert.equal(bundleUpload.data.bundle.contentType, "text/x-python");

  const oversizedBundle = await requestJson(
    app,
    `/api/templates/${templateId}/versions/${version.data.templateVersion.id}/bundle`,
    {
      method: "PUT",
      headers: {
        ...ownerHeaders,
        "content-type": "application/octet-stream"
      },
      body: "x".repeat(300_000)
    }
  );
  assert.equal(oversizedBundle.response.status, 413);

  const downloadedBundle = await app.fetch(
    new Request(`http://example.test/api/templates/${templateId}/versions/${version.data.templateVersion.id}/bundle`, {
      headers: ownerHeaders
    })
  );
  assert.equal(downloadedBundle.status, 200);
  assert.equal(await downloadedBundle.text(), bundleBody);

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

  const buildLog = await app.fetch(
    new Request(`http://example.test/api/template-builds/${version.data.build.id}/log`, {
      headers: ownerHeaders
    })
  );
  assert.equal(buildLog.status, 200);
  assert.match(await buildLog.text(), /bundle_uploaded=true/);

  const failingVersion = await requestJson(app, `/api/templates/${templateId}/versions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      version: "2.1.0",
      manifest: {
        image: "registry.cloudflare.com/test/python-dev:2.1.0",
        simulateFailure: true
      }
    })
  });
  assert.equal(failingVersion.response.status, 200);

  const failedProcess = await requestJson(app, "/api/template-builds/process", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(failedProcess.response.status, 200);
  assert.equal(failedProcess.data.processed, 1);

  const failedBuildLog = await app.fetch(
    new Request(`http://example.test/api/template-builds/${failingVersion.data.build.id}/log`, {
      headers: ownerHeaders
    })
  );
  assert.equal(failedBuildLog.status, 200);
  assert.match(await failedBuildLog.text(), /build_status=failed/);

  const retryOne = await requestJson(app, `/api/template-builds/${failingVersion.data.build.id}/retry`, {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(retryOne.response.status, 200);

  const failedProcessTwo = await requestJson(app, "/api/template-builds/process", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(failedProcessTwo.response.status, 200);

  const retryTwo = await requestJson(app, `/api/template-builds/${failingVersion.data.build.id}/retry`, {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(retryTwo.response.status, 200);

  const deadLetterProcess = await requestJson(app, "/api/template-builds/process", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(deadLetterProcess.response.status, 200);

  const allBuilds = await requestJson(app, "/api/template-builds", {
    headers: ownerHeaders
  });
  const deadLetterBuild = allBuilds.data.builds.find((entry) => entry.id === failingVersion.data.build.id);
  assert.equal(deadLetterBuild.status, "dead_lettered");
  assert.equal(deadLetterBuild.attempts, 3);

  const bulkRetried = await requestJson(app, "/api/admin/builds/retry-dead-lettered", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(bulkRetried.response.status, 200);
  assert.equal(bulkRetried.data.recovered, 1);
  assert.deepEqual(bulkRetried.data.buildIds, [failingVersion.data.build.id]);

  const promoted = await requestJson(app, `/api/templates/${templateId}/promote`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ versionId: version.data.templateVersion.id })
  });
  assert.equal(promoted.response.status, 200);

  const archived = await requestJson(app, `/api/templates/${templateId}/archive`, {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(archived.response.status, 200);

  const session = await requestJson(app, "/api/sessions", {
    method: "POST",
    headers: switchedHeaders,
    body: JSON.stringify({ name: "feature-x", templateId })
  });
  assert.equal(session.response.status, 409);

  const restoredTemplate = await requestJson(app, `/api/templates/${templateId}/restore`, {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(restoredTemplate.response.status, 200);

  const disposableTemplate = await requestJson(app, "/api/templates", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ name: "trash-dev", description: "Disposable template" })
  });
  assert.equal(disposableTemplate.response.status, 200);
  const disposableTemplateId = disposableTemplate.data.template.id;

  const disposableVersion = await requestJson(app, `/api/templates/${disposableTemplateId}/versions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      version: "0.1.0",
      manifest: { image: "registry.cloudflare.com/test/trash-dev:0.1.0" }
    })
  });
  assert.equal(disposableVersion.response.status, 200);

  const deletedTemplate = await requestJson(app, `/api/templates/${disposableTemplateId}`, {
    method: "DELETE",
    headers: ownerHeaders
  });
  assert.equal(deletedTemplate.response.status, 200);
  assert.equal(deletedTemplate.data.deletedVersions, 1);

  const templateList = await requestJson(app, "/api/templates", {
    headers: ownerHeaders
  });
  assert.equal(
    templateList.data.templates.some((entry) => entry.id === disposableTemplateId),
    false
  );

  const restoredSession = await requestJson(app, "/api/sessions", {
    method: "POST",
    headers: switchedHeaders,
    body: JSON.stringify({ name: "feature-x", templateId })
  });
  assert.equal(restoredSession.response.status, 200);
  const sessionId = restoredSession.data.session.id;

  const deleteBlocked = await requestJson(app, `/api/templates/${templateId}`, {
    method: "DELETE",
    headers: ownerHeaders
  });
  assert.equal(deleteBlocked.response.status, 409);

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

  const staleSession = await requestJson(app, "/api/sessions", {
    method: "POST",
    headers: switchedHeaders,
    body: JSON.stringify({ name: "feature-y", templateId })
  });
  assert.equal(staleSession.response.status, 200);
  const staleSessionId = staleSession.data.session.id;

  const staleStarted = await requestJson(app, `/api/sessions/${staleSessionId}/start`, {
    method: "POST",
    headers: switchedHeaders
  });
  assert.equal(staleStarted.response.status, 200);

  const staleStopped = await requestJson(app, `/api/sessions/${staleSessionId}/stop`, {
    method: "POST",
    headers: switchedHeaders
  });
  assert.equal(staleStopped.response.status, 200);

  const events = await requestJson(app, `/api/sessions/${sessionId}/events`, {
    headers: switchedHeaders
  });
  assert.ok(events.data.events.length >= 5);

  const snapshot = await requestJson(app, `/api/sessions/${sessionId}/snapshots`, {
    method: "POST",
    headers: switchedHeaders,
    body: JSON.stringify({ label: "autosave" })
  });
  assert.equal(snapshot.response.status, 200);

  const snapshotPayload = "snapshot payload";
  const snapshotGrant = await requestJson(
    app,
    `/api/sessions/${sessionId}/snapshots/${snapshot.data.snapshot.id}/content/upload`,
    {
      method: "POST",
      headers: switchedHeaders,
      body: JSON.stringify({
        contentType: "text/plain",
        bytes: snapshotPayload.length
      })
    }
  );
  assert.equal(snapshotGrant.response.status, 200);

  const snapshotUpload = await requestJson(app, snapshotGrant.data.uploadGrant.url, {
    method: "PUT",
    headers: {
      "content-type": "text/plain"
    },
    body: snapshotPayload
  });
  assert.equal(snapshotUpload.response.status, 200);

  const snapshotDownload = await app.fetch(
    new Request(`http://example.test/api/sessions/${sessionId}/snapshots/${snapshot.data.snapshot.id}/content`, {
      headers: switchedHeaders
    })
  );
  assert.equal(snapshotDownload.status, 200);
  assert.equal(await snapshotDownload.text(), "snapshot payload");

  const snapshotRestore = await requestJson(app, `/api/sessions/${sessionId}/snapshots/${snapshot.data.snapshot.id}/restore`, {
    method: "POST",
    headers: switchedHeaders
  });
  assert.equal(snapshotRestore.response.status, 200);
  assert.equal(snapshotRestore.data.session.lastRestoredSnapshotId, snapshot.data.snapshot.id);

  const snapshotDelete = await requestJson(app, `/api/sessions/${sessionId}/snapshots/${snapshot.data.snapshot.id}`, {
    method: "DELETE",
    headers: switchedHeaders
  });
  assert.equal(snapshotDelete.response.status, 200);

  const snapshotMissing = await app.fetch(
    new Request(`http://example.test/api/sessions/${sessionId}/snapshots/${snapshot.data.snapshot.id}/content`, {
      headers: switchedHeaders
    })
  );
  assert.equal(snapshotMissing.status, 404);

  const ssh = await requestJson(app, `/api/sessions/${sessionId}/ssh-token`, {
    method: "POST",
    headers: switchedHeaders
  });
  assert.match(ssh.data.sshCommand, /wscat --connect/);

  const runtimeInvalid = await app.fetch(
    new Request(`http://example.test/runtime/sessions/${sessionId}/ssh?token=${switchedToken}`)
  );
  assert.equal(runtimeInvalid.status, 401);

  const runtimeValid = await app.fetch(
    new Request(`http://example.test/runtime/sessions/${sessionId}/ssh?token=${ssh.data.token}`)
  );
  assert.equal(runtimeValid.status, 426);
  assert.match(await runtimeValid.text(), /WebSocket upgrade required/);

  const rateHeaders = { "x-forwarded-for": "10.0.0.8" };
  const deviceStart = await requestJson(app, "/api/cli/device/start", {
    method: "POST",
    headers: rateHeaders,
    body: JSON.stringify({ email: "ops@example.com" })
  });
  const deviceStartTwo = await requestJson(app, "/api/cli/device/start", {
    method: "POST",
    headers: rateHeaders,
    body: JSON.stringify({ email: "ops@example.com" })
  });
  const deviceStartThree = await requestJson(app, "/api/cli/device/start", {
    method: "POST",
    headers: rateHeaders,
    body: JSON.stringify({ email: "ops@example.com" })
  });
  const deviceStartFour = await requestJson(app, "/api/cli/device/start", {
    method: "POST",
    headers: rateHeaders,
    body: JSON.stringify({ email: "ops@example.com" })
  });
  assert.equal(deviceStartTwo.response.status, 200);
  assert.equal(deviceStartThree.response.status, 200);
  assert.equal(deviceStartFour.response.status, 200);
  const deviceStartBlocked = await requestJson(app, "/api/cli/device/start", {
    method: "POST",
    headers: rateHeaders,
    body: JSON.stringify({ email: "ops@example.com" })
  });
  assert.equal(deviceStartBlocked.response.status, 429);
  assert.equal(deviceStartBlocked.response.headers.get("x-burstflare-rate-limit-limit"), "4");
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
  assert.equal(report.data.report.buildsQueued, 1);
  assert.equal(report.data.report.buildsBuilding, 0);
  assert.equal(report.data.report.buildsStuck, 0);
  assert.equal(report.data.report.buildsDeadLettered, 0);
  assert.equal(report.data.report.sessionsSleeping, 1);
  assert.equal(report.data.report.activeUploadGrants, 0);

  const exported = await requestJson(app, "/api/admin/export", {
    headers: ownerHeaders
  });
  assert.equal(exported.response.status, 200);
  assert.equal(exported.data.export.workspace.id, owner.data.workspace.id);
  assert.equal(exported.data.export.members.length, 2);

  const enqueued = await requestJson(app, "/api/admin/reconcile/enqueue", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(enqueued.response.status, 200);
  assert.deepEqual(queuedReconcile, [{ type: "reconcile" }]);

  const refreshed = await requestJson(app, "/api/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: ownerRefreshToken })
  });
  assert.equal(refreshed.response.status, 200);
  assert.ok(refreshed.data.refreshToken);

  const loggedOut = await requestJson(app, "/api/auth/logout", {
    method: "POST",
    headers: { authorization: `Bearer ${refreshed.data.token}` },
    body: JSON.stringify({ refreshToken: refreshed.data.refreshToken })
  });
  assert.equal(loggedOut.response.status, 200);

  const revoked = await requestJson(app, "/api/auth/me", {
    headers: { authorization: `Bearer ${refreshed.data.token}` }
  });
  assert.equal(revoked.response.status, 401);

  const cleanupSnapshot = await requestJson(app, `/api/sessions/${sessionId}/snapshots`, {
    method: "POST",
    headers: switchedHeaders,
    body: JSON.stringify({ label: "cleanup" })
  });
  assert.equal(cleanupSnapshot.response.status, 200);
  const cleanupUpload = await requestJson(
    app,
    `/api/sessions/${sessionId}/snapshots/${cleanupSnapshot.data.snapshot.id}/content`,
    {
      method: "PUT",
      headers: {
        ...switchedHeaders,
        "content-type": "text/plain"
      },
      body: "cleanup payload"
    }
  );
  assert.equal(cleanupUpload.response.status, 200);
  const deletedSession = await requestJson(app, `/api/sessions/${sessionId}`, {
    method: "DELETE",
    headers: switchedHeaders
  });
  assert.equal(deletedSession.response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const cleanupRun = await requestJson(app, "/api/admin/reconcile", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(cleanupRun.response.status, 200);
  assert.equal(cleanupRun.data.recoveredStuckBuilds, 0);
  assert.equal(cleanupRun.data.purgedDeletedSessions, 1);
  assert.equal(cleanupRun.data.purgedStaleSleepingSessions, 1);
  const removedSession = await requestJson(app, `/api/sessions/${sessionId}`, {
    headers: switchedHeaders
  });
  assert.equal(removedSession.response.status, 404);
  const removedStaleSession = await requestJson(app, `/api/sessions/${staleSessionId}`, {
    headers: switchedHeaders
  });
  assert.equal(removedStaleSession.response.status, 404);

  const logoutAll = await requestJson(app, "/api/auth/logout-all", {
    method: "POST",
    headers: switchedHeaders
  });
  assert.equal(logoutAll.response.status, 200);
  assert.ok(logoutAll.data.revokedTokens >= 2);
  const revokedSwitched = await requestJson(app, "/api/auth/me", {
    headers: switchedHeaders
  });
  assert.equal(revokedSwitched.response.status, 401);
  const revokedTeammate = await requestJson(app, "/api/auth/me", {
    headers: teammateHeaders
  });
  assert.equal(revokedTeammate.response.status, 401);

  const ownerSecondLogin = await requestJson(app, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "ops@example.com", kind: "browser" })
  });
  assert.equal(ownerSecondLogin.response.status, 200);
  const ownerSecondHeaders = { authorization: `Bearer ${ownerSecondLogin.data.token}` };

  const ownerSessions = await requestJson(app, "/api/auth/sessions", {
    headers: ownerSecondHeaders
  });
  assert.equal(ownerSessions.response.status, 200);
  assert.ok(ownerSessions.data.sessions.some((entry) => entry.id === owner.data.authSessionId));
  assert.ok(ownerSessions.data.sessions.some((entry) => entry.current));

  const ownerSessionRevoked = await requestJson(app, `/api/auth/sessions/${owner.data.authSessionId}`, {
    method: "DELETE",
    headers: ownerSecondHeaders
  });
  assert.equal(ownerSessionRevoked.response.status, 200);
  assert.ok(ownerSessionRevoked.data.revokedTokens >= 1);

  const revokedOwner = await requestJson(app, "/api/auth/me", {
    headers: ownerHeaders
  });
  assert.equal(revokedOwner.response.status, 401);

  const activeOwner = await requestJson(app, "/api/auth/me", {
    headers: ownerSecondHeaders
  });
  assert.equal(activeOwner.response.status, 200);
});

test("worker scheduled handler enqueues reconcile jobs", async () => {
  const messages = [];
  await handleScheduled(
    { cron: "*/15 * * * *" },
    {
      RECONCILE_QUEUE: {
        async send(body) {
          messages.push(body);
        }
      }
    }
  );
  assert.deepEqual(messages, [
    {
      type: "reconcile",
      source: "scheduled",
      cron: "*/15 * * * *"
    }
  ]);
});

test("worker proxies runtime SSH websocket upgrades into the session container", async () => {
  const forwarded = {
    started: 0,
    sessionId: null,
    path: null,
    requestSessionId: null,
    upgrade: null
  };
  const service = createWorkerService();
  const app = createApp({
    service,
    containersEnabled: true,
    getSessionContainer(sessionId) {
      forwarded.sessionId = sessionId;
      return {
        async startAndWaitForPorts() {
          forwarded.started += 1;
        },
        async fetch(request) {
          const url = new URL(request.url);
          forwarded.path = url.pathname;
          forwarded.requestSessionId = url.searchParams.get("sessionId");
          forwarded.upgrade = request.headers.get("upgrade");
          return new Response("proxied ssh", {
            headers: {
              "content-type": "text/plain; charset=utf-8"
            }
          });
        }
      };
    }
  });

  const owner = await service.registerUser({
    email: "ssh-proxy@example.com",
    name: "SSH Proxy"
  });
  const template = await service.createTemplate(owner.token, {
    name: "ssh-proxy",
    description: "Template for container proxy"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/test/ssh-proxy:1.0.0"
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);

  const session = await service.createSession(owner.token, {
    name: "container-shell",
    templateId: template.template.id
  });
  await service.startSession(owner.token, session.session.id);
  const runtime = await service.issueRuntimeToken(owner.token, session.session.id);

  const response = await app.fetch(
    new Request(`http://example.test/runtime/sessions/${session.session.id}/ssh?token=${runtime.token}`, {
      headers: {
        upgrade: "websocket"
      }
    })
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "proxied ssh");
  assert.equal(forwarded.started, 1);
  assert.equal(forwarded.sessionId, session.session.id);
  assert.equal(forwarded.path, "/ssh");
  assert.equal(forwarded.requestSessionId, session.session.id);
  assert.equal(forwarded.upgrade, "websocket");
});

test("worker coordinates session lifecycle through the session container durable object", async () => {
  const calls = [];
  let runtime = {
    desiredState: "stopped",
    status: "idle",
    runtimeState: "stopped",
    bootCount: 0
  };

  const service = createWorkerService();
  const app = createApp({
    service,
    containersEnabled: true,
    getSessionContainer() {
      return {
        async startRuntime({ sessionId }) {
          runtime = {
            ...runtime,
            sessionId,
            desiredState: "running",
            status: "running",
            runtimeState: "healthy",
            bootCount: runtime.bootCount + 1,
            lastCommand: "start"
          };
          calls.push(`start:${sessionId}`);
          return runtime;
        },
        async stopRuntime(reason) {
          runtime = {
            ...runtime,
            desiredState: "sleeping",
            status: "sleeping",
            runtimeState: "stopped",
            lastCommand: "stop",
            lastStopReason: reason
          };
          calls.push(`stop:${reason}`);
          return runtime;
        },
        async restartRuntime({ sessionId }) {
          runtime = {
            ...runtime,
            sessionId,
            desiredState: "running",
            status: "running",
            runtimeState: "healthy",
            bootCount: runtime.bootCount + 1,
            lastCommand: "restart",
            lastStopReason: "restart"
          };
          calls.push(`restart:${sessionId}`);
          return runtime;
        },
        async deleteRuntime() {
          runtime = {
            ...runtime,
            desiredState: "deleted",
            status: "deleted",
            runtimeState: "stopped",
            lastCommand: "delete"
          };
          calls.push("delete");
          return runtime;
        },
        async getRuntimeState() {
          return runtime;
        }
      };
    }
  });

  const owner = await service.registerUser({
    email: "runtime-do@example.com",
    name: "Runtime DO"
  });
  const template = await service.createTemplate(owner.token, {
    name: "runtime-do",
    description: "Runtime coordination template"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/test/runtime-do:1.0.0"
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);
  const createdSession = await service.createSession(owner.token, {
    name: "runtime-coordination",
    templateId: template.template.id
  });
  const sessionId = createdSession.session.id;
  const authHeaders = {
    authorization: `Bearer ${owner.token}`
  };

  const started = await requestJson(app, `/api/sessions/${sessionId}/start`, {
    method: "POST",
    headers: authHeaders
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.data.session.state, "running");
  assert.equal(started.data.session.runtimeStatus, "running");
  assert.equal(started.data.session.runtimeState, "healthy");
  assert.equal(started.data.runtime.status, "running");
  assert.equal(started.data.runtime.bootCount, 1);

  const detail = await requestJson(app, `/api/sessions/${sessionId}`, {
    headers: authHeaders
  });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.session.runtimeStatus, "running");
  assert.equal(detail.data.session.runtime.status, "running");
  assert.equal(detail.data.session.runtime.runtimeState, "healthy");

  const listed = await requestJson(app, "/api/sessions", {
    headers: authHeaders
  });
  assert.equal(listed.response.status, 200);
  const listedSession = listed.data.sessions.find((entry) => entry.id === sessionId);
  assert.equal(listedSession.runtime.status, "running");

  const stopped = await requestJson(app, `/api/sessions/${sessionId}/stop`, {
    method: "POST",
    headers: authHeaders
  });
  assert.equal(stopped.response.status, 200);
  assert.equal(stopped.data.session.state, "sleeping");
  assert.equal(stopped.data.session.runtimeStatus, "sleeping");
  assert.equal(stopped.data.runtime.status, "sleeping");
  assert.equal(stopped.data.runtime.lastStopReason, "session_stop");

  const restarted = await requestJson(app, `/api/sessions/${sessionId}/restart`, {
    method: "POST",
    headers: authHeaders
  });
  assert.equal(restarted.response.status, 200);
  assert.equal(restarted.data.session.state, "running");
  assert.equal(restarted.data.session.runtimeStatus, "running");
  assert.equal(restarted.data.runtime.status, "running");
  assert.equal(restarted.data.runtime.bootCount, 2);

  const deleted = await requestJson(app, `/api/sessions/${sessionId}`, {
    method: "DELETE",
    headers: authHeaders
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.data.session.state, "deleted");
  assert.equal(deleted.data.session.runtimeStatus, "deleted");
  assert.equal(deleted.data.runtime.status, "deleted");

  assert.deepEqual(calls, [
    `start:${sessionId}`,
    "stop:session_stop",
    `restart:${sessionId}`,
    "delete"
  ]);
});

test("worker exposes workflow-backed build dispatch", async () => {
  const healthApp = createApp({
    BUILD_WORKFLOW_NAME: "burstflare-builds",
    BUILD_WORKFLOW: {
      async create() {
        return null;
      }
    }
  });
  const health = await requestJson(healthApp, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.data.runtime.workflowEnabled, true);
  assert.equal(health.data.runtime.buildDispatchMode, "workflow");

  const workflowRuns = [];
  const service = createWorkerService({
    BUILD_WORKFLOW_NAME: "burstflare-builds",
    BUILD_WORKFLOW: {
      async create(payload) {
        workflowRuns.push(payload);
        return {
          id: payload.id
        };
      }
    }
  });

  const owner = await service.registerUser({
    email: "workflow-worker@example.com",
    name: "Workflow Worker"
  });
  const template = await service.createTemplate(owner.token, {
    name: "workflow-worker",
    description: "Workflow worker template"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/workflow-worker:1.0.0"
    }
  });

  assert.equal(version.build.dispatchMode, "workflow");
  assert.equal(version.build.workflowStatus, "queued");
  assert.equal(workflowRuns.length, 1);
  assert.equal(workflowRuns[0].params.buildId, version.build.id);
  assert.equal(workflowRuns[0].params.workflowName, "burstflare-builds");

  await service.markTemplateBuildWorkflow(version.build.id, {
    status: "running",
    instanceId: version.build.workflowInstanceId,
    name: "burstflare-builds"
  });
  const processed = await service.processTemplateBuildById(version.build.id, {
    source: "workflow"
  });
  assert.equal(processed.build.status, "succeeded");
  assert.equal(processed.build.workflowStatus, "succeeded");
});
