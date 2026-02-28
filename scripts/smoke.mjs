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
  await waitForHealthy(baseUrl);

  const email = `smoke-${Date.now()}@example.com`;
  const register = await requestJson(baseUrl, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      name: "Smoke User"
    })
  });

  const authHeaders = {
    authorization: `Bearer ${register.token}`
  };

  const secondLogin = await requestJson(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      kind: "browser"
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

  const promoted = await requestJson(baseUrl, `/api/templates/${template.template.id}/promote`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      versionId: version.templateVersion.id
    })
  });

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
        processedBuilds: buildResult.processed,
        activeVersionId: promoted.activeVersion.id,
        sessionState: started.session.state,
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
