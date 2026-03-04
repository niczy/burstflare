import test from "node:test";
import assert from "node:assert/strict";
import { buildManagedRuntime, createBuildPlan, loadBuilderConfig, parseBuildRequest } from "../apps/builder/src/service.js";

test("builder parses config and creates a managed runtime build plan", () => {
  const config = loadBuilderConfig({
    BUILDER_IMAGE_REPOSITORY: "registry.example.com/burstflare/runtime",
    BUILDER_PLATFORM: "linux/arm64",
    BUILDER_PUSH: "0"
  });
  assert.equal(config.imageRepository, "registry.example.com/burstflare/runtime");
  assert.equal(config.platform, "linux/arm64");
  assert.equal(config.push, false);

  const request = parseBuildRequest({
    instanceId: "ins_demo",
    buildId: "bld_demo",
    builtAt: "2026-03-04T00:00:00.000Z",
    baseImage: "node:20",
    dockerfilePath: "./Dockerfile",
    dockerContext: ".",
    bootstrapVersion: "v1"
  });

  const plan = createBuildPlan(request, {
    ...config,
    push: true
  });
  assert.equal(plan.imageRef, "registry.example.com/burstflare/runtime:ins_demo-bld_demo");
  assert.match(plan.dockerfile, /FROM golang:1.24-alpine AS burstflare-runtime-build/);
  assert.match(plan.dockerfile, /FROM node:20/);
  assert.match(plan.dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/burstflare-bootstrap"\]/);
  assert.match(plan.dockerfile, /CMD \["\/usr\/local\/bin\/burstflare-runtime"\]/);
  assert.match(plan.bootstrapScript, /BURSTFLARE_STARTUP_HOOK/);
  const artifact = JSON.parse(plan.artifactBody);
  assert.equal(artifact.format, "burstflare.remote-builder.v1");
  assert.equal(artifact.managedRuntimeImage, plan.imageRef);
  assert.equal(artifact.runtimeContract.runtimeAgent, "/usr/local/bin/burstflare-runtime");
});

test("builder produces a digest from docker build metadata", async () => {
  const request = parseBuildRequest({
    instanceId: "ins_demo",
    buildId: "bld_demo",
    builtAt: "2026-03-04T00:00:00.000Z",
    baseImage: "node:20"
  });
  let ranCommand = false;
  let copiedRuntimeAgent = false;
  const writes = new Map<string, string>();

  const result = await buildManagedRuntime(
    request,
    {
      authToken: "",
      imageRepository: "registry.example.com/burstflare/runtime",
      dockerBin: "docker",
      platform: "linux/amd64",
      push: true,
      keepTemp: false
    },
    {
      async copyDir(sourcePath, destinationPath) {
        copiedRuntimeAgent = true;
        assert.match(String(sourcePath), /apps\/runtime-agent$/);
        assert.equal(destinationPath, "/tmp/builder-test/runtime-agent");
      },
      async mkdtemp() {
        return "/tmp/builder-test";
      },
      async writeFile(filePath, content) {
        writes.set(String(filePath), String(content));
      },
      async readFile(filePath) {
        if (String(filePath).endsWith("/metadata.json")) {
          return JSON.stringify({
            "containerimage.digest": "sha256:abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd"
          });
        }
        throw new Error(`Unexpected read: ${filePath}`);
      },
      async rm() {},
      async runCommand(command, args, cwd) {
        ranCommand = true;
        assert.equal(command, "docker");
        assert.equal(cwd, "/tmp/builder-test");
        assert.deepEqual(args.slice(0, 6), ["buildx", "build", "--file", "Dockerfile", "--platform", "linux/amd64"]);
        assert.equal(args.includes("--push"), true);
      }
    }
  );

  assert.equal(ranCommand, true);
  assert.equal(copiedRuntimeAgent, true);
  assert.equal(
    result.managedImageDigest,
    "sha256:abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd"
  );
  assert.equal(result.managedRuntimeImage, "registry.example.com/burstflare/runtime:ins_demo-bld_demo");
  assert.equal(result.artifactKey, "instance-builds/ins_demo/bld_demo.json");
  assert.equal(writes.has("/tmp/builder-test/Dockerfile"), true);
  assert.equal(writes.has("/tmp/builder-test/bootstrap.sh"), true);
});
