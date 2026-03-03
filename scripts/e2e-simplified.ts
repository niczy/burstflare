interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
}

interface HttpRequestError extends Error {
  status?: number;
  body?: unknown;
}

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

function getTurnstileToken(): string | null {
  return getArg("--turnstile-token") || process.env.BURSTFLARE_TURNSTILE_TOKEN || process.env.TURNSTILE_TOKEN || null;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requestJson(baseUrl: string, path: string, options: RequestOptions = {}): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
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
  const response = await fetch(`${baseUrl}${path}`, {
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
  const response = await fetch(`${baseUrl}${path}`, {
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
  const response = await fetch(`${baseUrl}/runtime/sessions/${sessionId}/editor`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      path: filePath,
      content
    })
  });
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

async function main(): Promise<void> {
  const baseUrl = getArg("--base-url") || process.env.BURSTFLARE_BASE_URL || "http://127.0.0.1:8787";
  const turnstileToken = getTurnstileToken();
  const health = await waitForHealthy(baseUrl);
  const runtimeEnabled = Boolean(health.runtime?.containersEnabled);

  if (health.runtime?.turnstileEnabled && !turnstileToken) {
    const homepage = await requestText(baseUrl, "/");
    if (!homepage.includes("BurstFlare") || !homepage.includes("Instances first.")) {
      throw new Error("Frontend shell did not render expected simplified markup");
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          baseUrl,
          limited: true,
          reason: "Turnstile is enabled; pass --turnstile-token for authenticated simplified E2E coverage",
          publicChecks: ["health", "homepage"]
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const email = `e2e-simplified-${Date.now()}@example.com`;
  const register = await requestJson(baseUrl, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      name: "Simplified E2E User",
      ...(turnstileToken ? { turnstileToken } : {})
    })
  });
  const headers = {
    authorization: `Bearer ${register.token}`
  };

  const identity = await requestJson(baseUrl, "/api/auth/me", {
    headers
  });
  assertCondition(identity.user?.email === email, "Authenticated identity did not match the registered user");

  const secondLogin = await requestJson(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      kind: "browser",
      ...(turnstileToken ? { turnstileToken } : {})
    })
  });
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
      name: "e2e-session-a",
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
    assertCondition(snapshotDetail.snapshots?.length === 1, "Expected one latest snapshot after stopping a runtime-backed session");
    assertCondition((snapshotDetail.snapshots[0]?.bytes || 0) > 0, "Latest snapshot did not capture content bytes");
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
      name: "e2e-session-b",
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
    assertCondition(sharedStateHtml.includes("shared-state"), "Session B did not receive shared /home/flare state");
    commonStateChecked = true;

    await saveRuntimeFile(baseUrl, sessionA.session.id, register.token, "/workspace/isolated.txt", "workspace-a-only");
    const isolatedHtml = await readRuntimeEditor(baseUrl, sessionB.session.id, register.token, "/workspace/isolated.txt");
    assertCondition(!isolatedHtml.includes("workspace-a-only"), "/workspace leaked between sessions");
    workspaceIsolationChecked = true;

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
      name: "e2e-session-c",
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
      name: "e2e-session-d",
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
  if (runtimeEnabled) {
    assertCondition((billingUsage.currentStorageBytes || 0) > 0, "Billing usage did not record persisted bytes in runtime mode");
  } else {
    assertCondition(
      Object.prototype.hasOwnProperty.call(billingUsage, "currentStorageBytes"),
      "Billing usage did not include current storage bytes"
    );
  }

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
