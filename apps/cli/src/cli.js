import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  return env.BURSTFLARE_CONFIG || path.join(os.homedir(), ".config", "burstflare", "config.json");
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
  return options.url || config.baseUrl || "http://127.0.0.1:8787";
}

function getToken(options, config) {
  return options.token || config.token || "";
}

function getRefreshToken(options, config) {
  return options["refresh-token"] || config.refreshToken || "";
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
    "burstflare auth register --email you@example.com [--name Name]",
    "burstflare auth login --email you@example.com",
    "burstflare auth recover --email you@example.com --code XXXX-XXXX-XXXX",
    "burstflare auth refresh",
    "burstflare auth logout",
    "burstflare auth logout-all",
    "burstflare auth sessions",
    "burstflare auth revoke-session <authSessionId>",
    "burstflare auth recovery-generate",
    "burstflare auth device-start --email you@example.com",
    "burstflare auth device-approve --code device_xxx",
    "burstflare auth device-exchange --code device_xxx",
    "burstflare auth switch-workspace <workspaceId>",
    "burstflare auth whoami",
    "burstflare workspace list",
    "burstflare workspace members",
    "burstflare workspace invite --email teammate@example.com [--role member]",
    "burstflare workspace accept-invite --code invite_xxx",
    "burstflare workspace set-role <userId> --role viewer",
    "burstflare workspace plan <free|pro|enterprise>",
    "burstflare template create <name> [--description ...]",
    "burstflare template upload <templateId> --version 1.0.0 [--file bundle.tgz] [--notes ...] [--simulate-failure] [--sleep-ttl-seconds 3600]",
    "burstflare template promote <templateId> <versionId>",
    "burstflare template archive <templateId>",
    "burstflare template restore <templateId>",
    "burstflare template delete <templateId>",
    "burstflare template list",
    "burstflare build list",
    "burstflare build log <buildId>",
    "burstflare build process",
    "burstflare build retry <buildId>",
    "burstflare release list",
    "burstflare up <name> --template <templateId>",
    "burstflare list",
    "burstflare status <sessionId>",
    "burstflare events <sessionId>",
    "burstflare start <sessionId>",
    "burstflare down <sessionId>",
    "burstflare restart <sessionId>",
    "burstflare delete <sessionId>",
    "burstflare snapshot save <sessionId> [--label manual] [--file snapshot.tgz]",
    "burstflare snapshot list <sessionId>",
    "burstflare snapshot delete <sessionId> <snapshotId>",
    "burstflare snapshot get <sessionId> <snapshotId> [--output restored.bin]",
    "burstflare usage",
    "burstflare report",
    "burstflare export [--output workspace-export.json]",
    "burstflare reconcile [--enqueue]",
    "burstflare preview <sessionId>",
    "burstflare ssh <sessionId>"
  ].join("\n");
}

export async function runCli(argv, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
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
  const [command = "help", subcommand, ...rest] = positionals;

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

  try {
    if (command === "help") {
      print(stdout, helpText());
      return 0;
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
    }

    if (command === "template") {
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
                sleepTtlSeconds: options["sleep-ttl-seconds"] ? Number(options["sleep-ttl-seconds"]) : undefined
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
        print(stdout, JSON.stringify(data, null, 2));
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
        print(stdout, JSON.stringify(data, null, 2));
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
    }

    if (command === "release" && subcommand === "list") {
      const data = await requestJsonAuthed(
        `${baseUrl}/api/releases`,
        {
          headers: headers(undefined, false)
        }
      );
      print(stdout, JSON.stringify(data, null, 2));
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
      print(stdout, JSON.stringify(data, null, 2));
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
      const route = options.enqueue ? "/api/admin/reconcile/enqueue" : "/api/admin/reconcile";
      const data = await requestJsonAuthed(
        `${baseUrl}${route}`,
        {
          method: "POST",
          headers: headers(undefined)
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

    if (command === "ssh") {
      const sessionId = subcommand;
      const data = await requestJsonAuthed(
        `${baseUrl}/api/sessions/${sessionId}/ssh-token`,
        {
          method: "POST",
          headers: headers(undefined)
        }
      );
      print(stdout, data.sshCommand);
      return 0;
    }

    throw new Error("Unknown command");
  } catch (error) {
    print(stderr, error.message || "Command failed");
    return 1;
  }
}
