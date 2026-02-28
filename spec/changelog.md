# BurstFlare Implementation Changelog

Status as of February 28, 2026.

This file records what has already been implemented in the repository and what has been verified in the live Cloudflare environment.

## 1. Product Spec Baseline

- Wrote the product overview in `spec/overview.md`.
- Wrote the Cloudflare-native architecture in `spec/architecture.md`.
- Wrote the staged PR execution plan in `spec/plan.md`.

## 2. Monorepo And Tooling Scaffold

- Created the top-level project structure for `apps/edge`, `apps/web`, `apps/cli`, `packages/shared`, `infra`, `scripts`, and `test`.
- Added root `package.json` scripts for development, build, test, CI, and Cloudflare ops.
- Added a baseline GitHub Actions CI workflow for lint, build, and tests.
- Added Wrangler configuration and generated-config support for deploys.

## 3. Shared Domain And Local Control Plane

- Implemented the shared service layer for:
  - accounts and tokens
  - workspace membership and role changes
  - device authorization flow
  - templates and template versions
  - template builds and release records
  - sessions and lifecycle transitions
  - usage events, quotas, and audit logs
- Added a local file-backed and in-memory data path so the app can run outside Cloudflare.

## 4. Web App And CLI Baseline

- Implemented the web UI served by the Worker.
- Implemented the `burstflare` CLI with auth and session-oriented commands.
- Added device-flow support between the web app and CLI.
- Added basic dashboard and management surfaces for templates, builds, sessions, and preview access.

## 5. Initial Data Model And Migrations

- Added the first D1 migration set in `infra/migrations/0001_init.sql`.
- Added a follow-up migration in `infra/migrations/0002_cloudflare_state.sql`.
- Added migration tooling and automation scripts to apply migrations against Cloudflare D1.

## 6. Expanded Control-Plane Workflows

- Added workspace invite creation and acceptance.
- Added workspace switching and role updates.
- Added workspace plan updates.
- Added queued template-build records, build processing, and build retry flows.
- Added template promotion with release tracking.
- Expanded session lifecycle tracking across `created`, `starting`, `running`, `stopping`, `sleeping`, and `deleted`.
- Added runtime-token checks tied to a specific session.

## 7. Worker Refactor For Real Cloudflare Bindings

- Split the edge router into a shared app layer and a Worker entry layer.
- Added separate store implementations for:
  - Node-only local state
  - memory-backed tests
  - Cloudflare-compatible persistence
- Removed Node-only dependencies from the Worker runtime path so the app can deploy cleanly on Cloudflare.

## 8. Cloudflare Provisioning Automation

- Added scripts to verify Cloudflare credentials and configuration.
- Added scripts to provision required resources from local automation.
- Added scripts to generate deployable Wrangler config from local environment state.
- Added scripts to run D1 migrations and verify deployment readiness.

## 9. Real Cloudflare Resources Provisioned

- Provisioned the primary D1 database.
- Provisioned KV namespaces for auth/session-style state and cache use.
- Provisioned R2 buckets for templates, snapshots, and build logs.
- Provisioned queues for build processing and reconciliation work.

## 10. Live Worker Deployment

- Deployed the Worker to Cloudflare at `burstflare.nicholas-zhaoyu.workers.dev`.
- Verified the live `/api/health` endpoint remotely.
- Verified live registration against the deployed Worker.

## 11. Container Runtime Wiring

- Added the Cloudflare Containers dependency.
- Added the session container image in `containers/session/Dockerfile`.
- Added the container HTTP service in `containers/session/server.mjs`.
- Added conditional Wrangler generation for:
  - Durable Object bindings
  - Durable Object migrations
  - container bindings
- Added container-aware session start and preview proxy logic in the Worker.

## 12. Live Container Deploy And Smoke Validation

- Built and deployed the session container image through Wrangler.
- Confirmed the live Worker is deployed with container bindings enabled.
- Verified the live `/api/health` response reports `containersEnabled: true`.
- Ran an end-to-end smoke flow against the public Worker:
  - register a user
  - create a template
  - add a template version
  - process the build
  - promote the version
  - create a session
  - start the session
  - fetch the preview route
- Confirmed the preview response comes from the running container path.

## 13. R2-Backed Template Artifacts And Build Logs

- Added authenticated template-bundle upload routes.
- Added authenticated template-bundle download routes.
- Added R2-backed template-bundle storage through the Worker.
- Added persisted build-log generation during template-build processing.
- Added build-log retrieval routes backed by R2.
- Extended the CLI to:
  - upload a real bundle file with `template upload --file`
  - fetch stored build logs with `build log`
- Verified the live Worker can:
  - upload a template bundle
  - download the same template bundle
  - process the build
  - return a build log that reflects the uploaded bundle

## 14. Current State

- The project is now a working, deployable Cloudflare-backed control plane with:
  - web UI
  - CLI
  - live Worker deployment
  - provisioned D1, KV, R2, and Queue resources
  - a container-backed preview path
  - R2-backed template artifacts and build logs
- The system is not yet at the full production-beta scope described in `spec/plan.md`.
- The remaining work is tracked in `spec/todo.md`.

## 15. Auth And Upload Rate Limiting

- Added rate limiting for:
  - user registration
  - user login
  - CLI device authorization start
  - template-bundle upload
- Added response headers for current rate-limit state on protected endpoints.
- Backed rate limiting with Cloudflare KV in production and an in-memory fallback in local/test environments.
- Verified the live Worker returns `429` after repeated device-start requests from the same client.

## 16. R2-Backed Snapshot Content

- Extended snapshot records to track stored object metadata.
- Added authenticated snapshot-content upload routes.
- Added authenticated snapshot-content download routes.
- Added R2-backed snapshot storage through `SNAPSHOT_BUCKET`.
- Added CLI support to:
  - upload a file when creating a snapshot
  - restore snapshot content to a local output path
- Verified the live Worker can round-trip snapshot content through the public API.

## 17. Refresh Tokens And Logout Revocation

- Added refresh-token issuance for:
  - browser registration
  - browser login
  - CLI login and device exchange
  - workspace switching
- Added refresh-token rotation through `/api/auth/refresh`.
- Added explicit logout and token revocation through `/api/auth/logout`.
- Added CLI support for `auth refresh` and `auth logout`.
- Verified the live Worker can:
  - issue a refresh token
  - rotate it once
  - reject the old refresh token after rotation
  - revoke the new access token on logout

## 18. Queue-Driven Template Build Processing

- Added build-job enqueue hooks when a template version is created.
- Added build-job enqueue hooks when a build is retried.
- Added Worker queue consumers for:
  - build processing
  - reconciliation messages
- Added a single-build processor that queue consumers can execute directly.
- Verified the live Worker can:
  - enqueue a template build
  - process it asynchronously through the build queue consumer
  - promote the version without calling the manual process endpoint

## 19. Queue-Driven Reconciliation

- Added an authenticated reconcile-enqueue control-plane route.
- Added service-layer support for queueing reconcile work.
- Added CLI support for `reconcile --enqueue`.
- Reused the existing reconcile queue consumer to execute queued reconciliation jobs.
- Verified the live Worker can:
  - enqueue a reconcile job
  - process it through the reconcile queue consumer
  - move a running session to `sleeping` asynchronously

## 20. Scheduled Reconcile Trigger

- Added a deployed Cloudflare cron trigger for reconcile scheduling.
- Added a Worker `scheduled` handler that enqueues reconcile jobs when the cron fires.
- Kept the existing queue consumer as the execution path for scheduled reconcile work.
- Verified the live deployment now includes the `*/15 * * * *` schedule trigger.

## 21. Client-Side Auto Refresh And Logout UX

- Added CLI-side automatic access-token refresh on `401` responses when a refresh token is available.
- Added web-app storage for refresh tokens in the browser client.
- Added web-app automatic token refresh on `401` responses.
- Added an explicit logout control in the web app.
- Verified the local CLI can recover against the live Worker after the stored access token is deliberately corrupted, using only the saved refresh token.

## 22. Snapshot Deletion And Artifact Cleanup

- Added authenticated snapshot deletion routes.
- Added R2-backed snapshot artifact deletion when a snapshot is removed.
- Added CLI support for `snapshot delete`.
- Verified the live Worker can:
  - delete a stored snapshot
  - remove it from the snapshot list
  - return `404` for the deleted snapshot content

## 23. Deleted Session Purge In Reconcile

- Extended reconcile to permanently purge sessions already marked `deleted`.
- Extended reconcile to remove snapshot records and snapshot artifacts for purged deleted sessions.
- Extended reconcile to remove session events and session-bound runtime tokens for purged deleted sessions.
- Verified the live Worker can:
  - delete a session
  - enqueue reconcile
  - return `404` for both the purged session record and its snapshot artifact after cleanup

## 24. Manifest Validation And Upload Limits

- Added template-manifest validation for:
  - required image field
  - supported feature names
  - persisted-path structure and count
- Added template-bundle size limits.
- Added snapshot-content size limits.
- Verified the live Worker returns:
  - `400` for invalid manifest features
  - `413` for oversized template-bundle uploads
