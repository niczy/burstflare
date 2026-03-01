function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }
  return process.argv[index + 1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTurnstileToken() {
  return getArg("--turnstile-token") || process.env.BURSTFLARE_TURNSTILE_TOKEN || process.env.TURNSTILE_TOKEN || null;
}

const TEST_SSH_PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGJ1cnN0ZmxhcmV0ZXN0a2V5bWF0ZXJpYWw= flare-smoke";

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `${options.method || "GET"} ${path} failed`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

async function requestText(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${options.method || "GET"} ${path} failed`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  return text;
}

async function waitForHealthy(baseUrl) {
  let lastError = null;
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

async function getBuildById(baseUrl, headers, buildId) {
  const payload = await requestJson(baseUrl, "/api/template-builds", {
    headers
  });
  return payload.builds.find((entry) => entry.id === buildId) || null;
}

async function waitForBuildReady(baseUrl, headers, buildId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const build = await getBuildById(baseUrl, headers, buildId);
    if (build?.status === "succeeded") {
      return {
        build,
        processed: 0
      };
    }
    if (build?.status === "dead_lettered" || build?.status === "failed") {
      throw new Error(`Build ${buildId} ended in ${build.status}`);
    }
    if (attempt === 4) {
      const processed = await requestJson(baseUrl, "/api/template-builds/process", {
        method: "POST",
        headers
      });
      if (processed.processed > 0) {
        const retriedBuild = await getBuildById(baseUrl, headers, buildId);
        if (retriedBuild?.status === "succeeded") {
          return {
            build: retriedBuild,
            processed: processed.processed
          };
        }
      }
    }
    await sleep(250);
  }
  const build = await getBuildById(baseUrl, headers, buildId);
  throw new Error(`Build ${buildId} did not become ready (last status: ${build?.status || "missing"})`);
}

async function main() {
  const baseUrl = getArg("--base-url") || process.env.BURSTFLARE_BASE_URL || "http://127.0.0.1:8787";
  const turnstileToken = getTurnstileToken();
  const health = await waitForHealthy(baseUrl);

  if (health.runtime?.turnstileEnabled && !turnstileToken) {
    const homepage = await requestText(baseUrl, "/");
    if (!homepage.includes("BurstFlare") || !homepage.includes('type="module"')) {
      throw new Error("Frontend shell did not render expected vinext markup");
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          baseUrl,
          limited: true,
          reason: "Turnstile is enabled; pass --turnstile-token for authenticated smoke coverage",
          publicChecks: ["health", "homepage"]
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const email = `smoke-${Date.now()}@example.com`;
  const register = await requestJson(baseUrl, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      name: "Smoke User",
      ...(turnstileToken ? { turnstileToken } : {})
    })
  });

  const authHeaders = {
    authorization: `Bearer ${register.token}`
  };

  const secondLogin = await requestJson(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      kind: "browser",
      ...(turnstileToken ? { turnstileToken } : {})
    })
  });
  const secondHeaders = {
    authorization: `Bearer ${secondLogin.token}`
  };

  const authSessions = await requestJson(baseUrl, "/api/auth/sessions", {
    headers: secondHeaders
  });

  const template = await requestJson(baseUrl, "/api/templates", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: `smoke-template-${Date.now()}`,
      description: "Smoke test template"
    })
  });

  const version = await requestJson(baseUrl, `/api/templates/${template.template.id}/versions`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      version: "1.0.0",
      manifest: {
        image: "registry.cloudflare.com/example/smoke:1.0.0"
      }
    })
  });

  const buildResult = await waitForBuildReady(baseUrl, authHeaders, version.build.id);
  const buildArtifact = await requestJson(baseUrl, `/api/template-builds/${version.build.id}/artifact`, {
    headers: authHeaders
  });
  if (!buildArtifact.imageReference || !buildArtifact.imageDigest) {
    throw new Error("Build artifact did not include OCI-style image metadata");
  }

  const promoted = await requestJson(baseUrl, `/api/templates/${template.template.id}/promote`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      versionId: version.templateVersion.id
    })
  });
  if (promoted.release?.binding?.imageReference !== buildArtifact.imageReference) {
    throw new Error("Release binding imageReference did not match the build artifact");
  }

  const session = await requestJson(baseUrl, "/api/sessions", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: "smoke-session",
      templateId: template.template.id
    })
  });

  const started = await requestJson(baseUrl, `/api/sessions/${session.session.id}/start`, {
    method: "POST",
    headers: authHeaders
  });
  if (started.session.state !== "running") {
    throw new Error(`Session did not start correctly (state=${started.session.state})`);
  }
  if (started.runtime && started.runtime.status !== "running") {
    throw new Error(`Runtime did not start correctly (status=${started.runtime.status})`);
  }
  const syncedSshKey = await requestJson(baseUrl, `/api/sessions/${session.session.id}/ssh-key`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      keyId: "smoke:ssh",
      label: "Smoke SSH",
      publicKey: TEST_SSH_PUBLIC_KEY
    })
  });
  if (syncedSshKey.sshKeyCount < 1) {
    throw new Error("Session SSH key sync did not register a usable key");
  }
  const sshToken = await requestJson(baseUrl, `/api/sessions/${session.session.id}/ssh-token`, {
    method: "POST",
    headers: authHeaders
  });
  if (!sshToken.token || sshToken.sshUser !== "dev") {
    throw new Error("SSH attach details did not include a runtime token and SSH user");
  }

  let previewChecked = false;
  let editorChecked = false;
  if (health.runtime?.containersEnabled) {
    const previewResponse = await fetch(`${baseUrl}/runtime/sessions/${session.session.id}/preview`, {
      headers: authHeaders
    });
    if (!previewResponse.ok) {
      throw new Error(`Preview route failed (${previewResponse.status})`);
    }
    const previewHtml = await previewResponse.text();
    if (!previewHtml.includes(session.session.id)) {
      throw new Error("Preview HTML did not contain the session id");
    }
    previewChecked = true;

    const editorResponse = await fetch(
      `${baseUrl}/runtime/sessions/${session.session.id}/editor?path=${encodeURIComponent("/workspace/notes.txt")}`,
      {
        headers: authHeaders
      }
    );
    if (!editorResponse.ok) {
      throw new Error(`Editor route failed (${editorResponse.status})`);
    }
    const editorHtml = await editorResponse.text();
    if (!editorHtml.includes("Workspace Editor")) {
      throw new Error("Editor HTML did not render");
    }
    editorChecked = true;
  }

  const listed = await requestJson(baseUrl, "/api/sessions", {
    headers: authHeaders
  });
  const listedSession = listed.sessions.find((entry) => entry.id === session.session.id);
  if (!listedSession) {
    throw new Error("Started session was not returned by the session list");
  }
  if (listedSession.runtime && listedSession.runtime.status !== "running") {
    throw new Error(`Listed runtime did not report running (status=${listedSession.runtime.status})`);
  }

  const stopped = await requestJson(baseUrl, `/api/sessions/${session.session.id}/stop`, {
    method: "POST",
    headers: authHeaders
  });
  if (stopped.session.state !== "sleeping") {
    throw new Error(`Session did not stop correctly (state=${stopped.session.state})`);
  }
  if (stopped.runtime && stopped.runtime.status !== "sleeping") {
    throw new Error(`Runtime did not stop correctly (status=${stopped.runtime.status})`);
  }
  if (health.runtime?.containersEnabled && stopped.runtime?.lastLifecyclePhase !== "sleep") {
    throw new Error("Runtime stop did not record the lifecycle phase");
  }

  const restarted = await requestJson(baseUrl, `/api/sessions/${session.session.id}/restart`, {
    method: "POST",
    headers: authHeaders
  });
  if (restarted.session.state !== "running") {
    throw new Error(`Session did not restart correctly (state=${restarted.session.state})`);
  }
  if (restarted.runtime && restarted.runtime.status !== "running") {
    throw new Error(`Runtime did not restart correctly (status=${restarted.runtime.status})`);
  }

  const detail = await requestJson(baseUrl, `/api/sessions/${session.session.id}`, {
    headers: authHeaders
  });
  if (detail.session.state !== "running") {
    throw new Error(`Session detail did not report running (state=${detail.session.state})`);
  }
  if (detail.session.runtime && detail.session.runtime.status !== "running") {
    throw new Error(`Session detail runtime did not report running (status=${detail.session.runtime.status})`);
  }
  if (health.runtime?.containersEnabled && !detail.session.runtime?.lastBootstrapAt) {
    throw new Error("Session detail runtime did not expose bootstrap analytics");
  }

  const snapshot = await requestJson(baseUrl, `/api/sessions/${session.session.id}/snapshots`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      label: "smoke"
    })
  });

  const report = await requestJson(baseUrl, "/api/admin/report", {
    headers: authHeaders
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl,
        email,
        authSessions: authSessions.sessions.length,
        buildStatus: buildResult.build.status,
        buildImageReference: buildArtifact.imageReference,
        processedBuilds: buildResult.processed,
        activeVersionId: promoted.activeVersion.id,
        sessionState: started.session.state,
        sshCommand: sshToken.sshCommand,
        previewChecked,
        editorChecked,
        stoppedState: stopped.session.state,
        restartedState: restarted.session.state,
        detailState: detail.session.state,
        snapshotId: snapshot.snapshot.id,
        templates: report.report.templates,
        sessionsTotal: report.report.sessionsTotal
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
