import { accessSync, constants } from "node:fs";
import path from "node:path";

export const SSH_RUNTIME_DEPENDENCIES = ["ssh", "wstunnel"];

function commandCandidates(command, platform, env) {
  if (platform !== "win32") {
    return [command];
  }
  const extensions = (env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const lowerCommand = command.toLowerCase();
  const includesKnownExtension = extensions.some((extension) => lowerCommand.endsWith(extension.toLowerCase()));
  if (includesKnownExtension) {
    return [command];
  }
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
}

function canExecute(filePath, platform) {
  try {
    accessSync(filePath, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function hasCommand(command, { env = process.env, platform = process.platform } = {}) {
  const searchPath = env.PATH || "";
  if (!searchPath) {
    return false;
  }
  const candidates = commandCandidates(command, platform, env);
  return searchPath
    .split(path.delimiter)
    .filter(Boolean)
    .some((directory) => candidates.some((candidate) => canExecute(path.join(directory, candidate), platform)));
}

export function listMissingCommands(commands, options = {}) {
  return commands.filter((command) => !hasCommand(command, options));
}

export function formatMissingCommandMessage(missing, { action = "flare ssh" } = {}) {
  const lines = [
    `[flare] Missing local dependencies for ${action}: ${missing.join(", ")}.`,
    ...missing.flatMap((command) => installHints(command)),
    "Preview and editor commands still work without these tools."
  ];
  return lines.filter(Boolean).join("\n");
}

export function installHints(command, { platform = process.platform } = {}) {
  if (command === "wstunnel") {
    if (platform === "darwin") {
      return [
        "Install `wstunnel` and make sure it is available on your PATH.",
        "macOS: `brew install wstunnel`"
      ];
    }
    if (platform === "win32") {
      return [
        "Install `wstunnel` and make sure it is available on your PATH.",
        "Windows: install `wstunnel` with your preferred package manager, then restart the shell."
      ];
    }
    return [
      "Install `wstunnel` and make sure it is available on your PATH.",
      "Linux: install `wstunnel` with your distro package manager or from the upstream release binary."
    ];
  }

  if (command === "ssh") {
    if (platform === "win32") {
      return [
        "Install an OpenSSH client and make sure `ssh` is available on your PATH.",
        "Windows: enable the built-in OpenSSH Client feature or install one with your preferred package manager."
      ];
    }
    return [
      "Install an OpenSSH client and make sure `ssh` is available on your PATH."
    ];
  }

  return [`Install \`${command}\` and make sure it is available on your PATH.`];
}

export function buildDoctorReport({
  env = process.env,
  platform = process.platform,
  nodeVersion = process.version,
  commands = SSH_RUNTIME_DEPENDENCIES
} = {}) {
  const dependencies = commands.map((command) => {
    const installed = hasCommand(command, { env, platform });
    return {
      command,
      installed,
      requiredFor: command === "ssh" || command === "wstunnel" ? ["flare ssh"] : [],
      hints: installed ? [] : installHints(command, { platform })
    };
  });
  const missing = dependencies.filter((entry) => !entry.installed).map((entry) => entry.command);

  return {
    ok: missing.length === 0,
    platform,
    nodeVersion,
    dependencies,
    missing,
    summary:
      missing.length === 0
        ? "flare is ready for SSH sessions on this machine."
        : `flare can run, but SSH sessions need additional local tools: ${missing.join(", ")}.`
  };
}

export function formatDoctorReport(report) {
  const lines = [
    `flare doctor`,
    `platform: ${report.platform}`,
    `node: ${report.nodeVersion}`,
    `ssh-ready: ${report.ok ? "yes" : "no"}`,
    ...report.dependencies.flatMap((entry) => {
      const base = `${entry.command}: ${entry.installed ? "ok" : "missing"}`;
      if (entry.installed) {
        return [base];
      }
      return [base, ...entry.hints.map((hint) => `  - ${hint}`)];
    }),
    `summary: ${report.summary}`
  ];
  return lines.join("\n");
}

export function ensureCommands(commands, options = {}) {
  const missing = listMissingCommands(commands, options);
  if (!missing.length) {
    return [];
  }
  const error = new Error(formatMissingCommandMessage(missing, options));
  error.status = 127;
  error.missingCommands = missing;
  throw error;
}

export function runInstallDependencyCheck({
  stderr = process.stderr,
  commands = SSH_RUNTIME_DEPENDENCIES,
  ...options
} = {}) {
  const report = buildDoctorReport({
    ...options,
    commands
  });
  const missing = report.missing;
  if (!missing.length) {
    return report;
  }
  stderr.write(`${formatMissingCommandMessage(missing, { ...options, action: "flare ssh" })}\n`);
  return report;
}
