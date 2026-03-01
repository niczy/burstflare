import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
let activeChild = null;

function spawnCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options
  });
  return child;
}

function stopChild(signal = "SIGTERM") {
  if (activeChild && !activeChild.killed) {
    activeChild.kill(signal);
  }
}

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

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopChild(signal);
    process.exit(0);
  });
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  stopChild("SIGTERM");
  process.exit(1);
});
