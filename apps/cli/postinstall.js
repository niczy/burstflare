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

  await import(new URL("./src/postinstall.js", import.meta.url).href);
}

await runPostinstall();
