// @ts-check

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function resetDir(target) {
  await rm(target, { force: true, recursive: true });
  await mkdir(target, { recursive: true });
}

async function main() {
  const webDist = path.join(root, "apps", "web", "dist");
  const edgeDist = path.join(root, "apps", "edge", "dist");
  const cliDist = path.join(root, "apps", "cli", "dist");
  await Promise.all([resetDir(webDist), resetDir(edgeDist), resetDir(cliDist)]);

  const manifest = {
    builtAt: new Date().toISOString(),
    packages: ["apps/web", "apps/edge", "apps/cli", "packages/shared"]
  };

  await Promise.all([
    writeFile(path.join(webDist, "manifest.json"), JSON.stringify(manifest, null, 2)),
    writeFile(path.join(edgeDist, "manifest.json"), JSON.stringify(manifest, null, 2)),
    writeFile(path.join(cliDist, "manifest.json"), JSON.stringify(manifest, null, 2))
  ]);

  process.stdout.write("build complete\n");
}

main().catch((error) => {
  const typedError = /** @type {Error} */ (error);
  process.stderr.write(`${typedError.stack || typedError.message}\n`);
  process.exit(1);
});
