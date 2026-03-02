import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

async function resetDir(target: string): Promise<void> {
  await rm(target, { force: true, recursive: true });
  await mkdir(target, { recursive: true });
}

function runNpmCommand(args: string[]): void {
  const result = spawnSync(npmCommand, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main(): Promise<void> {
  const webDist = path.join(root, "apps", "web", "dist");
  const edgeDist = path.join(root, "apps", "edge", "dist");
  const cliDist = path.join(root, "apps", "cli", "dist");
  const sharedDist = path.join(root, "packages", "shared", "dist");
  await Promise.all([resetDir(webDist), resetDir(edgeDist), resetDir(cliDist), resetDir(sharedDist)]);

  const manifest = {
    builtAt: new Date().toISOString(),
    packages: ["apps/web", "apps/edge", "apps/cli", "packages/shared"]
  };

  await Promise.all([
    writeFile(path.join(webDist, "manifest.json"), JSON.stringify(manifest, null, 2)),
    writeFile(path.join(edgeDist, "manifest.json"), JSON.stringify(manifest, null, 2)),
    writeFile(path.join(cliDist, "manifest.json"), JSON.stringify(manifest, null, 2))
  ]);

  runNpmCommand(["run", "build", "--workspace", "@burstflare/shared"]);

  process.stdout.write("build complete\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${getErrorMessage(error)}\n`);
  process.exit(1);
});
