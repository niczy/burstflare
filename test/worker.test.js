import test from "node:test";
import assert from "node:assert/strict";
import { createApp, createWorkerService, handleQueueBatch, handleScheduled, runReconcile } from "../apps/edge/src/app.js";

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

function createFrontendHandler(bodyByPath = {}) {
  return {
    async fetch(request) {
      const requestUrl = new URL(request.url);
      const body = bodyByPath[requestUrl.pathname] || bodyByPath.default;
      if (body === undefined) {
        return new Response("frontend missing", {
          status: 404,
          headers: {
            "content-type": "text/plain; charset=utf-8"
          }
        });
      }
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8"
        }
      });
    }
  };
}

const TEST_SSH_PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGJ1cnN0ZmxhcmV0ZXN0a2V5bWF0ZXJpYWw= flare@test";

test("worker serves invite flow, bundle upload, build logs, session events, and runtime validation", async () => {
  const queuedBuilds = [];
  const queuedReconcile = [];
  const app = createApp({
    frontendHandler: createFrontendHandler({
      "/":
        "<!doctype html><title>BurstFlare</title><main>Quick Terminal Approve Device Code Recovery Code New Recovery Codes Sign In With Passkey Register Passkey id=\"passkeys\" The verification challenge loads automatically in the hosted app deviceStatus pendingDevices lastRefresh terminalOutput persistedPaths snapshotList snapshotContentPreview</main>"
    }),
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
  assert.match(rootHtml, /Quick Terminal/);
  assert.match(rootHtml, /Approve Device Code/);
  assert.match(rootHtml, /Recovery Code/);
  assert.match(rootHtml, /New Recovery Codes/);
  assert.match(rootHtml, /Sign In With Passkey/);
  assert.match(rootHtml, /Register Passkey/);
  assert.match(rootHtml, /id="passkeys"/);
  assert.match(rootHtml, /The verification challenge loads automatically in the hosted app/);
  assert.match(rootHtml, /deviceStatus/);
  assert.match(rootHtml, /pendingDevices/);
  assert.match(rootHtml, /lastRefresh/);
  assert.match(rootHtml, /terminalOutput/);
  assert.match(rootHtml, /persistedPaths/);
  assert.match(rootHtml, /snapshotList/);
  assert.match(rootHtml, /snapshotContentPreview/);

  const turnstileApp = createApp({
    frontendHandler: createFrontendHandler({
      "/": "<!doctype html><title>BurstFlare</title><main>strict frontend shell</main>"
    }),
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
  assert.match(strictRootHtml, /strict frontend shell/);

  const strictMissing = await requestJson(turnstileApp, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "strict-missing@example.com", name: "Strict Missing" })
  });
  assert.equal(strictMissing.response.status, 400);
  assert.equal(strictMissing.data.code, "BAD_REQUEST");
  assert.equal(strictMissing.data.status, 400);
  assert.equal(strictMissing.data.method, "POST");
  assert.equal(strictMissing.data.path, "/api/auth/register");
  assert.match(strictMissing.data.requestId, /^[0-9a-f-]+$/);
  assert.equal(
    strictMissing.response.headers.get("x-burstflare-request-id"),
    strictMissing.data.requestId
  );

  const strictAllowed = await requestJson(turnstileApp, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: "strict-ok@example.com",
      name: "Strict Ok",
      turnstileToken: "valid-turnstile"
    })
  });
  assert.equal(strictAllowed.response.status, 200);

  const invalidJson = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: "{"
  });
  assert.equal(invalidJson.response.status, 400);
  assert.equal(invalidJson.data.error, "Invalid JSON request body");
  assert.equal(invalidJson.data.code, "INVALID_JSON");
  assert.equal(invalidJson.data.status, 400);
  assert.equal(invalidJson.data.method, "POST");
  assert.equal(invalidJson.data.path, "/api/auth/register");
  assert.match(invalidJson.data.requestId, /^[0-9a-f-]+$/);
  assert.equal(
    invalidJson.response.headers.get("x-burstflare-request-id"),
    invalidJson.data.requestId
  );

  const unauthenticatedSessions = await requestJson(app, "/api/sessions");
  assert.equal(unauthenticatedSessions.response.status, 401);
  assert.equal(unauthenticatedSessions.data.error, "Unauthorized");
  assert.equal(unauthenticatedSessions.data.code, "UNAUTHORIZED");
  assert.equal(unauthenticatedSessions.data.status, 401);
  assert.equal(unauthenticatedSessions.data.method, "GET");
  assert.equal(unauthenticatedSessions.data.path, "/api/sessions");
  assert.match(unauthenticatedSessions.data.requestId, /^[0-9a-f-]+$/);
  assert.equal(
    unauthenticatedSessions.response.headers.get("x-burstflare-request-id"),
    unauthenticatedSessions.data.requestId
  );

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
  assert.equal(bundleGrant.data.uploadGrant.transport, "worker_upload_grant");
  assert.equal(bundleGrant.data.uploadGrant.storage, "r2");
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
  const buildArtifact = await app.fetch(
    new Request(`http://example.test/api/template-builds/${version.data.build.id}/artifact`, {
      headers: ownerHeaders
    })
  );
  assert.equal(buildArtifact.status, 200);
  const parsedBuildArtifact = JSON.parse(await buildArtifact.text());
  assert.equal(parsedBuildArtifact.source, "bundle");
  assert.equal(parsedBuildArtifact.templateVersionId, version.data.templateVersion.id);
  assert.match(parsedBuildArtifact.imageReference, /^registry\.cloudflare\.com\/test\/python-dev@sha256:/);
  assert.match(parsedBuildArtifact.imageDigest, /^sha256:/);
  assert.equal(parsedBuildArtifact.layerCount, 2);

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
  assert.equal(promoted.data.release.binding.artifactSource, "bundle");
  assert.equal(promoted.data.release.binding.templateName, "python-dev");
  assert.equal(promoted.data.release.binding.imageReference, parsedBuildArtifact.imageReference);
  assert.equal(promoted.data.release.binding.imageDigest, parsedBuildArtifact.imageDigest);
  assert.equal(promoted.data.release.binding.layerCount, 2);

  const templateDetail = await requestJson(app, `/api/templates/${templateId}`, {
    headers: ownerHeaders
  });
  assert.equal(templateDetail.response.status, 200);
  assert.equal(templateDetail.data.template.releaseCount, 1);
  assert.equal(templateDetail.data.template.releases.length, 1);
  assert.equal(templateDetail.data.template.latestRelease.id, promoted.data.release.id);
  assert.equal(templateDetail.data.template.storageSummary.bundleBytes >= bundleBody.length, true);

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

  const syncedSshKey = await requestJson(app, `/api/sessions/${sessionId}/ssh-key`, {
    method: "PUT",
    headers: switchedHeaders,
    body: JSON.stringify({
      keyId: "cli:test",
      label: "CLI Test",
      publicKey: TEST_SSH_PUBLIC_KEY
    })
  });
  assert.equal(syncedSshKey.response.status, 200);
  assert.equal(syncedSshKey.data.sshKeyCount, 1);

  const ssh = await requestJson(app, `/api/sessions/${sessionId}/ssh-token`, {
    method: "POST",
    headers: switchedHeaders
  });
  assert.match(ssh.data.sshCommand, /ssh -i <local-key-path>/);
  assert.equal(ssh.data.sshKeyCount, 1);

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

test("worker records workspace membership edge cases in the audit log", async () => {
  const app = createApp();

  const owner = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "audit-owner@example.com", name: "Audit Owner" })
  });
  const teammate = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "audit-teammate@example.com", name: "Audit Teammate" })
  });
  const ownerHeaders = {
    authorization: `Bearer ${owner.data.token}`
  };
  const teammateHeaders = {
    authorization: `Bearer ${teammate.data.token}`
  };

  const invite = await requestJson(app, "/api/workspaces/current/invites", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      email: "audit-teammate@example.com",
      role: "member"
    })
  });
  assert.equal(invite.response.status, 200);

  const accepted = await requestJson(app, "/api/workspaces/current/invites/accept", {
    method: "POST",
    headers: teammateHeaders,
    body: JSON.stringify({ inviteCode: invite.data.invite.code })
  });
  assert.equal(accepted.response.status, 200);

  const existingMemberInvite = await requestJson(app, "/api/workspaces/current/invites", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      email: "audit-teammate@example.com",
      role: "member"
    })
  });
  assert.equal(existingMemberInvite.response.status, 409);

  const prospectInvite = await requestJson(app, "/api/workspaces/current/invites", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      email: "audit-prospect@example.com",
      role: "viewer"
    })
  });
  assert.equal(prospectInvite.response.status, 200);

  const duplicateInvite = await requestJson(app, "/api/workspaces/current/invites", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      email: "audit-prospect@example.com",
      role: "viewer"
    })
  });
  assert.equal(duplicateInvite.response.status, 409);

  const mismatchedAccept = await requestJson(app, "/api/workspaces/current/invites/accept", {
    method: "POST",
    headers: teammateHeaders,
    body: JSON.stringify({ inviteCode: prospectInvite.data.invite.code })
  });
  assert.equal(mismatchedAccept.response.status, 403);

  const reusedAccept = await requestJson(app, "/api/workspaces/current/invites/accept", {
    method: "POST",
    headers: teammateHeaders,
    body: JSON.stringify({ inviteCode: invite.data.invite.code })
  });
  assert.equal(reusedAccept.response.status, 409);

  const members = await requestJson(app, "/api/workspaces/current/members", {
    headers: ownerHeaders
  });
  assert.equal(members.response.status, 200);
  const teammateMembership = members.data.members.find((entry) => entry.userId === teammate.data.user.id);
  assert.ok(teammateMembership);

  const reaffirmedRole = await requestJson(app, `/api/workspaces/current/members/${teammate.data.user.id}/role`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ role: teammateMembership.role })
  });
  assert.equal(reaffirmedRole.response.status, 200);

  const elevatedRole = await requestJson(app, `/api/workspaces/current/members/${teammate.data.user.id}/role`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ role: "admin" })
  });
  assert.equal(elevatedRole.response.status, 200);

  const audit = await requestJson(app, "/api/audit", {
    headers: ownerHeaders
  });
  assert.equal(audit.response.status, 200);
  assert.ok(audit.data.audit.some((entry) => entry.action === "workspace.invite_rejected_existing_member"));
  assert.ok(audit.data.audit.some((entry) => entry.action === "workspace.invite_rejected_duplicate"));
  assert.ok(
    audit.data.audit.some(
      (entry) => entry.action === "workspace.invite_accept_failed" && entry.details.reason === "email_mismatch"
    )
  );
  assert.ok(
    audit.data.audit.some(
      (entry) => entry.action === "workspace.invite_accept_failed" && entry.details.reason === "already_used"
    )
  );
  assert.ok(audit.data.audit.some((entry) => entry.action === "workspace.member_role_reaffirmed"));
  const roleAudit = audit.data.audit.find((entry) => entry.action === "workspace.member_role_updated");
  assert.equal(roleAudit.details.previousRole, "member");
  assert.equal(roleAudit.details.role, "admin");
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

test("worker queue consumer processes queued builds with the shared service state", async () => {
  const service = createWorkerService({
    BUILD_QUEUE: {
      async send() {}
    },
    TEMPLATE_BUCKET: createBucket(),
    BUILD_BUCKET: createBucket()
  });

  const owner = await service.registerUser({
    email: "queue-consumer@example.com",
    name: "Queue Consumer"
  });
  const template = await service.createTemplate(owner.token, {
    name: "queue-template",
    description: "queue test"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/test/queue-template:1.0.0"
    }
  });
  assert.equal(version.build.status, "queued");

  await handleQueueBatch(
    {
      messages: [
        {
          body: {
            type: "build",
            buildId: version.build.id
          }
        }
      ]
    },
    { service }
  );

  const builds = await service.listTemplateBuilds(owner.token);
  const processedBuild = builds.builds.find((entry) => entry.id === version.build.id);
  assert.ok(processedBuild);
  assert.equal(processedBuild.status, "succeeded");
  assert.equal(processedBuild.executionSource, "queue");
});

test("worker exposes targeted operator reconcile endpoints", async () => {
  const app = createApp({
    TEMPLATE_BUCKET: createBucket(),
    BUILD_BUCKET: createBucket(),
    SNAPSHOT_BUCKET: createBucket()
  });

  const owner = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "operator-routes@example.com", name: "Operator Routes" })
  });
  const ownerHeaders = {
    authorization: `Bearer ${owner.data.token}`
  };

  const template = await requestJson(app, "/api/templates", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      name: "operator-routes-template",
      description: "Operator routes template"
    })
  });
  assert.equal(template.response.status, 200);

  const version = await requestJson(app, `/api/templates/${template.data.template.id}/versions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      version: "1.0.0",
      manifest: {
        image: "registry.cloudflare.com/example/operator-routes:1.0.0",
        sleepTtlSeconds: 1
      }
    })
  });
  assert.equal(version.response.status, 200);

  const processed = await requestJson(app, "/api/template-builds/process", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(processed.response.status, 200);
  assert.equal(processed.data.processed, 1);

  const promoted = await requestJson(app, `/api/templates/${template.data.template.id}/promote`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      versionId: version.data.templateVersion.id
    })
  });
  assert.equal(promoted.response.status, 200);

  const running = await requestJson(app, "/api/sessions", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      name: "operator-running",
      templateId: template.data.template.id
    })
  });
  assert.equal(running.response.status, 200);
  await requestJson(app, `/api/sessions/${running.data.session.id}/start`, {
    method: "POST",
    headers: ownerHeaders
  });

  const stale = await requestJson(app, "/api/sessions", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      name: "operator-stale",
      templateId: template.data.template.id
    })
  });
  assert.equal(stale.response.status, 200);
  await requestJson(app, `/api/sessions/${stale.data.session.id}/start`, {
    method: "POST",
    headers: ownerHeaders
  });
  await requestJson(app, `/api/sessions/${stale.data.session.id}/stop`, {
    method: "POST",
    headers: ownerHeaders
  });
  const staleSnapshot = await requestJson(app, `/api/sessions/${stale.data.session.id}/snapshots`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ label: "stale" })
  });
  assert.equal(staleSnapshot.response.status, 200);
  await requestJson(app, `/api/sessions/${stale.data.session.id}/snapshots/${staleSnapshot.data.snapshot.id}/content`, {
    method: "PUT",
    headers: {
      ...ownerHeaders,
      "content-type": "text/plain"
    },
    body: "stale operator snapshot"
  });

  const deleted = await requestJson(app, "/api/sessions", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      name: "operator-deleted",
      templateId: template.data.template.id
    })
  });
  assert.equal(deleted.response.status, 200);
  const deletedSnapshot = await requestJson(app, `/api/sessions/${deleted.data.session.id}/snapshots`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ label: "deleted" })
  });
  assert.equal(deletedSnapshot.response.status, 200);
  await requestJson(app, `/api/sessions/${deleted.data.session.id}/snapshots/${deletedSnapshot.data.snapshot.id}/content`, {
    method: "PUT",
    headers: {
      ...ownerHeaders,
      "content-type": "text/plain"
    },
    body: "deleted operator snapshot"
  });
  await requestJson(app, `/api/sessions/${deleted.data.session.id}`, {
    method: "DELETE",
    headers: ownerHeaders
  });

  await new Promise((resolve) => setTimeout(resolve, 1100));

  const preview = await requestJson(app, "/api/admin/reconcile/preview", {
    headers: ownerHeaders
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.data.preview.sleptSessions, 1);
  assert.equal(preview.data.preview.purgedStaleSleepingSessions, 1);
  assert.equal(preview.data.preview.purgedDeletedSessions, 1);
  assert.deepEqual(preview.data.preview.sessionIds.running, [running.data.session.id]);

  const slept = await requestJson(app, "/api/admin/reconcile/sleep-running", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(slept.response.status, 200);
  assert.equal(slept.data.sleptSessions, 1);

  const sleptAgain = await requestJson(app, "/api/admin/reconcile/sleep-running", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(sleptAgain.response.status, 200);
  assert.equal(sleptAgain.data.sleptSessions, 0);

  const purgedSleeping = await requestJson(app, "/api/admin/reconcile/purge-sleeping", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(purgedSleeping.response.status, 200);
  assert.equal(purgedSleeping.data.purgedStaleSleepingSessions, 1);
  assert.equal(purgedSleeping.data.purgedSnapshots, 1);

  const purgedDeleted = await requestJson(app, "/api/admin/reconcile/purge-deleted", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(purgedDeleted.response.status, 200);
  assert.equal(purgedDeleted.data.purgedDeletedSessions, 1);
  assert.equal(purgedDeleted.data.purgedSnapshots, 1);

  const report = await requestJson(app, "/api/admin/report", {
    headers: ownerHeaders
  });
  assert.equal(report.response.status, 200);
  assert.equal(report.data.report.reconcileCandidates.runningSessions, 0);
  assert.equal(report.data.report.reconcileCandidates.staleSleepingSessions, 0);
  assert.equal(report.data.report.reconcileCandidates.deletedSessions, 0);
});

test("worker exposes quota overrides and richer usage data", async () => {
  const app = createApp({
    TEMPLATE_BUCKET: createBucket(),
    BUILD_BUCKET: createBucket(),
    SNAPSHOT_BUCKET: createBucket()
  });

  const owner = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "quota-worker@example.com", name: "Quota Worker" })
  });
  const ownerHeaders = {
    authorization: `Bearer ${owner.data.token}`
  };

  const overrides = await requestJson(app, "/api/workspaces/current/quota-overrides", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      maxTemplates: 1,
      maxStorageBytes: 8
    })
  });
  assert.equal(overrides.response.status, 200);
  assert.equal(overrides.data.limits.maxTemplates, 1);
  assert.equal(overrides.data.overrides.maxStorageBytes, 8);

  const template = await requestJson(app, "/api/templates", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      name: "quota-worker-template",
      description: "quota test"
    })
  });
  assert.equal(template.response.status, 200);

  const blockedTemplate = await requestJson(app, "/api/templates", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      name: "quota-worker-template-2",
      description: "blocked"
    })
  });
  assert.equal(blockedTemplate.response.status, 403);

  const version = await requestJson(app, `/api/templates/${template.data.template.id}/versions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      version: "1.0.0",
      manifest: {
        image: "registry.cloudflare.com/example/quota-worker:1.0.0"
      }
    })
  });
  assert.equal(version.response.status, 200);

  const blockedUpload = await requestJson(app, `/api/templates/${template.data.template.id}/versions/${version.data.templateVersion.id}/bundle`, {
    method: "PUT",
    headers: {
      ...ownerHeaders,
      "content-type": "text/plain"
    },
    body: "too-large"
  });
  assert.equal(blockedUpload.response.status, 403);

  const raised = await requestJson(app, "/api/workspaces/current/quota-overrides", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      maxTemplates: 1,
      maxStorageBytes: 1024
    })
  });
  assert.equal(raised.response.status, 200);

  const uploaded = await requestJson(app, `/api/templates/${template.data.template.id}/versions/${version.data.templateVersion.id}/bundle`, {
    method: "PUT",
    headers: {
      ...ownerHeaders,
      "content-type": "text/plain"
    },
    body: "ok"
  });
  assert.equal(uploaded.response.status, 200);

  const usage = await requestJson(app, "/api/usage", {
    headers: ownerHeaders
  });
  assert.equal(usage.response.status, 200);
  assert.equal(usage.data.limits.maxTemplates, 1);
  assert.equal(usage.data.overrides.maxStorageBytes, 1024);
  assert.equal(usage.data.usage.storage.templateBundlesBytes, 2);
});

test("worker secures runtime routes and redacts workspace secrets", async () => {
  const app = createApp({
    TEMPLATE_BUCKET: createBucket(),
    BUILD_BUCKET: createBucket(),
    SNAPSHOT_BUCKET: createBucket()
  });

  const owner = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "security-owner@example.com", name: "Security Owner" })
  });
  const attacker = await requestJson(app, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "security-attacker@example.com", name: "Security Attacker" })
  });
  const ownerHeaders = {
    authorization: `Bearer ${owner.data.token}`
  };
  const attackerHeaders = {
    authorization: `Bearer ${attacker.data.token}`
  };

  const createdSecret = await requestJson(app, "/api/workspaces/current/secrets", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      name: "api_token",
      value: "secret-value"
    })
  });
  assert.equal(createdSecret.response.status, 200);
  assert.equal(createdSecret.data.secret.name, "API_TOKEN");

  const listedSecrets = await requestJson(app, "/api/workspaces/current/secrets", {
    headers: ownerHeaders
  });
  assert.equal(listedSecrets.response.status, 200);
  assert.deepEqual(listedSecrets.data.secrets.map((entry) => entry.name), ["API_TOKEN"]);
  assert.equal("value" in listedSecrets.data.secrets[0], false);

  const template = await requestJson(app, "/api/templates", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      name: "security-template",
      description: "security test"
    })
  });
  assert.equal(template.response.status, 200);

  const version = await requestJson(app, `/api/templates/${template.data.template.id}/versions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      version: "1.0.0",
      manifest: {
        image: "registry.cloudflare.com/example/security-template:1.0.0"
      }
    })
  });
  assert.equal(version.response.status, 200);

  const processed = await requestJson(app, "/api/template-builds/process", {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(processed.response.status, 200);

  const promoted = await requestJson(app, `/api/templates/${template.data.template.id}/promote`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      versionId: version.data.templateVersion.id
    })
  });
  assert.equal(promoted.response.status, 200);

  const session = await requestJson(app, "/api/sessions", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      name: "security-session",
      templateId: template.data.template.id
    })
  });
  assert.equal(session.response.status, 200);

  const started = await requestJson(app, `/api/sessions/${session.data.session.id}/start`, {
    method: "POST",
    headers: ownerHeaders
  });
  assert.equal(started.response.status, 200);

  const syncedSshKey = await requestJson(app, `/api/sessions/${session.data.session.id}/ssh-key`, {
    method: "PUT",
    headers: ownerHeaders,
    body: JSON.stringify({
      keyId: "cli:security",
      label: "Security CLI",
      publicKey: TEST_SSH_PUBLIC_KEY
    })
  });
  assert.equal(syncedSshKey.response.status, 200);

  const attackerPreview = await requestJson(app, `/runtime/sessions/${session.data.session.id}/preview`, {
    headers: attackerHeaders
  });
  assert.equal(attackerPreview.response.status, 404);

  let rateLimited = null;
  for (let attempt = 0; attempt < 13; attempt += 1) {
    const response = await requestJson(app, `/api/sessions/${session.data.session.id}/ssh-token`, {
      method: "POST",
      headers: ownerHeaders
    });
    rateLimited = response;
  }
  assert.equal(rateLimited.response.status, 429);
  assert.equal(rateLimited.response.headers.get("x-burstflare-rate-limit-limit"), "12");

  const exported = await requestJson(app, "/api/admin/export", {
    headers: ownerHeaders
  });
  assert.equal(exported.response.status, 200);
  assert.equal(exported.data.export.security.runtimeSecrets[0].name, "API_TOKEN");
  assert.equal("value" in exported.data.export.security.runtimeSecrets[0], false);
  assert.equal(exported.data.export.artifacts.buildArtifacts.length, 1);
});

test("runtime-aware reconcile stops running sessions and persists runtime state", async () => {
  const service = createWorkerService();
  const owner = await service.registerUser({
    email: "runtime-reconcile@example.com",
    name: "Runtime Reconcile"
  });
  const template = await service.createTemplate(owner.token, {
    name: "runtime-reconcile",
    description: "Runtime reconcile template"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/runtime-reconcile:1.0.0"
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);
  const created = await service.createSession(owner.token, {
    name: "runtime-reconcile-session",
    templateId: template.template.id
  });
  await service.startSession(owner.token, created.session.id);

  const stopped = [];
  const reconciled = await runReconcile({
    service,
    containersEnabled: true,
    getSessionContainer(sessionId) {
      return {
        async stopRuntime(reason) {
          stopped.push({
            sessionId,
            reason
          });
          return {
            sessionId,
            desiredState: "sleeping",
            status: "sleeping",
            runtimeState: "stopped"
          };
        }
      };
    }
  });

  assert.equal(reconciled.runtimeSleptSessions, 1);
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].sessionId, created.session.id);
  assert.equal(stopped[0].reason, "reconcile");

  const detail = await service.getSession(owner.token, created.session.id);
  assert.equal(detail.session.state, "sleeping");
  assert.equal(detail.session.runtimeStatus, "sleeping");
  assert.equal(detail.session.runtimeState, "stopped");
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
  await service.upsertSessionSshKey(owner.token, session.session.id, {
    keyId: "cli:ssh-proxy",
    label: "SSH Proxy",
    publicKey: TEST_SSH_PUBLIC_KEY
  });
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

test("worker proxies browser terminal websocket upgrades into the session container shell route", async () => {
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
          return new Response("proxied shell", {
            headers: {
              "content-type": "text/plain; charset=utf-8"
            }
          });
        }
      };
    }
  });

  const owner = await service.registerUser({
    email: "terminal-proxy@example.com",
    name: "Terminal Proxy"
  });
  const template = await service.createTemplate(owner.token, {
    name: "terminal-proxy",
    description: "Template for terminal proxy"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/test/terminal-proxy:1.0.0"
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);

  const session = await service.createSession(owner.token, {
    name: "container-terminal",
    templateId: template.template.id
  });
  await service.startSession(owner.token, session.session.id);
  await service.upsertSessionSshKey(owner.token, session.session.id, {
    keyId: "cli:terminal-proxy",
    label: "Terminal Proxy",
    publicKey: TEST_SSH_PUBLIC_KEY
  });
  const runtime = await service.issueRuntimeToken(owner.token, session.session.id);

  const response = await app.fetch(
    new Request(`http://example.test/runtime/sessions/${session.session.id}/terminal?token=${runtime.token}`, {
      headers: {
        upgrade: "websocket"
      }
    })
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "proxied shell");
  assert.equal(forwarded.started, 1);
  assert.equal(forwarded.sessionId, session.session.id);
  assert.equal(forwarded.path, "/shell");
  assert.equal(forwarded.requestSessionId, session.session.id);
  assert.equal(forwarded.upgrade, "websocket");
});

test("worker proxies browser editor requests into the session container editor route", async () => {
  const forwarded = {
    started: 0,
    sessionId: null,
    path: null,
    requestSessionId: null,
    requestedPath: null,
    persistedPaths: [],
    method: null,
    bodyText: null
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
          forwarded.requestedPath = url.searchParams.get("path");
          forwarded.persistedPaths = url.searchParams.getAll("persistedPath");
          forwarded.method = request.method;
          forwarded.bodyText = request.method === "POST" ? await request.text() : null;
          return new Response("proxied editor", {
            headers: {
              "content-type": "text/html; charset=utf-8"
            }
          });
        }
      };
    }
  });

  const owner = await service.registerUser({
    email: "editor-proxy@example.com",
    name: "Editor Proxy"
  });
  const template = await service.createTemplate(owner.token, {
    name: "editor-proxy",
    description: "Template for editor proxy"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/test/editor-proxy:1.0.0",
      persistedPaths: ["/workspace/project"]
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);

  const session = await service.createSession(owner.token, {
    name: "container-editor",
    templateId: template.template.id
  });

  const response = await app.fetch(
    new Request(
      `http://example.test/runtime/sessions/${session.session.id}/editor?path=${encodeURIComponent("/workspace/project/notes.txt")}`,
      {
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "proxied editor");
  assert.equal(forwarded.started, 1);
  assert.equal(forwarded.sessionId, session.session.id);
  assert.equal(forwarded.path, "/editor");
  assert.equal(forwarded.requestSessionId, session.session.id);
  assert.equal(forwarded.requestedPath, "/workspace/project/notes.txt");
  assert.deepEqual(forwarded.persistedPaths, ["/workspace/project"]);
  assert.equal(forwarded.method, "GET");

  const saved = await app.fetch(
    new Request(`http://example.test/runtime/sessions/${session.session.id}/editor`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${owner.token}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        path: "/workspace/project/notes.txt",
        content: "draft 2"
      })
    })
  );

  assert.equal(saved.status, 200);
  assert.equal(await saved.text(), "proxied editor");
  assert.equal(forwarded.method, "POST");
  assert.match(forwarded.bodyText || "", /content=draft\+2/);
});

test("worker bootstraps runtime containers on start and records lifecycle hooks on stop", async () => {
  const forwarded = {
    bootstrap: null,
    lifecycle: null
  };
  const service = createWorkerService();
  const app = createApp({
    service,
    containersEnabled: true,
    getSessionContainer() {
      return {
        async startRuntime({ sessionId }) {
          return {
            sessionId,
            desiredState: "running",
            status: "running",
            runtimeState: "healthy",
            version: 1,
            operationId: "op-start"
          };
        },
        async stopRuntime() {
          return {
            desiredState: "sleeping",
            status: "sleeping",
            runtimeState: "stopped",
            version: 2,
            operationId: "op-stop"
          };
        },
        async fetch(request) {
          const url = new URL(request.url);
          const payload = JSON.parse(await request.text());
          if (url.pathname === "/runtime/bootstrap") {
            forwarded.bootstrap = payload;
            return new Response(JSON.stringify({ ok: true, bootstrap: payload }), {
              headers: {
                "content-type": "application/json; charset=utf-8"
              }
            });
          }
          if (url.pathname === "/runtime/lifecycle") {
            forwarded.lifecycle = payload;
            return new Response(JSON.stringify({ ok: true, lifecycle: payload }), {
              headers: {
                "content-type": "application/json; charset=utf-8"
              }
            });
          }
          return new Response("unexpected", { status: 404 });
        }
      };
    }
  });

  const owner = await service.registerUser({
    email: "bootstrap-hooks@example.com",
    name: "Bootstrap Hooks"
  });
  const template = await service.createTemplate(owner.token, {
    name: "bootstrap-hooks",
    description: "Template for lifecycle hook coverage"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/test/bootstrap-hooks:1.0.0",
      persistedPaths: ["/workspace/project"]
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);

  const session = await service.createSession(owner.token, {
    name: "bootstrap-hooks-session",
    templateId: template.template.id
  });

  const started = await requestJson(app, `/api/sessions/${session.session.id}/start`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${owner.token}`
    }
  });
  assert.equal(started.response.status, 200);
  assert.equal(forwarded.bootstrap.sessionId, session.session.id);
  assert.equal(forwarded.bootstrap.state, "running");
  assert.deepEqual(forwarded.bootstrap.persistedPaths, ["/workspace/project"]);

  const stopped = await requestJson(app, `/api/sessions/${session.session.id}/stop`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${owner.token}`
    }
  });
  assert.equal(stopped.response.status, 200);
  assert.equal(forwarded.lifecycle.sessionId, session.session.id);
  assert.equal(forwarded.lifecycle.phase, "sleep");
  assert.equal(forwarded.lifecycle.reason, "session_stop");
});

test("worker coordinates session lifecycle through the session container durable object", async () => {
  const calls = [];
  let runtime = {
    desiredState: "stopped",
    status: "idle",
    runtimeState: "stopped",
    bootCount: 0,
    version: 0,
    operationId: null
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
            version: runtime.version + 1,
            operationId: `op-${runtime.version + 1}`,
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
            version: runtime.version + 1,
            operationId: `op-${runtime.version + 1}`,
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
            version: runtime.version + 1,
            operationId: `op-${runtime.version + 1}`,
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
            version: runtime.version + 1,
            operationId: `op-${runtime.version + 1}`,
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
  assert.equal(started.data.session.runtimeVersion, 1);
  assert.equal(started.data.session.runtimeOperationId, "op-1");
  assert.equal(started.data.runtime.status, "running");
  assert.equal(started.data.runtime.bootCount, 1);
  assert.equal(started.data.runtime.version, 1);

  const detail = await requestJson(app, `/api/sessions/${sessionId}`, {
    headers: authHeaders
  });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.session.runtimeStatus, "running");
  assert.equal(detail.data.session.runtime.status, "running");
  assert.equal(detail.data.session.runtime.runtimeState, "healthy");
  assert.equal(detail.data.session.runtimeVersion, 1);

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
  assert.equal(stopped.data.session.runtimeVersion, 2);
  assert.equal(stopped.data.runtime.status, "sleeping");
  assert.equal(stopped.data.runtime.lastStopReason, "session_stop");
  assert.equal(stopped.data.runtime.version, 2);

  const restarted = await requestJson(app, `/api/sessions/${sessionId}/restart`, {
    method: "POST",
    headers: authHeaders
  });
  assert.equal(restarted.response.status, 200);
  assert.equal(restarted.data.session.state, "running");
  assert.equal(restarted.data.session.runtimeStatus, "running");
  assert.equal(restarted.data.session.runtimeVersion, 3);
  assert.equal(restarted.data.runtime.status, "running");
  assert.equal(restarted.data.runtime.bootCount, 2);
  assert.equal(restarted.data.runtime.version, 3);

  const deleted = await requestJson(app, `/api/sessions/${sessionId}`, {
    method: "DELETE",
    headers: authHeaders
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.data.session.state, "deleted");
  assert.equal(deleted.data.session.runtimeStatus, "deleted");
  assert.equal(deleted.data.session.runtimeVersion, 4);
  assert.equal(deleted.data.runtime.status, "deleted");
  assert.equal(deleted.data.runtime.version, 4);

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

test("worker replays restored snapshots into the container runtime on session start", async () => {
  const appliedRestores = [];
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
            bootCount: runtime.bootCount + 1
          };
          return runtime;
        },
        async getRuntimeState() {
          return runtime;
        },
        async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === "/snapshot/restore") {
            const payload = JSON.parse(await request.text());
            appliedRestores.push(payload);
            return new Response(
              JSON.stringify({
                appliedPath: `/workspace/.burstflare/snapshots/${payload.snapshotId}.snapshot`
              }),
              {
                headers: {
                  "content-type": "application/json; charset=utf-8"
                }
              }
            );
          }
          return new Response("ok");
        }
      };
    }
  });

  const owner = await service.registerUser({
    email: "runtime-restore@example.com",
    name: "Runtime Restore"
  });
  const template = await service.createTemplate(owner.token, {
    name: "runtime-restore",
    description: "Runtime restore template"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/runtime-restore:1.0.0",
      persistedPaths: ["/workspace/project"]
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);

  const created = await service.createSession(owner.token, {
    name: "runtime-restore-session",
    templateId: template.template.id
  });
  const sessionId = created.session.id;
  const authHeaders = {
    authorization: `Bearer ${owner.token}`
  };

  const snapshot = await requestJson(app, `/api/sessions/${sessionId}/snapshots`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      label: "boot-restore"
    })
  });
  assert.equal(snapshot.response.status, 200);

  const payloadText = "runtime restore payload";
  const uploaded = await requestJson(app, `/api/sessions/${sessionId}/snapshots/${snapshot.data.snapshot.id}/content`, {
    method: "PUT",
    headers: {
      ...authHeaders,
      "content-type": "text/plain"
    },
    body: payloadText
  });
  assert.equal(uploaded.response.status, 200);

  const restored = await requestJson(app, `/api/sessions/${sessionId}/snapshots/${snapshot.data.snapshot.id}/restore`, {
    method: "POST",
    headers: authHeaders
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.data.session.lastRestoredSnapshotId, snapshot.data.snapshot.id);
  assert.equal(appliedRestores.length, 0);

  const started = await requestJson(app, `/api/sessions/${sessionId}/start`, {
    method: "POST",
    headers: authHeaders
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.data.session.state, "running");
  assert.equal(started.data.runtimeRestore.snapshotId, snapshot.data.snapshot.id);
  assert.equal(appliedRestores.length, 1);
  assert.equal(appliedRestores[0].snapshotId, snapshot.data.snapshot.id);
  assert.deepEqual(appliedRestores[0].persistedPaths, ["/workspace/project"]);
  assert.equal(Buffer.from(appliedRestores[0].contentBase64, "base64").toString("utf8"), payloadText);
});

test("worker auto-captures snapshot content from a running container", async () => {
  const autosavePayload = JSON.stringify(
    {
      format: "burstflare.snapshot.v2",
      persistedPaths: ["/workspace/project"],
      files: [
        {
          path: "/workspace/project/notes.txt",
          content: "container autosave payload"
        }
      ]
    },
    null,
    2
  );
  const exportRequests = [];
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
            bootCount: runtime.bootCount + 1
          };
          return runtime;
        },
        async getRuntimeState() {
          return runtime;
        },
        async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === "/snapshot/export") {
            exportRequests.push(JSON.parse(await request.text()));
            return new Response(autosavePayload, {
              headers: {
                "content-type": "application/vnd.burstflare.snapshot+json; charset=utf-8"
              }
            });
          }
          return new Response("ok");
        }
      };
    }
  });

  const owner = await service.registerUser({
    email: "runtime-autosave@example.com",
    name: "Runtime Autosave"
  });
  const template = await service.createTemplate(owner.token, {
    name: "runtime-autosave",
    description: "Runtime autosave template"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/runtime-autosave:1.0.0",
      persistedPaths: ["/workspace/project"]
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);

  const created = await service.createSession(owner.token, {
    name: "runtime-autosave-session",
    templateId: template.template.id
  });
  const sessionId = created.session.id;
  const authHeaders = {
    authorization: `Bearer ${owner.token}`
  };

  const started = await requestJson(app, `/api/sessions/${sessionId}/start`, {
    method: "POST",
    headers: authHeaders
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.data.session.state, "running");

  const snapshot = await requestJson(app, `/api/sessions/${sessionId}/snapshots`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      label: "autosave"
    })
  });
  assert.equal(snapshot.response.status, 200);
  assert.equal(snapshot.data.snapshot.bytes, autosavePayload.length);
  assert.equal(snapshot.data.runtimeCapture.bytes, autosavePayload.length);
  assert.equal(exportRequests.length, 1);
  assert.deepEqual(exportRequests[0].persistedPaths, ["/workspace/project"]);

  const content = await app.fetch(
    new Request(`http://example.test/api/sessions/${sessionId}/snapshots/${snapshot.data.snapshot.id}/content`, {
      headers: authHeaders
    })
  );
  assert.equal(content.status, 200);
  const parsed = JSON.parse(await content.text());
  assert.equal(parsed.format, "burstflare.snapshot.v2");
  assert.deepEqual(parsed.persistedPaths, ["/workspace/project"]);
  assert.equal(parsed.files[0].path, "/workspace/project/notes.txt");
});

test("preview route rehydrates the restored snapshot before proxying", async () => {
  const forwarded = [];
  const service = createWorkerService();
  const app = createApp({
    service,
    containersEnabled: true,
    getSessionContainer() {
      return {
        async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === "/runtime/bootstrap" || url.pathname === "/snapshot/restore") {
            forwarded.push({
              path: url.pathname,
              payload: JSON.parse(await request.text())
            });
            return new Response(JSON.stringify({ ok: true }), {
              headers: {
                "content-type": "application/json; charset=utf-8"
              }
            });
          }
          forwarded.push({
            path: url.pathname
          });
          return new Response("preview ok", {
            headers: {
              "content-type": "text/plain; charset=utf-8"
            }
          });
        }
      };
    }
  });

  const owner = await service.registerUser({
    email: "preview-rehydrate@example.com",
    name: "Preview Rehydrate"
  });
  const template = await service.createTemplate(owner.token, {
    name: "preview-rehydrate",
    description: "Preview rehydrate template"
  });
  const version = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/preview-rehydrate:1.0.0"
    }
  });
  await service.processTemplateBuildById(version.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, version.templateVersion.id);

  const created = await service.createSession(owner.token, {
    name: "preview-rehydrate-session",
    templateId: template.template.id
  });
  await service.startSession(owner.token, created.session.id);

  const snapshot = await service.createSnapshot(owner.token, created.session.id, {
    label: "preview-restore"
  });
  await service.uploadSnapshotContent(owner.token, created.session.id, snapshot.snapshot.id, {
    body: "preview restore payload",
    contentType: "text/plain"
  });
  await service.restoreSnapshot(owner.token, created.session.id, snapshot.snapshot.id);

  const preview = await app.fetch(
    new Request(`http://example.test/runtime/sessions/${created.session.id}/preview`, {
      headers: {
        authorization: `Bearer ${owner.token}`
      }
    })
  );
  assert.equal(preview.status, 200);
  assert.equal(await preview.text(), "preview ok");
  assert.equal(forwarded.length, 3);
  assert.equal(forwarded[0].path, "/runtime/bootstrap");
  assert.equal(forwarded[0].payload.sessionId, created.session.id);
  assert.equal(forwarded[1].path, "/snapshot/restore");
  assert.equal(forwarded[1].payload.snapshotId, snapshot.snapshot.id);
  assert.equal(Buffer.from(forwarded[1].payload.contentBase64, "base64").toString("utf8"), "preview restore payload");
  assert.equal(forwarded[2].path, "/");
});

test("worker can roll back a template through the API", async () => {
  const service = createWorkerService();
  const app = createApp({
    service,
    TEMPLATE_BUCKET: createBucket(),
    BUILD_BUCKET: createBucket()
  });
  const owner = await service.registerUser({
    email: "worker-rollback@example.com",
    name: "Worker Rollback"
  });
  const template = await service.createTemplate(owner.token, {
    name: "worker-rollback",
    description: "Worker rollback template"
  });
  const versionOne = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "1.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/worker-rollback:1.0.0"
    }
  });
  await service.processTemplateBuildById(versionOne.build.id);
  const firstPromotion = await service.promoteTemplateVersion(owner.token, template.template.id, versionOne.templateVersion.id);

  const versionTwo = await service.addTemplateVersion(owner.token, template.template.id, {
    version: "2.0.0",
    manifest: {
      image: "registry.cloudflare.com/example/worker-rollback:2.0.0"
    }
  });
  await service.processTemplateBuildById(versionTwo.build.id);
  await service.promoteTemplateVersion(owner.token, template.template.id, versionTwo.templateVersion.id);

  const rollback = await requestJson(app, `/api/templates/${template.template.id}/rollback`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${owner.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      releaseId: firstPromotion.release.id
    })
  });
  assert.equal(rollback.response.status, 200);
  assert.equal(rollback.data.activeVersion.id, versionOne.templateVersion.id);
  assert.equal(rollback.data.targetRelease.id, firstPromotion.release.id);
  assert.equal(rollback.data.release.mode, "rollback");
  assert.equal(rollback.data.release.sourceReleaseId, firstPromotion.release.id);

  const releases = await requestJson(app, "/api/releases", {
    headers: {
      authorization: `Bearer ${owner.token}`
    }
  });
  assert.equal(releases.response.status, 200);
  assert.equal(releases.data.releases.at(-1).mode, "rollback");
});
