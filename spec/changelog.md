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

## 25. Template Archive And Restore Controls

- Added template archive support in the service layer.
- Added template restore support in the service layer.
- Blocked new session creation from archived templates.
- Added authenticated archive and restore API routes.
- Added CLI support for:
  - `template archive <templateId>`
  - `template restore <templateId>`
- Added web UI controls to archive and restore templates.
- Verified the live Worker can:
  - archive a promoted template
  - return `409` with `Template is archived` when session creation is attempted
  - restore the template
  - allow session creation again after restore

## 26. Signed Artifact Upload Grants

- Added short-lived one-time upload grants for template-bundle uploads.
- Added short-lived one-time upload grants for snapshot-content uploads.
- Added a public grant-consumption upload route that accepts a signed grant id and stores the artifact.
- Updated the CLI to use signed upload grants for:
  - `template upload --file`
  - `snapshot save --file`
- Kept the existing authenticated direct upload routes for local and admin-friendly fallback flows.
- Verified the live Worker can:
  - mint a bundle upload grant
  - upload a template bundle through the grant URL
  - mint a snapshot upload grant
  - upload snapshot content through the grant URL
  - read both artifacts back successfully afterward

## 27. Template Deletion And Artifact Cleanup

- Added template deletion in the service layer.
- Blocked template deletion while a template still has non-deleted sessions.
- Added cleanup of stored template bundles when a template is deleted.
- Added cleanup of stored build logs when a template is deleted.
- Added an authenticated template deletion API route.
- Added CLI support for `template delete <templateId>`.
- Added a web UI delete control for templates.
- Verified the live Worker can:
  - return `409` when deleting a template that still has an active session
  - delete a disposable template successfully
  - remove the deleted template from the template list

## 28. Build Failure Retries And Dead-Letter Handling

- Added explicit build failure detection through a template manifest flag for controlled failure-path testing.
- Added build failure metadata on build records:
  - `lastError`
  - `lastFailureAt`
  - `deadLetteredAt`
- Added bounded build retry handling with a three-attempt cap.
- Added automatic queue-side retry scheduling for failed queue builds until the cap is reached.
- Added `dead_lettered` as the terminal build state after retry exhaustion.
- Added richer build logs with failure and dead-letter fields.
- Restricted manual `build retry` to failed or dead-lettered builds only.
- Verified the live Worker can:
  - process a queue-backed failing build
  - retry it automatically through the build queue
  - move it to `dead_lettered` after three attempts
  - expose the dead-letter status and failure reason in the build log

## 29. Stale Sleeping Session Cleanup

- Added optional `sleepTtlSeconds` validation in template manifests.
- Propagated `sleepTtlSeconds` from the active template version onto newly created sessions.
- Extended reconcile to purge sleeping sessions that have exceeded their configured sleep TTL.
- Extended reconcile cleanup to remove session events, session-bound runtime tokens, and snapshot artifacts for stale purged sessions.
- Added `purgedStaleSleepingSessions` to reconcile results.
- Added CLI support for setting `--sleep-ttl-seconds` during `template upload`.
- Verified the live Worker can:
  - create a session from a template with a one-second sleep TTL
  - stop the session into `sleeping`
  - purge it on reconcile after the TTL expires
  - return `404` for the purged session afterward

## 30. Expanded Operator Reporting

- Extended the admin report with additional operational counters:
  - `templatesArchived`
  - `buildsFailed`
  - `buildsDeadLettered`
  - `sessionsSleeping`
  - `sessionsStaleEligible`
  - `activeUploadGrants`
- Kept the existing report route and CLI command shape stable while expanding the payload.
- Verified the live Worker can surface:
  - at least one dead-lettered build
  - at least one sleeping session
  - zero active upload grants after used grants have been consumed
