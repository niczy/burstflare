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

function headers(token) {
  const map = { "content-type": "application/json" };
  if (token) {
    map.authorization = `Bearer ${token}`;
  }
  return map;
}

function print(stream, value) {
  stream.write(`${value}\n`);
}

export async function runCli(argv, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const env = dependencies.env || process.env;
  const configPath = dependencies.configPath || defaultConfigPath(env);

  const { positionals, options } = parseArgs(argv);
  const baseUrl = options.url || (await readConfig(configPath)).baseUrl || "http://127.0.0.1:8787";
  const config = await readConfig(configPath);
  const token = options.token || config.token || "";

  const [command = "help", subcommand, ...rest] = positionals;

  try {
    if (command === "help") {
      print(
        stdout,
        [
          "burstflare auth register --email you@example.com [--name Name]",
          "burstflare auth login --email you@example.com",
          "burstflare auth whoami",
          "burstflare template create <name> [--description ...]",
          "burstflare template upload <templateId> --version 1.0.0 [--notes ...]",
          "burstflare template promote <templateId> <versionId>",
          "burstflare template list",
          "burstflare up <name> --template <templateId>",
          "burstflare list",
          "burstflare status <sessionId>",
          "burstflare start <sessionId>",
          "burstflare down <sessionId>",
          "burstflare delete <sessionId>",
          "burstflare snapshot save <sessionId> [--label manual]",
          "burstflare snapshot list <sessionId>",
          "burstflare ssh <sessionId>"
        ].join("\n")
      );
      return 0;
    }

    if (command === "auth") {
      if (subcommand === "register") {
        const email = options.email;
        const name = options.name;
        const data = await requestJson(
          `${baseUrl}/api/auth/register`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ email, name })
          },
          fetchImpl
        );
        await writeConfig(configPath, {
          ...config,
          baseUrl,
          token: data.token,
          workspaceId: data.workspace.id,
          userEmail: data.user.email
        });
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "login") {
        const email = options.email;
        const data = await requestJson(
          `${baseUrl}/api/auth/login`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ email, kind: "api" })
          },
          fetchImpl
        );
        await writeConfig(configPath, {
          ...config,
          baseUrl,
          token: data.token,
          workspaceId: data.workspace.id,
          userEmail: data.user.email
        });
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }

      if (subcommand === "whoami") {
        const data = await requestJson(
          `${baseUrl}/api/auth/me`,
          {
            headers: headers(token)
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
            headers: headers(token)
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
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
          headers: headers(token)
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
          headers: headers(token)
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

    if (command === "delete") {
      const sessionId = subcommand;
      const data = await requestJson(
        `${baseUrl}/api/sessions/${sessionId}`,
        {
          method: "DELETE",
          headers: headers(token)
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
            headers: headers(token)
          },
          fetchImpl
        );
        print(stdout, JSON.stringify(data, null, 2));
        return 0;
      }
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
    return typeof error.status === "number" ? 1 : 1;
  }
}
