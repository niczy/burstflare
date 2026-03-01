import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }
  return process.argv[index + 1];
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealthy(baseUrl) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok) {
        return payload;
      }
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError || new Error("Dev server did not become healthy");
}

function spawnChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(detail || `${command} ${args.join(" ")} failed`);
  }
  return (result.stdout || "").trim();
}

function unwrap(value, key) {
  if (value && typeof value === "object" && !Array.isArray(value) && key in value) {
    return value[key];
  }
  return value;
}

function parseOutput(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  const scriptDir = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(scriptDir, "..");
  const baseUrlArg = getArg("--base-url");
  const packageName = getArg("--package") || "@burstflare/flare";
  const packageVersion = getArg("--version");
  const installSpec = `${packageName}${packageVersion ? `@${packageVersion}` : ""}`;
  const tempRoot = await mkdtemp(join(tmpdir(), "flare-npm-smoke-"));
  const configOwner = join(tempRoot, "owner-config.json");
  const configGuest = join(tempRoot, "guest-config.json");
  const configAux = join(tempRoot, "aux-config.json");
  const outputDir = join(tempRoot, "artifacts");
  let serverProcess = null;
  let baseUrl = baseUrlArg || "http://127.0.0.1:8787";

  try {
    if (!baseUrlArg) {
      serverProcess = spawn("node", ["apps/edge/src/dev-server.js"], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"]
      });
      serverProcess.stderr.on("data", (chunk) => {
        process.stderr.write(chunk);
      });
    }

    await waitForHealthy(baseUrl);

    spawnChecked("npm", ["init", "-y"], {
      cwd: tempRoot,
      stdio: "ignore"
    });
    spawnChecked("npm", ["install", installSpec], {
      cwd: tempRoot
    });
    await mkdir(outputDir, { recursive: true });

    const cliPath = join(tempRoot, "node_modules", ".bin", "flare");

    function runCli(args, configPath = configOwner) {
      const result = spawnSync(cliPath, [...args, "--url", baseUrl], {
        cwd: tempRoot,
        env: {
          ...process.env,
          FLARE_CONFIG: configPath
        },
        encoding: "utf8"
      });
      if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        throw new Error(detail || `flare ${args.join(" ")} failed`);
      }
      return parseOutput(result.stdout.trim());
    }

    const stamp = Date.now();
    const ownerEmail = `npm-smoke-owner-${stamp}@example.com`;
    const guestEmail = `npm-smoke-guest-${stamp}@example.com`;

    const helpText = spawnChecked(cliPath, ["help"], {
      cwd: tempRoot,
      env: {
        ...process.env,
        FLARE_CONFIG: configOwner
      }
    });
    assert(helpText.includes("flare auth register"), "Installed CLI did not return help output");

    const register = runCli(["auth", "register", "--email", ownerEmail, "--name", "Npm Smoke Owner"]);
    const workspace = register.workspace;
    assert(register.user?.email === ownerEmail, "Register did not return the created user");
    assert(workspace?.id, "Register did not return the workspace");

    const whoami = unwrap(runCli(["auth", "whoami"]), "user");
    assert(whoami?.email === ownerEmail, "whoami did not return the current user");

    const currentWorkspace = unwrap(runCli(["workspace"]), "workspace");
    assert(currentWorkspace?.id === workspace.id, "workspace did not return the current workspace");

    const listedWorkspaces = unwrap(runCli(["workspaces"]), "workspaces");
    assert(
      Array.isArray(listedWorkspaces) && listedWorkspaces.some((entry) => entry.id === workspace.id),
      "workspaces did not include the current workspace"
    );

    runCli(["workspace", "rename", "Npm Smoke HQ"]);
    assert(unwrap(runCli(["workspace"]), "workspace").name === "Npm Smoke HQ", "workspace rename failed");

    runCli(["workspace", "plan", "pro"]);
    const planWorkspace = unwrap(runCli(["workspace"]), "workspace");
    assert(planWorkspace.plan === "pro", "workspace plan update failed");

    runCli(["workspace", "quota-overrides", "--max-running-sessions", "3", "--max-storage-bytes", "4096"]);
    const quotaWorkspace = unwrap(runCli(["workspace"]), "workspace");
    assert(quotaWorkspace.quotaOverrides.maxRunningSessions === 3, "quota override maxRunningSessions failed");
    assert(quotaWorkspace.quotaOverrides.maxStorageBytes === 4096, "quota override maxStorageBytes failed");

    runCli(["workspace", "set-secret", "API_KEY", "--value", "smoke-secret"]);
    const secrets = unwrap(runCli(["workspace", "secrets"]), "secrets");
    assert(Array.isArray(secrets) && secrets.some((entry) => entry.name === "API_KEY"), "workspace secret set failed");

    const invite = unwrap(runCli(["workspace", "invite", "--email", guestEmail, "--role", "member"]), "invite");
    assert(invite?.code, "workspace invite failed");

    const guestRegister = runCli(["auth", "register", "--email", guestEmail, "--name", "Npm Smoke Guest"], configGuest);
    assert(guestRegister.user?.email === guestEmail, "guest register failed");

    const acceptedInvite = unwrap(runCli(["workspace", "accept-invite", "--code", invite.code], configGuest), "workspace");
    assert(acceptedInvite?.id === workspace.id, "workspace accept-invite failed");

    const members = unwrap(runCli(["workspace", "members"]), "members");
    assert(Array.isArray(members) && members.some((entry) => entry.userId === guestRegister.user.id), "guest member missing");

    runCli(["workspace", "set-role", guestRegister.user.id, "--role", "viewer"]);
    const updatedMembers = unwrap(runCli(["workspace", "members"]), "members");
    assert(
      updatedMembers.find((entry) => entry.userId === guestRegister.user.id)?.role === "viewer",
      "workspace set-role failed"
    );

    const auxLogin = runCli(["auth", "login", "--email", ownerEmail], configAux);
    assert(auxLogin.authSessionId, "auth login failed");
    const authSessionsResult = runCli(["auth", "sessions"]);
    const authSessions = Array.isArray(authSessionsResult)
      ? authSessionsResult
      : authSessionsResult?.authSessions || authSessionsResult?.sessions || authSessionsResult?.items || [];
    assert(Array.isArray(authSessions) && authSessions.length >= 2, "auth sessions did not list the extra session");
    const revokedSession = authSessions.find((entry) => entry.id !== register.authSessionId);
    assert(revokedSession, "extra auth session not found");
    runCli(["auth", "revoke-session", revokedSession.id]);

    const recoveryCodes = runCli(["auth", "recovery-generate"]);
    const recoveryCodeList = recoveryCodes?.codes || recoveryCodes?.recoveryCodes || [];
    assert(Array.isArray(recoveryCodeList) && recoveryCodeList.length > 0, "recovery code generation failed");

    const deviceStart = runCli(["auth", "device-start", "--email", ownerEmail]);
    const deviceCode = deviceStart?.code || deviceStart?.deviceCode;
    assert(deviceCode, "device start failed");
    runCli(["auth", "device-approve", "--code", deviceCode]);
    const deviceExchange = runCli(["auth", "device-exchange", "--code", deviceCode], configAux);
    assert(deviceExchange.token, "device exchange failed");

    const template = unwrap(
      runCli(["template", "create", "npm-cli-smoke-template", "--description", "Published npm CLI smoke"]),
      "template"
    );
    assert(template.id, "template create failed");

    const uploadResult = runCli([
      "template",
      "upload",
      template.id,
      "--version",
      "1.0.0",
      "--notes",
      "npm install smoke",
      "--persisted-paths",
      "/workspace"
    ]);
    const uploadedVersion = unwrap(uploadResult, "templateVersion");
    const uploadBuild = unwrap(uploadResult, "build");
    assert(uploadedVersion?.id && uploadBuild?.id, "template upload failed");

    const builds = unwrap(runCli(["builds"]), "builds");
    assert(Array.isArray(builds) && builds.some((entry) => entry.id === uploadBuild.id), "build list missing new build");

    runCli(["build", "process"]);
    const buildLog = runCli(["build", "log", uploadBuild.id]);
    assert(
      (typeof buildLog === "string" && buildLog.length > 0) ||
        (buildLog && typeof buildLog.log === "string" && buildLog.log.length > 0),
      "build log did not return content"
    );
    const buildArtifact = runCli(["build", "artifact", uploadBuild.id]);
    assert(buildArtifact.imageReference && buildArtifact.imageDigest, "build artifact did not return image metadata");

    const inspect = runCli(["template", "inspect", template.id]);
    assert(unwrap(inspect, "template").id === template.id, "template inspect failed");

    const release = unwrap(runCli(["template", "promote", template.id, uploadedVersion.id]), "release");
    assert(release.id, "template promote failed");
    const releases = unwrap(runCli(["releases"]), "releases");
    assert(Array.isArray(releases) && releases.some((entry) => entry.id === release.id), "release list missing promoted release");

    const session = unwrap(runCli(["session", "up", "npm-cli-smoke-session", "--template", template.id]), "session");
    assert(session.id, "session up failed");

    const sessionStatus = unwrap(runCli(["session", "status", session.id]), "session");
    assert(sessionStatus.id === session.id, "session status failed");
    const sessions = unwrap(runCli(["sessions"]), "sessions");
    assert(Array.isArray(sessions) && sessions.some((entry) => entry.id === session.id), "session list missing new session");

    const preview = runCli(["session", "preview", session.id]);
    assert(
      (typeof preview === "string" && preview.includes(`/runtime/sessions/${session.id}/preview`)) ||
        (preview && preview.url),
      "session preview did not return a URL"
    );
    const editor = runCli(["session", "editor", session.id]);
    assert(
      (typeof editor === "string" && editor.includes(`/runtime/sessions/${session.id}/editor`)) ||
        (editor && editor.url),
      "session editor did not return a URL"
    );
    const ssh = runCli(["session", "ssh", session.id, "--print"]);
    assert(
      ssh &&
        typeof ssh === "object" &&
        typeof ssh.sshUrl === "string" &&
        ssh.sshUrl.includes(`/runtime/sessions/${session.id}/ssh?token=`),
      "session ssh did not return attach details"
    );
    const events = unwrap(runCli(["session", "events", session.id]), "events");
    assert(Array.isArray(events) && events.length > 0, "session events were not returned");

    const snapshotFile = join(outputDir, "snapshot.bin");
    await writeFile(snapshotFile, "snapshot-content");
    const snapshot = unwrap(runCli(["snapshot", "save", session.id, "--label", "manual", "--file", snapshotFile]), "snapshot");
    assert(snapshot.id, "snapshot save failed");

    const snapshots = unwrap(runCli(["snapshot", "list", session.id]), "snapshots");
    assert(Array.isArray(snapshots) && snapshots.some((entry) => entry.id === snapshot.id), "snapshot list missing saved snapshot");

    const snapshotOutput = join(outputDir, "snapshot-restored.bin");
    const snapshotGet = runCli(["snapshot", "get", session.id, snapshot.id, "--output", snapshotOutput]);
    assert(typeof snapshotGet.bytes === "number" && snapshotGet.bytes > 0, "snapshot get did not return byte metadata");
    assert(await readFile(snapshotOutput, "utf8") === "snapshot-content", "snapshot get returned the wrong file contents");

    const snapshotRestore = runCli(["snapshot", "restore", session.id, snapshot.id]);
    assert(snapshotRestore?.session?.lastRestoredSnapshotId === snapshot.id, "snapshot restore failed");

    const usage = unwrap(runCli(["usage"]), "usage");
    assert(typeof usage.runtimeMinutes === "number" && usage.inventory, "usage did not return usage details");

    const report = unwrap(runCli(["report"]), "report");
    assert(typeof report.releases === "number", "report did not return counters");

    const exportPath = join(outputDir, "workspace-export.json");
    const exported = runCli(["export", "--output", exportPath]);
    assert(exported.output === exportPath, "export did not write the expected file");
    const exportedPayload = JSON.parse(await readFile(exportPath, "utf8"));
    assert(exportedPayload?.export?.workspace?.id === workspace.id, "exported workspace payload was not written");

    const reconcilePreview = unwrap(runCli(["reconcile", "preview"]), "preview");
    assert(typeof reconcilePreview.sleptSessions === "number", "reconcile preview did not return counters");
    const sleepRunning = runCli(["reconcile", "sleep-running"]);
    assert(typeof (sleepRunning.sleptSessions ?? sleepRunning.processed) === "number", "reconcile sleep-running failed");
    const recoverBuilds = runCli(["reconcile", "recover-builds"]);
    assert(
      typeof (recoverBuilds.recoveredStuckBuilds ?? recoverBuilds.recoveredBuilds ?? recoverBuilds.recovered) === "number",
      "reconcile recover-builds failed"
    );
    const purgeSleeping = runCli(["reconcile", "purge-sleeping"]);
    assert(
      typeof (purgeSleeping.purgedStaleSleepingSessions ?? purgeSleeping.deleted) === "number",
      "reconcile purge-sleeping failed"
    );

    runCli(["session", "start", session.id]);
    runCli(["session", "restart", session.id]);
    runCli(["session", "stop", session.id]);

    runCli(["snapshot", "delete", session.id, snapshot.id]);
    runCli(["session", "delete", session.id]);
    const purgeDeleted = runCli(["reconcile", "purge-deleted"]);
    assert(typeof (purgeDeleted.purgedDeletedSessions ?? purgeDeleted.deleted) === "number", "reconcile purge-deleted failed");

    runCli(["template", "archive", template.id]);
    runCli(["template", "restore", template.id]);
    runCli(["template", "delete", template.id]);

    runCli(["workspace", "delete-secret", "API_KEY"]);
    const secretsAfterDelete = unwrap(runCli(["workspace", "secrets"]), "secrets");
    assert(
      Array.isArray(secretsAfterDelete) && !secretsAfterDelete.some((entry) => entry.name === "API_KEY"),
      "workspace delete-secret failed"
    );

    runCli(["auth", "logout-all"]);
    const recovered = runCli(["auth", "recover", "--email", ownerEmail, "--code", recoveryCodeList[0]]);
    assert(recovered.token, "auth recover failed");
    runCli(["auth", "logout"]);

    const summary = {
      ok: true,
      installSpec,
      baseUrl,
      workspaceId: workspace.id,
      templateId: template.id,
      sessionId: session.id
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await new Promise((resolveKill) => {
        serverProcess.once("exit", resolveKill);
        setTimeout(resolveKill, 1000);
      });
    }
    await rm(tempRoot, {
      recursive: true,
      force: true
    });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
