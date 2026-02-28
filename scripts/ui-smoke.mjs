function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }
  return process.argv[index + 1];
}

async function requestText(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`);
  }
  return text;
}

async function main() {
  const baseUrl = getArg("--base-url") || process.env.BURSTFLARE_BASE_URL || "http://127.0.0.1:8787";

  const html = await requestText(baseUrl, "/");
  const css = await requestText(baseUrl, "/styles.css");
  const appJs = await requestText(baseUrl, "/app.js");

  const requiredHtml = [
    "BurstFlare",
    "Dashboard Pulse",
    "Workspace",
    "Sessions",
    "Snapshots",
    "Terminal"
  ];
  for (const marker of requiredHtml) {
    if (!html.includes(marker)) {
      throw new Error(`Shell HTML is missing ${marker}`);
    }
  }

  const requiredCss = [".hero", ".grid", ".card", ".terminal"];
  for (const marker of requiredCss) {
    if (!css.includes(marker)) {
      throw new Error(`Stylesheet is missing ${marker}`);
    }
  }

  const requiredJs = [
    "renderDashboardPulse",
    "data-editor",
    "openTerminal",
    "logoutAllButton"
  ];
  for (const marker of requiredJs) {
    if (!appJs.includes(marker)) {
      throw new Error(`App bundle is missing ${marker}`);
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl,
        htmlChecked: requiredHtml.length,
        cssChecked: requiredCss.length,
        jsChecked: requiredJs.length
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
