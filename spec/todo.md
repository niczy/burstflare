# BurstFlare Remaining Work

Status as of February 28, 2026.

This file lists the remaining work required to close the gap between the current implementation and the full production-beta scope defined in `spec/plan.md`.

## 1. Highest-Priority Gaps

- Replace the current serialized Cloudflare state bridge with fully normalized persistence across D1, KV, and R2.
- Implement production-grade browser auth:
  - Turnstile verification
  - WebAuthn / passkeys
  - cookie-backed browser sessions
  - CSRF protection
  - session revocation
  - recovery codes
- Implement real asynchronous build execution:
  - queue consumers
  - retry and dead-letter handling
  - workflow orchestration
  - real build-log storage in R2
  - real image build metadata
- Replace the current session lifecycle shim with a real Durable Object state machine and per-session locking.
- Implement the actual SSH-over-WebSocket runtime path instead of the current placeholder route.
- Add browser-native terminal access (`ttyd`, `code-server`, or equivalent) instead of preview-only HTTP.
- Implement real snapshot upload, restore, and persisted-path behavior for running containers.

## 2. PR Plan Status

### PR 01: Monorepo, Tooling, And Baseline Cloudflare App

- Status: mostly complete
- Remaining:
  - tighten CI with deployment-oriented smoke checks
  - add staging/production environment separation that matches the plan more closely

### PR 02: Data Model And Migration Framework

- Status: partially complete
- Done:
  - migrations exist
  - D1 is provisioned and migrations run
- Remaining:
  - move from the current bridged state model to a normalized D1 schema and data-access layer
  - add stronger migration test coverage and drift checks

### PR 03: Web Auth Foundations

- Status: partially complete
- Done:
  - basic registration and token-based auth flows exist
  - refresh-token rotation
  - explicit logout for issued access tokens
  - logout-all revokes all current user sessions across access and refresh tokens
  - browser client token refresh and logout UX
  - browser session and CSRF cookies are issued on auth success paths
  - cookie-authenticated mutating requests require a matching CSRF token
  - the web app now runs without storing bearer access tokens in local storage
- Remaining:
  - WebAuthn
  - Turnstile
  - recovery codes
  - deeper device/session management UX beyond the current logout-all path

### PR 04: Workspace And Membership Model

- Status: mostly complete
- Done:
  - personal workspaces
  - membership roles
  - invites
  - role changes
- Remaining:
  - richer workspace settings UX
  - deeper audit coverage for all membership edge cases

### PR 05: Web App Shell And Dashboard

- Status: partially complete
- Done:
  - web shell and basic management screens
- Remaining:
  - more polished dashboard state
  - complete empty/loading/error handling
  - stronger end-to-end UI smoke coverage

### PR 06: CLI Skeleton And Device Authorization

- Status: mostly complete
- Done:
  - CLI package
  - device-style auth flow
  - auth/session-oriented commands
  - refresh and logout commands
  - automatic token refresh for authenticated CLI requests
- Remaining:
  - broader CLI coverage and command ergonomics

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

- Status: partially complete
- Done:
  - build records
  - build status transitions
  - manual process/retry API
  - build-log generation and retrieval
  - R2-backed build-log storage
  - queue-backed build enqueue and consumer processing
  - bounded retry and dead-letter behavior for failed builds
- Remaining:
  - workflow orchestration
  - real builder execution
  - richer DLQ operator workflows beyond the current dead-letter state

### PR 09: Generated Runtime Binding Catalog And Deploy Automation

- Status: partially complete
- Done:
  - generated Wrangler config
  - promotion-driven release records
  - deploy automation scripts
- Remaining:
  - make template promotion the canonical source for generated runtime bindings
  - add rollback automation and staging validation flow

### PR 10: Session API And Durable Object State Machine

- Status: partially complete
- Done:
  - session APIs
  - lifecycle transitions
  - start/stop-style control paths
- Remaining:
  - real Durable Object lock/state machine
  - stronger concurrent-request protection
  - persistent session reconciliation behavior

### PR 11: Cloudflare Container Runtime Bootstrap

- Status: partially complete
- Done:
  - container image
  - container binding
  - container-backed preview path
  - live deploy verification
- Remaining:
  - startup hydration from persisted state
  - sleep/stop hooks
  - snapshot-aware boot and restore
  - lifecycle analytics emission

### PR 12: SSH Over WebSocket End-To-End

- Status: not complete
- Remaining:
  - run `sshd` in runtime images
  - runtime token issuance for SSH attach
  - Worker WebSocket proxy for SSH
  - CLI `burstflare ssh <session>`
  - `scp` / forwarding compatibility where supported

### PR 13: Browser Terminal And Web Session Controls

- Status: partially complete
- Done:
  - browser preview route
  - basic web controls for sessions
- Remaining:
  - true browser terminal/editor integration
  - richer live status updates
  - shared parity with CLI session controls

### PR 14: Workspace Snapshots, Persisted Paths, And Restore

- Status: partially complete
- Done:
  - snapshot create/list metadata
  - snapshot content upload and download routes
  - snapshot deletion route and artifact cleanup
  - R2-backed snapshot content storage
  - short-lived signed upload grants for snapshot uploads through the Worker
  - CLI save and restore path for snapshot artifacts
- Remaining:
  - persisted-path config in templates
  - container-side automatic snapshot upload/download
  - richer manual save/restore controls in the web UI
  - restore safety checks

### PR 15: Usage Metering, Quotas, And Plan Enforcement

- Status: partially complete
- Done:
  - usage and quota data structures exist
  - some plan checks exist in the service layer
- Remaining:
  - complete runtime/storage/build metering
  - rollups and reporting
  - hard enforcement across all quota boundaries
  - admin override surfaces

### PR 16: Reliability Jobs, Reconciliation, And Cleanup

- Status: partially complete
- Done:
  - reconcile concepts and queue scaffolding exist
  - queue-driven reconcile enqueue and consumer execution
  - scheduled reconcile trigger
  - deleted-session purge and attached snapshot cleanup
  - stale sleeping-session cleanup with template-defined sleep TTLs
  - richer admin report counters for current operator state
- Remaining:
  - stuck-build recovery
  - deeper idempotent operator workflows beyond the current read-only report
  - broader operator-facing recovery workflows and reporting

### PR 17: Security Hardening And Audit Completeness

- Status: partially complete
- Done:
  - audit logging exists for many core actions
  - rate limiting on key auth and upload routes
  - authenticated workspace export path for backup/export use
- Remaining:
  - abuse controls
  - full audit coverage
  - runtime secret handling
  - fuller backup/export procedures beyond the current workspace JSON export
  - focused security validation of proxy and tenant isolation paths

### PR 18: Beta Readiness, Docs, And Production Rollout

- Status: not complete
- Remaining:
  - operator runbooks
  - incident procedures
  - staging-to-production rollout checklist
  - full synthetic smoke coverage
  - limited beta onboarding plan
  - narrowing feature flags to the supported beta scope

## 3. Recommended Next Execution Order

1. Finish PR 03, PR 08, PR 10, PR 12, and PR 14 first. Those are the largest functional gaps between the current repo and a usable multi-tenant product.
2. Then finish PR 15, PR 16, and PR 17 so the platform has real enforcement, cleanup, and security controls.
3. Finish PR 18 last, once the runtime and platform guarantees are stable.

## 4. CI And Test Work Still Needed

- Add migration tests that validate normalized D1 schema behavior, not just happy-path script execution.
- Add integration tests for browser auth, device auth, and session revocation.
- Add queue-consumer and workflow tests for build processing.
- Add Durable Object concurrency tests for session state.
- Add end-to-end runtime tests for SSH, browser terminal access, and snapshot restore.
- Add deployment smoke tests that run automatically after a successful Cloudflare deploy.
