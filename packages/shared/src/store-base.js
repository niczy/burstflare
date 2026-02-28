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

  #runTransaction(work, options = {}) {
    const next = this.#queue.then(async () => {
      const useScopedLoad =
        Array.isArray(options.collections) &&
        options.collections.length > 0 &&
        typeof this.loadCollections === "function";
      const state = useScopedLoad ? await this.loadCollections(options.collections) : await this.load();
      const draft = clone(state);
      const result = await work(draft);
      await this.save(draft, state, useScopedLoad ? { collections: options.collections } : undefined);
      return result;
    });
    this.#queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  transact(work) {
    return this.#runTransaction(work);
  }

  transactCollections(collections, work) {
    return this.#runTransaction(work, { collections });
  }
}
