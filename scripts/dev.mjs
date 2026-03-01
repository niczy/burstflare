// @ts-check

import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
/** @type {import("node:child_process").ChildProcess | null} */
let activeChild = null;

/** @type {NodeJS.Signals[]} */
const shutdownSignals = ["SIGINT", "SIGTERM"];

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptions} [options]
 */
function spawnCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options
  });
  return child;
}

/**
 * @param {NodeJS.Signals} [signal]
 */
function stopChild(signal = "SIGTERM") {
  if (activeChild && !activeChild.killed) {
    activeChild.kill(signal);
  }
}

/**
 * @param {string[]} args
 */
function runCommand(args) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(npmCommand, args);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${args.join(" ")} exited from signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${args.join(" ")} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  await runCommand(["run", "build:web"]);

  activeChild = spawnCommand(npmCommand, ["run", "dev:edge"]);
  activeChild.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

for (const signal of shutdownSignals) {
  process.on(signal, () => {
    stopChild(signal);
    process.exit(0);
  });
}

main().catch((error) => {
  const typedError = /** @type {Error} */ (error);
  process.stderr.write(`${typedError.stack || typedError.message}\n`);
  stopChild("SIGTERM");
  process.exit(1);
});
