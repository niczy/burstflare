import { Container, getContainer } from "@cloudflare/containers";
import { createApp } from "./app.js";

export class BurstFlareSessionContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "15m";
}

export { createApp } from "./app.js";

export default {
  async fetch(request, env) {
    const app = createApp({
      ...env,
      containersEnabled: Boolean(env?.SESSION_CONTAINER),
      getSessionContainer(sessionId) {
        if (!env?.SESSION_CONTAINER) {
          return null;
        }
        return getContainer(env.SESSION_CONTAINER, sessionId);
      }
    });
    return app.fetch(request);
  }
};
