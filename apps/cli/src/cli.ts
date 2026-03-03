
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { WebSocket as NodeWebSocket } from "ws";
import {
  buildDoctorReport,
  ensureCommands,
  formatDoctorReport,
  SSH_RUNTIME_DEPENDENCIES
} from "./runtime-deps.js";

interface WritableOutput {
  write(chunk: string | Uint8Array): void;
  isTTY?: boolean;
}

type SpawnImpl = (
  command: string,
  args: string[],
  options?: import("node:child_process").SpawnOptions
) => { on(event: string, handler: (...args: any[]) => void): unknown };

const CLI_NAME = "flare";
const DEFAULT_BASE_URL = "https://burstflare.dev";

interface CLIConfig {
  clientId?: string;
  sshKeys?: Record<string, any>;
  baseUrl?: string;
  token?: string;
  refreshToken?: string;
  workspaceId?: string;
  userEmail?: string;
  [key: string]: unknown;
}

interface CliError extends Error {
  status?: number;
  code?: number | string | null;
}

function createCliError(message: string, status: number): CliError {
  const error = new Error(message) as CliError;
  error.status = status;
  return error;
}

function createClientId(): string {
  return `cli_${globalThis.crypto.randomUUID()}`;
}

function normalizeSshKeys(config: CLIConfig = {}): Record<string, any> {
  const keys = config?.sshKeys;
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
    return {};
  }
  return keys;
}

function withLocalKeyState(config: CLIConfig = {}): CLIConfig {
  return {
    ...config,
    clientId: config.clientId || createClientId(),
    sshKeys: normalizeSshKeys(config)
  };
}

function sshKeyDirectory(configPath: string): string {
  return path.join(path.dirname(configPath), "ssh");
}

function sessionSshKeyPath(configPath: string, sessionId: string): string {
  return path.join(sshKeyDirectory(configPath), `${sessionId}.ed25519`);
}

export function websocketUrlForSsh(baseUrl: string, sessionId: string, token: string): string {
  const url = new URL(`/runtime/sessions/${sessionId}/ssh`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

function toWebSocketBytes(value: unknown): Buffer | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return Buffer.from([]);
  }
  return Buffer.from([]);
}

export async function createSshTunnel(
  sshUrl: string,
  options: {
    netImpl?: typeof net;
    WebSocketImpl?: any;
  } = {}
): Promise<{
  host: string;
  port: number;
  close(): Promise<void>;
}> {
  const netImpl = options.netImpl || net;
  const WebSocketImpl = options.WebSocketImpl || (globalThis as any).WebSocket || NodeWebSocket;
  const wsOpenState = WebSocketImpl.OPEN ?? 1;
  const wsConnectingState = WebSocketImpl.CONNECTING ?? 0;
  if (typeof WebSocketImpl !== "function") {
    throw new Error("WebSocket client support is unavailable in this Node runtime");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let activeSocket: import("node:net").Socket | null = null;
    let activeWebSocket: any = null;
    const server = netImpl.createServer((socket) => {
      if (activeSocket) {
        socket.end();
        return;
      }
      activeSocket = socket;
      const ws = new WebSocketImpl(sshUrl);
      activeWebSocket = ws;
      ws.binaryType = "arraybuffer";
      let socketClosed = false;
      let wsOpen = false;
      const pendingChunks: Buffer[] = [];
      const addListener =
        typeof ws.addEventListener === "function"
          ? (eventName: string, handler: (...args: any[]) => void) => ws.addEventListener(eventName, handler)
          : (eventName: string, handler: (...args: any[]) => void) =>
              ws.on(eventName, (...args: any[]) => {
                if (eventName === "message") {
                  handler({ data: args[0] });
                  return;
                }
                handler(...args);
              });
      const closeServer = () => {
        if (server.listening) {
          server.close();
        }
      };

      socket.on("data", (chunk) => {
        if (socketClosed) {
          return;
        }
        if (wsOpen && ws.readyState === wsOpenState) {
          ws.send(chunk);
          return;
        }
        pendingChunks.push(Buffer.from(chunk));
      });

      addListener("open", () => {
        wsOpen = true;
        while (pendingChunks.length > 0 && ws.readyState === wsOpenState) {
          ws.send(pendingChunks.shift());
        }
      });

      addListener("message", async (event: { data: unknown }) => {
        if (!activeSocket || activeSocket.destroyed) {
          return;
        }
        if (typeof Blob !== "undefined" && event.data instanceof Blob) {
          const arrayBuffer = await event.data.arrayBuffer();
          activeSocket.write(Buffer.from(arrayBuffer));
          return;
        }
        const chunk = toWebSocketBytes(event.data);
        if (chunk) {
          activeSocket.write(chunk);
        }
      });

      addListener("close", () => {
        wsOpen = false;
        if (activeSocket && !activeSocket.destroyed) {
          activeSocket.end();
        }
        closeServer();
      });

      addListener("error", () => {
        if (activeSocket && !activeSocket.destroyed) {
          activeSocket.destroy(new Error("Failed to connect to the BurstFlare SSH tunnel"));
        }
        closeServer();
      });

      socket.on("close", () => {
        socketClosed = true;
        if (ws.readyState === wsOpenState || ws.readyState === wsConnectingState) {
          ws.close();
        }
        closeServer();
      });

      socket.on("error", () => {
        socketClosed = true;
        if (ws.readyState === wsOpenState || ws.readyState === wsConnectingState) {
          ws.close();
        }
        closeServer();
      });
    });

    server.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    server.listen(0, "127.0.0.1", () => {
      if (settled) {
        return;
      }
      settled = true;
      const address = server.address();
      resolve({
        host: "127.0.0.1",
        port: typeof address === "object" && address ? address.port : 0,
        async close() {
          if (activeSocket && !activeSocket.destroyed) {
            activeSocket.destroy();
          }
          if (
            activeWebSocket &&
            (activeWebSocket.readyState === wsOpenState || activeWebSocket.readyState === wsConnectingState)
          ) {
            activeWebSocket.close();
          }
          if (!server.listening) {
            return;
          }
          await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
        }
      });
    });
  });
}

function parseArgs(argv: string[]): { positionals: string[]; options: Record<string, string | true> } {
  const positionals: string[] = [];
  const options: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return { positionals, options };
}

function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return (env.FLARE_CONFIG as string) || path.join(os.homedir(), ".config", CLI_NAME, "config.json");
}

async function readConfig(configPath: string): Promise<CLIConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as CLIConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {} as CLIConfig;
    }
    throw error;
  }
}

async function writeConfig(configPath: string, value: CLIConfig): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(value, null, 2));
}

async function requestJson(url: string, options: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<any> {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createCliError(data.error || `Request failed (${response.status})`, response.status);
  }
  return data;
}

async function requestText(url: string, options: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw createCliError(text || `Request failed (${response.status})`, response.status);
  }
  return text;
}

function headers(token?: string, withJson: boolean = true): Record<string, string> {
  const map: Record<string, string> = {};
  if (withJson) {
    map["content-type"] = "application/json";
  }
  if (token) {
    map.authorization = `Bearer ${token}`;
  }
  return map;
}

function print(stream: WritableOutput, value: string): void {
  stream.write(`${value}\n`);
}

function shouldUseColor(stream: WritableOutput, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined) {
    return false;
  }
  if (env.FORCE_COLOR === "0") {
    return false;
  }
  if (env.FORCE_COLOR) {
    return true;
  }
  return Boolean(stream?.isTTY);
}

function styleText(value: string, codes: string, enabled: boolean): string {
  if (!enabled) {
    return value;
  }
  return `${codes}${value}\u001B[0m`;
}

interface HelpCommand {
  name: string;
  usageTail: string;
  summary: string;
}

interface HelpGroupTopic {
  kind: "group";
  name: string;
  alias?: string;
  usageTail?: string;
  summary: string;
  commands: HelpCommand[];
}

interface HelpCommandTopic {
  kind: "command";
  name: string;
  alias?: string;
  usageTail?: string;
  summary: string;
}

type HelpTopic = HelpGroupTopic | HelpCommandTopic;

interface HelpSection {
  title: string;
  topics: HelpTopic[];
}

const HELP_CATALOG: HelpSection[] = [
  {
    title: "Authentication",
    topics: [
      {
        kind: "group",
        name: "auth",
        summary: "Register, log in, and manage local auth state.",
        commands: [
          { name: "register", usageTail: "--email <email> [--name <name>]", summary: "Create a user and save auth tokens locally." },
          { name: "login", usageTail: "--email <email>", summary: "Log in with an email-based API flow." },
          { name: "recover", usageTail: "--email <email> --code <code>", summary: "Recover access with a recovery code." },
          { name: "refresh", usageTail: "", summary: "Rotate the current access and refresh tokens." },
          { name: "logout", usageTail: "", summary: "Revoke the current refresh token locally and remotely." },
          { name: "logout-all", usageTail: "", summary: "Revoke every active auth session for the user." },
          { name: "sessions", usageTail: "", summary: "List active auth sessions." },
          { name: "revoke-session", usageTail: "<authSessionId>", summary: "Revoke one auth session by id." },
          { name: "recovery-generate", usageTail: "", summary: "Generate a new batch of recovery codes." },
          { name: "device-start", usageTail: "--email <email>", summary: "Start the CLI device authorization flow." },
          { name: "device-approve", usageTail: "--code <deviceCode>", summary: "Approve a pending device code." },
          { name: "device-exchange", usageTail: "--code <deviceCode>", summary: "Exchange a device code for tokens." },
          { name: "switch-workspace", usageTail: "<workspaceId>", summary: "Switch the active workspace for the saved tokens." },
          { name: "whoami", usageTail: "", summary: "Show the authenticated user and active workspace." }
        ]
      }
    ]
  },
  {
    title: "Workspace",
    topics: [
      {
        kind: "group",
        name: "workspace",
        alias: "workspaces",
        summary: "Inspect and manage the current workspace. Defaults to current when no subcommand is given.",
        commands: [
          { name: "current", usageTail: "", summary: "Show the selected workspace." },
          { name: "list", usageTail: "", summary: "List every workspace the user can access." },
          { name: "members", usageTail: "", summary: "List members in the current workspace." },
          { name: "rename", usageTail: "<name>", summary: "Rename the current workspace." },
          { name: "invite", usageTail: "--email <email> [--role <role>]", summary: "Invite a teammate into the workspace." },
          { name: "accept-invite", usageTail: "--code <inviteCode>", summary: "Accept a workspace invite." },
          { name: "set-role", usageTail: "<userId> --role <role>", summary: "Change a member role." },
          { name: "plan", usageTail: "<free|pro|enterprise>", summary: "Change the workspace plan." },
          { name: "quota-overrides", usageTail: "[--max-running-sessions <count>] [--max-storage-bytes <bytes>] [--clear]", summary: "Override or clear workspace quota limits." },
          { name: "secrets", usageTail: "", summary: "List workspace secrets without values." },
          { name: "set-secret", usageTail: "<name> --value <value>", summary: "Create or update a workspace secret." },
          { name: "delete-secret", usageTail: "<name>", summary: "Delete a workspace secret." }
        ]
      }
    ]
  },
  {
    title: "Templates and Releases",
    topics: [
      {
        kind: "group",
        name: "template",
        alias: "templates",
        summary: "Create templates and manage template versions. Defaults to list when no subcommand is given.",
        commands: [
          { name: "list", usageTail: "[--active|--archived]", summary: "List templates, optionally filtered by archive state." },
          { name: "inspect", usageTail: "<templateId>", summary: "Inspect one template." },
          { name: "create", usageTail: "<name> [--description <text>]", summary: "Create a new template." },
          { name: "upload", usageTail: "<templateId> --version <version> [--file <path>] [--notes <text>]", summary: "Create a template version and optionally upload a bundle." },
          { name: "promote", usageTail: "<templateId> <versionId>", summary: "Promote a version to the active release." },
          { name: "rollback", usageTail: "<templateId> [<releaseId>]", summary: "Roll back a template to a prior release." },
          { name: "archive", usageTail: "<templateId>", summary: "Archive a template." },
          { name: "restore", usageTail: "<templateId>", summary: "Restore an archived template." },
          { name: "delete", usageTail: "<templateId>", summary: "Delete a template." }
        ]
      },
      {
        kind: "group",
        name: "release",
        alias: "releases",
        summary: "Inspect release history. Defaults to list when no subcommand is given.",
        commands: [{ name: "list", usageTail: "[--template <templateId>]", summary: "List releases, optionally filtered by template." }]
      }
    ]
  },
  {
    title: "Builds",
    topics: [
      {
        kind: "group",
        name: "build",
        alias: "builds",
        summary: "Inspect and manage template builds. Defaults to list when no subcommand is given.",
        commands: [
          { name: "list", usageTail: "[--status <status>]", summary: "List template builds, optionally filtered by status." },
          { name: "log", usageTail: "<buildId>", summary: "Print the build log." },
          { name: "artifact", usageTail: "<buildId>", summary: "Print the build artifact output." },
          { name: "process", usageTail: "", summary: "Process queued builds." },
          { name: "retry", usageTail: "<buildId>", summary: "Retry one build." },
          { name: "retry-dead-lettered", usageTail: "", summary: "Retry dead-lettered builds." }
        ]
      }
    ]
  },
  {
    title: "Sessions",
    topics: [
      {
        kind: "group",
        name: "session",
        alias: "sessions",
        summary: "Launch and control runtime sessions. Defaults to list when no subcommand is given.",
        commands: [
          { name: "list", usageTail: "[--status <status>] [--template <templateId>]", summary: "List sessions, optionally filtered by status or template." },
          { name: "up", usageTail: "<name> --template <templateId>", summary: "Create and start a session." },
          { name: "status", usageTail: "<sessionId>", summary: "Show session details." },
          { name: "events", usageTail: "<sessionId>", summary: "List session events." },
          { name: "start", usageTail: "<sessionId>", summary: "Start a sleeping session." },
          { name: "stop", usageTail: "<sessionId>", summary: "Stop a running session." },
          { name: "restart", usageTail: "<sessionId>", summary: "Restart a session." },
          { name: "delete", usageTail: "<sessionId>", summary: "Delete a session." },
          { name: "preview", usageTail: "<sessionId>", summary: "Print the session preview URL." },
          { name: "editor", usageTail: "<sessionId>", summary: "Print the browser editor URL." },
          { name: "ssh", usageTail: "<sessionId> [--print]", summary: "Open or print SSH attach details." }
        ]
      }
    ]
  },
  {
    title: "Snapshots and Operations",
    topics: [
      {
        kind: "group",
        name: "snapshot",
        summary: "Save, restore, delete, and download session snapshots.",
        commands: [
          { name: "save", usageTail: "<sessionId> [--label <label>] [--file <path>]", summary: "Create a snapshot and optionally upload snapshot content." },
          { name: "list", usageTail: "<sessionId>", summary: "List snapshots for a session." },
          { name: "restore", usageTail: "<sessionId> <snapshotId>", summary: "Restore a snapshot onto a session." },
          { name: "delete", usageTail: "<sessionId> <snapshotId>", summary: "Delete a snapshot." },
          { name: "get", usageTail: "<sessionId> <snapshotId> [--output <path>]", summary: "Download snapshot content or write it to a file." }
        ]
      },
      { kind: "command", name: "doctor", usageTail: "[--json]", summary: "Check local SSH dependencies." },
      { kind: "command", name: "usage", usageTail: "", summary: "Fetch usage metrics." },
      { kind: "command", name: "report", usageTail: "", summary: "Fetch the operator report." },
      { kind: "command", name: "export", usageTail: "[--output <path>]", summary: "Export workspace data as JSON." },
      {
        kind: "group",
        name: "reconcile",
        usageTail: "[--enqueue]",
        summary: "Run or preview operator reconcile workflows.",
        commands: [
          { name: "preview", usageTail: "", summary: "Preview reconcile work without changing state." },
          { name: "sleep-running", usageTail: "", summary: "Sleep sessions that are still running." },
          { name: "recover-builds", usageTail: "", summary: "Recover stalled builds." },
          { name: "purge-sleeping", usageTail: "", summary: "Purge sleeping sessions past retention." },
          { name: "purge-deleted", usageTail: "", summary: "Purge deleted sessions past retention." }
        ]
      }
    ]
  },
  {
    title: "Billing",
    topics: [
      {
        kind: "group",
        name: "billing",
        summary: "Manage billing information, payment methods, charges, and account balance.",
        commands: [
          { name: "status", usageTail: "", summary: "Show billing status, plan, and payment info." },
          { name: "enroll", usageTail: "--success-url <url> --cancel-url <url>", summary: "Start Stripe checkout enrollment and print the URL." },
          { name: "add-card", usageTail: "--payment-method-id <id>", summary: "Attach a Stripe payment method to the workspace." },
          { name: "charge", usageTail: "--amount <usd> [--description <text>]", summary: "Charge the workspace and add credits to the balance." },
          { name: "balance", usageTail: "", summary: "Show remaining credit balance and pending usage cost." }
        ]
      }
    ]
  },
  {
    title: "Shortcuts",
    topics: [
      { kind: "command", name: "up", usageTail: "<name> --template <templateId>", summary: "Shortcut for session up." },
      { kind: "command", name: "list", usageTail: "[--status <status>] [--template <templateId>]", summary: "Shortcut for session list." },
      { kind: "command", name: "status", usageTail: "<sessionId>", summary: "Shortcut for session status." },
      { kind: "command", name: "events", usageTail: "<sessionId>", summary: "Shortcut for session events." },
      { kind: "command", name: "start", usageTail: "<sessionId>", summary: "Shortcut for session start." },
      { kind: "command", name: "down", usageTail: "<sessionId>", summary: "Shortcut for session stop." },
      { kind: "command", name: "restart", usageTail: "<sessionId>", summary: "Shortcut for session restart." },
      { kind: "command", name: "delete", usageTail: "<sessionId>", summary: "Shortcut for session delete." },
      { kind: "command", name: "preview", usageTail: "<sessionId>", summary: "Shortcut for session preview." },
      { kind: "command", name: "editor", usageTail: "<sessionId>", summary: "Shortcut for session editor." },
      { kind: "command", name: "ssh", usageTail: "<sessionId> [--print]", summary: "Shortcut for session ssh." }
    ]
  }
];

function commandUsageLine(commandName: string, usageTail: string = ""): string {
  return [commandName, usageTail].filter(Boolean).join(" ");
}

function buildHelpIndex(): Array<{ section: string; path: string[]; matchers: string[][] }> {
  const entries: Array<{ section: string; path: string[]; matchers: string[][] }> = [];
  for (const section of HELP_CATALOG) {
    for (const topic of section.topics) {
      entries.push({
        section: section.title,
        path: [topic.name],
        matchers: [[topic.name], ...(topic.alias ? [[topic.alias]] : [])]
      });
      if (topic.kind === "group") {
        for (const command of topic.commands) {
          entries.push({
            section: section.title,
            path: [topic.name, command.name],
            matchers: [
              [topic.name, command.name],
              ...(topic.alias ? [[topic.alias, command.name]] : [])
            ]
          });
        }
      }
    }
  }
  return entries;
}

const HELP_INDEX = buildHelpIndex();

function resolveHelpPath(tokens: string[] = []): string[] | null {
  let bestMatch: { path: string[]; length: number } | null = null;
  for (const entry of HELP_INDEX) {
    for (const matcher of entry.matchers) {
      if (matcher.length > tokens.length) {
        continue;
      }
      let matches = true;
      for (let index = 0; index < matcher.length; index += 1) {
        if (matcher[index] !== tokens[index]) {
          matches = false;
          break;
        }
      }
      if (!matches) {
        continue;
      }
      if (!bestMatch || matcher.length > bestMatch.length) {
        bestMatch = {
          path: entry.path,
          length: matcher.length
        };
      }
    }
  }
  return bestMatch?.path || null;
}

function createHelpProgram(): Command {
  const program = new Command();
  program.name(CLI_NAME);
  program.description("BurstFlare command reference");
  program.addHelpCommand(false);

  for (const section of HELP_CATALOG) {
    for (const topic of section.topics) {
      const topLevel = program.command(topic.name).description(topic.summary);
      topLevel.addHelpCommand(false);
      if (topic.usageTail) {
        topLevel.usage(topic.usageTail);
      }
      if (topic.kind === "command") {
        continue;
      }
      for (const command of topic.commands) {
        const subcommand = topLevel.command(command.name).description(command.summary);
        if (command.usageTail) {
          subcommand.usage(command.usageTail);
        }
      }
    }
  }

  return program;
}

function findHelpCommand(program: Command, pathSegments: string[]): Command | null {
  let current: Command = program;
  for (const segment of pathSegments) {
    const found = current.commands.find((command) => command.name() === segment);
    if (!found) {
      return null;
    }
    current = found;
  }
  return current;
}

function formatCommandHelp(text: string, stream: WritableOutput, env: NodeJS.ProcessEnv = process.env): string {
  const useColor = shouldUseColor(stream, env);
  const lines = text.trimEnd().split("\n");
  if (!useColor) {
    return lines.join("\n");
  }
  return lines
    .map((line) => {
      if (line.startsWith("Usage: ")) {
        return `${styleText("Usage", "\u001B[1;33m", true)}:${line.slice("Usage:".length)}`;
      }
      if (/^[A-Z][A-Za-z ]+:$/.test(line)) {
        return `${styleText(line.slice(0, -1), "\u001B[1;33m", true)}:`;
      }
      return line.replace(/^(\s*)flare\b/, (_match, indent) => `${indent}${styleText("flare", "\u001B[1;32m", true)}`);
    })
    .join("\n");
}

function helpTextForTopic(tokens: string[], stream: WritableOutput, env: NodeJS.ProcessEnv = process.env): string {
  const pathSegments = resolveHelpPath(tokens);
  if (!pathSegments) {
    throw new Error(`Unknown help topic: ${tokens.join(" ")}`);
  }
  const helpProgram = createHelpProgram();
  const command = findHelpCommand(helpProgram, pathSegments);
  if (!command) {
    throw new Error(`Unknown help topic: ${tokens.join(" ")}`);
  }
  return formatCommandHelp(command.helpInformation(), stream, env);
}

function getBaseUrl(options: Record<string, string | true>, config: CLIConfig): string {
  return (options.url as string) || config.baseUrl || DEFAULT_BASE_URL;
}

function getToken(options: Record<string, string | true>, config: CLIConfig): string {
  return (options.token as string) || config.token || "";
}

function getRefreshToken(options: Record<string, string | true>, config: CLIConfig): string {
  return (options["refresh-token"] as string) || config.refreshToken || "";
}

function parseListOption(value: unknown): string[] | undefined {
  if (!value || typeof value !== "string") {
    return undefined;
  }
  const items = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function parseIntegerOption(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw createCliError("Expected an integer option value", 400);
  }
  return parsed;
}

function filterCollection(data: any, key: string, predicate: (entry: any) => boolean): any {
  const items = Array.isArray(data?.[key]) ? data[key] : [];
  const filtered = items.filter(predicate);
  return {
    ...data,
    [key]: filtered,
    count: filtered.length,
    filtered: filtered.length !== items.length
  };
}

function selectCurrentWorkspace(workspaces: any[], workspaceId: string | undefined): any {
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return null;
  }
  return workspaces.find((entry) => entry.id === workspaceId) || workspaces[0];
}

async function saveAuthConfig(configPath: string, config: CLIConfig, baseUrl: string, payload: any): Promise<CLIConfig> {
  const next = {
    ...withLocalKeyState(config),
    baseUrl,
    token: payload.token,
    refreshToken: payload.refreshToken || "",
    workspaceId: payload.workspace.id,
    userEmail: payload.user.email
  };
  await writeConfig(configPath, next);
  return next;
}

async function clearAuthConfig(configPath: string, config: CLIConfig, baseUrl: string): Promise<CLIConfig> {
  const next = {
    ...withLocalKeyState(config),
    baseUrl,
    token: "",
    refreshToken: "",
    workspaceId: "",
    userEmail: config.userEmail || ""
  };
  await writeConfig(configPath, next);
  return next;
}

async function runForegroundCommand(
  spawnImpl: SpawnImpl,
  command: string,
  args: string[],
  options: import("node:child_process").SpawnOptions = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawnImpl(command, args, options);

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(
        signal ? `${command} terminated with signal ${signal}` : `${command} exited with code ${code}`
      ) as CliError;
      error.status = typeof code === "number" && code > 0 ? code : 1;
      reject(error);
    });
  });
}

function helpText(stream: WritableOutput, env: NodeJS.ProcessEnv = process.env): string {
  const useColor = shouldUseColor(stream, env);
  const title = styleText("flare CLI", "\u001B[1;36m", useColor);
  const usageLabel = styleText("Usage", "\u001B[1;33m", useColor);
  const sectionLabel = (value: string) => styleText(value, "\u001B[1;33m", useColor);
  const commandPrefix = styleText(CLI_NAME, "\u001B[1;32m", useColor);
  const note = (value: string) => styleText(value, "\u001B[2m", useColor);

  const lines = [
    title,
    `${usageLabel}: ${commandPrefix} <command> [options]`,
    note(`Default API: ${DEFAULT_BASE_URL}`),
    note("Use --url to point the CLI at a different control plane."),
    ""
  ];

  for (const section of HELP_CATALOG) {
    lines.push(sectionLabel(section.title));
    for (const topic of section.topics) {
      lines.push(`  ${commandPrefix} ${commandUsageLine(topic.name, topic.usageTail)}`);
      if (topic.alias) {
        lines.push(`  ${commandPrefix} ${topic.alias}`);
      }
      if (topic.kind === "group") {
        for (const command of topic.commands) {
          lines.push(`    ${commandPrefix} ${commandUsageLine(`${topic.name} ${command.name}`, command.usageTail)}`);
        }
      }
    }
    lines.push("");
  }

  lines.push(note("Use `flare help <topic>` or append `--help` for focused command details."));
  lines.push(note("Use the shortcuts when you want the common session commands without the session prefix."));
  return lines.join("\n").trimEnd();
}

export async function runCli(
  argv: string[],
  dependencies: {
    fetchImpl?: typeof fetch;
    spawnImpl?: SpawnImpl;
    createSshTunnelImpl?: typeof createSshTunnel;
    stdout?: WritableOutput;
    stderr?: WritableOutput;
    env?: NodeJS.ProcessEnv;
    configPath?: string;
  } = {}
): Promise<number> {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const spawnImpl = dependencies.spawnImpl || spawn;
  const createSshTunnelImpl = dependencies.createSshTunnelImpl || createSshTunnel;
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const env = dependencies.env || process.env;
  const configPath = dependencies.configPath || defaultConfigPath(env);
  const { positionals, options } = parseArgs(argv);
  if (positionals[0] === "help") {
    try {
      print(stdout, positionals.length > 1 ? helpTextForTopic(positionals.slice(1), stdout, env) : helpText(stdout, env));
      return 0;
    } catch (error) {
      const typedError = error as CliError;
      print(stderr, typedError.message || "Command failed");
      return 1;
    }
  }
  if (options.help || positionals.length === 0) {
    try {
      print(stdout, positionals.length > 0 ? helpTextForTopic(positionals, stdout, env) : helpText(stdout, env));
      return 0;
    } catch (error) {
      const typedError = error as CliError;
      print(stderr, typedError.message || "Command failed");
      return 1;
    }
  }
  const config = withLocalKeyState(await readConfig(configPath));
  const baseUrl = getBaseUrl(options, config);
  let token = getToken(options, config);
  let refreshToken = getRefreshToken(options, config);
  let authConfig = config;
  let [command, subcommand, ...rest] = positionals;

  if (command === "workspaces") {
    command = "workspace";
    subcommand = subcommand || "list";
  }
  if (command === "templates") {
    command = "template";
    subcommand = subcommand || "list";
  }
  if (command === "builds") {
    command = "build";
    subcommand = subcommand || "list";
  }
  if (command === "releases") {
    command = "release";
    subcommand = subcommand || "list";
  }
  if (command === "sessions") {
    command = "session";
    subcommand = subcommand || "list";
  }
  if (command === "billing" && !subcommand) {
    subcommand = "status";
  }
  if (command === "workspace" && !subcommand) {
    subcommand = "current";
  }
  if (command === "template" && !subcommand) {
    subcommand = "list";
  }
  if (command === "build" && !subcommand) {
    subcommand = "list";
  }
  if (command === "release" && !subcommand) {
    subcommand = "list";
  }
  if (command === "session" && !subcommand) {
    subcommand = "list";
  }
  if (command === "session") {
    if (subcommand === "up") {
      command = "up";
      [subcommand, ...rest] = rest;
    } else if (subcommand === "list") {
      command = "list";
      [subcommand, ...rest] = rest;
    } else if (subcommand === "status" || subcommand === "events" || subcommand === "start" || subcommand === "restart" || subcommand === "delete" || subcommand === "preview" || subcommand === "editor" || subcommand === "ssh") {
      command = subcommand;
      [subcommand, ...rest] = rest;
    } else if (subcommand === "stop" || subcommand === "down") {
      command = "down";
      [subcommand, ...rest] = rest;
    }
  }

  async function rotateAuthTokens(): Promise<any> {
    if (!refreshToken) {
      throw createCliError("Refresh token missing", 401);
    }
    const data = await requestJson(
      `${baseUrl}/api/auth/refresh`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ refreshToken })
      },
      fetchImpl
    );
    authConfig = await saveAuthConfig(configPath, authConfig, baseUrl, data);
    token = authConfig.token as string;
    refreshToken = authConfig.refreshToken || "";
    await syncKnownSshKeysForAuth(token);
    return data;
  }

  function withCurrentAuth(existingHeaders: Record<string, string> = {}): Record<string, string> {
    const merged = new Headers(existingHeaders);
    if (!merged.has("authorization") && token) {
      merged.set("authorization", `Bearer ${token}`);
    }
    return Object.fromEntries(merged.entries());
  }

  async function requestJsonAuthed(url: string, options: RequestInit = {}): Promise<any> {
    const firstAttempt = {
      ...options,
      headers: withCurrentAuth(options.headers as Record<string, string> || {})
    };
    try {
      return await requestJson(url, firstAttempt, fetchImpl);
    } catch (error) {
      const typedError = error as CliError;
      if (typedError.status !== 401 || !refreshToken) {
        throw error;
      }
      await rotateAuthTokens();
      return requestJson(
        url,
        {
          ...options,
          headers: withCurrentAuth(options.headers as Record<string, string> || {})
        },
        fetchImpl
      );
    }
  }

  async function requestTextAuthed(url: string, options: RequestInit = {}): Promise<string> {
    const firstAttempt = {
      ...options,
      headers: withCurrentAuth(options.headers as Record<string, string> || {})
    };
    try {
      return await requestText(url, firstAttempt, fetchImpl);
    } catch (error) {
      const typedError = error as CliError;
      if (typedError.status !== 401 || !refreshToken) {
        throw error;
      }
      await rotateAuthTokens();
      return requestText(
        url,
        {
          ...options,
          headers: withCurrentAuth(options.headers as Record<string, string> || {})
        },
        fetchImpl
      );
    }
  }

  async function fetchAuthed(url: string, options: RequestInit = {}): Promise<Response> {
    const attempt = () =>
      fetchImpl(url, {
        ...options,
        headers: withCurrentAuth(options.headers as Record<string, string> || {})
      });

    let response = await attempt();
    if (response.status !== 401 || !refreshToken) {
      return response;
    }
    await rotateAuthTokens();
    response = await attempt();
    return response;
  }

  async function uploadWithGrant(uploadUrl: string, body: unknown, contentType: string): Promise<any> {
    return requestJson(
      uploadUrl,
      {
        method: "PUT",
        headers: {
          "content-type": contentType || "application/octet-stream"
        },
        body: body as BodyInit
      },
      fetchImpl
    );
  }

  async function persistAuthConfig(nextConfig: CLIConfig): Promise<CLIConfig> {
    authConfig = withLocalKeyState(nextConfig);
    token = authConfig.token || "";
    refreshToken = authConfig.refreshToken || "";
    await writeConfig(configPath, authConfig);
    return authConfig;
  }

  async function ensureSessionSshKey(sessionId: string): Promise<Record<string, any>> {
    let nextConfig = withLocalKeyState(authConfig);
    const keyPath = sessionSshKeyPath(configPath, sessionId);
    const publicKeyPath = `${keyPath}.pub`;
    let privateKeyExists = true;
    let publicKey = "";
    try {
      await readFile(keyPath, "utf8");
      publicKey = (await readFile(publicKeyPath, "utf8")).trim();
    } catch (_error) {
      privateKeyExists = false;
    }

    if (!privateKeyExists || !publicKey) {
      ensureCommands(["ssh-keygen"], {
        env,
        action: "flare ssh"
      });
      await mkdir(sshKeyDirectory(configPath), { recursive: true });
      await runForegroundCommand(spawnImpl, "ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        `${CLI_NAME}-${sessionId}`,
        "-f",
        keyPath
      ], {
        stdio: "ignore"
      });
      publicKey = (await readFile(publicKeyPath, "utf8")).trim();
    }

    const sshKeys: Record<string, any> = {
      ...normalizeSshKeys(nextConfig)
    };
    const existing = sshKeys[sessionId] || {};
    const entry = {
      keyId: existing.keyId || `${nextConfig.clientId}:${sessionId}`,
      label: existing.label || `${os.hostname()} ${sessionId}`,
      privateKeyPath: keyPath,
      publicKeyPath,
      publicKey,
      createdAt: existing.createdAt || new Date().toISOString(),
      syncedAt: existing.syncedAt || null
    };
    const changed =
      !sshKeys[sessionId] ||
      sshKeys[sessionId].publicKey !== entry.publicKey ||
      sshKeys[sessionId].privateKeyPath !== entry.privateKeyPath ||
      sshKeys[sessionId].publicKeyPath !== entry.publicKeyPath;
    sshKeys[sessionId] = entry;
    if (changed) {
      nextConfig = {
        ...nextConfig,
        sshKeys
      };
      await persistAuthConfig(nextConfig);
    } else {
      authConfig = nextConfig;
    }
    return {
      ...entry
    };
  }

  async function syncSessionSshKey(sessionId: string): Promise<Record<string, any>> {
    const key = await ensureSessionSshKey(sessionId);
    await requestJsonAuthed(
      `${baseUrl}/api/sessions/${sessionId}/ssh-key`,
      {
        method: "PUT",
        headers: headers(undefined),
        body: JSON.stringify({
          keyId: key.keyId,
          label: key.label,
          publicKey: key.publicKey
        })
      }
    );
    const sshKeys: Record<string, any> = {
      ...normalizeSshKeys(authConfig),
      [sessionId]: {
        ...normalizeSshKeys(authConfig)[sessionId],
        ...key,
        syncedAt: new Date().toISOString()
      }
    };
    await persistAuthConfig({
      ...authConfig,
      sshKeys
    });
    return sshKeys[sessionId];
  }

  async function syncKnownSshKeysForAuth(nextToken: string): Promise<void> {
    const keyEntries = Object.entries(normalizeSshKeys(authConfig));
    if (!nextToken || keyEntries.length === 0) {
      return;
    }
    let changed = false;
    for (const [sessionId, entry] of keyEntries) {
      const publicKeyPath = (entry as any)?.publicKeyPath || `${sessionSshKeyPath(configPath, sessionId)}.pub`;
      let publicKey = "";
      try {
        publicKey = (await readFile(publicKeyPath, "utf8")).trim();
      } catch (_error) {
        continue;
      }
      try {
        await requestJson(
          `${baseUrl}/api/sessions/${sessionId}/ssh-key`,
          {
            method: "PUT",
            headers: {
              ...headers(nextToken),
              authorization: `Bearer ${nextToken}`
            },
            body: JSON.stringify({
              keyId: (entry as any).keyId,
              label: (entry as any).label,
              publicKey
            })
          },
          fetchImpl
        );
        (authConfig.sshKeys as Record<string, any>)[sessionId] = {
          ...(entry as any),
          publicKey,
          publicKeyPath,
          syncedAt: new Date().toISOString()
        };
        changed = true;
      } catch (error) {
        const typedError = error as CliError;
        if (![401, 403, 404, 409].includes(Number(typedError.status))) {
          throw error;
        }
      }
    }
    if (changed) {
      await persistAuthConfig(authConfig);
    }
  }

  async function ensureSessionRunningForSsh(sessionId: string): Promise<any> {
    try {
      return await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}/ssh-token`,
        {
          method: "POST",
          headers: headers(undefined)
        }
      );
    } catch (error) {
      const typedError = error as CliError;
      if (typedError.status !== 409 || typedError.message !== "Session is not running") {
        throw error;
      }
      await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}/start`,
        {
          method: "POST",
          headers: headers(undefined)
        }
      );
      return requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}/ssh-token`,
        {
          method: "POST",
          headers: headers(undefined)
        }
      );
    }
  }

  async function runInteractiveCommand(command: string, args: string[]): Promise<void> {
    try {
      await runForegroundCommand(spawnImpl, command, args, {
        stdio: "inherit"
      });
    } catch (error) {
      const typedError = error as CliError;
      if (typedError?.message?.startsWith(`${command} exited with code `)) {
        const code = typedError.message.slice(`${command} exited with code `.length);
        const wrapped = createCliError(`SSH session exited with code ${code}`, Number(typedError.status) || 1);
        throw wrapped;
      }
      if (typedError?.message?.startsWith(`${command} terminated with signal `)) {
        const signal = typedError.message.slice(`${command} terminated with signal `.length);
        const wrapped = createCliError(`SSH session terminated with signal ${signal}`, Number(typedError.status) || 1);
        throw wrapped;
      }
      throw error;
    }
  }

  function buildSshAttachInfo(sessionId: string, data: any, sshKey: Record<string, any> | null): {
    sshUrl: string;
    sshUser: string;
    sshPrivateKeyPath: string;
    localCommand: string;
    note: string;
  } {
    const sshUrl = websocketUrlForSsh(baseUrl, sessionId, data.token);
    const keyPath = sshKey?.privateKeyPath || "<local-key-path>";
    return {
      sshUrl,
      sshUser: data.sshUser || "flare",
      sshPrivateKeyPath: keyPath,
      localCommand:
        `ssh -i ${keyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ` +
        "-o IdentitiesOnly=yes -o PreferredAuthentications=publickey -p <local-port> flare@127.0.0.1",
      note: `Run \`flare ssh ${sessionId}\` to open the local tunnel automatically.`
    };
  }

  try {
    if (command === "doctor") {
      const report = buildDoctorReport({
        env,
        platform: process.platform,
        nodeVersion: process.version
      });
      if (options.json) {
        print(stdout, JSON.stringify(report, null, 2));
        return report.ok ? 0 : 1;
      }
      print(stdout, formatDoctorReport(report));
      return report.ok ? 0 : 1;
    }

    if (command === "auth") {
      if (subcommand === "register") {
        const data = await requestJson(
          `${baseUrl}/api/auth/register`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ email: options.email, name: options.name, turnstileToken: options["turnstile-token"] || "" })
          },
          fetchImpl
        );
        authConfig = await saveAuthConfig(configPath, authConfig, baseUrl, data);
        token = authConfig.token as string;
        refreshToken = authConfig.refreshToken || "";
        await syncKnownSshKeysForAuth(token);
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "login") {
        const data = await requestJson(
          `${baseUrl}/api/auth/login`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ email: options.email, kind: "api", turnstileToken: options["turnstile-token"] || "" })
          },
          fetchImpl
        );
        authConfig = await saveAuthConfig(configPath, authConfig, baseUrl, data);
        token = authConfig.token as string;
        refreshToken = authConfig.refreshToken || "";
        await syncKnownSshKeysForAuth(token);
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "recover") {
        const data = await requestJson(
          `${baseUrl}/api/auth/recover`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({
              email: options.email,
              code: options.code,
              workspaceId: options["workspace-id"] || null,
              turnstileToken: options["turnstile-token"] || ""
            })
          },
          fetchImpl
        );
        authConfig = await saveAuthConfig(configPath, authConfig, baseUrl, data);
        token = authConfig.token as string;
        refreshToken = authConfig.refreshToken || "";
        await syncKnownSshKeysForAuth(token);
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "device-start") {
        const data = await requestJson(
          `${baseUrl}/api/cli/device/start`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({
              email: options.email,
              workspaceId: options["workspace-id"] || null,
              turnstileToken: options["turnstile-token"] || ""
            })
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "device-approve") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/cli/device/approve`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ deviceCode: options.code })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "device-exchange") {
        const data = await requestJson(
          `${baseUrl}/api/cli/device/exchange`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ deviceCode: options.code })
          },
          fetchImpl
        );
        authConfig = await saveAuthConfig(configPath, authConfig, baseUrl, data);
        token = authConfig.token as string;
        refreshToken = authConfig.refreshToken || "";
        await syncKnownSshKeysForAuth(token);
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "refresh") {
        const data = await rotateAuthTokens();
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "logout") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/auth/logout`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ refreshToken })
          }
        );
        authConfig = await clearAuthConfig(configPath, authConfig, baseUrl);
        token = "";
        refreshToken = "";
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "logout-all") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/auth/logout-all`,
          {
            method: "POST",
            headers: headers(undefined, false)
          }
        );
        authConfig = await clearAuthConfig(configPath, authConfig, baseUrl);
        token = "";
        refreshToken = "";
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "switch-workspace") {
        const workspaceId = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/auth/switch-workspace`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ workspaceId })
          }
        );
        authConfig = await saveAuthConfig(configPath, authConfig, baseUrl, data);
        token = authConfig.token as string;
        refreshToken = authConfig.refreshToken || "";
        await syncKnownSshKeysForAuth(token);
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "whoami") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/auth/me`,
          {
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "recovery-generate") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/auth/recovery-codes/generate`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ count: options.count ? Number(options.count) : undefined })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "sessions") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/auth/sessions`,
          {
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "revoke-session") {
        const authSessionId = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/auth/sessions/${authSessionId}`,
          {
            method: "DELETE",
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
    }

    if (command === "workspace") {
      if (subcommand === "current") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces`,
          {
            headers: headers(undefined, false)
          }
        );
        print(
          stdout,
          JSON.stringify(
            {
              workspace: selectCurrentWorkspace(data.workspaces, authConfig.workspaceId || config.workspaceId)
            },
            null,
            2
          )
        );
        return 0;
      }

      if (subcommand === "list") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces`,
          {
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "members") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/members`,
          {
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "rename") {
        const name = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/settings`,
          {
            method: "PATCH",
            headers: headers(undefined),
            body: JSON.stringify({ name })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "invite") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/invites`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ email: options.email, role: options.role || "member" })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "accept-invite") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/invites/accept`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ inviteCode: options.code })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "set-role") {
        const userId = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/members/${userId}/role`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ role: options.role })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "plan") {
        const plan = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/plan`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ plan })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "quota-overrides") {
        const payload = options.clear
          ? { clear: true }
          : {
              maxTemplates: parseIntegerOption(options["max-templates"]),
              maxRunningSessions: parseIntegerOption(options["max-running-sessions"]),
              maxTemplateVersionsPerTemplate: parseIntegerOption(options["max-template-versions-per-template"]),
              maxSnapshotsPerSession: parseIntegerOption(options["max-snapshots-per-session"]),
              maxStorageBytes: parseIntegerOption(options["max-storage-bytes"]),
              maxRuntimeMinutes: parseIntegerOption(options["max-runtime-minutes"]),
              maxTemplateBuilds: parseIntegerOption(options["max-template-builds"])
            };
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/quota-overrides`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify(payload)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "secrets") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/secrets`,
          {
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "set-secret") {
        const name = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/secrets`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({
              name,
              value: options.value
            })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "delete-secret") {
        const name = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/secrets/${encodeURIComponent(name)}`,
          {
            method: "DELETE",
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
    }

    if (command === "billing") {
      if (subcommand === "status") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/billing`,
          { headers: headers(undefined, false) }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "balance") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/billing/balance`,
          { headers: headers(undefined, false) }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "enroll") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/billing/checkout`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({
              successUrl: options["success-url"],
              cancelUrl: options["cancel-url"]
            })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "add-card") {
        if (!options["payment-method-id"]) {
          throw createCliError("--payment-method-id <id> is required", 400);
        }
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/billing/payment-method`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ paymentMethodId: options["payment-method-id"] })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "charge") {
        if (!options.amount) {
          throw createCliError("--amount <usd> is required", 400);
        }
        const amountUsd = Number(options.amount);
        if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
          throw createCliError("--amount must be a positive number (e.g. --amount 10.00)", 400);
        }
        const data = await requestJsonAuthed(
          `${baseUrl}/api/workspaces/current/billing/charge`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({
              amountUsd,
              description: options.description || undefined
            })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
    }

    if (command === "template") {
      if (subcommand === "inspect") {
        const templateId = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/templates/${templateId}`,
          {
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "create") {
        const name = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/templates`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ name, description: options.description || "" })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "upload") {
        const templateId = rest[0];
        const created = await requestJsonAuthed(
          `${baseUrl}/api/templates/${templateId}/versions`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({
              version: options.version,
              notes: options.notes || "",
              manifest: {
                image: `registry.cloudflare.com/local/${templateId}:${options.version}`,
                features: ["ssh", "browser", "snapshots"],
                simulateFailure: Boolean(options["simulate-failure"]),
                sleepTtlSeconds: options["sleep-ttl-seconds"] ? Number(options["sleep-ttl-seconds"]) : undefined,
                persistedPaths: parseListOption(options["persisted-paths"])
              }
            })
          }
        );
        let result = created;
        if (options.file) {
          const bundleBody = await readFile(options.file as string);
          const uploadGrant = await requestJsonAuthed(
            `${baseUrl}/api/templates/${templateId}/versions/${created.templateVersion.id}/bundle/upload`,
            {
              method: "POST",
              headers: headers(undefined),
              body: JSON.stringify({
                contentType: options["content-type"] || "application/octet-stream",
                bytes: bundleBody.byteLength
              })
            }
          );
          const uploaded = await uploadWithGrant(
            uploadGrant.uploadGrant.url,
            bundleBody,
            uploadGrant.uploadGrant.contentType || options["content-type"] || "application/octet-stream"
          );
          result = {
            ...created,
            templateVersion: uploaded.templateVersion,
            bundle: uploaded.bundle
          };
        }
        print(stdout, JSON.stringify(result, null, 2));
        return 0;
      }

      if (subcommand === "promote") {
        const templateId = rest[0];
        const versionId = rest[1];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/templates/${templateId}/promote`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ versionId })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "rollback") {
        const templateId = rest[0];
        const releaseId = rest[1] || null;
        const data = await requestJsonAuthed(
          `${baseUrl}/api/templates/${templateId}/rollback`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({
              releaseId
            })
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "archive") {
        const templateId = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/templates/${templateId}/archive`,
          {
            method: "POST",
            headers: headers(undefined)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "restore") {
        const templateId = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/templates/${templateId}/restore`,
          {
            method: "POST",
            headers: headers(undefined)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "list") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/templates`,
          {
            headers: headers(undefined, false)
          }
        );
        let result = data;
        if (options.archived) {
          result = filterCollection(data, "templates", (entry) => Boolean(entry.archivedAt));
        } else if (options.active) {
          result = filterCollection(data, "templates", (entry) => !entry.archivedAt);
        }
        print(stdout, JSON.stringify(result, null, 2));
        return 0;
      }

      if (subcommand === "delete") {
        const templateId = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/templates/${templateId}`,
          {
            method: "DELETE",
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
    }

    if (command === "build") {
      if (subcommand === "list") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/template-builds`,
          {
            headers: headers(undefined, false)
          }
        );
        const result = options.status ? filterCollection(data, "builds", (entry) => entry.status === options.status) : data;
        print(stdout, JSON.stringify(result, null, 2));
        return 0;
      }

      if (subcommand === "log") {
        const buildId = rest[0];
        const data = await requestTextAuthed(
          `${baseUrl}/api/template-builds/${buildId}/log`,
          {
            headers: headers(undefined, false)
          }
        );
        print(stdout, data.trimEnd());
        return 0;
      }

      if (subcommand === "artifact") {
        const buildId = rest[0];
        const data = await requestTextAuthed(
          `${baseUrl}/api/template-builds/${buildId}/artifact`,
          {
            headers: headers(undefined, false)
          }
        );
        print(stdout, data.trimEnd());
        return 0;
      }

      if (subcommand === "process") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/template-builds/process`,
          {
            method: "POST",
            headers: headers(undefined)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "retry") {
        const buildId = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/template-builds/${buildId}/retry`,
          {
            method: "POST",
            headers: headers(undefined)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "retry-dead-lettered") {
        const data = await requestJsonAuthed(
          `${baseUrl}/api/admin/builds/retry-dead-lettered`,
          {
            method: "POST",
            headers: headers(undefined)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
    }

    if (command === "release" && subcommand === "list") {
      const data = await requestJsonAuthed(
        `${baseUrl}/api/releases`,
        {
          headers: headers(undefined, false)
        }
      );
      const result = options.template ? filterCollection(data, "releases", (entry) => entry.templateId === options.template) : data;
      print(stdout, JSON.stringify(result, null, 2));
      return 0;
    }

    if (command === "up") {
      const name = subcommand;
      const templateId = options.template;
      const created = await requestJsonAuthed(
        `${baseUrl}/api/sessions`,
        {
          method: "POST",
          headers: headers(undefined),
          body: JSON.stringify({ name, templateId })
        }
      );
      const started = await requestJsonAuthed(
        `${baseUrl}/api/sessions/${created.session.id}/start`,
        {
          method: "POST",
          headers: headers(undefined)
        }
      );
      print(stdout, JSON.stringify(started, null, 2));
      return 0;
    }

    if (command === "list") {
      const data = await requestJsonAuthed(
        `${baseUrl}/api/sessions`,
        {
          headers: headers(undefined, false)
        }
      );
      let result = data;
      if (options.status) {
        result = filterCollection(
          result,
          "sessions",
          (entry) =>
            entry.state === options.status ||
            entry.status === options.status ||
            entry.runtimeStatus === options.status ||
            entry.runtime?.status === options.status
        );
      }
      if (options.template) {
        result = filterCollection(result, "sessions", (entry) => entry.templateId === options.template);
      }
      print(stdout, JSON.stringify(result, null, 2));
      return 0;
    }

    if (command === "status") {
      const sessionId = subcommand;
      const data = await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}`,
        {
          headers: headers(undefined, false)
        }
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "events") {
      const sessionId = subcommand;
      const data = await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}/events`,
        {
          headers: headers(undefined, false)
        }
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "start") {
      const sessionId = subcommand;
      const data = await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}/start`,
        {
          method: "POST",
          headers: headers(undefined)
        }
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "down") {
      const sessionId = subcommand;
      const data = await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}/stop`,
        {
          method: "POST",
          headers: headers(undefined)
        }
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "restart") {
      const sessionId = subcommand;
      const data = await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}/restart`,
        {
          method: "POST",
          headers: headers(undefined)
        }
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "delete") {
      const sessionId = subcommand;
      const data = await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}`,
        {
          method: "DELETE",
          headers: headers(undefined, false)
        }
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "snapshot") {
      if (subcommand === "save") {
        const sessionId = rest[0];
        const created = await requestJsonAuthed(
          `${baseUrl}/api/sessions/${sessionId}/snapshots`,
          {
            method: "POST",
            headers: headers(undefined),
            body: JSON.stringify({ label: options.label || "manual" })
          }
        );
        let result = created;
        if (options.file) {
          const snapshotBody = await readFile(options.file as string);
          const uploadGrant = await requestJsonAuthed(
            `${baseUrl}/api/sessions/${sessionId}/snapshots/${created.snapshot.id}/content/upload`,
            {
              method: "POST",
              headers: headers(undefined),
              body: JSON.stringify({
                contentType: options["content-type"] || "application/octet-stream",
                bytes: snapshotBody.byteLength
              })
            }
          );
          const uploaded = await uploadWithGrant(
            uploadGrant.uploadGrant.url,
            snapshotBody,
            uploadGrant.uploadGrant.contentType || options["content-type"] || "application/octet-stream"
          );
          result = uploaded;
        }
        print(stdout, JSON.stringify(result, null, 2));
        return 0;
      }

      if (subcommand === "list") {
        const sessionId = rest[0];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/sessions/${sessionId}/snapshots`,
          {
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "delete") {
        const sessionId = rest[0];
        const snapshotId = rest[1];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/sessions/${sessionId}/snapshots/${snapshotId}`,
          {
            method: "DELETE",
            headers: headers(undefined, false)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "restore") {
        const sessionId = rest[0];
        const snapshotId = rest[1];
        const data = await requestJsonAuthed(
          `${baseUrl}/api/sessions/${sessionId}/snapshots/${snapshotId}/restore`,
          {
            method: "POST",
            headers: headers(undefined)
          }
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "get") {
        const sessionId = rest[0];
        const snapshotId = rest[1];
        const response = await fetchAuthed(`${baseUrl}/api/sessions/${sessionId}/snapshots/${snapshotId}/content`, {
          headers: headers(undefined, false)
        });
        const body = new Uint8Array(await response.arrayBuffer());
        if (!response.ok) {
          throw new Error(new TextDecoder().decode(body) || `Request failed (${response.status})`);
        }
        if (options.output) {
          await writeFile(options.output as string, body);
          print(
            stdout,
            JSON.stringify(
              {
                snapshotId,
                output: options.output,
                bytes: body.byteLength
              },
              null,
              2
            )
          );
          return 0;
        }
        print(stdout, new TextDecoder().decode(body));
        return 0;
      }
    }

    if (command === "usage") {
      const data = await requestJsonAuthed(
        `${baseUrl}/api/usage`,
        {
          headers: headers(undefined, false)
        }
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "report") {
      const data = await requestJsonAuthed(
        `${baseUrl}/api/admin/report`,
        {
          headers: headers(undefined, false)
        }
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "export") {
      const data = await requestJsonAuthed(
        `${baseUrl}/api/admin/export`,
        {
          headers: headers(undefined, false)
        }
      );
      if (options.output) {
        await writeFile(options.output as string, JSON.stringify(data, null, 2));
        print(
          stdout,
          JSON.stringify(
            {
              output: options.output,
              bytes: new TextEncoder().encode(JSON.stringify(data, null, 2)).byteLength
            },
            null,
            2
          )
        );
        return 0;
      }
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "reconcile") {
      let route = "/api/admin/reconcile";
      let method = "POST";
      if (subcommand === "preview") {
        route = "/api/admin/reconcile/preview";
        method = "GET";
      } else if (subcommand === "sleep-running") {
        route = "/api/admin/reconcile/sleep-running";
      } else if (subcommand === "recover-builds") {
        route = "/api/admin/reconcile/recover-builds";
      } else if (subcommand === "purge-sleeping") {
        route = "/api/admin/reconcile/purge-sleeping";
      } else if (subcommand === "purge-deleted") {
        route = "/api/admin/reconcile/purge-deleted";
      } else if (options.enqueue) {
        route = "/api/admin/reconcile/enqueue";
      } else if (subcommand) {
        throw new Error("Unknown reconcile action");
      }
      const data = await requestJsonAuthed(
        `${baseUrl}${route}`,
        {
          method,
          headers: method === "GET" ? headers(undefined, false) : headers(undefined)
        }
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "preview") {
      const sessionId = subcommand;
      const session = await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}`,
        {
          headers: headers(undefined, false)
        }
      );
      const url = new URL(session.session.previewUrl, baseUrl).toString();
      print(stdout, url);
      return 0;
    }

    if (command === "editor") {
      const sessionId = subcommand;
      print(stdout, new URL(`/runtime/sessions/${sessionId}/editor`, baseUrl).toString());
      return 0;
    }

    if (command === "ssh") {
      const sessionId = subcommand;
      const sshKey = await syncSessionSshKey(sessionId);
      const data = await ensureSessionRunningForSsh(sessionId);
      const sshAttach = buildSshAttachInfo(sessionId, data, sshKey);
      if (options.print) {
        print(stdout, JSON.stringify(sshAttach, null, 2));
        return 0;
      }
      ensureCommands(["ssh"], {
        env,
        action: "flare ssh"
      });
      const tunnel = await createSshTunnelImpl(sshAttach.sshUrl);
      try {
        await runInteractiveCommand("ssh", [
          "-i",
          sshAttach.sshPrivateKeyPath,
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "UserKnownHostsFile=/dev/null",
          "-o",
          "IdentitiesOnly=yes",
          "-o",
          "PreferredAuthentications=publickey",
          "-p",
          String(tunnel.port),
          `${sshAttach.sshUser}@${tunnel.host}`
        ]);
        return 0;
      } finally {
        await tunnel.close().catch(() => {});
      }
    }

    throw new Error("Unknown command");
  } catch (error) {
    const typedError = error as CliError;
    print(stderr, typedError.message || "Command failed");
    return 1;
  }
}
