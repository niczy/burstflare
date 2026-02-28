import { clone } from "./utils.js";

export function createDefaultState() {
  return {
    users: [],
    workspaces: [],
    memberships: [],
    workspaceInvites: [],
    authTokens: [],
    deviceCodes: [],
    templates: [],
    templateVersions: [],
    templateBuilds: [],
    bindingReleases: [],
    sessions: [],
    sessionEvents: [],
    snapshots: [],
    uploadGrants: [],
    usageEvents: [],
    auditLogs: []
  };
}

export class BaseStore {
  #queue = Promise.resolve();

  transact(work) {
    const next = this.#queue.then(async () => {
      const state = await this.load();
      const draft = clone(state);
      const result = await work(draft);
      await this.save(draft, state);
      return result;
    });
    this.#queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
