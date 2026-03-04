import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type BuilderConfig = {
  authToken: string;
  imageRepository: string;
  dockerBin: string;
  platform: string;
  push: boolean;
  keepTemp: boolean;
};

export type BuildRequest = {
  instanceId: string;
  buildId: string;
  builtAt: string;
  baseImage: string;
  dockerfilePath: string | null;
  dockerContext: string | null;
  bootstrapVersion: string;
};

export type BuildResponse = {
  managedRuntimeImage: string;
  managedImageDigest: string;
  artifactKey: string;
  artifactBody: string;
  artifactContentType: string;
};

export type BuildPlan = {
  imageRef: string;
  artifactKey: string;
  artifactBody: string;
  artifactContentType: string;
  dockerfile: string;
  bootstrapScript: string;
};

type BuildDeps = {
  mkdtemp(prefix: string): Promise<string>;
  writeFile(filePath: string, content: string, encoding: "utf8"): Promise<void>;
  readFile(filePath: string, encoding: "utf8"): Promise<string>;
  rm(filePath: string, options: { force: boolean; recursive: boolean }): Promise<void>;
  runCommand(command: string, args: string[], cwd: string): Promise<void>;
};

const DEFAULT_ARTIFACT_CONTENT_TYPE = "application/json; charset=utf-8";
const SAFE_IMAGE_REFERENCE = /^[a-zA-Z0-9._/@:-]+$/;
const SAFE_TAG_SEGMENT = /[^a-zA-Z0-9_.-]+/g;

const BOOTSTRAP_SCRIPT = `#!/bin/sh
set -eu

if [ -n "\${BURSTFLARE_STARTUP_HOOK:-}" ]; then
  hook_file="/tmp/burstflare-startup-hook.sh"
  printf '%s\n' "$BURSTFLARE_STARTUP_HOOK" > "$hook_file"
  chmod 700 "$hook_file"
  /bin/sh "$hook_file"
fi

if [ -x /usr/local/bin/burstflare-user-startup ]; then
  /usr/local/bin/burstflare-user-startup
fi

exec "$@"
`;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function runtimeServerPath(): string {
  return path.join(repoRoot(), "containers", "session", "server.mjs");
}

function sanitizeTagSegment(value: string): string {
  const normalized = String(value || "")
    .trim()
    .replace(SAFE_TAG_SEGMENT, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "build";
}

function ensureSafeImageReference(value: string, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized || !SAFE_IMAGE_REFERENCE.test(normalized)) {
    throw new Error(`${label} must be a safe container image reference`);
  }
  return normalized;
}

export function loadBuilderConfig(env: NodeJS.ProcessEnv = process.env): BuilderConfig {
  return {
    authToken: String(env.BUILDER_AUTH_TOKEN || "").trim(),
    imageRepository: String(env.BUILDER_IMAGE_REPOSITORY || "").trim(),
    dockerBin: String(env.BUILDER_DOCKER_BIN || "docker").trim() || "docker",
    platform: String(env.BUILDER_PLATFORM || "linux/amd64").trim() || "linux/amd64",
    push: String(env.BUILDER_PUSH || "1").trim() !== "0",
    keepTemp: String(env.BUILDER_KEEP_TEMP || "0").trim() === "1"
  };
}

export function parseBuildRequest(body: unknown): BuildRequest {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const instanceId = String(record.instanceId || "").trim();
  const buildId = String(record.buildId || "").trim();
  const builtAt = String(record.builtAt || "").trim();
  const baseImage = ensureSafeImageReference(record.baseImage as string, "baseImage");
  const bootstrapVersion = String(record.bootstrapVersion || "v1").trim() || "v1";
  if (!instanceId) {
    throw new Error("instanceId is required");
  }
  if (!buildId) {
    throw new Error("buildId is required");
  }
  if (!builtAt || Number.isNaN(Date.parse(builtAt))) {
    throw new Error("builtAt must be an ISO timestamp");
  }
  return {
    instanceId,
    buildId,
    builtAt,
    baseImage,
    dockerfilePath: record.dockerfilePath == null ? null : String(record.dockerfilePath || ""),
    dockerContext: record.dockerContext == null ? null : String(record.dockerContext || ""),
    bootstrapVersion
  };
}

function buildDockerfile(baseImage: string): string {
  return `FROM ${baseImage}

SHELL ["/bin/sh", "-lc"]
WORKDIR /app

COPY server.mjs /app/server.mjs
COPY bootstrap.sh /usr/local/bin/burstflare-bootstrap

RUN chmod 755 /usr/local/bin/burstflare-bootstrap \\
  && if ! command -v node >/dev/null 2>&1; then echo "Base image must already include Node.js" >&2; exit 1; fi \\
  && if command -v apk >/dev/null 2>&1; then \\
       apk add --no-cache openssh-server openssh-sftp-server shadow; \\
     elif command -v apt-get >/dev/null 2>&1; then \\
       apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openssh-server passwd && rm -rf /var/lib/apt/lists/*; \\
     elif command -v microdnf >/dev/null 2>&1; then \\
       microdnf install -y openssh-server shadow-utils && microdnf clean all; \\
     elif command -v dnf >/dev/null 2>&1; then \\
       dnf install -y openssh-server shadow-utils && dnf clean all; \\
     elif command -v yum >/dev/null 2>&1; then \\
       yum install -y openssh-server shadow-utils && yum clean all; \\
     else \\
       echo "Unsupported package manager in base image" >&2; exit 1; \\
     fi \\
  && if ! id -u flare >/dev/null 2>&1; then \\
       if command -v adduser >/dev/null 2>&1; then adduser -D flare 2>/dev/null || adduser --disabled-password --gecos '' flare; \\
       elif command -v useradd >/dev/null 2>&1; then useradd -m -s /bin/sh flare; \\
       else echo "No user creation tool available" >&2; exit 1; fi; \\
     fi \\
  && (echo "flare:burstflare-runtime" | chpasswd 2>/dev/null || true) \\
  && mkdir -p /run/sshd /var/run/sshd /home/flare/.ssh \\
  && chown -R flare:flare /home/flare 2>/dev/null || true

ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/burstflare-bootstrap"]
CMD ["node", "/app/server.mjs"]
`;
}

export function createBuildPlan(request: BuildRequest, config: BuilderConfig): BuildPlan {
  const repository = ensureSafeImageReference(config.imageRepository, "BUILDER_IMAGE_REPOSITORY");
  const tag = `${sanitizeTagSegment(request.instanceId)}-${sanitizeTagSegment(request.buildId)}`;
  const imageRef = `${repository}:${tag}`;
  const artifactKey = `instance-builds/${request.instanceId}/${request.buildId}.json`;
  const dockerfile = buildDockerfile(request.baseImage);
  const artifactBody = JSON.stringify(
    {
      format: "burstflare.remote-builder.v1",
      instanceId: request.instanceId,
      buildId: request.buildId,
      builtAt: request.builtAt,
      baseImage: request.baseImage,
      dockerfilePath: request.dockerfilePath,
      dockerContext: request.dockerContext,
      bootstrapVersion: request.bootstrapVersion,
      managedRuntimeImage: imageRef,
      runtimeContract: {
        entrypoint: "/usr/local/bin/burstflare-bootstrap",
        startupHookEnv: "BURSTFLARE_STARTUP_HOOK",
        runtimeServer: "/app/server.mjs"
      }
    },
    null,
    2
  );
  return {
    imageRef,
    artifactKey,
    artifactBody,
    artifactContentType: DEFAULT_ARTIFACT_CONTENT_TYPE,
    dockerfile,
    bootstrapScript: BOOTSTRAP_SCRIPT
  };
}

function parseBuildDigest(metadata: string): string {
  const parsed = JSON.parse(metadata || "{}");
  const direct =
    parsed["containerimage.digest"] ||
    parsed["containerimage.config.digest"] ||
    parsed?.containerimage?.digest ||
    parsed?.containerimage?.descriptor?.digest ||
    parsed?.["containerimage.descriptor"]?.digest;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  throw new Error("Build metadata did not contain a pushed image digest");
}

function defaultRunCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`));
    });
  });
}

function defaultDeps(): BuildDeps {
  return {
    mkdtemp,
    writeFile: (filePath, content, encoding) => writeFile(filePath, content, encoding),
    readFile: (filePath, encoding) => readFile(filePath, encoding),
    rm: (filePath, options) => rm(filePath, options),
    runCommand: defaultRunCommand
  };
}

export async function buildManagedRuntime(
  request: BuildRequest,
  config: BuilderConfig,
  deps: Partial<BuildDeps> = {}
): Promise<BuildResponse> {
  const mergedDeps = {
    ...defaultDeps(),
    ...deps
  } as BuildDeps;
  const plan = createBuildPlan(request, config);
  const workDir = await mergedDeps.mkdtemp(path.join(os.tmpdir(), "burstflare-builder-"));
  const metadataPath = path.join(workDir, "metadata.json");
  try {
    await mergedDeps.writeFile(path.join(workDir, "Dockerfile"), plan.dockerfile, "utf8");
    await mergedDeps.writeFile(path.join(workDir, "bootstrap.sh"), plan.bootstrapScript, "utf8");
    await mergedDeps.writeFile(
      path.join(workDir, "server.mjs"),
      await mergedDeps.readFile(runtimeServerPath(), "utf8"),
      "utf8"
    );
    const args = [
      "buildx",
      "build",
      "--file",
      "Dockerfile",
      "--platform",
      config.platform,
      "--tag",
      plan.imageRef,
      "--metadata-file",
      metadataPath
    ];
    if (config.push) {
      args.push("--push");
    } else {
      args.push("--load");
    }
    args.push(".");
    await mergedDeps.runCommand(config.dockerBin, args, workDir);
    const metadata = await mergedDeps.readFile(metadataPath, "utf8");
    return {
      managedRuntimeImage: plan.imageRef,
      managedImageDigest: parseBuildDigest(metadata),
      artifactKey: plan.artifactKey,
      artifactBody: plan.artifactBody,
      artifactContentType: plan.artifactContentType
    };
  } finally {
    if (!config.keepTemp) {
      await mergedDeps.rm(workDir, { force: true, recursive: true });
    }
  }
}
