import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildDoctorReport,
  ensureCommands,
  formatDoctorReport,
  SSH_RUNTIME_DEPENDENCIES
} from "./runtime-deps.js";

const CLI_NAME = "flare";
const DEFAULT_BASE_URL = "https://burstflare.dev";

function parseArgs(argv) {
  const positionals = [];
  const options = {};
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

function defaultConfigPath(env = process.env) {
  return env.FLARE_CONFIG || path.join(os.homedir(), ".config", CLI_NAME, "config.json");
}

async function readConfig(configPath) {
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeConfig(configPath, value) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(value, null, 2));
}

async function requestJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function requestText(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(text || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return text;
}

function headers(token, withJson = true) {
  const map = {};
  if (withJson) {
    map["content-type"] = "application/json";
  }
  if (token) {
    map.authorization = `Bearer ${token}`;
  }
  return map;
}

function print(stream, value) {
  stream.write(`${value}\n`);
}

function getBaseUrl(options, config) {
  return options.url || config.baseUrl || DEFAULT_BASE_URL;
}

function getToken(options, config) {
  return options.token || config.token || "";
}

function getRefreshToken(options, config) {
  return options["refresh-token"] || config.refreshToken || "";
}

function parseListOption(value) {
  if (!value || typeof value !== "string") {
    return undefined;
  }
  const items = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function parseIntegerOption(value) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    const error = new Error("Expected an integer option value");
    error.status = 400;
    throw error;
  }
  return parsed;
}

function filterCollection(data, key, predicate) {
  const items = Array.isArray(data?.[key]) ? data[key] : [];
  const filtered = items.filter(predicate);
  return {
    ...data,
    [key]: filtered,
    count: filtered.length,
    filtered: filtered.length !== items.length
  };
}

function selectCurrentWorkspace(workspaces, workspaceId) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return null;
  }
  return workspaces.find((entry) => entry.id === workspaceId) || workspaces[0];
}

async function saveAuthConfig(configPath, config, baseUrl, payload) {
  await writeConfig(configPath, {
    ...config,
    baseUrl,
    token: payload.token,
    refreshToken: payload.refreshToken || "",
    workspaceId: payload.workspace.id,
    userEmail: payload.user.email
  });
}

async function clearAuthConfig(configPath, config, baseUrl) {
  await writeConfig(configPath, {
    ...config,
    baseUrl,
    token: "",
    refreshToken: "",
    workspaceId: "",
    userEmail: config.userEmail || ""
  });
}

function helpText() {
  return [
    "auth register --email you@example.com [--name Name]",
    "auth login --email you@example.com",
    "auth recover --email you@example.com --code XXXX-XXXX-XXXX",
    "auth refresh",
    "auth logout",
    "auth logout-all",
    "auth sessions",
    "auth revoke-session <authSessionId>",
    "auth recovery-generate",
    "auth device-start --email you@example.com",
    "auth device-approve --code device_xxx",
    "auth device-exchange --code device_xxx",
    "auth switch-workspace <workspaceId>",
    "auth whoami",
    "workspace [current]",
    "workspaces",
    "workspace list",
    "workspace members",
    "workspace rename <name>",
    "workspace invite --email teammate@example.com [--role member]",
    "workspace accept-invite --code invite_xxx",
    "workspace set-role <userId> --role viewer",
    "workspace plan <free|pro|enterprise>",
    "workspace quota-overrides [--max-running-sessions 5] [--max-storage-bytes 1048576] [--clear]",
    "workspace secrets",
    "workspace set-secret <NAME> --value super-secret",
    "workspace delete-secret <NAME>",
    "template [list] [--active|--archived]",
    "templates",
    "template inspect <templateId>",
    "template create <name> [--description ...]",
    "template upload <templateId> --version 1.0.0 [--file bundle.tgz] [--notes ...] [--simulate-failure] [--sleep-ttl-seconds 3600] [--persisted-paths /workspace,/home/dev/.cache]",
    "template promote <templateId> <versionId>",
    "template rollback <templateId> [<releaseId>]",
    "template archive <templateId>",
    "template restore <templateId>",
    "template delete <templateId>",
    "build [list] [--status queued|building|succeeded|failed|dead_lettered]",
    "builds",
    "build log <buildId>",
    "build artifact <buildId>",
    "build process",
    "build retry <buildId>",
    "build retry-dead-lettered",
    "release [list] [--template <templateId>]",
    "releases",
    "session [list] [--status running|sleeping|deleted] [--template <templateId>]",
    "sessions",
    "session up <name> --template <templateId>",
    "session status <sessionId>",
    "session events <sessionId>",
    "session start <sessionId>",
    "session stop <sessionId>",
    "session restart <sessionId>",
    "session delete <sessionId>",
    "session preview <sessionId>",
    "session editor <sessionId>",
    "session ssh <sessionId> [--print]",
    "up <name> --template <templateId>",
    "list [--status running|sleeping|deleted] [--template <templateId>]",
    "status <sessionId>",
    "events <sessionId>",
    "start <sessionId>",
    "down <sessionId>",
    "restart <sessionId>",
    "delete <sessionId>",
    "snapshot save <sessionId> [--label manual] [--file snapshot.tgz]",
    "snapshot list <sessionId>",
    "snapshot restore <sessionId> <snapshotId>",
    "snapshot delete <sessionId> <snapshotId>",
    "snapshot get <sessionId> <snapshotId> [--output restored.bin]",
    "doctor",
    "usage",
    "report",
    "export [--output workspace-export.json]",
    "reconcile [--enqueue]",
    "reconcile preview",
    "reconcile sleep-running",
    "reconcile recover-builds",
    "reconcile purge-sleeping",
    "reconcile purge-deleted",
    "preview <sessionId>",
    "editor <sessionId>",
    "ssh <sessionId> [--print]"
  ]
    .map((command) => `${CLI_NAME} ${command}`)
    .join("\n");
}

export async function runCli(argv, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const spawnImpl = dependencies.spawnImpl || spawn;
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const env = dependencies.env || process.env;
  const configPath = dependencies.configPath || defaultConfigPath(env);
  const config = await readConfig(configPath);
  const { positionals, options } = parseArgs(argv);
  const baseUrl = getBaseUrl(options, config);
  let token = getToken(options, config);
  let refreshToken = getRefreshToken(options, config);
  let authConfig = config;
  let [command = "help", subcommand, ...rest] = positionals;

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

  async function rotateAuthTokens() {
    if (!refreshToken) {
      const error = new Error("Refresh token missing");
      error.status = 401;
      throw error;
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
    await saveAuthConfig(configPath, authConfig, baseUrl, data);
    authConfig = {
      ...authConfig,
      baseUrl,
      token: data.token,
      refreshToken: data.refreshToken,
      workspaceId: data.workspace.id,
      userEmail: data.user.email
    };
    token = data.token;
    refreshToken = data.refreshToken || "";
    return data;
  }

  function withCurrentAuth(existingHeaders = {}) {
    const merged = new Headers(existingHeaders);
    if (!merged.has("authorization") && token) {
      merged.set("authorization", `Bearer ${token}`);
    }
    return Object.fromEntries(merged.entries());
  }

  async function requestJsonAuthed(url, options = {}) {
    const firstAttempt = {
      ...options,
      headers: withCurrentAuth(options.headers || {})
    };
    try {
      return await requestJson(url, firstAttempt, fetchImpl);
    } catch (error) {
      if (error.status !== 401 || !refreshToken) {
        throw error;
      }
      await rotateAuthTokens();
      return requestJson(
        url,
        {
          ...options,
          headers: withCurrentAuth(options.headers || {})
        },
        fetchImpl
      );
    }
  }

  async function requestTextAuthed(url, options = {}) {
    const firstAttempt = {
      ...options,
      headers: withCurrentAuth(options.headers || {})
    };
    try {
      return await requestText(url, firstAttempt, fetchImpl);
    } catch (error) {
      if (error.status !== 401 || !refreshToken) {
        throw error;
      }
      await rotateAuthTokens();
      return requestText(
        url,
        {
          ...options,
          headers: withCurrentAuth(options.headers || {})
        },
        fetchImpl
      );
    }
  }

  async function fetchAuthed(url, options = {}) {
    const attempt = () =>
      fetchImpl(url, {
        ...options,
        headers: withCurrentAuth(options.headers || {})
      });

    let response = await attempt();
    if (response.status !== 401 || !refreshToken) {
      return response;
    }
    await rotateAuthTokens();
    response = await attempt();
    return response;
  }

  async function uploadWithGrant(uploadUrl, body, contentType) {
    return requestJson(
      uploadUrl,
      {
        method: "PUT",
        headers: {
          "content-type": contentType || "application/octet-stream"
        },
        body
      },
      fetchImpl
    );
  }

  async function ensureSessionRunningForSsh(sessionId) {
    try {
      return await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}/ssh-token`,
        {
          method: "POST",
          headers: headers(undefined)
        }
      );
    } catch (error) {
      if (error.status !== 409 || error.message !== "Session is not running") {
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

  async function runInteractiveCommand(commandLine) {
    const shell = "/bin/sh";
    await new Promise((resolve, reject) => {
      let settled = false;
      const child = spawnImpl(shell, ["-lc", commandLine], {
        stdio: "inherit"
      });

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
          signal ? `SSH session terminated with signal ${signal}` : `SSH session exited with code ${code}`
        );
        error.status = typeof code === "number" && code > 0 ? code : 1;
        reject(error);
      });
    });
  }

  try {
    if (command === "help") {
      print(stdout, helpText());
      return 0;
    }

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
        await saveAuthConfig(configPath, authConfig, baseUrl, data);
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
        await saveAuthConfig(configPath, authConfig, baseUrl, data);
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
        await saveAuthConfig(configPath, authConfig, baseUrl, data);
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
        await saveAuthConfig(configPath, authConfig, baseUrl, data);
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
        await clearAuthConfig(configPath, authConfig, baseUrl);
        authConfig = {
          ...authConfig,
          baseUrl,
          token: "",
          refreshToken: "",
          workspaceId: ""
        };
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
        await clearAuthConfig(configPath, authConfig, baseUrl);
        authConfig = {
          ...authConfig,
          baseUrl,
          token: "",
          refreshToken: "",
          workspaceId: ""
        };
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
        await saveAuthConfig(configPath, authConfig, baseUrl, data);
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
          const bundleBody = await readFile(options.file);
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
          const snapshotBody = await readFile(options.file);
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
          await writeFile(options.output, body);
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
        await writeFile(options.output, JSON.stringify(data, null, 2));
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
      const data = await ensureSessionRunningForSsh(sessionId);
      if (options.print) {
        print(stdout, data.sshCommand);
        return 0;
      }
      ensureCommands(SSH_RUNTIME_DEPENDENCIES, {
        env,
        action: "flare ssh"
      });
      await runInteractiveCommand(data.sshCommand);
      return 0;
    }

    throw new Error("Unknown command");
  } catch (error) {
    print(stderr, error.message || "Command failed");
    return 1;
  }
}
