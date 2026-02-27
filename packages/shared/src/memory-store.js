import { BaseStore, createDefaultState } from "./store-base.js";
import { clone } from "./utils.js";

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

export { createDefaultState } from "./store-base.js";

export function createMemoryStore(seed) {
  return new MemoryStore(seed);
}
