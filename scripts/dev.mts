import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
let activeChild: ChildProcess | null = null;

const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function spawnCommand(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options
  });
  return child;
}

function stopChild(signal: NodeJS.Signals = "SIGTERM"): void {
  if (activeChild && !activeChild.killed) {
    activeChild.kill(signal);
  }
}

function runCommand(args: string[]): Promise<void> {
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

async function main(): Promise<void> {
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

main().catch((error: unknown) => {
  process.stderr.write(`${getErrorMessage(error)}\n`);
  stopChild("SIGTERM");
  process.exit(1);
});
