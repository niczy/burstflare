function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }
  return process.argv[index + 1];
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

async function requestText(baseUrl: string, path: string): Promise<string> {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`);
  }
  return text;
}

async function waitForShell(baseUrl: string): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await requestText(baseUrl, "/");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error("UI shell did not become ready");
}

async function main(): Promise<void> {
  const baseUrl = getArg("--base-url") || process.env.BURSTFLARE_BASE_URL || "http://127.0.0.1:8787";

  const html = await waitForShell(baseUrl);

  const requiredHtml = [
    "BurstFlare",
    "Dashboard Pulse",
    "Workspace",
    "Sessions",
    "Snapshots",
    "Terminal",
    "type=\"module\""
  ];
  for (const marker of requiredHtml) {
    if (!html.includes(marker)) {
      throw new Error(`Shell HTML is missing ${marker}`);
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl,
        htmlChecked: requiredHtml.length
      },
      null,
      2
    )}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${getErrorMessage(error)}\n`);
  process.exit(1);
});
