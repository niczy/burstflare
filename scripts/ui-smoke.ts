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

async function requestText(url: string): Promise<string> {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} failed (${response.status})`);
  }
  return text;
}

async function waitForShell(url: string): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await requestText(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error("UI shell did not become ready");
}

async function main(): Promise<void> {
  const baseUrl = getArg("--base-url") || process.env.BURSTFLARE_BASE_URL || "http://127.0.0.1:8787";

  const pages = [
    {
      path: "/",
      required: ["BurstFlare", "Ship faster with reusable cloud workspaces.", "Try the dashboard", "/docs", "rel=\"modulepreload\""],
      forbidden: ["Template", "Release"]
    },
    {
      path: "/dashboard",
      required: ["Instances", "Sessions", "/home/flare", "Create and start", "rel=\"modulepreload\""],
      forbidden: ["Templates", "Queue build", "Promote version", "Terminal"]
    },
    {
      path: "/login",
      required: ["Send Sign-In Code", "Verify Code", "Work email", "rel=\"modulepreload\""],
      forbidden: ["Register", "Recovery code", "Passkeys", "Device approvals"]
    },
    {
      path: "/profile",
      required: ["Billing", "Browser sessions", "Add payment method", "rel=\"modulepreload\""],
      forbidden: ["Members &amp; invites", "Approve device"]
    },
    {
      path: "/docs",
      required: ["Instances", "Sessions", "Snapshots", "Common state"],
      forbidden: ["Templates", "Builds", "Releases"]
    }
  ];

  for (const page of pages) {
    const url = new URL(page.path, `${baseUrl}/`).toString();
    const html = await waitForShell(url);
    for (const marker of page.required) {
      if (!html.includes(marker)) {
        throw new Error(`${page.path} is missing ${marker}`);
      }
    }
    for (const marker of page.forbidden) {
      if (html.includes(marker)) {
        throw new Error(`${page.path} still contains removed UI text: ${marker}`);
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl,
        pagesChecked: pages.length
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
