import { clone } from "./utils.js";

type TransactionOptions = {
  collections?: string[];
};

type TransactionStore = {
  load(): Promise<any>;
  save(nextState: any, previousState?: any, options?: TransactionOptions): Promise<void>;
  loadCollections?: (collections: string[]) => Promise<any>;
};

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

  #runTransaction<T>(work: (draft: any) => T | Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const store = this as unknown as TransactionStore;
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

  transact<T>(work: (draft: any) => T | Promise<T>): Promise<T> {
    return this.#runTransaction(work);
  }

  transactCollections<T>(collections: string[], work: (draft: any) => T | Promise<T>): Promise<T> {
    return this.#runTransaction(work, { collections });
  }
}
