import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { clone } from "./utils.js";

export function createDefaultState() {
  return {
    users: [],
    workspaces: [],
    memberships: [],
    authTokens: [],
    deviceCodes: [],
    templates: [],
    templateVersions: [],
    templateBuilds: [],
    sessions: [],
    snapshots: [],
    usageEvents: [],
    auditLogs: []
  };
}

class BaseStore {
  #queue = Promise.resolve();

  transact(work) {
    const next = this.#queue.then(async () => {
      const state = await this.load();
      const draft = clone(state);
      const result = await work(draft);
      await this.save(draft);
      return result;
    });
    this.#queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

class MemoryStore extends BaseStore {
  constructor(seed) {
    super();
    this.state = clone(seed || createDefaultState());
  }

  async load() {
    return this.state;
  }

  async save(nextState) {
    this.state = nextState;
  }
}

class FileStore extends BaseStore {
  constructor(filePath) {
    super();
    this.filePath = filePath;
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return { ...createDefaultState(), ...JSON.parse(raw) };
    } catch (error) {
      if (error.code === "ENOENT") {
        return createDefaultState();
      }
      throw error;
    }
  }

  async save(nextState) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(nextState, null, 2));
  }
}

export function createMemoryStore(seed) {
  return new MemoryStore(seed);
}

export function createFileStore(filePath) {
  return new FileStore(filePath);
}
