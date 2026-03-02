import { BaseStore, createDefaultState } from "./store-base.js";
import { clone } from "./utils.js";

class MemoryStore extends BaseStore {
  state: any;

  constructor(seed?: any) {
    super();
    this.state = clone(seed || createDefaultState());
  }

  async load(): Promise<any> {
    return this.state;
  }

  async save(nextState: any): Promise<void> {
    this.state = nextState;
  }
}

export { createDefaultState } from "./store-base.js";

export function createMemoryStore(seed?: any): MemoryStore {
  return new MemoryStore(seed);
}
