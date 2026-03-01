declare module "cloudflare:workers" {
  export class WorkflowEntrypoint {
    env: Record<string, unknown>;
    ctx: unknown;
    constructor(ctx: unknown, env: Record<string, unknown>);
    run(event: unknown, step: unknown): Promise<unknown>;
  }
}
