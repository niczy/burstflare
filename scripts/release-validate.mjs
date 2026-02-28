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
      return build;
    }
    if (build?.status === "failed" || build?.status === "dead_lettered") {
      throw new Error(`Build ${buildId} ended in ${build.status}`);
    }
    if (attempt === 4) {
      await requestJson(baseUrl, "/api/template-builds/process", {
        method: "POST",
        headers
      });
    }
    await sleep(250);
  }
  const build = await getBuildById(baseUrl, headers, buildId);
  throw new Error(`Build ${buildId} did not become ready (last status: ${build?.status || "missing"})`);
}

async function main() {
  const baseUrl = getArg("--base-url") || process.env.BURSTFLARE_BASE_URL || "http://127.0.0.1:8787";
  await waitForHealthy(baseUrl);

  const email = `release-validate-${Date.now()}@example.com`;
  const register = await requestJson(baseUrl, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      name: "Release Validator"
    })
  });
  const headers = {
    authorization: `Bearer ${register.token}`
  };

  const template = await requestJson(baseUrl, "/api/templates", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `release-validate-${Date.now()}`,
      description: "Release validation template"
    })
  });

  const versionOne = await requestJson(baseUrl, `/api/templates/${template.template.id}/versions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      version: "1.0.0",
      manifest: {
        image: "registry.cloudflare.com/example/release-validate:1.0.0"
      }
    })
  });
  const versionTwo = await requestJson(baseUrl, `/api/templates/${template.template.id}/versions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      version: "2.0.0",
      manifest: {
        image: "registry.cloudflare.com/example/release-validate:2.0.0"
      }
    })
  });

  await waitForBuildReady(baseUrl, headers, versionOne.build.id);
  await waitForBuildReady(baseUrl, headers, versionTwo.build.id);

  const firstPromotion = await requestJson(baseUrl, `/api/templates/${template.template.id}/promote`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      versionId: versionOne.templateVersion.id
    })
  });
  const secondPromotion = await requestJson(baseUrl, `/api/templates/${template.template.id}/promote`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      versionId: versionTwo.templateVersion.id
    })
  });
  const rolledBack = await requestJson(baseUrl, `/api/templates/${template.template.id}/rollback`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  const releases = await requestJson(baseUrl, "/api/releases", {
    headers
  });

  const templateReleases = releases.releases.filter((entry) => entry.templateId === template.template.id);
  if (rolledBack.activeVersion.id !== versionOne.templateVersion.id) {
    throw new Error("Rollback did not restore the first version");
  }
  if (templateReleases.length !== 3) {
    throw new Error(`Expected 3 releases for validation template, got ${templateReleases.length}`);
  }
  const latestRelease = templateReleases.at(-1);
  if (latestRelease.mode !== "rollback") {
    throw new Error("Latest release is not marked as a rollback");
  }
  if (latestRelease.sourceReleaseId !== firstPromotion.release.id) {
    throw new Error("Rollback provenance does not point to the first release");
  }
  if (latestRelease.templateVersionId !== versionOne.templateVersion.id) {
    throw new Error("Rollback release does not target the first version");
  }
  if (!latestRelease.binding?.artifactDigest) {
    throw new Error("Rollback release is missing its binding artifact digest");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl,
        email,
        templateId: template.template.id,
        firstReleaseId: firstPromotion.release.id,
        secondReleaseId: secondPromotion.release.id,
        rollbackReleaseId: latestRelease.id,
        rollbackSourceReleaseId: latestRelease.sourceReleaseId,
        activeVersionId: rolledBack.activeVersion.id,
        artifactDigest: latestRelease.binding.artifactDigest
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
