#!/usr/bin/env node
// @ts-check

async function runPostinstall() {
  try {
    await import(new URL("./dist/postinstall.js", import.meta.url).href);
    return;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
  }

  // src is TypeScript — run via tsx (available in workspace devDependencies)
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const srcPath = fileURLToPath(new URL("./src/postinstall.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", srcPath], {
    stdio: "inherit",
    cwd: fileURLToPath(new URL(".", import.meta.url))
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

await runPostinstall();
