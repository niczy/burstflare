import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BaseStore, createDefaultState } from "./store-base.js";

class FileStore extends BaseStore {
  filePath: string;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  async load(): Promise<any> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return { ...createDefaultState(), ...JSON.parse(raw) };
    } catch (error: unknown) {
      const typedError = error as NodeJS.ErrnoException;
      if (typedError.code === "ENOENT") {
        return createDefaultState();
      }
      throw error;
    }
  }

  async save(nextState: any): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(nextState, null, 2));
  }
}

export function createFileStore(filePath: string): FileStore {
  return new FileStore(filePath);
}
