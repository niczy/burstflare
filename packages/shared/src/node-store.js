import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BaseStore, createDefaultState } from "./store-base.js";

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

export function createFileStore(filePath) {
  return new FileStore(filePath);
}
