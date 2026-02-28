# BurstFlare Delivery Plan

## Execution Strategy

The product should ship as a sequence of vertical PRs that keep the system runnable at every merge. Each PR should land behind feature flags where needed, include migrations and rollback notes, and avoid large "big bang" branches. The goal is to reach a production-capable beta with a working CLI, web app, account system, template pipeline, runtime plane, and operational controls.

The plan below assumes a monorepo with:

- `apps/edge` for the main Worker
- `apps/web` for the web UI bundled into the Worker
- `apps/cli` for the `flare` CLI
- `packages/shared` for API contracts, types, validation, and auth helpers
- `infra/` for generated config, migrations, and deployment helpers

## PR 01: Monorepo, Tooling, And Baseline Cloudflare App

Objective:
Create the repository structure, local developer workflow, and first deployable Worker skeleton.

Changes:

- Set up the monorepo, package manager, linting, formatting, shared TS config, and CI.
- Create the base Worker with health routes and environment loading.
- Add frontend build plumbing so the Worker can serve static assets.
- Add Wrangler configuration for local, staging, and production environments.
- Commit initial docs for local setup and deployment conventions.

Exit criteria:

- `wrangler dev` runs locally.
- CI validates lint, typecheck, and unit tests.
- The Worker deploys successfully with a placeholder page and `/api/health`.

## PR 02: Data Model And Migration Framework

Objective:
Establish the durable schema for accounts, workspaces, templates, sessions, and audits.

Changes:

- Add D1 migration tooling and the first migration set.
- Create tables for users, passkeys, workspaces, memberships, sessions, templates, template versions, usage events, and audit logs.
- Add seed helpers for local and staging environments.
- Add a typed data-access layer in `packages/shared`.

Exit criteria:

- A fresh environment can create and migrate the D1 schema.
- The Worker can connect to D1 and perform smoke-test reads/writes.
- All schema changes are covered by migration tests.

## PR 03: Web Auth Foundations

Objective:
Ship production-grade browser authentication.

Changes:

- Implement WebAuthn registration and login flows.
- Add Turnstile verification on registration and login challenge creation.
- Create session cookies, CSRF protection, and session revocation primitives.
- Add recovery code generation and verification.
- Add auth middleware and route guards for protected pages and APIs.

Exit criteria:

- A user can sign up, sign in, sign out, and restore access using a recovery code.
- Revoked sessions are blocked immediately.
- Auth flows are covered by integration tests.

## PR 04: Workspace And Membership Model

Objective:
Introduce account ownership boundaries and policy enforcement.

Changes:

- Add personal workspace creation for every new account.
- Implement workspace membership invites and role assignment.
- Add RBAC middleware for `owner`, `admin`, `member`, and `viewer`.
- Create workspace settings UI and audit log entries for membership changes.

Exit criteria:

- Users can view and switch workspaces they belong to.
- Protected routes enforce workspace role checks.
- Membership changes are visible in audit history.

## PR 05: Web App Shell And Dashboard

Objective:
Deliver the first usable web interface for authenticated users.

Changes:

- Build the app shell, navigation, session list page, template catalog page, and account settings page.
- Add a dashboard showing active sessions, recent activity, and basic usage.
- Wire the UI to typed API contracts rather than ad hoc fetches.
- Add empty and loading states so the product is usable before runtime exists.

Exit criteria:

- A signed-in user can navigate the app and view real workspace/account data.
- Dashboard pages work in local dev and staging.
- End-to-end smoke tests cover core navigation.

## PR 06: CLI Skeleton And Device Authorization

Objective:
Ship the first useful CLI with shared auth.

Changes:

- Create the `flare` CLI package with command parsing, config storage, and structured output.
- Implement `flare auth login`, `auth logout`, and `auth whoami`.
- Add device authorization endpoints in the Worker.
- Add the web approval page for pending CLI device logins.
- Store CLI access and refresh tokens securely on the client side.

Exit criteria:

- A user can log in to the CLI using the browser approval flow.
- CLI tokens refresh correctly.
- CLI and web auth share the same account and workspace model.

## PR 07: Template Catalog CRUD And R2 Storage

Objective:
Enable template creation and version storage in the control plane.

Changes:

- Add template and template-version APIs.
- Implement signed R2 upload URLs for template bundles and manifests.
- Create privileged CLI commands: `template create`, `template upload`, `template list`.
- Add template management UI for admins.
- Validate uploaded manifests, enforce size limits, and reject unsafe metadata.

Exit criteria:

- An authorized user can create a template record and upload a version bundle to R2.
- Template metadata is visible in both CLI and web UI.
- Invalid bundles are rejected with clear errors.

## PR 08: Async Build Pipeline With Queues And Workflows

Objective:
Turn uploaded template bundles into promotable runtime images.

Changes:

- Add `template_builds` records and state transitions.
- Create Queue producers/consumers for build jobs.
- Implement a Workflow that validates, builds, retries, records logs, and marks success/failure.
- Add a dedicated builder container image/class that performs rootless image builds and pushes outputs to the Cloudflare container registry.
- Persist build logs and normalized build metadata to R2 and D1.
- Add build status surfaces in the web UI and CLI.

Exit criteria:

- A template upload automatically creates and runs a build job.
- A successful build produces a versioned image in the Cloudflare container registry.
- Users can observe build state and retrieve logs.
- Failures are retryable and auditable.

## PR 09: Generated Runtime Binding Catalog And Deploy Automation

Objective:
Make promoted templates runnable on Cloudflare Containers despite static binding requirements.

Changes:

- Add a generated binding manifest that maps active template versions to container bindings.
- Implement a release script that rewrites the generated Wrangler/container config from template promotion state.
- Add a promotion step that triggers a deploy after binding generation.
- Add admin UI/CLI controls to promote, demote, and archive template versions.
- Add staging safeguards so promotion can be validated before production rollout.

Exit criteria:

- Promoting a template version updates the generated runtime catalog and triggers a successful deploy.
- The active template catalog is visible and consistent with D1 metadata.
- Rollback to the previous promoted image is documented and tested.

## PR 10: Session API And Durable Object State Machine

Objective:
Create the control-plane API for starting and managing runtime sessions.

Changes:

- Add session create/list/get/stop/delete endpoints.
- Implement the per-session Durable Object with a lock and explicit lifecycle state machine.
- Add D1 persistence for session metadata and timestamps.
- Add quota and entitlement checks before session creation.
- Add session activity feeds in the web app and CLI.

Exit criteria:

- A session can be created and reaches a tracked lifecycle state.
- Concurrent start/stop requests do not corrupt state.
- The web app and CLI show live session state from a real control plane.

## PR 11: Cloudflare Container Runtime Bootstrap

Objective:
Launch real container-backed sessions.

Changes:

- Add the first production template images with bootstrap scripts.
- Implement container classes and bindings for the active catalog.
- Add startup hooks that hydrate workspace state from R2 and inject runtime metadata.
- Add sleep/stop hooks that persist snapshot metadata and clean up transient state.
- Record container lifecycle events in Analytics Engine and D1.

Exit criteria:

- Starting a session results in a real container boot.
- Session status transitions from `starting` to `running`.
- A sleeping or stopped session can be recreated from persisted metadata.

## PR 12: SSH Over WebSocket End-To-End

Objective:
Deliver the platform's core connection path: real SSH through the Worker.

Changes:

- Run `sshd` and the WebSocket tunnel endpoint in every runtime image.
- Add authenticated runtime token issuance for CLI attach operations.
- Implement the Worker runtime proxy route for SSH WebSocket traffic.
- Add `flare ssh <session>` and optional local SSH config helpers.
- Add CLI support for port-forwarding and standard SSH passthrough options.

Exit criteria:

- A user can run `flare ssh <session>` and get a real shell.
- SSH access is denied immediately when tokens expire or access is revoked.
- `scp` and standard SSH forwarding work for supported templates.

## PR 13: Browser Terminal And Web Session Controls

Objective:
Support browser-native access and make the web app fully operational without the CLI.

Changes:

- Add `code-server` or `ttyd` to runtime images and route browser traffic through the Worker.
- Add "Open in Browser", "Sleep", "Stop", and "Restart" controls in the web UI.
- Add live session status updates via polling or server-pushed events.
- Add access banners, session ownership indicators, and expiry warnings.

Exit criteria:

- A user can launch and interact with a session directly from the browser.
- Web session controls operate on the same DO-backed session state machine as the CLI.
- Browser access respects the same auth, workspace, and audit policies as SSH.

## PR 14: Workspace Snapshots, Persisted Paths, And Restore

Objective:
Make sleeping sessions practical by preserving user work between runs.

Changes:

- Add persisted-path configuration to templates.
- Implement snapshot create/list/restore metadata in D1.
- Add container-side upload/download logic for R2-backed snapshots.
- Add manual "Save Now" and "Restore Snapshot" controls in the web UI and CLI.
- Add safeguards for snapshot size, frequency, and failed restores.

Exit criteria:

- Changes in persisted paths survive sleep and restart.
- Users can inspect and restore prior snapshots.
- Failed snapshot operations do not corrupt the latest good restore point.

## PR 15: Usage Metering, Quotas, And Plan Enforcement

Objective:
Add the controls required for a real multi-tenant service.

Changes:

- Emit structured usage events for runtime minutes, storage consumption, and build activity.
- Roll up usage into D1 for per-user and per-workspace reporting.
- Add plan and quota tables with enforcement checks.
- Expose usage views in the web UI and CLI.
- Add admin controls for plan assignment and manual overrides.

Exit criteria:

- The platform can block new sessions or builds when quota is exceeded.
- Usage numbers are visible and internally consistent.
- Audit logs record plan and quota changes.

## PR 16: Reliability Jobs, Reconciliation, And Cleanup

Objective:
Harden the platform against drift, failed workflows, and abandoned state.

Changes:

- Add scheduled reconciliation jobs for stale sessions, orphaned snapshots, and stuck builds.
- Add retry and dead-letter handling for Queue consumers.
- Add background cleanup for expired tokens, deleted workspaces, and archived template artifacts.
- Add operator dashboards or reports for failed jobs and reconciliation actions.

Exit criteria:

- The system self-heals common failure modes without manual intervention.
- Operators can identify and recover stuck resources.
- Cleanup jobs are idempotent and safe to rerun.

## PR 17: Security Hardening And Audit Completeness

Objective:
Close the major security and compliance gaps before beta launch.

Changes:

- Add comprehensive audit coverage for auth, templates, sessions, workspace membership, and admin actions.
- Add rate limiting and abuse controls on auth, device flow, and template upload endpoints.
- Add secure secret handling for runtime environment variables.
- Add penetration-test style checks for session isolation and proxy authorization.
- Add backup/export procedures for D1 and critical R2 metadata.

Exit criteria:

- High-risk actions are fully auditable.
- Abuse paths have concrete mitigation and alerting.
- Security review findings are addressed or explicitly waived.

## PR 18: Beta Readiness, Docs, And Production Rollout

Objective:
Ship a supportable production beta.

Changes:

- Finalize onboarding docs, operator runbooks, and incident procedures.
- Add staging-to-production promotion checklists.
- Add synthetic smoke tests that cover signup, CLI auth, template launch, SSH, browser access, and snapshot restore.
- Run a limited beta migration with seeded accounts and curated templates.
- Remove or narrow feature flags as the beta scope stabilizes.

Exit criteria:

- The full path from account creation to active shell works in production.
- Operators have documented rollback and incident procedures.
- The beta can onboard users without manual database edits.

## Recommended Milestones

Milestone 1:
PR 01 through PR 06

Outcome:
Shared account system, usable web shell, and a real CLI login flow.

Milestone 2:
PR 07 through PR 10

Outcome:
Template catalog, build pipeline, promotion workflow, and session control plane.

Milestone 3:
PR 11 through PR 14

Outcome:
End-to-end runtime with SSH, browser access, and workspace persistence.

Milestone 4:
PR 15 through PR 18

Outcome:
Production-grade quotas, reliability, security, and beta launch readiness.

## Cross-Cutting Rules For Every PR

- Add or update migrations in the same PR as schema changes.
- Keep API contracts versioned and shared between web and CLI.
- Add audit events for any new high-value action.
- Add smoke tests for the happy path and one failure path.
- Document operational implications and rollback steps in the PR description.
