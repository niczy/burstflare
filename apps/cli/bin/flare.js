#!/usr/bin/env node
// @ts-check

async function loadRunCli() {
  try {
    const module = await import(new URL("../dist/cli.js", import.meta.url).href);
    return module.runCli;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
  }

  const module = await import(new URL("../src/cli.js", import.meta.url).href);
  return module.runCli;
}

const runCli = await loadRunCli();
const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
