# BurstFlare Remaining Work

Status as of February 28, 2026.

This file lists the remaining work required to close the gap between the current implementation and the full production-beta scope defined in `spec/plan.md`.

## 1. Highest-Priority Gaps

- No current high-priority gaps remain. The remaining work is polish, operator hardening, and future scale improvements.

## 2. PR Plan Status

### PR 01: Monorepo, Tooling, And Baseline Cloudflare App

- Status: complete

### PR 02: Data Model And Migration Framework

- Status: complete
- Done:
  - migrations exist
  - D1 is provisioned and migrations run
  - a normalized D1 table set now exists for persisted state
  - the Cloudflare store now cuts over from the legacy blob to normalized D1 tables
  - normalized writes now use row-level upserts and deletes instead of full-table rewrites
  - migration coverage now includes a Cloudflare-store cutover test
  - hot service paths now use scoped normalized-collection transactions instead of always loading every collection
  - the runtime no longer uses the legacy `_burstflare_state` fallback row
  - the legacy `_burstflare_state` table is dropped by migration
  - Cloudflare schema validation now checks for drift and rejects a missing-or-stale normalized schema
- Remaining:
  - optional future cleanup: replace the shared-state projection layer with direct repository-style per-table access if needed for further scale

### PR 03: Web Auth Foundations

- Status: complete
- Done:
  - basic registration and token-based auth flows exist
  - refresh-token rotation
  - explicit logout for issued access tokens
  - logout-all revokes all current user sessions across access and refresh tokens
  - browser client token refresh and logout UX
  - browser session and CSRF cookies are issued on auth success paths
  - cookie-authenticated mutating requests require a matching CSRF token
  - the web app now runs without storing bearer access tokens in local storage
  - auth-session list and targeted revoke APIs exist
  - CLI support exists for listing and revoking individual auth sessions
  - browser recovery-code generation and recovery controls now exist
  - browser Turnstile widget wiring now exists with a manual-token fallback path
  - WebAuthn passkey registration, login, listing, and deletion now exist
  - browser passkey controls now exist for register, login, and delete
  - browser auth state now surfaces passkeys and actionable pending device approvals
  - server-side passkey assertion validation now verifies challenge, origin, and signatures
  - live Turnstile enforcement is now enabled in the production deployment with configured keys and server-side verification

### PR 04: Workspace And Membership Model

- Status: mostly complete
- Done:
  - personal workspaces
  - membership roles
  - invites
  - role changes
  - workspace rename/settings path across API, CLI, and web
- Remaining:
  - deeper audit coverage for all membership edge cases

### PR 05: Web App Shell And Dashboard

- Status: complete
- Done:
  - web shell and basic management screens
  - browser auth-session list, revoke, and logout-all controls
  - clearer empty states and last-sync visibility in the browser shell
  - the dashboard now exposes a `Dashboard Pulse` summary strip for templates, builds, sessions, and snapshots
  - `scripts/ui-smoke.mjs` now validates the shell HTML, stylesheet, and browser bundle markers
  - GitHub Actions now runs the UI smoke flow against the local dev server alongside the existing synthetic smoke and release validation flows

### PR 06: CLI Skeleton And Device Authorization

- Status: complete
- Done:
  - CLI package
  - device-style auth flow
  - auth/session-oriented commands
  - refresh and logout commands
  - automatic token refresh for authenticated CLI requests
  - noun-first command aliases now exist for workspace, template, build, release, and session workflows
  - local CLI filters now exist for session, build, template, and release list commands
  - broader CLI coverage now includes alias and filter flows in the CLI test suite

### PR 07: Template Catalog CRUD And R2 Storage

- Status: mostly complete
- Done:
  - template records
  - template version records
  - template list/create flows
  - authenticated bundle upload endpoint
  - authenticated bundle download endpoint
  - R2-backed template-bundle storage
  - short-lived signed upload grants for bundle uploads through the Worker
  - manifest validation and upload size limits
  - template archive and restore controls
  - archived templates block new session creation
  - template deletion with bundle and build-log cleanup
- Remaining:
  - direct-to-R2 presigned upload URLs if we want to bypass the Worker relay path
  - deeper admin-grade template management UX beyond the current CRUD and lifecycle controls

### PR 08: Async Build Pipeline With Queues And Workflows

- Status: complete
- Done:
  - build records
  - build status transitions
  - manual process/retry API
  - build-log generation and retrieval
  - R2-backed build-log storage
  - queue-backed build enqueue and consumer processing
  - bounded retry and dead-letter behavior for failed builds
  - operator bulk retry for dead-lettered builds
  - workflow-backed build orchestration through a live `BUILD_WORKFLOW` binding
  - workflow metadata on build records and build logs
  - workflow-preserving reconcile redispatch for queued/retrying builds
  - successful builds now produce and store real build artifacts with digest and source metadata
  - build artifacts are retrievable through API and CLI
  - successful builds now emit OCI-style image metadata (`imageReference`, `imageDigest`, `configDigest`, `layerCount`) in both the stored build artifact and promoted release bindings

### PR 09: Generated Runtime Binding Catalog And Deploy Automation

- Status: complete
- Done:
  - generated Wrangler config
  - promotion-driven release records
  - deploy automation scripts
  - template promotion now emits a canonical release binding manifest derived from the promoted build output
  - release list responses now return the binding manifest payload
  - rollback automation now promotes a prior release back to the active version and records rollback provenance
  - added a release-validation flow that exercises promote and rollback against a target deployment and now runs in CI

### PR 10: Session API And Durable Object State Machine

- Status: complete
- Done:
  - session APIs
  - lifecycle transitions
  - start/stop-style control paths
  - lifecycle routes now coordinate through the session container Durable Object
  - per-session runtime coordinator state is now persisted and exposed on session detail and session list responses
  - lifecycle routes now use the Durable Object runtime transition result as the source of truth before persisting the session transition
  - session records now persist the last-known runtime snapshot fields (`runtimeStatus`, `runtimeState`, `runtimeDesiredState`, `runtimeUpdatedAt`)
  - queued reconcile now stops running container sessions through the runtime binding before persisting the sleep transition
  - runtime transitions now carry monotonic operation versions and stale runtime snapshots are rejected instead of overwriting newer persisted state

### PR 11: Cloudflare Container Runtime Bootstrap

- Status: complete
- Done:
  - container image
  - container binding
  - container-backed preview path
  - live deploy verification
  - snapshot-aware boot now replays the last restored snapshot into the runtime on session start/restart
  - preview and SSH now also rehydrate the last restored snapshot when they boot the runtime outside the normal session-start path
  - runtime start, preview, editor, SSH, and terminal attach paths now bootstrap persisted session metadata into the running container
  - the runtime now writes bootstrap metadata to `/workspace/.burstflare/session.json`
  - stop, reconcile, restart, and delete paths now emit lifecycle hooks into the runtime and record them in runtime state
  - runtime state now surfaces lifecycle analytics fields such as `lastBootstrapAt`, `lastLifecyclePhase`, and `lastLifecycleReason`

### PR 12: SSH Over WebSocket End-To-End

- Status: complete
- Done:
  - runtime token issuance for SSH attach
  - Worker-side authenticated WebSocket upgrade path for the SSH route
  - the browser terminal now uses a dedicated `/runtime/sessions/:id/terminal` shell route instead of the raw SSH route
  - runtime images now start a real `sshd` listener on `127.0.0.1:2222`
  - the `/runtime/sessions/:id/ssh` route now proxies raw SSH bytes over WebSocket into the in-container `sshd`
  - CLI `flare ssh <session>` now emits a `wstunnel` plus native `ssh` attach command instead of the old `wscat` shell bridge
  - the deployed runtime now serves a real OpenSSH banner over the public SSH tunnel path, which is sufficient for standard SSH clients and `scp`-style traffic over the local TCP tunnel

### PR 13: Browser Terminal And Web Session Controls

- Status: complete
- Done:
  - browser preview route
  - basic web controls for sessions
  - browser terminal panel wired to the container-backed SSH WebSocket shell
  - automatic live dashboard refresh while the browser session is active
  - session cards now surface runtime coordinator state from the control plane
  - the browser terminal now uses a dedicated runtime shell route instead of the raw SSH tunnel route
  - the browser now has a container-native workspace editor route that can read and write live runtime files inside the configured persisted paths
  - saving from the browser editor now mutates the live runtime state and is captured by runtime-backed snapshots
  - CLI now exposes a matching `flare editor <sessionId>` command that prints the browser editor URL for a session

### PR 14: Workspace Snapshots, Persisted Paths, And Restore

- Status: complete
- Done:
  - snapshot create/list metadata
  - snapshot content upload and download routes
  - snapshot deletion route and artifact cleanup
  - R2-backed snapshot content storage
  - short-lived signed upload grants for snapshot uploads through the Worker
  - CLI save and restore path for snapshot artifacts
  - richer manual snapshot save/list/view/delete controls in the web UI
  - persisted-path config is now exposed in CLI and web template version inputs
  - explicit snapshot restore route with restore-state safety checks
  - browser restore control and restored-snapshot visibility in the session UI
  - running-session snapshot restore now applies into the live container runtime
  - session start/restart now replay the last restored snapshot into the container runtime
  - snapshot creation on running sessions now auto-captures runtime state into snapshot storage
  - persisted-path-aware runtime snapshot capture and restore now use a structured snapshot envelope and filter restored files to the template's allowed persisted paths

### PR 15: Usage Metering, Quotas, And Plan Enforcement

- Status: complete
- Done:
  - usage and quota data structures exist
  - effective plan limits now include dynamic quota overrides on the workspace record
  - usage responses now include current storage metering and inventory rollups
  - hard quota enforcement now covers template count, running sessions, runtime minutes, template versions, template builds, snapshot count, and storage bytes
  - workspace quota overrides now exist across the service layer, API, and `flare` CLI
  - admin report responses now expose the effective limits alongside the operational counters

### PR 16: Reliability Jobs, Reconciliation, And Cleanup

- Status: complete
- Done:
  - reconcile concepts and queue scaffolding exist
  - queue-driven reconcile enqueue and consumer execution
  - scheduled reconcile trigger
  - deleted-session purge and attached snapshot cleanup
  - stale sleeping-session cleanup with template-defined sleep TTLs
  - stuck-build recovery for stale `building` jobs during reconcile
  - richer admin report counters for current operator state
  - admin report responses now include a `reconcileCandidates` summary for running sessions, stuck builds, queued builds, stale sleeping sessions, and deleted sessions
  - targeted operator workflows now exist for reconcile preview, sleep-running, recover-builds, purge-sleeping, and purge-deleted across the service layer, API, and `flare` CLI
  - targeted reconcile actions are now covered by focused service, Worker, and CLI tests

### PR 17: Security Hardening And Audit Completeness

- Status: complete
- Done:
  - audit logging exists for many core actions
  - rate limiting on key auth and upload routes
  - authenticated workspace export path for backup/export use
  - audit logging now covers sensitive read paths including usage, audit, admin report, reconcile preview, and export access
  - runtime secret management now exists across the service layer, API, and `flare` CLI with metadata-only responses
  - workspace export now includes artifact inventory plus redacted runtime secret metadata for backup/security review
  - runtime attach, preview, editor, terminal, and SSH routes now have explicit per-route rate limits
  - focused security validation now covers runtime route authorization, runtime attach throttling, and export redaction in Worker tests

### PR 18: Beta Readiness, Docs, And Production Rollout

- Status: complete
- Done:
  - baseline synthetic smoke coverage exists for auth, build, session, snapshot, and report flows
  - synthetic smoke coverage now includes start, list, stop, restart, and detail validation for session lifecycle
  - production and staging deployment modes are now separated in the Cloudflare tooling
  - synthetic smoke coverage now validates build artifact image metadata and the SSH tunnel contract
  - synthetic smoke coverage now conditionally validates preview and editor routes when runtime containers are enabled
  - `spec/runbook.md` now defines operator runbooks, incident procedures, and the staging-to-production rollout checklist
  - `spec/runbook.md` now defines the limited beta onboarding plan and the current supported beta scope

## 3. Recommended Next Execution Order

1. Tighten the earlier mostly-complete product surfaces in PR 04 and PR 07.
2. Treat the optional PR 02 repository-style data-access cleanup as a scale-oriented follow-up, not a blocker for the current beta baseline.
3. Treat the remaining CI items below as incremental hardening work rather than blockers for the current beta baseline.

## 4. CI And Test Work Still Needed

- Expand migration and persistence tests beyond the current normalized-store cutover and scoped-collection coverage.
- Add integration tests for browser auth, device auth, and session revocation.
- Add deeper queue-consumer and workflow tests for build processing, including failure and retry orchestration across live workflow redispatch.
- Add Durable Object concurrency tests for session state.
- Add end-to-end runtime tests for SSH, browser terminal access, and snapshot restore.
- Add deployment smoke tests that run automatically after a successful Cloudflare deploy.
