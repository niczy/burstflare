# TypeScript Migration Plan

## Current Status

| Package | Status | Notes |
|---------|--------|-------|
| `packages/shared/*` | ✅ TypeScript | Fully migrated |
| `apps/web/app/*` | ✅ TypeScript | Next.js App Router |
| `apps/edge/*` | ✅ TypeScript | Migrated in PR #49 |
| `apps/cli/*` | ✅ TypeScript | Migrated in PR #51 |
| `test/*` | ✅ TypeScript | Migrated in PR #52 |

## Migration Complete

All three phases shipped and merged to main.

### Phase 1: apps/edge (PR #49) ✅
- `apps/edge/src/worker.js` → `worker.ts`
- `apps/edge/src/app.js` → `app.ts`
- `apps/edge/src/dev-server.js` → `dev-server.ts`
- Updated `wrangler.toml`, wrangler generator, smoke scripts
- Added `--import tsx/esm` to test/ssh-smoke scripts for TS resolution

### Phase 2: apps/cli (PR #51) ✅
- `apps/cli/src/cli.js` → `cli.ts`
- `apps/cli/src/runtime-deps.js` → `runtime-deps.ts` (included in PR #49)
- `apps/cli/src/postinstall.js` → `postinstall.ts` (postinstall fallback updated to use tsx)
- Added `WritableOutput` and `SpawnImpl` types for test mock compatibility
- Updated `ssh:smoke` and `ssh:smoke:live` scripts to use tsx loader

### Phase 3: test files (PR #52) ✅
- All 6 test files renamed from `.js` to `.ts`
- Removed `// @ts-check` directives
- Converted JSDoc annotations to TypeScript types
