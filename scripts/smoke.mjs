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

  const processed = await requestJson(baseUrl, "/api/template-builds/process", {
    method: "POST",
    headers: authHeaders
  });

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
        processedBuilds: processed.processed,
        activeVersionId: promoted.activeVersion.id,
        sessionState: started.session.state,
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
