# TypeScript Migration Plan

## Current Status

| Package | Status | Notes |
|---------|--------|-------|
| `packages/shared/*` | ✅ TypeScript | Fully migrated |
| `apps/web/app/*` | ✅ TypeScript | Next.js App Router |
| `apps/edge/*` | 🔶 JS with `@ts-check` | Partial types, needs migration |
| `apps/cli/*` | 🔶 JS with `@ts-check` | Partial types, needs migration |
| `test/*` | 🔶 JS with `@ts-check` | Partial types, needs migration |

## Migration Sequence

### Phase 1: apps/edge

Files to migrate:
- `apps/edge/src/worker.js` → `worker.ts`
- `apps/edge/src/app.js` → `app.ts`
- `apps/edge/src/dev-server.js` → `dev-server.ts`

Tasks:
1. Install `@cloudflare/workers-types` if needed
2. Rename files from `.js` to `.ts`
3. Replace JSDoc `@typedef` annotations with TypeScript interfaces
4. Update imports (remove `.js` extensions)
5. Remove redundant `@ts-check` comments
6. Verify with TypeScript compiler

### Phase 2: apps/cli

Files to migrate:
- `apps/cli/src/cli.js` → `cli.ts`
- `apps/cli/src/runtime-deps.js` → `runtime-deps.ts`

Tasks:
1. Ensure Node.js types are available
2. Rename files from `.js` to `.ts`
3. Convert JSDoc to TypeScript interfaces
4. Update imports
5. Remove `@ts-check` comments

### Phase 3: test files

Files to migrate:
- `test/worker.test.js`
- `test/container-server.test.js`
- `test/cloudflare-store.test.js`
- `test/services.test.js`
- `test/runtime-deps.test.js`
- `test/cli.test.js`

Tasks:
1. Rename test files to `.ts`
2. Add appropriate test framework types (Jest/Vitest)
3. Verify tests pass

## Key Considerations

1. **Build tooling**: Verify existing build scripts handle `.ts` files
2. **Import extensions**: TypeScript in NodeNext mode may require `.js` extension handling
3. **Type coverage**: Ensure all external types are installed (Cloudflare, Node.js, Jest)
4. **Incremental migration**: Each phase should be tested before proceeding
