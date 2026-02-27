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

async function saveAuthConfig(configPath, config, baseUrl, payload) {
  await writeConfig(configPath, {
    ...config,
    baseUrl,
    token: payload.token,
    workspaceId: payload.workspace.id,
    userEmail: payload.user.email
  });
}

function helpText() {
  return [
    "burstflare auth register --email you@example.com [--name Name]",
    "burstflare auth login --email you@example.com",
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
    "burstflare template upload <templateId> --version 1.0.0 [--notes ...]",
    "burstflare template promote <templateId> <versionId>",
    "burstflare template list",
    "burstflare build list",
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
    "burstflare snapshot save <sessionId> [--label manual]",
    "burstflare snapshot list <sessionId>",
    "burstflare usage",
    "burstflare report",
    "burstflare reconcile",
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
  const token = getToken(options, config);
  const [command = "help", subcommand, ...rest] = positionals;

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
            body: JSON.stringify({ email: options.email, name: options.name })
          },
          fetchImpl
        );
        await saveAuthConfig(configPath, config, baseUrl, data);
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "login") {
        const data = await requestJson(
          `${baseUrl}/api/auth/login`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ email: options.email, kind: "api" })
          },
          fetchImpl
        );
        await saveAuthConfig(configPath, config, baseUrl, data);
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "device-start") {
        const data = await requestJson(
          `${baseUrl}/api/cli/device/start`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ email: options.email, workspaceId: options["workspace-id"] || null })
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "device-approve") {
        const data = await requestJson(
          `${baseUrl}/api/cli/device/approve`,
          {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ deviceCode: options.code })
          },
          fetchImpl
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
        await saveAuthConfig(configPath, config, baseUrl, data);
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "switch-workspace") {
        const workspaceId = rest[0];
        const data = await requestJson(
          `${baseUrl}/api/auth/switch-workspace`,
          {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ workspaceId })
          },
          fetchImpl
        );
        await saveAuthConfig(configPath, config, baseUrl, data);
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "whoami") {
        const data = await requestJson(
          `${baseUrl}/api/auth/me`,
          {
            headers: headers(token, false)
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
    }

    if (command === "workspace") {
      if (subcommand === "list") {
        const data = await requestJson(
          `${baseUrl}/api/workspaces`,
          {
            headers: headers(token, false)
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "members") {
        const data = await requestJson(
          `${baseUrl}/api/workspaces/current/members`,
          {
            headers: headers(token, false)
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "invite") {
        const data = await requestJson(
          `${baseUrl}/api/workspaces/current/invites`,
          {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ email: options.email, role: options.role || "member" })
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "accept-invite") {
        const data = await requestJson(
          `${baseUrl}/api/workspaces/current/invites/accept`,
          {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ inviteCode: options.code })
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "set-role") {
        const userId = rest[0];
        const data = await requestJson(
          `${baseUrl}/api/workspaces/current/members/${userId}/role`,
          {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ role: options.role })
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "plan") {
        const plan = rest[0];
        const data = await requestJson(
          `${baseUrl}/api/workspaces/current/plan`,
          {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ plan })
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
    }

    if (command === "template") {
      if (subcommand === "create") {
        const name = rest[0];
        const data = await requestJson(
          `${baseUrl}/api/templates`,
          {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ name, description: options.description || "" })
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "upload") {
        const templateId = rest[0];
        const data = await requestJson(
          `${baseUrl}/api/templates/${templateId}/versions`,
          {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({
              version: options.version,
              notes: options.notes || "",
              manifest: {
                image: `registry.cloudflare.com/local/${templateId}:${options.version}`,
                features: ["ssh", "browser", "snapshots"]
              }
            })
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "promote") {
        const templateId = rest[0];
        const versionId = rest[1];
        const data = await requestJson(
          `${baseUrl}/api/templates/${templateId}/promote`,
          {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ versionId })
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "list") {
        const data = await requestJson(
          `${baseUrl}/api/templates`,
          {
            headers: headers(token, false)
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
    }

    if (command === "build") {
      if (subcommand === "list") {
        const data = await requestJson(
          `${baseUrl}/api/template-builds`,
          {
            headers: headers(token, false)
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "process") {
        const data = await requestJson(
          `${baseUrl}/api/template-builds/process`,
          {
            method: "POST",
            headers: headers(token)
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "retry") {
        const buildId = rest[0];
        const data = await requestJson(
          `${baseUrl}/api/template-builds/${buildId}/retry`,
          {
            method: "POST",
            headers: headers(token)
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
    }

    if (command === "release" && subcommand === "list") {
      const data = await requestJson(
        `${baseUrl}/api/releases`,
        {
          headers: headers(token, false)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "up") {
      const name = subcommand;
      const templateId = options.template;
      const created = await requestJson(
        `${baseUrl}/api/sessions`,
        {
          method: "POST",
          headers: headers(token),
          body: JSON.stringify({ name, templateId })
        },
        fetchImpl
      );
      const started = await requestJson(
        `${baseUrl}/api/sessions/${created.session.id}/start`,
        {
          method: "POST",
          headers: headers(token)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(started, null, 2));
      return 0;
    }

    if (command === "list") {
      const data = await requestJson(
        `${baseUrl}/api/sessions`,
        {
          headers: headers(token, false)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "status") {
      const sessionId = subcommand;
      const data = await requestJson(
        `${baseUrl}/api/sessions/${sessionId}`,
        {
          headers: headers(token, false)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "events") {
      const sessionId = subcommand;
      const data = await requestJson(
        `${baseUrl}/api/sessions/${sessionId}/events`,
        {
          headers: headers(token, false)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "start") {
      const sessionId = subcommand;
      const data = await requestJson(
        `${baseUrl}/api/sessions/${sessionId}/start`,
        {
          method: "POST",
          headers: headers(token)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "down") {
      const sessionId = subcommand;
      const data = await requestJson(
        `${baseUrl}/api/sessions/${sessionId}/stop`,
        {
          method: "POST",
          headers: headers(token)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "restart") {
      const sessionId = subcommand;
      const data = await requestJson(
        `${baseUrl}/api/sessions/${sessionId}/restart`,
        {
          method: "POST",
          headers: headers(token)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "delete") {
      const sessionId = subcommand;
      const data = await requestJson(
        `${baseUrl}/api/sessions/${sessionId}`,
        {
          method: "DELETE",
          headers: headers(token, false)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "snapshot") {
      if (subcommand === "save") {
        const sessionId = rest[0];
        const data = await requestJson(
          `${baseUrl}/api/sessions/${sessionId}/snapshots`,
          {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ label: options.label || "manual" })
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "list") {
        const sessionId = rest[0];
        const data = await requestJson(
          `${baseUrl}/api/sessions/${sessionId}/snapshots`,
          {
            headers: headers(token, false)
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
    }

    if (command === "usage") {
      const data = await requestJson(
        `${baseUrl}/api/usage`,
        {
          headers: headers(token, false)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "report") {
      const data = await requestJson(
        `${baseUrl}/api/admin/report`,
        {
          headers: headers(token, false)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "reconcile") {
      const data = await requestJson(
        `${baseUrl}/api/admin/reconcile`,
        {
          method: "POST",
          headers: headers(token)
        },
        fetchImpl
      );
      print(stdout, JSON.stringify(data, null, 2));
      return 0;
    }

    if (command === "preview") {
      const sessionId = subcommand;
      const session = await requestJson(
        `${baseUrl}/api/sessions/${sessionId}`,
        {
          headers: headers(token, false)
        },
        fetchImpl
      );
      const url = new URL(session.session.previewUrl, baseUrl).toString();
      print(stdout, url);
      return 0;
    }

    if (command === "ssh") {
      const sessionId = subcommand;
      const data = await requestJson(
        `${baseUrl}/api/sessions/${sessionId}/ssh-token`,
        {
          method: "POST",
          headers: headers(token)
        },
        fetchImpl
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
