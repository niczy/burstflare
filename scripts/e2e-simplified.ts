interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal;
}

interface HttpRequestError extends Error {
  status?: number;
  body?: unknown;
}

const REQUEST_TIMEOUT_MS = 30_000;

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }
  return process.argv[index + 1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchWithTimeout(url: string, label: string, options: RequestOptions = {}): Promise<Response> {
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requestJson(baseUrl: string, path: string, options: RequestOptions = {}): Promise<any> {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, `${options.method || "GET"} ${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `${options.method || "GET"} ${path} failed`) as HttpRequestError;
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

async function requestText(baseUrl: string, path: string, options: RequestOptions = {}): Promise<string> {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, `${options.method || "GET"} ${path}`, {
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${options.method || "GET"} ${path} failed`) as HttpRequestError;
    error.status = response.status;
    error.body = text;
    throw error;
  }
  return text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requestJsonAllowError(baseUrl: string, path: string, options: RequestOptions = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, `${options.method || "GET"} ${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function waitForHealthy(baseUrl: string): Promise<any> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const health = await requestJson(baseUrl, "/api/health");
      if (health.ok) {
        return health;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError || new Error("Health check did not become ready");
}

async function saveRuntimeFile(baseUrl: string, sessionId: string, token: string, filePath: string, content: string): Promise<void> {
  const response = await fetchWithTimeout(
    `${baseUrl}/runtime/sessions/${sessionId}/editor`,
    `POST /runtime/sessions/${sessionId}/editor`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        path: filePath,
        content
      })
    }
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Saving ${filePath} failed (${response.status}): ${body}`);
  }
}

async function readRuntimeEditor(baseUrl: string, sessionId: string, token: string, filePath: string): Promise<string> {
  return requestText(
    baseUrl,
    `/runtime/sessions/${sessionId}/editor?path=${encodeURIComponent(filePath)}`,
    {
      headers: {
        authorization: `Bearer ${token}`
      }
    }
  );
}

async function stopIfRunning(baseUrl: string, sessionId: string, token: string): Promise<void> {
  const detail = await requestJsonAllowError(baseUrl, `/api/sessions/${sessionId}`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  if (!detail.ok) {
    return;
  }
  if (detail.data.session?.state === "running") {
    const stopped = await requestJsonAllowError(baseUrl, `/api/sessions/${sessionId}/stop`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    if (!stopped.ok && stopped.status !== 409) {
      throw new Error(`Stopping session ${sessionId} failed (${stopped.status})`);
    }
  }
}

async function deleteIfPresent(baseUrl: string, path: string, token: string): Promise<void> {
  const result = await requestJsonAllowError(baseUrl, path, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  if (!result.ok && result.status !== 404) {
    throw new Error(`Deleting ${path} failed (${result.status})`);
  }
}

async function waitForLatestSnapshot(baseUrl: string, sessionId: string, headers: HeadersInit): Promise<any> {
  let lastDetail = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    lastDetail = await requestJson(baseUrl, `/api/sessions/${sessionId}`, {
      headers
    });
    if (lastDetail.snapshots?.length === 1 && (lastDetail.snapshots[0]?.bytes || 0) > 0) {
      return lastDetail;
    }
    await sleep(500);
  }
  return lastDetail;
}

async function signInWithEmailCode(baseUrl: string, email: string, name: string): Promise<any> {
  const delivery = await requestJson(baseUrl, "/api/auth/email-code/request", {
    method: "POST",
    body: JSON.stringify({
      email,
      name,
      kind: "browser"
    })
  });
  if (!delivery.code) {
    throw new Error(`Email code was not exposed for ${email}`);
  }
  return requestJson(baseUrl, "/api/auth/email-code/verify", {
    method: "POST",
    body: JSON.stringify({
      email,
      code: delivery.code
    })
  });
}

function isManagedSmokeEmail(email: string): boolean {
  const normalized = String(email || "").trim().toLowerCase();
  const [localPart, domain] = normalized.split("@");
  return domain === "burstflare.dev" && (localPart === "smoke_test" || localPart.startsWith("smoke_test+"));
}

async function main(): Promise<void> {
  const baseUrl = getArg("--base-url") || process.env.BURSTFLARE_BASE_URL || "http://127.0.0.1:8787";
  const health = await waitForHealthy(baseUrl);
  const runtimeEnabled = Boolean(health.runtime?.containersEnabled);
  const homepage = await requestText(baseUrl, "/");
  if (!homepage.includes("BurstFlare") || !homepage.includes('rel="modulepreload"')) {
    throw new Error("Frontend shell did not render expected simplified SSR markup");
  }

  const email =
    getArg("--email") ||
    process.env.BURSTFLARE_SMOKE_EMAIL ||
    `smoke_test+e2e-${Date.now()}@burstflare.dev`;
  const runId = Date.now().toString(36);
  const register = await signInWithEmailCode(baseUrl, email, "Simplified E2E User");
  const headers = {
    authorization: `Bearer ${register.token}`
  };

  if (isManagedSmokeEmail(email)) {
    const existingSessions = await requestJson(baseUrl, "/api/sessions", {
      headers
    });
    for (const entry of existingSessions.sessions || []) {
      await stopIfRunning(baseUrl, entry.id, register.token);
      await deleteIfPresent(baseUrl, `/api/sessions/${entry.id}`, register.token);
    }
    const existingInstances = await requestJson(baseUrl, "/api/instances", {
      headers
    });
    for (const entry of existingInstances.instances || []) {
      await deleteIfPresent(baseUrl, `/api/instances/${entry.id}`, register.token);
    }
  }

  const identity = await requestJson(baseUrl, "/api/auth/me", {
    headers
  });
  assertCondition(identity.user?.email === email, "Authenticated identity did not match the registered user");

  const secondLogin = await signInWithEmailCode(baseUrl, email, "Simplified E2E User");
  assertCondition(secondLogin.authSessionId, "Second login did not return an auth session id");

  const authSessions = await requestJson(baseUrl, "/api/auth/sessions", {
    headers
  });
  assertCondition(authSessions.sessions.length >= 2, "Expected at least two auth sessions after second login");

  const revoked = await requestJson(baseUrl, `/api/auth/sessions/${secondLogin.authSessionId}`, {
    method: "DELETE",
    headers
  });
  assertCondition((revoked.revokedTokens || 0) >= 1, "Second auth session was not revoked");

  const imageInstance = await requestJson(baseUrl, "/api/instances", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `e2e-image-${Date.now()}`,
      description: "Primary simplified E2E instance",
      image: "node:20",
      persistedPaths: ["/workspace", "/home/flare"],
      sleepTtlSeconds: 30,
      envVars: { NODE_ENV: "test" },
      secrets: { API_KEY: "abc" }
    })
  });
  const imageInstanceId = imageInstance.instance.id;

  const dockerInstance = await requestJson(baseUrl, "/api/instances", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `e2e-docker-${Date.now()}`,
      description: "Docker metadata E2E instance",
      image: "registry.cloudflare.com/example/e2e-docker:1.0.0",
      dockerfilePath: "./containers/session/Dockerfile",
      dockerContext: "./containers/session"
    })
  });
  assertCondition(dockerInstance.instance.dockerfilePath === "./containers/session/Dockerfile", "Docker-backed instance did not persist dockerfile metadata");

  const listedInstances = await requestJson(baseUrl, "/api/instances", {
    headers
  });
  assertCondition(
    listedInstances.instances.some((entry: { id: string }) => entry.id === imageInstanceId),
    "Primary instance was not returned by the instance list"
  );

  const imageInstanceDetail = await requestJson(baseUrl, `/api/instances/${imageInstanceId}`, {
    headers
  });
  assertCondition(imageInstanceDetail.instance.secretCount === 1, "Instance detail did not report the saved secret");

  const sessionA = await requestJson(baseUrl, "/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `e2e-session-a-${runId}`,
      instanceId: imageInstanceId
    })
  });

  const startedA = await requestJson(baseUrl, `/api/sessions/${sessionA.session.id}/start`, {
    method: "POST",
    headers
  });
  assertCondition(startedA.session.state === "running", "Session A did not start");

  let previewChecked = false;
  let editorChecked = false;
  let commonStateChecked = false;
  let workspaceIsolationChecked = false;
  let autoSnapshotCaptured = false;

  if (runtimeEnabled) {
    const previewHtml = await requestText(baseUrl, `/runtime/sessions/${sessionA.session.id}/preview`, {
      headers
    });
    assertCondition(previewHtml.includes(sessionA.session.id), "Preview HTML did not include the session id");
    previewChecked = true;

    const editorHtml = await readRuntimeEditor(baseUrl, sessionA.session.id, register.token, "/home/flare/.myconfig");
    assertCondition(editorHtml.includes("Workspace Editor"), "Editor HTML did not render");
    editorChecked = true;
  }

  const stoppedA = await requestJson(baseUrl, `/api/sessions/${sessionA.session.id}/stop`, {
    method: "POST",
    headers
  });
  assertCondition(stoppedA.session.state === "sleeping", "Session A did not stop");

  let snapshotDetail = await requestJson(baseUrl, `/api/sessions/${sessionA.session.id}`, {
    headers
  });
  if (runtimeEnabled) {
    snapshotDetail = await waitForLatestSnapshot(baseUrl, sessionA.session.id, headers);
    autoSnapshotCaptured = Boolean(snapshotDetail?.snapshots?.length === 1 && (snapshotDetail.snapshots[0]?.bytes || 0) > 0);
    if (!autoSnapshotCaptured) {
      const fallbackSnapshot = await requestJson(baseUrl, `/api/sessions/${sessionA.session.id}/snapshots`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          label: "manual-e2e-fallback"
        })
      });
      assertCondition(fallbackSnapshot.snapshot?.id, "Manual snapshot fallback failed after stop");
      const uploadedFallback = await fetchWithTimeout(
        `${baseUrl}/api/sessions/${sessionA.session.id}/snapshots/${fallbackSnapshot.snapshot.id}/content`,
        `PUT /api/sessions/${sessionA.session.id}/snapshots/${fallbackSnapshot.snapshot.id}/content`,
        {
          method: "PUT",
          headers: {
            authorization: String(headers.authorization || ""),
            "content-type": "text/plain; charset=utf-8"
          },
          body: "manual snapshot fallback"
        }
      );
      if (!uploadedFallback.ok) {
        throw new Error(`Manual snapshot fallback upload failed (${uploadedFallback.status})`);
      }
      snapshotDetail = await requestJson(baseUrl, `/api/sessions/${sessionA.session.id}`, {
        headers
      });
    }
    assertCondition(snapshotDetail.snapshots?.length === 1, "Expected one latest snapshot after stopping a runtime-backed session");
  } else {
    const createdSnapshot = await requestJson(baseUrl, `/api/sessions/${sessionA.session.id}/snapshots`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        label: "manual-e2e"
      })
    });
    assertCondition(createdSnapshot.snapshot?.id, "Manual snapshot creation failed in local mode");
    snapshotDetail = await requestJson(baseUrl, `/api/sessions/${sessionA.session.id}`, {
      headers
    });
    assertCondition(snapshotDetail.snapshots?.length === 1, "Expected one latest snapshot after manual save");
  }

  const restartedStartA = await requestJson(baseUrl, `/api/sessions/${sessionA.session.id}/start`, {
    method: "POST",
    headers
  });
  assertCondition(restartedStartA.session.state === "running", "Session A did not restart from sleeping");

  const restartedA = await requestJson(baseUrl, `/api/sessions/${sessionA.session.id}/restart`, {
    method: "POST",
    headers
  });
  assertCondition(restartedA.session.state === "running", "Session A did not restart");

  const sessionB = await requestJson(baseUrl, "/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `e2e-session-b-${runId}`,
      instanceId: imageInstanceId
    })
  });
  await requestJson(baseUrl, `/api/sessions/${sessionB.session.id}/start`, {
    method: "POST",
    headers
  });

  if (runtimeEnabled) {
    await saveRuntimeFile(baseUrl, sessionA.session.id, register.token, "/home/flare/.myconfig", "shared-state");
    const pushed = await requestJson(baseUrl, `/api/instances/${imageInstanceId}/push`, {
      method: "POST",
      headers
    });
    assertCondition(pushed.commonState?.bytes > 0, "Explicit common-state push did not store bytes");

    const pulled = await requestJson(baseUrl, `/api/instances/${imageInstanceId}/pull`, {
      method: "POST",
      headers
    });
    assertCondition(Array.isArray(pulled.appliedSessions), "Common-state pull did not return applied sessions");

    const sharedStateHtml = await readRuntimeEditor(baseUrl, sessionB.session.id, register.token, "/home/flare/.myconfig");
    commonStateChecked = sharedStateHtml.includes("shared-state");

    await saveRuntimeFile(baseUrl, sessionA.session.id, register.token, "/workspace/isolated.txt", "workspace-a-only");
    const isolatedHtml = await readRuntimeEditor(baseUrl, sessionB.session.id, register.token, "/workspace/isolated.txt");
    workspaceIsolationChecked = !isolatedHtml.includes("workspace-a-only");

    await requestJson(baseUrl, `/api/sessions/${sessionB.session.id}/stop`, {
      method: "POST",
      headers
    });
    await requestJson(baseUrl, `/api/sessions/${sessionB.session.id}/start`, {
      method: "POST",
      headers
    });
  }

  const sessionC = await requestJson(baseUrl, "/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `e2e-session-c-${runId}`,
      instanceId: imageInstanceId
    })
  });
  await requestJson(baseUrl, `/api/sessions/${sessionC.session.id}/start`, {
    method: "POST",
    headers
  });

  const sessionsAfterScale = await requestJson(baseUrl, "/api/sessions", {
    headers
  });
  const runningForInstance = sessionsAfterScale.sessions.filter(
    (entry: { instanceId: string; state: string }) => entry.instanceId === imageInstanceId && entry.state === "running"
  );
  assertCondition(runningForInstance.length >= 3, "Expected three running sessions for the primary instance");

  const updatedImage = "ubuntu:24.04";
  await requestJson(baseUrl, `/api/sessions/${sessionC.session.id}/stop`, {
    method: "POST",
    headers
  });
  const editedInstance = await requestJson(baseUrl, `/api/instances/${imageInstanceId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      image: updatedImage
    })
  });
  assertCondition(editedInstance.instance.image === updatedImage, "Instance edit did not persist the new image");

  const sessionD = await requestJson(baseUrl, "/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `e2e-session-d-${runId}`,
      instanceId: imageInstanceId
    })
  });
  const startedD = await requestJson(baseUrl, `/api/sessions/${sessionD.session.id}/start`, {
    method: "POST",
    headers
  });
  assertCondition(startedD.session.state === "running", "Session D did not start after the instance edit");

  const usage = await requestJson(baseUrl, "/api/usage", {
    headers
  });
  const usageSummary = usage.usage || usage;
  assertCondition((usageSummary.runtimeMinutes || 0) > 0, "Usage did not record runtime minutes");
  if (Object.prototype.hasOwnProperty.call(usageSummary, "templateBuilds")) {
    assertCondition(usageSummary.templateBuilds === 0, "Usage still reports legacy template builds");
  }

  const billing = await requestJson(baseUrl, "/api/workspaces/current/billing", {
    headers
  });
  const billingUsage = billing.usage || {};
  assertCondition(
    Object.prototype.hasOwnProperty.call(billingUsage, "currentStorageBytes"),
    "Billing usage did not include current storage bytes"
  );

  const sessionIds = [sessionA.session.id, sessionB.session.id, sessionC.session.id, sessionD.session.id];
  for (const sessionId of sessionIds) {
    await stopIfRunning(baseUrl, sessionId, register.token);
    await deleteIfPresent(baseUrl, `/api/sessions/${sessionId}`, register.token);
  }

  await deleteIfPresent(baseUrl, `/api/instances/${dockerInstance.instance.id}`, register.token);
  await deleteIfPresent(baseUrl, `/api/instances/${imageInstanceId}`, register.token);

  const cleanedInstances = await requestJson(baseUrl, "/api/instances", {
    headers
  });
  assertCondition(cleanedInstances.instances.length === 0, "Cleanup did not remove all instances");

  const logoutAll = await requestJson(baseUrl, "/api/auth/logout-all", {
    method: "POST",
    headers
  });
  assertCondition((logoutAll.revokedTokens || 0) >= 1, "Logout-all did not revoke any auth sessions");

  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl,
        email,
        runtimeEnabled,
        authSessionsSeen: authSessions.sessions.length,
        imageInstanceId,
        dockerInstanceId: dockerInstance.instance.id,
        sessionsCreated: sessionIds.length,
        previewChecked,
        editorChecked,
        autoSnapshotCaptured,
        commonStateChecked,
        workspaceIsolationChecked,
        runtimeMinutes: usageSummary.runtimeMinutes || 0,
        currentStorageBytes: billingUsage.currentStorageBytes || 0,
        cleanedInstances: cleanedInstances.instances.length
      },
      null,
      2
    )}\n`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
