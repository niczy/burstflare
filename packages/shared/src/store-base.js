// @ts-check

import { clone } from "./utils.js";

/**
 * @typedef {{
 *   collections?: string[];
 * }} TransactionOptions
 */

/**
 * @typedef {{
 *   load(): Promise<any>;
 *   save(nextState: any, previousState?: any, options?: TransactionOptions): Promise<void>;
 *   loadCollections?: (collections: string[]) => Promise<any>;
 * }} TransactionStore
 */

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

  /**
   * @param {(draft: any) => any | Promise<any>} work
   * @param {TransactionOptions} [options]
   */
  #runTransaction(work, options = {}) {
    const store = /** @type {TransactionStore} */ (/** @type {unknown} */ (this));
    const next = this.#queue.then(async () => {
      const useScopedLoad =
        Array.isArray(options.collections) &&
        options.collections.length > 0 &&
        typeof store.loadCollections === "function";
      const state = useScopedLoad ? await store.loadCollections(options.collections) : await store.load();
      const draft = clone(state);
      const result = await work(draft);
      await store.save(draft, state, useScopedLoad ? { collections: options.collections } : undefined);
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

  /**
   * @param {string[]} collections
   * @param {(draft: any) => any | Promise<any>} work
   */
  transactCollections(collections, work) {
    return this.#runTransaction(work, { collections });
  }
}
