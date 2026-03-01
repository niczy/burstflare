import { spawn } from "node:child_process";

const frontendOrigin = process.env.BURSTFLARE_FRONTEND_ORIGIN || "http://127.0.0.1:3000";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();

function spawnCommand(command, args, options = {}) {
  const child = spawn(command, args, {
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

function stopChildren(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

async function waitForFrontend(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error(`Frontend did not become ready at ${url}`);
}

async function main() {
  const frontend = spawnCommand(npmCommand, ["run", "dev:web"], {
    detached: false
  });

  frontend.on("exit", (code, signal) => {
    if (children.size > 0) {
      stopChildren(signal || "SIGTERM");
    }
    process.exit(code ?? 0);
  });

  await waitForFrontend(frontendOrigin);

  const edge = spawnCommand(npmCommand, ["run", "dev:edge"], {
    env: {
      ...process.env,
      BURSTFLARE_FRONTEND_ORIGIN: frontendOrigin
    }
  });

  edge.on("exit", (code, signal) => {
    stopChildren(signal || "SIGTERM");
    process.exit(code ?? 0);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopChildren(signal);
    process.exit(0);
  });
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  stopChildren("SIGTERM");
  process.exit(1);
});
