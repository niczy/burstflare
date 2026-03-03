# Product Simplification: Instance + Session Model

## Motivation

The current BurstFlare product model has five core concepts: **workspace**, **template** (with versions, builds, promotions, releases), **session**, and **snapshot** (with full history). This is powerful but too complex for most users. The upload → build → promote → release pipeline, version management, snapshot history, and workspace scoping create friction that doesn't justify itself for the primary use case: "I need a machine, fast."

This document proposes collapsing the model to two concepts: **Instance** and **Session**.

## New Mental Model

```
User
  └── Instance (defines what to run)
        ├── Docker image reference
        ├── Environment variables / secrets
        ├── Persisted paths configuration
        ├── Common state (shared R2 prefix)
        └── Sessions (running environments)
              ├── Session A (own isolated state)
              ├── Session B (own isolated state)
              └── Session C (own isolated state)
```

An **Instance** is what you configure once. A **Session** is what you launch and work in. That's it.

## Concept Mapping

| Current concept | New concept | Notes |
|----------------|-------------|-------|
| Workspace | User account (flat) | Remove workspace indirection for v1; one user = one account |
| Template | Instance | No versions, no builds, no promotion. Just a docker image ref + config. |
| Template version | *(removed)* | Instance points directly at an image. Update = edit the instance. |
| Template build | CLI-side Docker build | No server-side builds. CLI builds locally from Dockerfile and pushes to registry. |
| Promotion / release | *(removed)* | No release pipeline. Editing instance config takes effect on next session start. |
| Session | Session | Same concept, but tied to an Instance instead of a Template. |
| Snapshot (list) | Latest snapshot (one per session) | No history. Only the most recent snapshot is retained. |
| Workspace secrets | Instance env vars | Scoped to instance, not workspace. |

## Instance

### Definition

An Instance is a named configuration that defines how sessions run.

```typescript
interface Instance {
  id: string;
  userId: string;
  name: string;
  description: string;

  // Runtime definition
  image: string;                      // e.g. "node:20", "ubuntu:24.04", OCI registry URL
  dockerfilePath: string | null;      // local path used by CLI for rebuild; null if --image was used
  dockerContext: string | null;       // build context directory; null if --image was used
  envVars: Record<string, string>;    // non-sensitive config (visible in UI)
  secrets: Record<string, string>;    // sensitive config (write-only in UI)

  // Common state (/home/flare)
  commonStateKey: string;             // R2 prefix for shared /home/flare across sessions

  // Metadata
  createdAt: string;
  updatedAt: string;
}
```

### Key behaviors

1. **No versioning.** An Instance has exactly one configuration at any time. Editing it is a direct mutation, not a new version.
2. **No server-side build pipeline.** The `image` field is a reference to an already-built image. The CLI can build from a Dockerfile locally (see below), but the server never runs builds.
3. **Changes apply on next start.** If you change the image or env vars on an Instance, already-running sessions are unaffected. The next session to start picks up the new config.
4. **Secrets are write-only.** Once set, secret values are never returned by the API. They're injected into sessions at bootstrap time.

### Creating from a Dockerfile

`flare instance create` supports two modes:

**From an existing image:**
```
flare instance create my-env --image node:20
```

**From a local Dockerfile:**
```
flare instance create my-env --dockerfile ./Dockerfile
flare instance create my-env --dockerfile ./dev/Dockerfile --context .
```

When `--dockerfile` is provided, the CLI:

1. Runs `docker build` locally using the user's Docker daemon.
2. Tags the image as `registry.cloudflare.com/{accountId}/flare-{instanceName}:{hash}`.
3. Pushes the image to the Cloudflare container registry.
4. Creates the Instance with the pushed image URL.

This keeps builds client-side (no server build queue, no build workers, no build logs to manage) while still giving users who don't have a pre-built image a one-command path. The same flow works for `flare instance edit --dockerfile` to update the image.

**Requirements:** Docker must be installed and running on the user's machine. The CLI detects this and gives a clear error if Docker is unavailable.

**Rebuild shortcut:**
```
flare instance rebuild <id>
```
Re-runs the local Docker build using the Dockerfile path stored in the Instance metadata, pushes, and updates the image. Useful after editing the Dockerfile.

### API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/instances` | Create a new instance |
| GET | `/api/instances` | List user's instances |
| GET | `/api/instances/:id` | Get instance detail |
| PATCH | `/api/instances/:id` | Update instance config (image, env, secrets, paths) |
| DELETE | `/api/instances/:id` | Delete instance and all its sessions |

### CLI

```
flare instance create <name> --image <image> [--env KEY=VAL]... [--secret KEY=VAL]...
flare instance create <name> --dockerfile <path> [--context <dir>] [--env KEY=VAL]...
flare instance list
flare instance show <id>
flare instance edit <id> [--image <image>] [--dockerfile <path>]
flare instance rebuild <id>             # re-build + push from stored Dockerfile path
flare instance env set <id> KEY=VAL
flare instance env unset <id> KEY
flare instance secret set <id> KEY=VAL
flare instance secret unset <id> KEY
flare instance delete <id>
```

## Session

### Definition

A Session is a running (or sleeping) container environment launched from an Instance.

```typescript
interface Session {
  id: string;
  instanceId: string;
  userId: string;
  name: string;
  state: "starting" | "running" | "sleeping" | "stopped" | "failed" | "deleted";

  // Runtime state
  runtimeStatus: string | null;
  runtimeVersion: number;

  // Snapshot (latest only)
  latestSnapshotId: string | null;
  latestSnapshotAt: string | null;
  latestSnapshotBytes: number | null;

  // Metadata
  imageAtLaunch: string;              // frozen copy of instance.image at start time
  createdAt: string;
  updatedAt: string;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
}
```

### Key behaviors

1. **Multiple sessions per instance.** A user can run any number of sessions from the same Instance, each with its own isolated workspace. No per-instance session limit.
2. **Isolated state.** Each session has its own snapshot in R2. The system persists `/workspace` automatically — this is not user-configurable. Session A's `/workspace` is completely separate from Session B's.
3. **Common state.** All sessions of the same Instance share a common R2 prefix. This is mounted read-write and changes are visible across sessions. See the Common State section below.
4. **Single snapshot.** Each session retains only its latest snapshot. When a new snapshot is saved (on sleep, stop, or manual save), it replaces the previous one. No history, no restore-from-list.
5. **Image frozen at start.** When a session starts, it records `imageAtLaunch` from the Instance config. If the Instance image is later changed, this session continues using the image it started with until it's stopped and restarted.

### API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/instances/:id/sessions` | Create and start a session |
| GET | `/api/instances/:id/sessions` | List sessions for an instance |
| GET | `/api/sessions/:id` | Get session detail |
| POST | `/api/sessions/:id/start` | Start/wake a sleeping session |
| POST | `/api/sessions/:id/stop` | Stop (sleep) a session |
| POST | `/api/sessions/:id/restart` | Restart a session |
| DELETE | `/api/sessions/:id` | Delete a session and its snapshot |
| POST | `/api/sessions/:id/snapshot` | Force an immediate snapshot save |
| POST | `/api/sessions/:id/ssh-token` | Get SSH attach credentials |

### CLI

```
flare up <name> --instance <id>            # create + start
flare list [--instance <id>]               # list sessions
flare status <session-id>
flare ssh <session-id>
flare stop <session-id>
flare start <session-id>
flare restart <session-id>
flare delete <session-id>
flare snapshot <session-id>                # force save now
flare preview <session-id>
flare editor <session-id>
```

## Common State (`/home/flare`)

### Concept

Every Instance has a **common state** — the user's home directory `/home/flare`. Since the user SSHs in as `flare`, this means dotfiles (`.bashrc`, `.gitconfig`, `.ssh/config`, tool caches), scripts, and any home-directory config are automatically shared across all sessions of the same Instance.

This is separate from `/workspace`, which is per-session isolated state.

### Implementation

Common state is backed by an R2 prefix scoped to the Instance:

```
R2: burstflare-snapshots/{instanceId}/home/
```

**Sync model: auto-pull on start, auto-push on stop, explicit push/pull mid-session.**

1. **On session start:** the container bootstrap pulls the latest `/home/flare` snapshot from R2 and hydrates the home directory.
2. **During runtime:** `/home/flare` is a normal local directory. Changes are local to this session until pushed.
3. **On session stop/sleep:** the container automatically pushes `/home/flare` back to R2 before shutting down.
4. **Mid-session:** the user can run `flare instance push` or `flare instance pull` at any time for immediate sync without restart.

There is **no live sync**. This is deliberate — it avoids distributed filesystem complexity, conflict resolution, and sync daemons. The model is simple and predictable: changes flow through R2 at session boundaries, with manual commands for mid-session sync.

**Concurrent stop:** If two sessions stop simultaneously, last-write-wins at the file level (R2 object timestamps). This is acceptable since there's no real-time coordination — users pushing shared state understand they're overwriting.

### What gets shared vs. isolated

| Path | Scope | Snapshot timing |
|------|-------|-----------------|
| `/home/flare` | **Shared** across all sessions of an Instance | Pull on start, push on stop |
| `/workspace` | **Isolated** per session | Pull on start, push on stop |
| Everything else | **Ephemeral** | Lost on stop |

This maps to how developers naturally think: "my home directory is me, my workspace is my project."

### CLI commands

```
flare instance push <id>              # upload current session's /home/flare to R2
flare instance pull <id>              # download latest /home/flare from R2 into current session (without restart)
```

### Future enhancement

Live sync (R2 polling + inotify push with last-write-wins) can be added later as an opt-in feature on the Instance (`"syncMode": "live"`) without changing the data model. The pull-on-start default remains the safe, simple path.

## Snapshot Simplification

### Current model

Each session can have many snapshots. Users list, browse, and restore specific snapshots. The system tracks snapshot metadata, upload state, and R2 keys for each one.

### New model

Each session has **at most one snapshot** — the latest one. This simplifies everything:

| Operation | Behavior |
|-----------|----------|
| Auto-save on sleep/stop | Overwrites the single snapshot |
| Manual save | Overwrites the single snapshot |
| Restore on start | Restores the single snapshot (no choice needed) |
| Delete session | Deletes the single snapshot |
| List snapshots | Not needed — session detail includes snapshot metadata |

**R2 layout:**

```
burstflare-snapshots/{instanceId}/sessions/{sessionId}/snapshot.tar.gz
```

One key per session. Overwritten in place. No versioning.

### Migration from current model

For existing sessions with multiple snapshots:
1. Keep the most recent snapshot.
2. Delete all older snapshots from R2.
3. Update the session record to point to the single remaining snapshot.

## Billing Changes

### Current billing model

Billing is tied to **workspaces**. Every workspace has a `billing` object that tracks:
- Stripe customer ID, payment method, subscription status
- Usage totals: `runtimeMinutes`, `snapshots`, `templateBuilds`
- Invoice history and webhook state

Usage events are scoped to `workspaceId`. The billing catalog prices three metrics:
- Runtime minutes: $0.03/min
- Snapshots: $0.02/snapshot (per save operation)
- Template builds: $0.10/build

Storage is tracked (`summarizeStorage`) but **not billed** — it's only used for quota enforcement.

### What needs to change

1. **Billing owner: workspace → user.** Since workspaces are removed, billing state moves to the user account. Each user has one Stripe customer, one payment method, one billing record.

2. **Remove `templateBuilds` metric.** No server-side builds. Remove from usage tracking, billing catalog, and invoice line items.

3. **Add `storageGbMonths` metric.** Charge for R2 storage at the same rate Cloudflare charges us: $0.015/GB-month. This covers:
   - Per-session snapshot storage (`snapshot.tar.gz`)
   - Common state storage (`/home/flare` R2 prefix)

4. **Simplify `snapshots` metric.** With single-snapshot-per-session, there's no meaningful per-save billing. Replace with storage-based billing. Remove the per-snapshot-save charge.

5. **Track storage usage events.** Add a periodic job (cron, e.g. daily) that measures each user's total R2 storage and writes a `storage_gb_day` usage event. At invoice time, sum daily measurements and convert to GB-months.

### New billing catalog

```typescript
const BILLING_CATALOG = {
  currency: "usd",
  runtimeMinuteUsd: 0.03,        // unchanged
  storageGbMonthUsd: 0.015,      // same as R2 Standard pricing
};
```

### New usage tracking

```typescript
// Usage totals per user
interface UsageTotals {
  runtimeMinutes: number;         // accumulated runtime across all sessions
  storageGbDays: number;          // accumulated daily storage measurements
}

// Derived at invoice time
interface BillableUsage {
  runtimeMinutes: number;
  storageGbMonths: number;        // storageGbDays / 30
}
```

### New usage summary function

```typescript
function summarizeUsage(state, userId) {
  const usage = {
    runtimeMinutes: 0,
    storageGbDays: 0,
  };
  for (const event of state.usageEvents) {
    if (event.userId !== userId) continue;
    if (event.kind === "runtime_minutes") usage.runtimeMinutes += event.value;
    if (event.kind === "storage_gb_day") usage.storageGbDays += event.value;
  }

  // Current storage inventory
  const instances = state.instances.filter(i => i.userId === userId);
  const sessions = state.sessions.filter(s => s.userId === userId && s.state !== "deleted");
  let storageBytes = 0;
  for (const session of sessions) {
    storageBytes += session.latestSnapshotBytes || 0;
  }
  // Common state storage per instance (tracked in instance metadata)
  for (const instance of instances) {
    storageBytes += instance.commonStateBytes || 0;
  }

  return {
    ...usage,
    storageGbMonths: Number((usage.storageGbDays / 30).toFixed(4)),
    currentStorageBytes: storageBytes,
    currentStorageGb: Number((storageBytes / (1024 * 1024 * 1024)).toFixed(4)),
    inventory: {
      instances: instances.length,
      sessions: sessions.length,
    }
  };
}
```

### New invoice line items

| Metric | Unit | Rate | Description |
|--------|------|------|-------------|
| `runtimeMinutes` | minutes | $0.03 | Accumulated session runtime |
| `storageGbMonths` | GB-months | $0.015 | Average storage over billing period |

### Storage measurement job

A daily cron (already have `*/15 * * * *` schedule) measures storage:

```typescript
// Run daily: measure each user's total R2 storage and record a usage event
function recordDailyStorageUsage(state, clock, userId) {
  const sessions = state.sessions.filter(s => s.userId === userId && s.state !== "deleted");
  const instances = state.instances.filter(i => i.userId === userId);
  let totalBytes = 0;
  for (const session of sessions) totalBytes += session.latestSnapshotBytes || 0;
  for (const instance of instances) totalBytes += instance.commonStateBytes || 0;
  const gbDay = totalBytes / (1024 * 1024 * 1024);
  if (gbDay > 0) {
    writeUsage(state, clock, { userId, kind: "storage_gb_day", value: Number(gbDay.toFixed(6)) });
  }
}
```

### Billing method renames

| Current | New |
|---------|-----|
| `getWorkspaceBilling(token)` | `getUserBilling(token)` |
| `createWorkspaceCheckoutSession(token, opts)` | `createCheckoutSession(token, opts)` |
| `createWorkspaceBillingPortalSession(token, opts)` | `createBillingPortalSession(token, opts)` |
| `createWorkspaceUsageInvoice(token)` | `createUsageInvoice(token)` |
| `chargeWorkspace(token, input)` | `chargeUser(token, input)` |
| `applyBillingWebhook(event)` | `applyBillingWebhook(event)` (unchanged, but targets user instead of workspace) |

### CLI changes

```
flare billing                     # show billing summary + current storage usage
flare billing add-card            # unchanged
flare billing portal              # unchanged
flare billing charge              # unchanged
flare billing invoice             # create usage invoice
```

### .env changes

```bash
# Remove
BILLING_RATE_SNAPSHOT_USD=0.02
BILLING_RATE_TEMPLATE_BUILD_USD=0.10

# Add
BILLING_RATE_STORAGE_GB_MONTH_USD=0.015

# Keep
BILLING_RATE_RUNTIME_MINUTE_USD=0.03
```

## Data Model Changes

### Tables to remove

| Current table | Reason |
|---------------|--------|
| `bf_workspaces` | Replaced by direct user ownership |
| `bf_workspace_memberships` | No workspace sharing in v1 |
| `bf_workspace_invites` | No workspace sharing in v1 |
| `bf_templates` | Replaced by instances |
| `bf_template_versions` | No versioning |
| `bf_template_builds` | No server-side builds |
| `bf_binding_releases` | No promotion/release pipeline |

### Tables to add/modify

| Table | Description |
|-------|-------------|
| `bf_instances` | Instance config: image, env vars, common state key |
| `bf_sessions` (modified) | Add `instance_id`, `image_at_launch`, `latest_snapshot_*` fields. Remove `template_id`, `workspace_id`. |
| `bf_snapshots` (simplified) | One row per session max. Remove multi-snapshot tracking. |

### Schema migration

```sql
-- 0005_simplify_model.sql

-- New instances table
CREATE TABLE IF NOT EXISTS bf_instances (
  row_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  user_id TEXT,
  name TEXT,
  image TEXT,
  created_at TEXT,
  updated_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bf_instances_user_id ON bf_instances (user_id);
CREATE INDEX IF NOT EXISTS idx_bf_instances_name ON bf_instances (name);

-- Add instance_id to sessions, drop template/workspace references
-- (handled in application layer since we use payload_json pattern)

-- Drop legacy tables (after data migration)
-- DROP TABLE IF EXISTS bf_templates;
-- DROP TABLE IF EXISTS bf_template_versions;
-- DROP TABLE IF EXISTS bf_template_builds;
-- DROP TABLE IF EXISTS bf_binding_releases;
-- DROP TABLE IF EXISTS bf_workspace_memberships;
-- DROP TABLE IF EXISTS bf_workspace_invites;
```

## Service Layer Changes

### Removed service methods

The following service method groups can be deleted entirely:

- `createTemplate`, `listTemplates`, `getTemplate`, `archiveTemplate`, `restoreTemplate`, `deleteTemplate`
- `createTemplateVersion`, `uploadTemplateVersionBundle`, `getTemplateVersionBundle`
- `promoteTemplateVersion`, `rollbackTemplate`
- All build-related methods: `processBuilds`, `retryBuild`, `retryDeadLetteredBuilds`, `getBuildLog`, `getBuildArtifact`
- All release-related methods: `listReleases`
- Workspace invite/membership methods: `inviteToWorkspace`, `acceptInvite`, `setMemberRole`, `listMembers`
- Multi-snapshot methods: `listSnapshots`, `getSnapshot`, `restoreSnapshot`, `deleteSnapshot`

### New service methods

```typescript
// Instance CRUD
createInstance(token, { name, image, envVars, secrets })
listInstances(token)
getInstance(token, instanceId)
updateInstance(token, instanceId, { image?, envVars?, secrets? })
deleteInstance(token, instanceId)

// Instance env/secrets (convenience wrappers)
setInstanceEnvVar(token, instanceId, key, value)
unsetInstanceEnvVar(token, instanceId, key)
setInstanceSecret(token, instanceId, key, value)
unsetInstanceSecret(token, instanceId, key)

// Session (simplified)
createSession(token, instanceId, { name })
listSessions(token, { instanceId? })
getSession(token, sessionId)
startSession(token, sessionId)
stopSession(token, sessionId)
restartSession(token, sessionId)
deleteSession(token, sessionId)
saveSnapshot(token, sessionId)           // force save, overwrites latest

// Common state
syncCommonState(token, instanceId)       // push/pull common state
```

## CLI Changes

### Removed commands

```
flare template *          → replaced by flare instance *
flare build *             → removed (no server-side builds)
flare releases            → removed (no promotion pipeline)
flare workspace invite    → removed (no sharing in v1)
flare workspace members   → removed
flare workspace set-role  → removed
flare snapshot list       → removed (only latest exists)
flare snapshot get        → removed
flare snapshot restore    → removed (automatic on start)
flare reconcile *         → simplified
flare export              → simplified
```

### New/updated commands

```
flare instance create <name> --image <image>
flare instance list
flare instance show <id>
flare instance edit <id> [--image ...] [--env KEY=VAL] [--secret KEY=VAL]
flare instance delete <id>

flare up <name> --instance <id>     # replaces --template
flare snapshot <session-id>         # save now (single command, no subcommands)
```

## Implementation Plan

The service has no live users, so we can make breaking product decisions directly — no external migration path, no backward compatibility promises, no feature flags. Even so, the original "4 clean PRs" split is too large for review and too risky for trunk stability. The rewrite should land in smaller PRs that each keep `main` green.

### PR 1: Runtime prep (`dev` → `flare`)

**Scope:** Land the cross-cutting SSH/runtime rename first so later diffs only have one user name in play.

- Rename the SSH user from `dev` to `flare` across the entire codebase:
  - `containers/session/Dockerfile` — `adduser -D flare`, `chpasswd`, `chown` references.
  - `containers/session/server.mjs` — `id -u flare`, `id -g flare`, default username return.
  - `packages/shared/src/service.ts` — `sshUser: "flare"`, SSH command template `flare@127.0.0.1`.
  - `scripts/ssh-smoke.ts` — mock SSH server username, assertions for `whoami` output.
  - `scripts/live-ssh-smoke.ts` — SSH command username, assertions.
  - `test/container-server.test.ts` — update any `dev` user references.
- Update any CLI help text, fixtures, or docs that still mention the old SSH username.

**Exit criteria:** Container tests and SSH smoke tests pass with `whoami === "flare"`.

### PR 2: Instance foundation (types + storage + service CRUD)

**Scope:** Introduce the new core object without cutting over every caller yet.

- Add the `Instance` type and serializers.
- Add `bf_instances` schema definitions plus the new D1 migration.
- Update `cloudflare-store.ts`, `memory-store.ts`, and shared store helpers for instance persistence.
- Add `createInstance`, `listInstances`, `getInstance`, `updateInstance`, and `deleteInstance` to `service.ts`.
- Keep legacy template APIs intact in this PR so the branch stays easy to validate while the new model is added.
- Add focused unit tests for instance CRUD and persistence.

**Exit criteria:** `npm run typecheck && npm test` pass, and the service layer can create and read instances even if legacy templates still exist.

**Docs to update:**
- `packages/shared/src/cloudflare-schema.ts` — add `bf_instances`.
- `spec/overview.md` — introduce Instance terminology at a high level.

### PR 3: Session ownership cutover

**Scope:** Move session records onto the new instance model first, without changing snapshot behavior yet.

- Add `instanceId` to the session shape and formatters.
- Update `createSession`, `listSessions`, `getSession`, `startSession`, `stopSession`, `restartSession`, and `deleteSession` in `service.ts` to resolve sessions through instances.
- Keep `templateId` as a temporary compatibility field internally where needed so the branch can stay deployable while the route layer still sends template-based payloads.
- Update session-related store tests, fixtures, and service tests to assert `instanceId` is present and authoritative.
- Keep snapshot methods working exactly as they do today in this PR.

**Exit criteria:** Session lifecycle tests pass with `instanceId` present on sessions, and no user-facing snapshot behavior changes yet.

### PR 4: Latest-snapshot backend semantics

**Scope:** Collapse snapshot persistence to one logical latest snapshot per session while preserving the existing route surface.

- Replace multi-snapshot service logic with a single latest snapshot record/object per session.
- Update snapshot storage layout to one object key per session.
- Make repeated snapshot saves overwrite the current latest snapshot instead of appending history.
- Keep compatibility shims so `listSnapshots` can still return a singleton array until the API/CLI route cleanup PR removes the old surface.
- Update snapshot-focused tests and fixtures in the service and shared store layers.

**Exit criteria:** Repeated saves overwrite the same latest snapshot, and every session has at most one persisted snapshot.

**Docs to update:**
- `spec/architecture.md` — update persistence and session metadata to latest-snapshot-only.

### PR 5: Automatic latest-snapshot restore

**Scope:** Wire the runtime flow to restore the latest snapshot automatically on start, separate from the storage rewrite itself.

- Update session start/restart behavior to load the latest snapshot automatically if one exists.
- Rework the edge runtime restore/export helpers to consume the session’s latest snapshot metadata instead of requiring explicit snapshot selection.
- Keep temporary adapters for any still-existing `restoreSnapshot` code paths so the branch remains safe while public routes are still being simplified.
- Update worker tests and runtime lifecycle tests around start, restart, and container bootstrap.

**Exit criteria:** Starting a stopped session automatically restores its latest snapshot with no explicit restore step in the backend path.

### PR 6: Billing rewrite

**Scope:** Move billing off workspaces and onto users as a separate, reviewable change.

- Rewrite billing ownership from workspace to user.
- Remove `templateBuilds` and per-save `snapshots` metrics.
- Add `storageGbDays` accounting and `storageGbMonths` invoice math.
- Update the billing catalog to keep `runtimeMinuteUsd` and add `storageGbMonthUsd`.
- Add the daily storage measurement cron path.
- Update `.env.example` billing keys and all billing unit tests.

**Exit criteria:** Billing summaries and invoices only expose runtime and storage metrics, and cron writes daily storage usage events.

### PR 7: Remove legacy template/build/release/workspace-sharing code

**Scope:** Delete the old model after the new internals exist.

- Delete template, template version, template build, binding release, workspace membership, and workspace invite code from `service.ts`.
- Delete the corresponding D1 table definitions from `cloudflare-schema.ts`.
- Remove Queues, Workflows, and server-side build pipeline logic from the backend.
- Remove dead tests, fixtures, and helpers tied only to the deleted features.
- Keep the branch deployable; any still-referenced API routes should fail closed with clear removals until the route layer is updated in the next PR.

**Exit criteria:** The backend no longer contains build/release/workspace-sharing internals, and `packages/shared/src/service.ts` is materially smaller and easier to review.

**Docs to update:**
- `spec/architecture.md` — remove template/build/promotion and workspace-sharing sections.

### PR 8: API routes and CLI switch-over

**Scope:** Rewire the external interfaces to the new backend.

- Delete `/api/templates/*`, `/api/template-builds/*`, and `/api/releases/*` routes from `apps/edge/src/app.ts`.
- Delete workspace invite/membership routes.
- Add `/api/instances` CRUD routes.
- Update session routes to use `instanceId`.
- Simplify snapshot routes to a single `POST` save action plus automatic restore behavior.
- Rewrite the CLI: replace `flare template *` with `flare instance *`, remove `flare build *`, `flare releases`, and multi-snapshot commands.
- Add `--dockerfile` and `--context` flags to `flare instance create` and `flare instance edit`.
- Add `flare instance rebuild`.
- Implement the local Docker build → push → create/update flow in the CLI.
- Update smoke tests and CLI tests.

**Exit criteria:** `npm run ci` passes. `flare instance create --image node:20`, `flare instance create --dockerfile ./Dockerfile`, and `flare up --instance <id>` all work.

**Docs to update:**
- `apps/cli/README.md` — rewrite command reference for Instance + Session model; add `--dockerfile` examples.
- `spec/plan.md` — replace legacy delivery PRs with the new simplified sequence.

### PR 9: Common state (`/home/flare`)

**Scope:** Add shared home-directory state after the base session model is stable.

- Add `commonStateKey` and `commonStateBytes` to the Instance model.
- On session start, pull common state from R2 into `/home/flare`.
- On session stop/sleep, push `/home/flare` back to R2.
- Add `flare instance push <id>` to upload the current session's `/home/flare` immediately.
- Add `flare instance pull <id>` to fetch the latest `/home/flare` without restart.
- Update container bootstrap (`server.mjs`) to hydrate and persist `/home/flare`.
- No live sync — pull-on-start, auto-push on stop, explicit push/pull mid-session.

**Exit criteria:** Two sessions of the same instance both see shared files in `/home/flare` after push + restart, while `/workspace` stays isolated.

**Docs to update:**
- `spec/architecture.md` — add the Common State section and R2 layout details.
- `containers/session/` — update container docs if present with `/home/flare` sync behavior.

### PR 10: Web app and deploy cleanup

**Scope:** Update the UI and deployment surface after the API and CLI have stabilized.

- Replace template catalog pages with Instance list/create/edit pages.
- Simplify session creation flow to pick Instance → name → launch.
- Remove build/promotion/release UI pages.
- Simplify session detail to show single snapshot status inline.
- Update `scripts/deploy.ts` to remove build workflow and queue references.
- Update `wrangler.toml` and any config generator output to remove workflow/queue sections.
- Update runbook, changelog, todo list, and top-level README.

**Exit criteria:** Full CI passes, the web app shows only instances and sessions, and `npm run deploy` completes without queue/workflow errors.

**Docs to update:**
- `spec/runbook.md`
- `spec/changelog.md`
- `spec/todo.md`
- `README.md`

### PR 11: End-to-end verification

**Scope:** Verify the entire simplified product works end-to-end in production.

This PR contains no feature code — only tests, smoke scripts, and fixes for anything they uncover.

**E2E test script** (`scripts/e2e-simplified.ts`):

Runs the full user journey against a live deployment:

1. **Auth:** Register a new user, verify `whoami`, login from a second session, revoke it.
2. **Instance from image:** `flare instance create e2e-test --image node:20 --env NODE_ENV=test --secret API_KEY=abc` → verify instance appears in `flare instance list` and `flare instance show`.
3. **Instance from Dockerfile:** `flare instance create e2e-docker --dockerfile ./containers/session/Dockerfile` → verify local Docker build, push, and instance creation with a registry image URL.
4. **Session lifecycle:** `flare up test-session --instance <id>` → verify session reaches `running` → `flare status` → `flare stop` → verify `sleeping` → `flare start` → verify `running` → `flare restart` → verify `running`.
5. **SSH:** `flare ssh <session-id> -- whoami` → verify output is `flare`.
6. **Preview + editor:** Fetch preview and editor URLs, verify HTTP 200 and expected HTML content.
7. **Snapshot:** `flare stop <session-id>` → verify snapshot auto-saved (session detail shows `latestSnapshotAt` and `latestSnapshotBytes > 0`) → `flare start <session-id>` → verify snapshot auto-restored.
8. **Common state:** Write a file to `/home/flare/.myconfig` in session A → `flare instance push <id>` → create session B from same instance → verify `.myconfig` exists in session B's `/home/flare` → `flare stop` session B → verify `/home/flare` auto-pushed on stop.
9. **Multiple sessions:** Launch 3 sessions from the same instance → verify all running → verify isolated `/workspace` (file in session 1 not visible in session 2) → stop all.
10. **Instance edit:** `flare instance edit <id> --image ubuntu:24.04` → start a new session → verify `imageAtLaunch` is `ubuntu:24.04` → verify previously running session still uses `node:20`.
11. **Billing:** `flare billing` → verify response includes `runtimeMinutes > 0` and `currentStorageBytes > 0` → verify no `templateBuilds` or `snapshots` metrics in output.
12. **Cleanup:** Delete all sessions → delete all instances → verify `flare instance list` is empty.
13. **Negative tests:** Try to create a session on a deleted instance (expect 404) → try to SSH to a stopped session (expect error) → try to `flare instance rebuild` without Docker running (expect clear error message).

**Manual verification checklist** (run by operator after E2E script passes):

- [ ] Web app: sign in → instance list page loads → create instance → launch session → session dashboard shows running
- [ ] Web app: click preview → page loads → click editor → page loads
- [ ] Web app: stop session → session shows sleeping → start → session shows running
- [ ] Web app: instance edit page → change image → save → verify
- [ ] Web app: billing page → shows runtime + storage usage, no build/snapshot line items
- [ ] Web app: no references to "template", "build", "promotion", or "release" anywhere in the UI
- [ ] CLI: `flare --help` fits on one screen
- [ ] CLI: `flare instance --help` shows create/list/show/edit/rebuild/delete/push/pull
- [ ] Deploy: `npm run deploy` completes without queue/workflow errors
- [ ] Health: `curl /api/health` returns `{"ok": true}` with no build/queue/workflow bindings

**Update smoke scripts:**
- Rewrite `scripts/smoke.ts` to test Instance + Session flow instead of template + build + promote.
- Rewrite `scripts/release-validate.ts` → rename to `scripts/instance-validate.ts`, test instance CRUD + session lifecycle.
- Rewrite `scripts/npm-cli-smoke.ts` to use `flare instance` commands instead of `flare template`.
- Remove build-related assertions from all smoke scripts.

**Exit criteria:** E2E script passes against production. Manual checklist completed. All smoke scripts updated and passing. The full user journey from sign-up to shell works with zero references to the old model.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Users without Docker can't use `--dockerfile` | `--image` works without Docker. Add curated quick-start images (node:20, python:3, ubuntu:24.04) to the docs and CLI help. |
| Common state has no live sync | Pull-on-start + explicit push is deterministic and simple. Live sync can be added later as opt-in without changing the data model. |
| Single snapshot means no rollback if latest is corrupt | Keep a 1-deep backup: `snapshot.tar.gz` + `snapshot.prev.tar.gz`. Auto-fallback if latest fails to restore. |
| Removing workspaces blocks future team features | The `userId` ownership model is simple to extend later: add `teamId` to Instance when team features ship. |
| Local Docker build requires Docker Desktop | Document this clearly. Most developers already have Docker. For those who don't, `--image` with a public registry image works. |

## Success Criteria

The simplification is complete when:

1. A new user can go from sign-up to running shell in **3 commands**: `flare instance create`, `flare up`, `flare ssh`.
2. `flare instance create --dockerfile ./Dockerfile` builds, pushes, and creates in one command.
3. The CLI `--help` fits on one screen.
4. The web app has ≤4 primary navigation items.
5. Zero mentions of "template version", "build", "promotion", or "release" in user-facing copy.
6. The service layer is <3000 lines (currently ~5300).
7. No Queues, Workflows, or build pipeline code remains.
