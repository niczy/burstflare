import { accessSync, constants } from "node:fs";
import path from "node:path";

interface CommandDependencyError extends Error {
  status?: number;
  missingCommands?: string[];
}

interface WritableOutput {
  write(chunk: string): void;
}

export const SSH_RUNTIME_DEPENDENCIES = ["ssh", "ssh-keygen"];

function commandCandidates(command: string, platform: string, env: NodeJS.ProcessEnv): string[] {
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

function canExecute(filePath: string, platform: string): boolean {
  try {
    accessSync(filePath, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function hasCommand(command: string, { env = process.env, platform = process.platform }: { env?: NodeJS.ProcessEnv; platform?: string } = {}): boolean {
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

export function listMissingCommands(commands: string[], options: { env?: NodeJS.ProcessEnv; platform?: string } = {}): string[] {
  return commands.filter((command) => !hasCommand(command, options));
}

export function formatMissingCommandMessage(missing: string[], { action = "flare ssh" }: { action?: string } = {}): string {
  const lines = [
    `[flare] Missing local dependencies for ${action}: ${missing.join(", ")}.`,
    ...missing.flatMap((command) => installHints(command)),
    "Preview and editor commands still work without these tools."
  ];
  return lines.filter(Boolean).join("\n");
}

export function installHints(command: string, { platform = process.platform }: { platform?: string } = {}): string[] {
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

  if (command === "ssh-keygen") {
    if (platform === "win32") {
      return [
        "Install OpenSSH tooling and make sure `ssh-keygen` is available on your PATH.",
        "Windows: enable the built-in OpenSSH Client feature or install one with your preferred package manager."
      ];
    }
    return [
      "Install OpenSSH tooling and make sure `ssh-keygen` is available on your PATH."
    ];
  }

  return [`Install \`${command}\` and make sure it is available on your PATH.`];
}

interface DependencyEntry {
  command: string;
  installed: boolean;
  requiredFor: string[];
  hints: string[];
}

interface DoctorReport {
  ok: boolean;
  platform: string;
  nodeVersion: string;
  dependencies: DependencyEntry[];
  missing: string[];
  summary: string;
}

export function buildDoctorReport({
  env = process.env,
  platform = process.platform,
  nodeVersion = process.version,
  commands = SSH_RUNTIME_DEPENDENCIES
}: {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  nodeVersion?: string;
  commands?: string[];
} = {}): DoctorReport {
  const dependencies = commands.map((command) => {
    const installed = hasCommand(command, { env, platform });
    return {
      command,
      installed,
      requiredFor: ["flare ssh"],
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

export function formatDoctorReport(report: DoctorReport): string {
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

export function ensureCommands(commands: string[], options: { env?: NodeJS.ProcessEnv; platform?: string; action?: string } = {}): string[] {
  const missing = listMissingCommands(commands, options);
  if (!missing.length) {
    return [];
  }
  const error = new Error(formatMissingCommandMessage(missing, options)) as CommandDependencyError;
  error.status = 127;
  error.missingCommands = missing;
  throw error;
}

export function runInstallDependencyCheck({
  stderr = process.stderr as WritableOutput,
  commands = SSH_RUNTIME_DEPENDENCIES,
  ...options
}: {
  stderr?: WritableOutput;
  commands?: string[];
  env?: NodeJS.ProcessEnv;
  platform?: string;
  nodeVersion?: string;
} = {}): DoctorReport {
  const report = buildDoctorReport({
    ...options,
    commands
  });
  const missing = report.missing;
  if (!missing.length) {
    return report;
  }
  stderr.write(`${formatMissingCommandMessage(missing, { action: "flare ssh" })}\n`);
  return report;
}
