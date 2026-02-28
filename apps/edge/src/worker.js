import { Container, getContainer } from "@cloudflare/containers";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { createApp, createWorkerService, handleScheduled } from "./app.js";

const RUNTIME_STATE_KEY = "burstflare:runtime-state";

function nowIso() {
  return new Date().toISOString();
}

export class BurstFlareSessionContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "15m";

  async readRuntimeState() {
    const current = await this.ctx.storage.get(RUNTIME_STATE_KEY);
    if (current) {
      return current;
    }
    return {
      sessionId: null,
      desiredState: "stopped",
      status: "idle",
      runtimeState: "stopped",
      bootCount: 0,
      lastCommand: null,
      lastCommandAt: null,
      lastStartedAt: null,
      lastStoppedAt: null,
      lastStopReason: null,
      lastExitCode: null,
      lastError: null,
      updatedAt: null
    };
  }

  async writeRuntimeState(patch) {
    const current = await this.readRuntimeState();
    const next = {
      ...current,
      ...patch,
      updatedAt: nowIso()
    };
    await this.ctx.storage.put(RUNTIME_STATE_KEY, next);
    return next;
  }

  async getContainerStatus() {
    try {
      const state = await this.getState();
      return state?.status || "unknown";
    } catch (_error) {
      return "unknown";
    }
  }

  async getRuntimeState() {
    const current = await this.readRuntimeState();
    return {
      ...current,
      runtimeState: current.runtimeState || (await this.getContainerStatus())
    };
  }

  async waitForContainerStopped(retries = 20, waitMs = 100) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const state = await this.getContainerStatus();
      if (!["running", "healthy"].includes(state)) {
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return this.getContainerStatus();
  }

  async startRuntime(metadata = {}) {
    const current = await this.readRuntimeState();
    await this.startAndWaitForPorts();
    const containerState = await this.getContainerStatus();
    const startedAt = nowIso();
    return this.writeRuntimeState({
      sessionId: metadata.sessionId || current.sessionId || null,
      desiredState: "running",
      status: "running",
      runtimeState: containerState,
      bootCount: current.status === "running" ? current.bootCount || 0 : (current.bootCount || 0) + 1,
      lastCommand: "start",
      lastCommandAt: startedAt,
      lastStartedAt: startedAt,
      lastError: null
    });
  }

  async stopRuntime(reason = "stop") {
    const containerState = await this.getContainerStatus();
    if (["running", "healthy"].includes(containerState)) {
      await this.destroy().catch(() => {});
      await this.waitForContainerStopped();
    }
    const stoppedAt = nowIso();
    const current = await this.readRuntimeState();
    return this.writeRuntimeState({
      sessionId: current.sessionId || null,
      desiredState: "sleeping",
      status: "sleeping",
      runtimeState: "stopped",
      lastCommand: "stop",
      lastCommandAt: stoppedAt,
      lastStoppedAt: stoppedAt,
      lastStopReason: reason,
      lastError: null
    });
  }

  async restartRuntime(metadata = {}) {
    const current = await this.readRuntimeState();
    const containerState = await this.getContainerStatus();
    if (current.status === "running" || ["running", "healthy"].includes(containerState)) {
      await this.destroy().catch(() => {});
      await this.waitForContainerStopped();
    }
    await this.startAndWaitForPorts();
    const nextCurrent = await this.readRuntimeState();
    const restartedAt = nowIso();
    return this.writeRuntimeState({
      sessionId: metadata.sessionId || nextCurrent.sessionId || null,
      desiredState: "running",
      status: "running",
      runtimeState: await this.getContainerStatus(),
      bootCount: (nextCurrent.bootCount || 0) + 1,
      lastCommand: "restart",
      lastCommandAt: restartedAt,
      lastStartedAt: restartedAt,
      lastStoppedAt: restartedAt,
      lastStopReason: "restart",
      lastError: null
    });
  }

  async deleteRuntime() {
    await this.destroy().catch(() => {});
    await this.waitForContainerStopped();
    const deletedAt = nowIso();
    const current = await this.readRuntimeState();
    return this.writeRuntimeState({
      sessionId: current.sessionId || null,
      desiredState: "deleted",
      status: "deleted",
      runtimeState: "stopped",
      lastCommand: "delete",
      lastCommandAt: deletedAt,
      lastStoppedAt: deletedAt,
      lastStopReason: "delete",
      lastError: null
    });
  }

  async onStart() {
    const current = await this.readRuntimeState();
    await this.writeRuntimeState({
      sessionId: current.sessionId || null,
      desiredState: current.desiredState === "deleted" ? "deleted" : "running",
      status: current.desiredState === "deleted" ? "deleted" : "running",
      runtimeState: "healthy",
      lastError: null
    });
  }

  async onStop(params) {
    const current = await this.readRuntimeState();
    await this.writeRuntimeState({
      sessionId: current.sessionId || null,
      status: current.desiredState === "deleted" ? "deleted" : current.desiredState === "running" ? "sleeping" : current.status,
      runtimeState: "stopped",
      lastStoppedAt: current.lastStoppedAt || nowIso(),
      lastStopReason: params?.reason || current.lastStopReason || "stopped",
      lastExitCode: params?.exitCode ?? current.lastExitCode ?? null
    });
  }

  async onError(error) {
    await this.writeRuntimeState({
      status: "error",
      lastError: String(error?.message || error || "Unknown container error")
    });
    throw error;
  }
}

export class BurstFlareBuildWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const payload = event?.payload || {};
    const buildId = payload.buildId;
    if (!buildId) {
      throw new Error("Build ID is required");
    }

    const workflowName = payload.workflowName || this.env.BUILD_WORKFLOW_NAME || "burstflare-builds";
    const instanceId = payload.instanceId || null;
    const service = createWorkerService(this.env);
    try {
      await step.do("mark build workflow running", async () => {
        await service.markTemplateBuildWorkflow(buildId, {
          status: "running",
          instanceId,
          name: workflowName
        });
      });
    } catch (error) {
      if (error?.status === 404) {
        return {
          buildId,
          processed: 0,
          status: "missing",
          attempts: 0
        };
      }
      throw error;
    }

    try {
      return await step.do("execute template build", async () => {
        const result = await service.processTemplateBuildById(buildId, {
          source: "workflow"
        });
        return {
          buildId,
          processed: result.processed,
          status: result.build?.status || "skipped",
          attempts: result.build?.attempts || 0
        };
      });
    } catch (error) {
      if (error?.status === 404) {
        return {
          buildId,
          processed: 0,
          status: "missing",
          attempts: 0
        };
      }
      throw error;
    }
  }
}

function createRuntimeOptions(env) {
  return {
    ...env,
    containersEnabled: Boolean(env?.SESSION_CONTAINER),
    getSessionContainer(sessionId) {
      if (!env?.SESSION_CONTAINER) {
        return null;
      }
      return getContainer(env.SESSION_CONTAINER, sessionId);
    }
  };
}

export { createApp, createWorkerService } from "./app.js";

export default {
  async fetch(request, env) {
    const app = createApp(createRuntimeOptions(env));
    return app.fetch(request);
  },

  async queue(batch, env) {
    const service = createWorkerService(createRuntimeOptions(env));
    for (const message of batch.messages) {
      const body = message.body || {};
      if (body.type === "build" && body.buildId) {
        await service.processTemplateBuildById(body.buildId, {
          source: "queue"
        });
        continue;
      }
      if (body.type === "reconcile") {
        await service.reconcile();
      }
    }
  },

  async scheduled(controller, env) {
    await handleScheduled(controller, createRuntimeOptions(env));
  }
};
