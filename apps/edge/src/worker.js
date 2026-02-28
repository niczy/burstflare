import { Container, getContainer } from "@cloudflare/containers";
import { createApp, createWorkerService } from "./app.js";

export class BurstFlareSessionContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "15m";
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
  }
};
