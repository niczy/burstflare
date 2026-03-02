import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(
  command: string,
  args: string[],
  opts?: { captureStdout?: boolean }
): string {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: opts?.captureStdout ? ["inherit", "pipe", "inherit"] : "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return opts?.captureStdout ? result.stdout.toString() : "";
}

function step(label: string, fn: () => void): void {
  process.stdout.write(`\n▸ ${label}\n`);
  fn();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipCi = args.includes("--skip-ci");
  const skipSmoke = args.includes("--skip-smoke");

  const baseUrlArg = args.find((a) => a.startsWith("--base-url="));
  const baseUrl =
    baseUrlArg?.split("=")[1] ||
    process.env.DEPLOY_BASE_URL ||
    "https://burstflare.nicholas-zhaoyu.workers.dev";

  process.stdout.write("━━━ BurstFlare Deploy ━━━\n");

  // 1. CI
  if (!skipCi) {
    step("Running CI (lint → typecheck → build → test)", () => {
      run(npmCommand, ["run", "ci"]);
    });
  } else {
    process.stdout.write("\n▸ Skipping CI (--skip-ci)\n");
  }

  // 2. Schema validation
  step("Validating D1 schema", () => {
    run(npmCommand, ["run", "cf:validate-schema"]);
  });

  // 3. Generate wrangler config
  step("Generating wrangler config", () => {
    const toml = run(
      "npx",
      ["tsx", "scripts/cloudflare-generate-wrangler.mts"],
      { captureStdout: true }
    );
    const outPath = path.join(root, "wrangler.generated.toml");
    writeFileSync(outPath, toml);
    process.stdout.write(`  → wrote ${outPath}\n`);
  });

  // 4. Deploy
  step("Deploying to Cloudflare Workers", () => {
    run("npx", ["wrangler", "deploy", "-c", "wrangler.generated.toml"]);
  });

  // 5. Smoke test
  if (!skipSmoke) {
    step(`Running smoke tests against ${baseUrl}`, () => {
      run("npx", ["tsx", "scripts/smoke.mts", "--base-url", baseUrl]);
    });
  } else {
    process.stdout.write("\n▸ Skipping smoke tests (--skip-smoke)\n");
  }

  process.stdout.write("\n✓ Deploy complete\n");
}

main().catch((error: unknown) => {
  const msg =
    error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`\n✗ Deploy failed: ${msg}\n`);
  process.exit(1);
});
