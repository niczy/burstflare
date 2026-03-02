import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
const children = new Set<ChildProcess>();
let shuttingDown = false;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function spawnCommand(args: string[], options: SpawnOptions = {}): ChildProcess {
  const child = spawn(npmCommand, args, {
    stdio: "inherit",
    env: process.env,
    ...options
  });
  children.add(child);
  child.on("exit", () => {
    children.delete(child);
  });
  return child;
}

function terminateChildren(signal: NodeJS.Signals = "SIGTERM"): void {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

function wireLifecycle(child: ChildProcess, label: string): void {
  child.on("error", (error: unknown) => {
    process.stderr.write(`[${label}] ${getErrorMessage(error)}\n`);
    if (!shuttingDown) {
      shuttingDown = true;
      terminateChildren("SIGTERM");
      process.exit(1);
    }
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    terminateChildren("SIGTERM");
    if (signal) {
      process.stderr.write(`[${label}] exited due to ${signal}\n`);
      process.exit(1);
      return;
    }
    process.exit(code ?? 0);
  });
}

async function main(): Promise<void> {
  process.stdout.write("Starting BurstFlare UI mode\n");
  process.stdout.write("UI:  http://127.0.0.1:3000 (hot reload)\n");
  process.stdout.write("API: http://127.0.0.1:8787\n");

  const edge = spawnCommand(["run", "dev:edge"]);
  const web = spawnCommand(["run", "dev:web"]);

  wireLifecycle(edge, "edge");
  wireLifecycle(web, "web");
}

for (const signal of shutdownSignals) {
  process.on(signal, () => {
    shuttingDown = true;
    terminateChildren(signal);
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`${getErrorMessage(error)}\n`);
  shuttingDown = true;
  terminateChildren("SIGTERM");
  process.exit(1);
});
