import { Container, getContainer } from "@cloudflare/containers";
import { createApp, createWorkerService, handleQueueBatch, handleScheduled } from "./app.js";

const RUNTIME_STATE_KEY = "burstflare:runtime-state";

interface RuntimeStorageContext {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

interface RuntimeState {
  sessionId: string | null;
  desiredState: string;
  status: string;
  runtimeState: string;
  bootCount: number;
  operationVersion: number;
  lastOperationId: string | null;
  lastCommand: string | null;
  lastCommandAt: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  lastStopReason: string | null;
  lastBootstrapAt: string | null;
  lastBootstrapSnapshotId: string | null;
  lastBootstrapState: string | null;
  lastLifecyclePhase: string | null;
  lastLifecycleAt: string | null;
  lastLifecycleReason: string | null;
  lastExitCode: number | null;
  lastError: string | null;
  updatedAt: string | null;
}

interface RuntimeStateInput {
  sessionId?: string | null;
  desiredState?: string;
  status?: string;
  runtimeState?: string;
  bootCount?: number;
  operationVersion?: number;
  lastOperationId?: string | null;
  lastCommand?: string | null;
  lastCommandAt?: string | null;
  lastStartedAt?: string | null;
  lastStoppedAt?: string | null;
  lastStopReason?: string | null;
  lastBootstrapAt?: string | null;
  lastBootstrapSnapshotId?: string | null;
  lastBootstrapState?: string | null;
  lastLifecyclePhase?: string | null;
  lastLifecycleAt?: string | null;
  lastLifecycleReason?: string | null;
  lastExitCode?: number | null;
  lastError?: string | null;
  updatedAt?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class BurstFlareSessionContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "15m";

  runtimeStorage(): RuntimeStorageContext {
    return (this as unknown as { ctx: { storage: RuntimeStorageContext } }).ctx.storage as RuntimeStorageContext;
  }

  async readRuntimeState(): Promise<RuntimeState> {
    const current = await this.runtimeStorage().get(RUNTIME_STATE_KEY) as RuntimeState | undefined;
    if (current) {
      return current;
    }
    return {
      sessionId: null,
      desiredState: "stopped",
      status: "idle",
      runtimeState: "stopped",
      bootCount: 0,
      operationVersion: 0,
      lastOperationId: null,
      lastCommand: null,
      lastCommandAt: null,
      lastStartedAt: null,
      lastStoppedAt: null,
      lastStopReason: null,
      lastBootstrapAt: null,
      lastBootstrapSnapshotId: null,
      lastBootstrapState: null,
      lastLifecyclePhase: null,
      lastLifecycleAt: null,
      lastLifecycleReason: null,
      lastExitCode: null,
      lastError: null,
      updatedAt: null
    };
  }

  async writeRuntimeState(patch: RuntimeStateInput): Promise<RuntimeState> {
    const current = await this.readRuntimeState();
    const next: RuntimeState = {
      ...current,
      ...patch,
      updatedAt: nowIso()
    };
    await this.runtimeStorage().put(RUNTIME_STATE_KEY, next);
    return next;
  }

  async getContainerStatus(): Promise<string> {
    try {
      const state = await this.getState();
      return state?.status || "unknown";
    } catch {
      return "unknown";
    }
  }

  async getRuntimeState(): Promise<{
    sessionId: string | null;
    desiredState: string;
    status: string;
    runtimeState: string;
    bootCount: number;
    operationVersion: number;
    lastOperationId: string | null;
    lastCommand: string | null;
    lastCommandAt: string | null;
    lastStartedAt: string | null;
    lastStoppedAt: string | null;
    lastStopReason: string | null;
    lastBootstrapAt: string | null;
    lastBootstrapSnapshotId: string | null;
    lastBootstrapState: string | null;
    lastLifecyclePhase: string | null;
    lastLifecycleAt: string | null;
    lastLifecycleReason: string | null;
    lastExitCode: number | null;
    lastError: string | null;
    updatedAt: string | null;
    version: number;
    operationId: string | null;
  }> {
    const current = await this.readRuntimeState();
    return {
      ...current,
      version: current.operationVersion || 0,
      operationId: current.lastOperationId || null,
      runtimeState: current.runtimeState || (await this.getContainerStatus())
    };
  }

  nextOperation(current: RuntimeState | undefined): { operationVersion: number; lastOperationId: string } {
    return {
      operationVersion: (current?.operationVersion || 0) + 1,
      lastOperationId: globalThis.crypto.randomUUID()
    };
  }

  async waitForContainerStopped(retries = 20, waitMs = 100): Promise<string> {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const state = await this.getContainerStatus();
      if (!["running", "healthy"].includes(state)) {
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return this.getContainerStatus();
  }

  async startRuntime(metadata: { sessionId?: string } = {}): Promise<ReturnType<typeof this.getRuntimeState>> {
    const current = await this.readRuntimeState();
    await this.startAndWaitForPorts();
    const containerState = await this.getContainerStatus();
    const startedAt = nowIso();
    const operation = this.nextOperation(current);
    await this.writeRuntimeState({
      sessionId: metadata.sessionId || current.sessionId || null,
      desiredState: "running",
      status: "running",
      runtimeState: containerState,
      ...operation,
      bootCount: current.status === "running" ? current.bootCount || 0 : (current.bootCount || 0) + 1,
      lastCommand: "start",
      lastCommandAt: startedAt,
      lastStartedAt: startedAt,
      lastError: null
    });
    return this.getRuntimeState();
  }

  async stopRuntime(reason = "stop"): Promise<ReturnType<typeof this.getRuntimeState>> {
    const containerState = await this.getContainerStatus();
    if (["running", "healthy"].includes(containerState)) {
      await this.destroy().catch(() => {});
      await this.waitForContainerStopped();
    }
    const stoppedAt = nowIso();
    const current = await this.readRuntimeState();
    const operation = this.nextOperation(current);
    await this.writeRuntimeState({
      sessionId: current.sessionId || null,
      desiredState: "sleeping",
      status: "sleeping",
      runtimeState: "stopped",
      ...operation,
      lastCommand: "stop",
      lastCommandAt: stoppedAt,
      lastStoppedAt: stoppedAt,
      lastStopReason: reason,
      lastError: null
    });
    return this.getRuntimeState();
  }

  async restartRuntime(metadata: { sessionId?: string } = {}): Promise<ReturnType<typeof this.getRuntimeState>> {
    const current = await this.readRuntimeState();
    const containerState = await this.getContainerStatus();
    if (current.status === "running" || ["running", "healthy"].includes(containerState)) {
      await this.destroy().catch(() => {});
      await this.waitForContainerStopped();
    }
    await this.startAndWaitForPorts();
    const nextCurrent = await this.readRuntimeState();
    const restartedAt = nowIso();
    const operation = this.nextOperation(nextCurrent);
    await this.writeRuntimeState({
      sessionId: metadata.sessionId || nextCurrent.sessionId || null,
      desiredState: "running",
      status: "running",
      runtimeState: await this.getContainerStatus(),
      ...operation,
      bootCount: (nextCurrent.bootCount || 0) + 1,
      lastCommand: "restart",
      lastCommandAt: restartedAt,
      lastStartedAt: restartedAt,
      lastStoppedAt: restartedAt,
      lastStopReason: "restart",
      lastError: null
    });
    return this.getRuntimeState();
  }

  async deleteRuntime(): Promise<ReturnType<typeof this.getRuntimeState>> {
    await this.destroy().catch(() => {});
    await this.waitForContainerStopped();
    const deletedAt = nowIso();
    const current = await this.readRuntimeState();
    const operation = this.nextOperation(current);
    await this.writeRuntimeState({
      sessionId: current.sessionId || null,
      desiredState: "deleted",
      status: "deleted",
      runtimeState: "stopped",
      ...operation,
      lastCommand: "delete",
      lastCommandAt: deletedAt,
      lastStoppedAt: deletedAt,
      lastStopReason: "delete",
      lastError: null
    });
    return this.getRuntimeState();
  }

  async recordBootstrap(metadata: { sessionId?: string; lastRestoredSnapshotId?: string | null; state?: string | null } = {}): Promise<ReturnType<typeof this.getRuntimeState>> {
    await this.writeRuntimeState({
      sessionId: metadata.sessionId || null,
      lastBootstrapAt: nowIso(),
      lastBootstrapSnapshotId: metadata.lastRestoredSnapshotId || null,
      lastBootstrapState: metadata.state || null
    });
    return this.getRuntimeState();
  }

  async recordLifecycleHook(metadata: { sessionId?: string; phase?: string | null; reason?: string | null } = {}): Promise<ReturnType<typeof this.getRuntimeState>> {
    await this.writeRuntimeState({
      sessionId: metadata.sessionId || null,
      lastLifecyclePhase: metadata.phase || null,
      lastLifecycleAt: nowIso(),
      lastLifecycleReason: metadata.reason || metadata.phase || null
    });
    return this.getRuntimeState();
  }

  async onStart(): Promise<void> {
    const current = await this.readRuntimeState();
    await this.writeRuntimeState({
      sessionId: current.sessionId || null,
      desiredState: current.desiredState === "deleted" ? "deleted" : "running",
      status: current.desiredState === "deleted" ? "deleted" : "running",
      runtimeState: "healthy",
      lastError: null
    });
  }

  async onStop(params?: { reason?: string; exitCode?: number }): Promise<void> {
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

  async onError(error: unknown): Promise<never> {
    await this.writeRuntimeState({
      status: "error",
      lastError: String((error as Error)?.message || error || "Unknown container error")
    });
    throw error;
  }
}

interface EnvWithSessionContainer {
  SESSION_CONTAINER?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  [key: string]: unknown;
}

interface RuntimeOptions {
  containersEnabled: boolean;
  getFrontendAssetResponse?: (request: Request) => Promise<Response | null> | Response | null;
  getSessionContainer?: (sessionId: string) => ReturnType<typeof getContainer> | null;
}

function createRuntimeOptions(env: EnvWithSessionContainer): RuntimeOptions {
  return {
    ...env,
    containersEnabled: Boolean(env?.SESSION_CONTAINER),
    async getFrontendAssetResponse(request: Request): Promise<Response | null> {
      if (!env?.ASSETS || !["GET", "HEAD"].includes(request.method)) {
        return null;
      }
      return env.ASSETS.fetch(request);
    },
    getSessionContainer(sessionId: string) {
      if (!env?.SESSION_CONTAINER) {
        return null;
      }
      return getContainer(env.SESSION_CONTAINER, sessionId);
    }
  };
}

export { createApp, createWorkerService } from "./app.js";

export default {
  async fetch(request: Request, env: EnvWithSessionContainer): Promise<Response> {
    const app = createApp(createRuntimeOptions(env));
    return app.fetch(request);
  },

  async queue(batch: { messages: { body: unknown }[] }, env: EnvWithSessionContainer): Promise<void> {
    await handleQueueBatch(batch, createRuntimeOptions(env));
  },

  async scheduled(controller: { cron?: string }, env: EnvWithSessionContainer): Promise<void> {
    await handleScheduled(controller, createRuntimeOptions(env));
  }
};
