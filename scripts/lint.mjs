// @ts-check

import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const TARGETS = ["apps", "packages", "scripts", "test"];
const extensions = new Set([".js", ".mjs"]);

/**
 * @param {string} dir
 * @param {string[]} [files]
 */
async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
      continue;
    }
    if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = [];
for (const target of TARGETS) {
  await walk(path.join(ROOT, target), files);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write(`linted ${files.length} files\n`);
