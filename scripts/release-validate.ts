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

async function main(): Promise<void> {
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
          reason: "Turnstile is enabled; pass --turnstile-token for authenticated release validation",
          publicChecks: ["health", "homepage"]
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const email = `release-validate-${Date.now()}@example.com`;
  const register = await requestJson(baseUrl, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      name: "Release Validator",
      ...(turnstileToken ? { turnstileToken } : {})
    })
  });
  const headers = {
    authorization: `Bearer ${register.token}`
  };

  const instance = await requestJson(baseUrl, "/api/instances", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `release-validate-${Date.now()}`,
      description: "Release validation instance",
      image: "registry.cloudflare.com/example/release-validate:1.0.0"
    })
  });

  const session = await requestJson(baseUrl, "/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "release-validate-session",
      instanceId: instance.instance.id
    })
  });
  await requestJson(baseUrl, `/api/sessions/${session.session.id}/start`, {
    method: "POST",
    headers
  });
  const snapshot = await requestJson(baseUrl, `/api/sessions/${session.session.id}/snapshots`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      label: "validation"
    })
  });

  const rollbackResponse = await fetch(`${baseUrl}/api/templates/${instance.instance.id}/rollback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify({})
  });
  if (rollbackResponse.status !== 404) {
    throw new Error(`Expected template rollback route to be removed (status=${rollbackResponse.status})`);
  }
  const releasesResponse = await fetch(`${baseUrl}/api/releases`, {
    headers
  });
  if (releasesResponse.status !== 404) {
    throw new Error(`Expected releases route to be removed (status=${releasesResponse.status})`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl,
        email,
        instanceId: instance.instance.id,
        sessionId: session.session.id,
        snapshotId: snapshot.snapshot.id,
        rollbackRouteRemoved: true,
        releasesRouteRemoved: true
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
