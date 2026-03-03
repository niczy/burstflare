import test from "node:test";
import assert from "node:assert/strict";
import { createBurstFlareService, createMemoryStore } from "@burstflare/shared";

const TEST_SSH_PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGJ1cnN0ZmxhcmV0ZXN0a2V5bWF0ZXJpYWw= flare@test";

function createObjectStore() {
  const bundles = new Map<string, { key: string; body: Uint8Array; contentType: string }>();
  const logs = new Map<string, string>();
  const artifacts = new Map<string, string>();
  const commonStates = new Map<string, { key: string; body: Uint8Array; contentType: string }>();
  const snapshots = new Map<string, { body: Uint8Array; contentType: string }>();
  const decoder = new TextDecoder();

  return {
    async putCommonState({ instance, body, contentType }: { instance: { id: string; commonStateKey: string }; body: Uint8Array; contentType: string }) {
      commonStates.set(instance.id, {
        key: instance.commonStateKey,
        body: body.slice(),
        contentType
      });
    },
    async getCommonState({ instance }: { instance: { id: string } }) {
      const entry = commonStates.get(instance.id);
      if (!entry) {
        return null;
      }
      return {
        body: entry.body.slice(),
        contentType: entry.contentType,
        bytes: entry.body.byteLength
      };
    },
    async deleteCommonState({ instance }: { instance: { id: string } }) {
      commonStates.delete(instance.id);
    },
    async putTemplateVersionBundle({ templateVersion, body, contentType }: { templateVersion: { id: string; bundleKey: string }; body: Uint8Array; contentType: string }) {
      bundles.set(templateVersion.id, {
        key: templateVersion.bundleKey,
        body: body.slice(),
        contentType
      });
    },
    async getTemplateVersionBundle({ templateVersion }: { templateVersion: { id: string } }) {
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
    async deleteTemplateVersionBundle({ templateVersion }: { templateVersion: { id: string } }) {
      bundles.delete(templateVersion.id);
    },
    async putBuildLog({ templateVersion, log }: { templateVersion: { id: string }; log: string }) {
      logs.set(templateVersion.id, log);
    },
    async getBuildLog({ templateVersion }: { templateVersion: { id: string } }) {
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
    async deleteBuildLog({ templateVersion }: { templateVersion: { id: string } }) {
      logs.delete(templateVersion.id);
    },
    async putBuildArtifact({ build, artifact }: { build: { id: string }; artifact: string }) {
      artifacts.set(build.id, artifact);
    },
    async getBuildArtifact({ build }: { build: { id: string } }) {
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
    async deleteBuildArtifact({ build }: { build: { id: string } }) {
      artifacts.delete(build.id);
    },
    async putSnapshot({ snapshot, body, contentType }: { snapshot: { id: string }; body: Uint8Array; contentType: string }) {
      snapshots.set(snapshot.id, {
        body: body.slice(),
        contentType
      });
    },
    async getSnapshot({ snapshot }: { snapshot: { id: string } }) {
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
    async deleteSnapshot({ snapshot }: { snapshot: { id: string } }) {
      snapshots.delete(snapshot.id);
    },
    readCommonStateText(instanceId: string) {
      const entry = commonStates.get(instanceId);
      return entry ? decoder.decode(entry.body) : null;
    },
    readBundleText(templateVersionId: string) {
      const entry = bundles.get(templateVersionId);
      return entry ? decoder.decode(entry.body) : null;
    },
    readBuildLogText(templateVersionId: string) {
      return logs.get(templateVersionId) || null;
    },
    readBuildArtifactText(buildId: string) {
      return artifacts.get(buildId) || null;
    }
  };
}

test("service supports instance CRUD with write-only secrets", async () => {
  let tick = Date.parse("2026-03-03T00:00:00.000Z");
  const service = createBurstFlareService({
    store: createMemoryStore(),
    clock: () => {
      tick += 1000;
      return tick;
    }
  });

  const owner = await service.registerUser({
    email: "instances@example.com",
    name: "Instance Owner"
  });

  const created = await service.createInstance(owner.token, {
    name: "Base Node",
    description: "Node 20 runtime",
    image: "node:20",
    dockerfilePath: "./Dockerfile",
    dockerContext: ".",
    persistedPaths: ["/workspace", "/home/flare/.cache"],
    sleepTtlSeconds: 60,
    envVars: {
      NODE_ENV: "development"
    },
    secrets: {
      api_key: "secret-1"
    }
  });
  assert.equal(created.instance.name, "Base Node");
  assert.equal(created.instance.image, "node:20");
  assert.deepEqual(created.instance.persistedPaths, ["/workspace", "/home/flare/.cache"]);
  assert.equal(created.instance.sleepTtlSeconds, 60);
  assert.deepEqual(created.instance.envVars, {
    NODE_ENV: "development"
  });
  assert.deepEqual(created.instance.secretNames, ["API_KEY"]);
  assert.equal(created.instance.secretCount, 1);
  assert.equal("secrets" in created.instance, false);

  const listed = await service.listInstances(owner.token);
  assert.equal(listed.instances.length, 1);
  assert.equal(listed.instances[0].id, created.instance.id);

  const updated = await service.updateInstance(owner.token, created.instance.id, {
    image: "node:22",
    persistedPaths: ["/workspace", "/home/flare"],
    sleepTtlSeconds: 120,
    envVars: {
      NODE_ENV: "production",
      DEBUG: "0"
    },
    secrets: {
      api_key: "secret-2",
      extra_token: "secret-3"
    }
  });
  assert.equal(updated.instance.image, "node:22");
  assert.deepEqual(updated.instance.persistedPaths, ["/workspace", "/home/flare"]);
  assert.equal(updated.instance.sleepTtlSeconds, 120);
  assert.deepEqual(updated.instance.envVars, {
    NODE_ENV: "production",
    DEBUG: "0"
  });
  assert.deepEqual(updated.instance.secretNames, ["API_KEY", "EXTRA_TOKEN"]);
  assert.equal(updated.instance.secretCount, 2);

  const fetched = await service.getInstance(owner.token, created.instance.id);
  assert.equal(fetched.instance.id, created.instance.id);
  assert.equal(fetched.instance.image, "node:22");
  assert.deepEqual(fetched.instance.persistedPaths, ["/workspace", "/home/flare"]);
  assert.equal(fetched.instance.sleepTtlSeconds, 120);
  assert.equal("secrets" in fetched.instance, false);

  const deleted = await service.deleteInstance(owner.token, created.instance.id);
  assert.equal(deleted.ok, true);
  assert.equal(deleted.instanceId, created.instance.id);

  const empty = await service.listInstances(owner.token);
  assert.deepEqual(empty.instances, []);
});

test("service can persist instance common state", async () => {
  let tick = Date.parse("2026-03-03T00:00:00.000Z");
  const objects = createObjectStore();
  const service = createBurstFlareService({
    objects,
    clock: () => {
      tick += 1000;
      return tick;
    }
  });

  const owner = await service.registerUser({
    email: "common-state@example.com",
    name: "Common State"
  });
  const instance = await service.createInstance(owner.token, {
    name: "common-state",
    description: "Common state instance",
    image: "registry.cloudflare.com/example/common-state:1.0.0"
  });

  const saved = await service.saveInstanceCommonState(owner.token, instance.instance.id, {
    body: JSON.stringify({
      format: "burstflare.common-state.v1",
      files: [
        {
          path: "/home/flare/.myconfig",
          content: "hello"
        }
      ]
    }),
    contentType: "application/vnd.burstflare.common-state+json; charset=utf-8"
  });
  assert.match(saved.commonState.key, /^instances\/ins_/);
  assert.ok(saved.commonState.bytes > 0);
  assert.ok(saved.commonState.updatedAt);
  assert.equal(saved.instance.commonStateBytes, saved.commonState.bytes);
  assert.match(objects.readCommonStateText(instance.instance.id) || "", /.myconfig/);

  const fetched = await service.getInstanceCommonState(owner.token, instance.instance.id);
  const parsed = JSON.parse(new TextDecoder().decode(fetched.body));
  assert.equal(parsed.format, "burstflare.common-state.v1");
  assert.equal(parsed.files[0].path, "/home/flare/.myconfig");
  assert.equal(fetched.commonState.bytes, saved.commonState.bytes);
});

test("service can create and operate on sessions owned by an instance", async () => {
  let tick = Date.parse("2026-03-03T00:10:00.000Z");
  const service = createBurstFlareService({
    store: createMemoryStore(),
    clock: () => {
      tick += 1000;
      return tick;
    }
  });

  const owner = await service.registerUser({
    email: "instance-sessions@example.com",
    name: "Instance Sessions"
  });
  const instance = await service.createInstance(owner.token, {
    name: "Session Base",
    image: "node:20",
    persistedPaths: ["/workspace", "/home/flare"],
    sleepTtlSeconds: 30
  });

  const created = await service.createSession(owner.token, {
    name: "from-instance",
    instanceId: instance.instance.id
  });
  assert.equal(created.session.instanceId, instance.instance.id);
  assert.equal(created.session.instanceName, "Session Base");
  assert.equal(created.session.templateId, null);
  assert.deepEqual(created.session.persistedPaths, ["/workspace", "/home/flare"]);
  assert.equal(created.session.sleepTtlSeconds, 30);

  const listed = await service.listSessions(owner.token);
  assert.equal(listed.sessions.length, 1);
  assert.equal(listed.sessions[0].instanceId, instance.instance.id);

  const started = await service.startSession(owner.token, created.session.id);
  assert.equal(started.session.state, "running");
  assert.equal(started.session.instanceId, instance.instance.id);

  const detail = await service.getSession(owner.token, created.session.id);
  assert.equal(detail.session.instanceId, instance.instance.id);
  assert.equal(detail.session.instanceName, "Session Base");

  const stopped = await service.stopSession(owner.token, created.session.id);
  assert.equal(stopped.session.state, "sleeping");
  assert.equal(stopped.session.instanceId, instance.instance.id);
});

test("service covers removed sharing, instance sessions, usage, and audit", async () => {
  let tick = Date.parse("2026-02-27T00:00:00.000Z");
  const objects = createObjectStore();
  let reconcileJobs = 0;
  const store = createMemoryStore();
  const service = createBurstFlareService({
    store,
    objects,
    jobs: {
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
  await service.registerPasskey(owner.token, {
    credentialId: "credential-owner-1",
    label: "Owner Laptop",
    publicKey: "spki-owner-key",
    publicKeyAlgorithm: -7,
    transports: ["internal", "hybrid"]
  });
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
  await assert.rejects(() => service.switchWorkspace(teammate.token, owner.workspace.id), /Unauthorized workspace/);

  const plan = await service.setWorkspacePlan(owner.token, "pro");
  assert.equal(plan.workspace.plan, "pro");
  const renamedWorkspace = await service.updateWorkspaceSettings(owner.token, {
    name: "Burst Operations"
  });
  assert.equal(renamedWorkspace.workspace.name, "Burst Operations");

  const instance = await service.createInstance(owner.token, {
    name: "node-dev",
    description: "Node runtime",
    image: "registry.cloudflare.com/test/node-dev:1.0.0",
    persistedPaths: ["/workspace", "/home/flare/.cache"],
    sleepTtlSeconds: 10
  });
  assert.equal(instance.instance.name, "node-dev");

  const runningSession = await service.createSession(owner.token, {
    name: "demo",
    instanceId: instance.instance.id
  });
  await service.startSession(owner.token, runningSession.session.id);
  const restarted = await service.restartSession(owner.token, runningSession.session.id);
  assert.equal(restarted.session.state, "running");

  const syncedSshKey = await service.upsertSessionSshKey(owner.token, runningSession.session.id, {
    keyId: "cli:test",
    label: "CLI Test",
    publicKey: TEST_SSH_PUBLIC_KEY
  });
  assert.equal(syncedSshKey.sshKeyCount, 1);
  const runtime = await service.issueRuntimeToken(owner.token, runningSession.session.id);
  assert.match(runtime.sshCommand, /ssh -i <local-key-path>/);
  const runtimeSession = await service.validateRuntimeToken(runtime.token, runningSession.session.id);
  assert.deepEqual(runtimeSession.session.sshAuthorizedKeys, [TEST_SSH_PUBLIC_KEY]);

  const events = await service.listSessionEvents(owner.token, runningSession.session.id);
  assert.ok(events.events.length >= 4);

  const snapshot = await service.createSnapshot(owner.token, runningSession.session.id, {
    label: "manual-save"
  });
  assert.equal(snapshot.snapshot.label, "manual-save");
  const emptySnapshot = await service.createSnapshot(owner.token, runningSession.session.id, {
    label: "empty"
  });
  assert.equal(emptySnapshot.snapshot.id, snapshot.snapshot.id);
  await assert.rejects(
    () => service.restoreSnapshot(owner.token, runningSession.session.id, emptySnapshot.snapshot.id),
    /Snapshot content not uploaded/
  );
  const snapshotBody = "workspace-state";
  const snapshotGrant = await service.createSnapshotUploadGrant(owner.token, runningSession.session.id, snapshot.snapshot.id, {
    contentType: "text/plain",
    bytes: snapshotBody.length
  });
  const uploadedSnapshot = await service.consumeUploadGrant(snapshotGrant.uploadGrant.id, {
    body: snapshotBody,
    contentType: "text/plain"
  });
  assert.equal(uploadedSnapshot.target, "snapshot");
  const downloadedSnapshot = await service.getSnapshotContent(owner.token, runningSession.session.id, snapshot.snapshot.id);
  assert.equal(new TextDecoder().decode(downloadedSnapshot.body), snapshotBody);
  const restoredSnapshot = await service.restoreSnapshot(owner.token, runningSession.session.id, snapshot.snapshot.id);
  assert.equal(restoredSnapshot.session.lastRestoredSnapshotId, snapshot.snapshot.id);

  const staleSession = await service.createSession(owner.token, {
    name: "stale-demo",
    instanceId: instance.instance.id
  });
  await service.startSession(owner.token, staleSession.session.id);
  await service.stopSession(owner.token, staleSession.session.id);
  const staleSnapshot = await service.createSnapshot(owner.token, staleSession.session.id, {
    label: "stale"
  });
  await service.uploadSnapshotContent(owner.token, staleSession.session.id, staleSnapshot.snapshot.id, {
    body: "stale-state",
    contentType: "text/plain"
  });
  await store.transact((state: any) => {
    const staleRecord = state.sessions.find((entry: any) => entry.id === staleSession.session.id);
    assert.ok(staleRecord);
    staleRecord.lastStoppedAt = new Date(tick - 20000).toISOString();
    staleRecord.updatedAt = staleRecord.lastStoppedAt;
  });

  const deletedSession = await service.createSession(owner.token, {
    name: "deleted-demo",
    instanceId: instance.instance.id
  });
  const deletedSnapshot = await service.createSnapshot(owner.token, deletedSession.session.id, {
    label: "deleted"
  });
  await service.uploadSnapshotContent(owner.token, deletedSession.session.id, deletedSnapshot.snapshot.id, {
    body: "deleted-state",
    contentType: "text/plain"
  });
  await service.deleteSession(owner.token, deletedSession.session.id);

  const cleanup = await service.reconcile(owner.token);
  assert.equal(cleanup.sleptSessions, 1);
  assert.equal(cleanup.recoveredStuckBuilds, 0);
  assert.equal(cleanup.processedBuilds, 0);
  assert.equal(cleanup.purgedDeletedSessions, 1);
  assert.equal(cleanup.purgedStaleSleepingSessions, 1);
  assert.equal(cleanup.purgedSnapshots, 2);
  await assert.rejects(() => service.getSession(owner.token, staleSession.session.id), /Session not found/);
  await assert.rejects(() => service.getSession(owner.token, deletedSession.session.id), /Session not found/);

  const ownerSecondLogin = await service.login({
    email: "owner@example.com",
    kind: "browser"
  });
  const ownerThirdLogin = await service.login({
    email: "owner@example.com",
    kind: "browser"
  });
  const authSessions = await service.listAuthSessions(ownerSecondLogin.token);
  assert.ok(authSessions.sessions.some((entry: any) => entry.id === ownerThirdLogin.authSessionId));
  const revokeSession = await service.revokeAuthSession(ownerSecondLogin.token, ownerThirdLogin.authSessionId);
  assert.equal(revokeSession.ok, true);
  await assert.rejects(() => service.authenticate(ownerThirdLogin.token), /Unauthorized/);

  const usage = await service.getUsage(ownerSecondLogin.token);
  assert.ok(usage.usage.runtimeMinutes >= 2);
  assert.ok(usage.usage.snapshots >= 3);
  assert.equal(usage.usage.templateBuilds, 0);
  assert.equal(usage.usage.storage.templateBundlesBytes, 0);
  assert.equal(usage.usage.storage.buildArtifactBytes, 0);
  assert.ok(usage.usage.storage.snapshotBytes > 0);
  assert.equal(usage.usage.inventory.instances, 1);
  assert.equal(usage.usage.inventory.templates, 0);
  assert.equal(usage.limits.maxRunningSessions, 20);
  assert.equal(usage.plan, "pro");
  assert.deepEqual(usage.overrides, {});

  const refreshed = await service.refreshSession(ownerSecondLogin.refreshToken);
  assert.ok(refreshed.token);
  await assert.rejects(() => service.refreshSession(ownerSecondLogin.refreshToken), /Unauthorized/);
  const logout = await service.logout(refreshed.token, refreshed.refreshToken);
  assert.equal(logout.ok, true);
  await assert.rejects(() => service.authenticate(refreshed.token), /Unauthorized/);

  const enqueued = await service.enqueueReconcile(ownerSecondLogin.token);
  assert.equal(enqueued.queued, true);
  assert.equal(reconcileJobs, 1);

  const report = await service.getAdminReport(ownerSecondLogin.token);
  assert.equal(report.report.members, 1);
  assert.equal(report.report.instances, 1);
  assert.equal(report.report.templates, 0);
  assert.equal(report.report.releases, 0);
  assert.equal(report.report.buildsQueued, 0);
  assert.equal(report.report.buildsBuilding, 0);
  assert.equal(report.report.buildsStuck, 0);
  assert.equal(report.report.buildsFailed, 0);
  assert.equal(report.report.buildsDeadLettered, 0);
  assert.equal(report.report.activeUploadGrants, 0);
  assert.equal(report.report.limits.maxRunningSessions, 20);

  const secret = await service.setWorkspaceSecret(ownerSecondLogin.token, "api_token", "secret-value");
  assert.equal(secret.secret.name, "API_TOKEN");
  const secrets = await service.listWorkspaceSecrets(ownerSecondLogin.token);
  assert.deepEqual(secrets.secrets.map((entry: any) => entry.name), ["API_TOKEN"]);

  const exported = await service.exportWorkspace(ownerSecondLogin.token);
  assert.equal(exported.export.workspace.id, owner.workspace.id);
  assert.equal(exported.export.members.length, 1);
  assert.equal(exported.export.instances.length, 1);
  assert.deepEqual(exported.export.templates, []);
  assert.deepEqual(exported.export.builds, []);
  assert.deepEqual(exported.export.releases, []);
  assert.deepEqual(exported.export.artifacts.templateBundles, []);
  assert.deepEqual(exported.export.artifacts.buildArtifacts, []);
  assert.equal(exported.export.artifacts.snapshots.length, 1);
  assert.equal(exported.export.security.runtimeSecrets.length, 1);
  assert.equal(exported.export.security.runtimeSecrets[0].name, "API_TOKEN");
  assert.ok(exported.export.audit.length >= 1);

  const deletedSecret = await service.deleteWorkspaceSecret(ownerSecondLogin.token, "api_token");
  assert.equal(deletedSecret.ok, true);

  const audit = await service.getAudit(ownerSecondLogin.token, { limit: 200 });
  assert.ok(audit.audit.length >= 10);
  assert.equal(
    audit.audit.some((entry: any) => String(entry.action || "").startsWith("workspace.invite_")),
    false
  );
  assert.equal(
    audit.audit.some((entry: any) => String(entry.action || "").startsWith("workspace.member_role_")),
    false
  );
});

test("service creates usage-based billing sessions, invoices, and Stripe webhooks", async () => {
  const checkoutCalls: any[] = [];
  const portalCalls: any[] = [];
  const invoiceCalls: any[] = [];
  const store = createMemoryStore();
  const service = createBurstFlareService({
    store,
    billingCatalog: {
      runtimeMinuteUsd: 0.05,
      storageGbMonthUsd: 0.5
    },
    billing: {
      providerName: "stripe",
      async createCheckoutSession(input: any) {
        checkoutCalls.push(input);
        return {
          provider: "stripe",
          id: "cs_test_1",
          url: "https://checkout.stripe.com/c/pay/cs_test_1",
          customerId: "cus_test_1",
          setupIntentId: "seti_test_1",
          billingStatus: "checkout_open"
        };
      },
      async createPortalSession(input: any) {
        portalCalls.push(input);
        return {
          provider: "stripe",
          id: "bps_test_1",
          url: "https://billing.stripe.com/p/session/test_1"
        };
      },
      async createUsageInvoice(input: any) {
        invoiceCalls.push(input);
        return {
          provider: "stripe",
          id: "in_test_1",
          status: "open",
          hostedInvoiceUrl: "https://invoice.stripe.com/i/in_test_1",
          currency: "usd",
          amountUsd: input.pricing.totalUsd,
          billingStatus: "active"
        };
      }
    }
  });

  const owner = await service.registerUser({
    email: "billing-owner@example.com",
    name: "Billing Owner"
  });

  const checkout = await service.createWorkspaceCheckoutSession(owner.token, {
    successUrl: "https://app.example.com/billing/success",
    cancelUrl: "https://app.example.com/billing/cancel"
  });
  assert.equal(checkout.checkoutSession.id, "cs_test_1");
  assert.equal(checkout.billing.pricingModel, "usage");
  assert.equal(checkout.billing.provider, "stripe");
  assert.equal(checkout.billing.customerId, "cus_test_1");
  assert.equal(checkout.billing.billingStatus, "checkout_open");
  assert.equal(checkout.billing.lastSetupIntentId, "seti_test_1");
  assert.equal(checkout.workspace.plan, "free");
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].successUrl, "https://app.example.com/billing/success");
  assert.equal(checkoutCalls[0].cancelUrl, "https://app.example.com/billing/cancel");
  assert.equal(checkoutCalls[0].billing.customerId, null);

  const listed = await service.getWorkspaceBilling(owner.token);
  assert.equal(listed.billing.customerId, "cus_test_1");
  assert.equal(listed.pricing.totalUsd, 0);
  assert.equal(listed.pricing.rates.storageGbMonthUsd, 0.5);
  assert.equal(listed.pendingInvoiceEstimate.totalUsd, 0);

  const portal = await service.createWorkspaceBillingPortalSession(owner.token, {
    returnUrl: "https://app.example.com/settings"
  });
  assert.equal(portal.portalSession.id, "bps_test_1");
  assert.equal(portal.billing.lastPortalSessionId, "bps_test_1");
  assert.equal(portalCalls.length, 1);
  assert.equal(portalCalls[0].billing.customerId, "cus_test_1");
  assert.equal(portalCalls[0].returnUrl, "https://app.example.com/settings");

  await store.transact((state: any) => {
    state.usageEvents.push(
      {
        id: "use_runtime_1",
        workspaceId: owner.workspace.id,
        kind: "runtime_minutes",
        value: 12,
        details: {},
        createdAt: new Date().toISOString()
      },
      {
        id: "use_storage_1",
        workspaceId: owner.workspace.id,
        kind: "storage_gb_day",
        value: 90,
        details: {},
        createdAt: new Date().toISOString()
      },
      {
        id: "use_build_1",
        workspaceId: owner.workspace.id,
        kind: "template_build",
        value: 2,
        details: {},
        createdAt: new Date().toISOString()
      },
      {
        id: "use_snapshot_1",
        workspaceId: owner.workspace.id,
        kind: "snapshot",
        value: 3,
        details: {},
        createdAt: new Date().toISOString()
      }
    );
  });

  const quoted = await service.getWorkspaceBilling(owner.token);
  assert.equal(quoted.pendingInvoiceEstimate.totalUsd, 2.1);
  assert.equal(quoted.pendingInvoiceEstimate.lineItems[0].amountUsd, 0.6);
  assert.equal(quoted.pendingInvoiceEstimate.lineItems[1].amountUsd, 1.5);

  const invoiced = await service.createWorkspaceUsageInvoice(owner.token);
  assert.equal(invoiced.invoice.id, "in_test_1");
  assert.equal(invoiced.invoice.amountUsd, 2.1);
  assert.equal(invoiced.billing.lastInvoiceId, "in_test_1");
  assert.equal(invoiced.billing.lastInvoiceAmountUsd, 2.1);
  assert.equal(invoiced.billing.billedUsageTotals.runtimeMinutes, 12);
  assert.equal(invoiced.billing.billedUsageTotals.storageGbDays, 90);
  assert.equal(invoiceCalls.length, 1);
  assert.equal(invoiceCalls[0].usage.runtimeMinutes, 12);
  assert.equal(invoiceCalls[0].usage.storageGbDays, 90);

  const noDelta = await service.createWorkspaceUsageInvoice(owner.token);
  assert.equal(noDelta.invoice, null);
  assert.equal(noDelta.pendingInvoiceEstimate.totalUsd, 0);

  const activeEvent = {
    id: "evt_checkout_complete",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        customer: "cus_test_1",
        payment_method: "pm_test_1",
        setup_intent: "seti_test_1",
        metadata: {
          workspaceId: owner.workspace.id
        }
      }
    }
  };
  const activated = await service.applyBillingWebhook(activeEvent);
  assert.equal(activated.duplicate, false);
  assert.equal(activated.billing.billingStatus, "active");
  assert.equal(activated.billing.defaultPaymentMethodId, "pm_test_1");
  assert.equal(activated.workspace.plan, "free");

  const duplicate = await service.applyBillingWebhook(activeEvent);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.billing.billingStatus, "active");

  const auth = await service.authenticate(owner.token);
  assert.equal(auth.workspace.plan, "free");
  assert.equal(auth.workspace.billing.billingStatus, "active");

  const paid = await service.applyBillingWebhook({
    id: "evt_invoice_paid",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_test_1",
        customer: "cus_test_1",
        status: "paid",
        currency: "usd",
        amount_paid: 610,
        metadata: { workspaceId: owner.workspace.id }
      }
    }
  });
  assert.equal(paid.billing.lastInvoiceStatus, "paid");
  assert.equal(paid.billing.lastInvoiceAmountUsd, 6.1);
});

test("service rejects legacy template backend methods", async () => {
  const service = createBurstFlareService();
  const owner = await service.registerUser({
    email: "legacy-removed@example.com",
    name: "Legacy Removed"
  });
  const instance = await service.createInstance(owner.token, {
    name: "legacy-check",
    description: "Legacy backend removal coverage",
    image: "registry.cloudflare.com/example/legacy-check:1.0.0"
  });

  await assert.rejects(() => service.createTemplate(), /Legacy template backend removed/);
  await assert.rejects(() => service.archiveTemplate(), /Legacy template backend removed/);
  await assert.rejects(() => service.restoreTemplate(), /Legacy template backend removed/);
  await assert.rejects(() => service.deleteTemplate(), /Legacy template backend removed/);
  await assert.rejects(() => service.listTemplates(), /Legacy template backend removed/);
  await assert.rejects(() => service.getTemplate(), /Legacy template backend removed/);
  await assert.rejects(() => service.listTemplateBuilds(), /Legacy template backend removed/);
  await assert.rejects(() => service.addTemplateVersion(), /Legacy template backend removed/);
  await assert.rejects(() => service.uploadTemplateVersionBundle(), /Legacy template backend removed/);
  await assert.rejects(() => service.createTemplateVersionBundleUploadGrant(), /Legacy template backend removed/);
  await assert.rejects(() => service.getTemplateVersionBundle(), /Legacy template backend removed/);
  await assert.rejects(() => service.processTemplateBuilds(), /Legacy template backend removed/);
  await assert.rejects(() => service.processTemplateBuildById(), /Legacy template backend removed/);
  await assert.rejects(() => service.markTemplateBuildWorkflow(), /Legacy template backend removed/);
  await assert.rejects(() => service.getTemplateBuildLog(), /Legacy template backend removed/);
  await assert.rejects(() => service.getTemplateBuildArtifact(), /Legacy template backend removed/);
  await assert.rejects(() => service.retryTemplateBuild(), /Legacy template backend removed/);
  await assert.rejects(() => service.promoteTemplateVersion(), /Legacy template backend removed/);
  await assert.rejects(() => service.listBindingReleases(), /Legacy template backend removed/);
  await assert.rejects(() => service.rollbackTemplate(), /Legacy template backend removed/);

  const recovered = await service.retryDeadLetteredBuilds();
  assert.deepEqual(recovered, {
    recovered: 0,
    buildIds: []
  });

  await assert.rejects(
    () =>
      service.createSession(owner.token, {
        name: "legacy-template-session"
      }),
    /Instance is required/
  );

  const created = await service.createSession(owner.token, {
    name: "instance-only-session",
    instanceId: instance.instance.id
  });
  assert.equal(created.session.instanceId, instance.instance.id);
  assert.equal(created.session.templateId, null);
  assert.equal(created.session.templateName, null);
});

test("service exposes targeted operator reconcile workflows", async () => {
  let tick = Date.parse("2026-02-28T12:00:00.000Z");
  const objects = createObjectStore();
  const store = createMemoryStore();
  const service = createBurstFlareService({
    store,
    objects,
    clock: () => {
      tick += 1000;
      return tick;
    }
  });

  const owner = await service.registerUser({
    email: "ops-workflows@example.com",
    name: "Ops Workflows"
  });
  const instance = await service.createInstance(owner.token, {
    name: "ops-instance",
    description: "Operator workflow instance",
    image: "registry.cloudflare.com/test/ops-instance:1.0.0",
    sleepTtlSeconds: 10
  });

  const runningSession = await service.createSession(owner.token, {
    name: "ops-running",
    instanceId: instance.instance.id
  });
  await service.startSession(owner.token, runningSession.session.id);

  const staleSession = await service.createSession(owner.token, {
    name: "ops-stale",
    instanceId: instance.instance.id
  });
  await service.startSession(owner.token, staleSession.session.id);
  await service.stopSession(owner.token, staleSession.session.id);
  const staleSnapshot = await service.createSnapshot(owner.token, staleSession.session.id, {
    label: "stale"
  });
  await service.uploadSnapshotContent(owner.token, staleSession.session.id, staleSnapshot.snapshot.id, {
    body: "stale-snapshot",
    contentType: "text/plain"
  });

  const deletedSession = await service.createSession(owner.token, {
    name: "ops-deleted",
    instanceId: instance.instance.id
  });
  const deletedSnapshot = await service.createSnapshot(owner.token, deletedSession.session.id, {
    label: "deleted"
  });
  await service.uploadSnapshotContent(owner.token, deletedSession.session.id, deletedSnapshot.snapshot.id, {
    body: "deleted-snapshot",
    contentType: "text/plain"
  });
  await service.deleteSession(owner.token, deletedSession.session.id);

  await store.transact((state: any) => {
    const session = state.sessions.find((entry: any) => entry.id === staleSession.session.id);
    assert.ok(session);
    session.lastStoppedAt = new Date(tick - 1000 * 60 * 10).toISOString();
    session.updatedAt = session.lastStoppedAt;
  });

  tick += 2000;

  const preview = await service.previewReconcile(owner.token);
  assert.equal(preview.preview.sleptSessions, 1);
  assert.equal(preview.preview.recoveredStuckBuilds, 0);
  assert.equal(preview.preview.processedBuilds, 0);
  assert.equal(preview.preview.purgedDeletedSessions, 1);
  assert.equal(preview.preview.purgedStaleSleepingSessions, 1);
  assert.deepEqual(preview.preview.sessionIds.running, [runningSession.session.id]);
  assert.deepEqual(preview.preview.sessionIds.staleSleeping, [staleSession.session.id]);
  assert.deepEqual(preview.preview.sessionIds.deleted, [deletedSession.session.id]);
  assert.deepEqual(preview.preview.buildIds.stuck, []);
  assert.deepEqual(preview.preview.buildIds.queued, []);

  const recovered = await service.recoverStuckBuilds(owner.token);
  assert.equal(recovered.recoveredStuckBuilds, 0);
  assert.deepEqual(recovered.buildIds, []);
  const recoveredAgain = await service.recoverStuckBuilds(owner.token);
  assert.equal(recoveredAgain.recoveredStuckBuilds, 0);

  const purgedSleeping = await service.purgeStaleSleepingSessions(owner.token);
  assert.equal(purgedSleeping.purgedStaleSleepingSessions, 1);
  assert.equal(purgedSleeping.purgedSnapshots, 1);
  assert.deepEqual(purgedSleeping.sessionIds, [staleSession.session.id]);
  const purgedSleepingAgain = await service.purgeStaleSleepingSessions(owner.token);
  assert.equal(purgedSleepingAgain.purgedStaleSleepingSessions, 0);
  await assert.rejects(() => service.getSession(owner.token, staleSession.session.id), /Session not found/);

  const purgedDeleted = await service.purgeDeletedSessions(owner.token);
  assert.equal(purgedDeleted.purgedDeletedSessions, 1);
  assert.equal(purgedDeleted.purgedSnapshots, 1);
  assert.deepEqual(purgedDeleted.sessionIds, [deletedSession.session.id]);
  const purgedDeletedAgain = await service.purgeDeletedSessions(owner.token);
  assert.equal(purgedDeletedAgain.purgedDeletedSessions, 0);
  await assert.rejects(() => service.getSession(owner.token, deletedSession.session.id), /Session not found/);

  const slept = await service.sleepRunningSessions(owner.token);
  assert.equal(slept.sleptSessions, 1);
  assert.deepEqual(slept.sessionIds, [runningSession.session.id]);
  const sleptAgain = await service.sleepRunningSessions(owner.token);
  assert.equal(sleptAgain.sleptSessions, 0);

  const report = await service.getAdminReport(owner.token);
  assert.equal(report.report.reconcileCandidates.runningSessions, 0);
  assert.equal(report.report.reconcileCandidates.stuckBuilds, 0);
  assert.equal(report.report.reconcileCandidates.deletedSessions, 0);
  assert.equal(report.report.reconcileCandidates.staleSleepingSessions, 0);
  assert.equal(report.report.reconcileCandidates.queuedBuilds, 0);
});

test("service enforces quota overrides and storage limits", async () => {
  let tick = Date.parse("2026-02-28T13:00:00.000Z");
  const objects = createObjectStore();
  const store = createMemoryStore();
  const service = createBurstFlareService({
    store,
    objects,
    clock: () => {
      tick += 1000;
      return tick;
    }
  });

  const owner = await service.registerUser({
    email: "quota-owner@example.com",
    name: "Quota Owner"
  });

  const overrides = await service.setWorkspaceQuotaOverrides(owner.token, {
    maxRunningSessions: 1,
    maxSnapshotsPerSession: 1,
    maxStorageBytes: 20,
    maxRuntimeMinutes: 1
  });
  assert.equal(overrides.overrides.maxStorageBytes, 20);

  const instance = await service.createInstance(owner.token, {
    name: "quota-instance",
    description: "Quota test instance",
    image: "registry.cloudflare.com/test/quota-instance:1.0.0"
  });

  const session = await service.createSession(owner.token, {
    name: "quota-session",
    instanceId: instance.instance.id
  });
  const started = await service.startSession(owner.token, session.session.id);
  assert.equal(started.session.state, "running");

  const secondSession = await service.createSession(owner.token, {
    name: "quota-session-2",
    instanceId: instance.instance.id
  });
  await assert.rejects(() => service.startSession(owner.token, secondSession.session.id), /Running session limit reached/);
  await service.stopSession(owner.token, session.session.id);

  const snapshot = await service.createSnapshot(owner.token, session.session.id, {
    label: "quota-snap"
  });
  assert.ok(snapshot.snapshot.id);
  const replacementSnapshot = await service.createSnapshot(owner.token, session.session.id, {
    label: "quota-snap-2"
  });
  assert.equal(replacementSnapshot.snapshot.id, snapshot.snapshot.id);
  assert.equal(replacementSnapshot.snapshot.label, "quota-snap-2");

  await assert.rejects(
    () =>
      service.uploadSnapshotContent(owner.token, session.session.id, replacementSnapshot.snapshot.id, {
        body: "012345678901234567890",
        contentType: "text/plain"
      }),
    /Workspace storage limit reached/
  );

  const raisedStorage = await service.setWorkspaceQuotaOverrides(owner.token, {
    maxRunningSessions: 1,
    maxSnapshotsPerSession: 1,
    maxStorageBytes: 512,
    maxRuntimeMinutes: 1
  });
  assert.equal(raisedStorage.limits.maxStorageBytes, 512);

  await service.uploadSnapshotContent(owner.token, session.session.id, replacementSnapshot.snapshot.id, {
    body: "small-snapshot",
    contentType: "text/plain"
  });

  const usage = await service.getUsage(owner.token);
  assert.equal(usage.limits.maxRunningSessions, 1);
  assert.equal(usage.overrides.maxRuntimeMinutes, 1);
  assert.equal(usage.usage.inventory.instances, 1);

  const cleared = await service.setWorkspaceQuotaOverrides(owner.token, { clear: true });
  assert.deepEqual(cleared.overrides, {});
  assert.equal(cleared.limits.maxRunningSessions, 3);
});

test("service can persist runtime state from a durable-object-driven session transition", async () => {
  const service = createBurstFlareService();
  const owner = await service.registerUser({
    email: "runtime-sync@example.com",
    name: "Runtime Sync"
  });
  const instance = await service.createInstance(owner.token, {
    name: "runtime-sync",
    description: "Runtime sync instance",
    image: "registry.cloudflare.com/example/runtime-sync:1.0.0"
  });
  const created = await service.createSession(owner.token, {
    name: "runtime-sync-session",
    instanceId: instance.instance.id
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

test("service rejects legacy template release operations", async () => {
  const service = createBurstFlareService();
  await service.registerUser({
    email: "rollback@example.com",
    name: "Rollback User"
  });

  await assert.rejects(() => service.promoteTemplateVersion(), /Legacy template backend removed/);
  await assert.rejects(() => service.listBindingReleases(), /Legacy template backend removed/);
  await assert.rejects(() => service.rollbackTemplate(), /Legacy template backend removed/);
});

test("service ignores stale runtime transitions that arrive after a newer runtime state", async () => {
  const service = createBurstFlareService();
  const owner = await service.registerUser({
    email: "runtime-stale@example.com",
    name: "Runtime Stale"
  });
  const instance = await service.createInstance(owner.token, {
    name: "runtime-stale",
    description: "Runtime stale instance",
    image: "registry.cloudflare.com/example/runtime-stale:1.0.0"
  });

  const created = await service.createSession(owner.token, {
    name: "runtime-stale-session",
    instanceId: instance.instance.id
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
