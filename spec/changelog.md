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

## 31. Cookie CSRF Hardening

- Added a dedicated browser CSRF cookie (`burstflare_csrf`) alongside the session cookie on auth success paths.
- Added `csrfToken` to auth success payloads for browser clients.
- Enforced a double-submit CSRF check for cookie-authenticated mutating requests.
- Kept bearer-authenticated API calls unchanged, so CLI and token-based flows remain compatible.
- Updated the web app to persist the CSRF token and send it on mutating requests.
- Verified the live Worker can:
  - reject a cookie-authenticated write without the CSRF header
  - accept the same write when the matching CSRF header is provided

## 32. Workspace Export And Backup Path

- Added an authenticated admin export route for workspace data.
- Added service-layer export generation for:
  - workspace metadata
  - members and invites
  - templates, builds, and releases
  - sessions and snapshots
  - usage events and audit logs
- Added CLI support for `burstflare export` with optional `--output`.
- Verified the live Worker can return a structured workspace export with templates and audit entries present

## 33. Browser-Only Session Flow

- Removed bearer-token storage from the web app client.
- Removed bearer-token header injection from browser-originated API requests.
- Kept the browser client on:
  - session cookies
  - refresh token storage
  - CSRF token storage
- Added a startup cleanup path that clears any legacy `burstflare_token` value from browser storage.
- Verified the live `/app.js` bundle now:
  - retains refresh-token storage
  - retains CSRF header wiring
  - does not inject `Authorization` headers
  - does not reference `state.token`

## 34. Cross-Session Logout All

- Added `logout-all` support in the auth service.
- Added an authenticated `POST /api/auth/logout-all` route.
- Added CLI support for `burstflare auth logout-all`.
- Revokes all non-runtime tokens for the current user across sessions.
- Clears browser auth cookies on the `logout-all` path.
- Verified the live Worker can:
  - revoke at least two access tokens and two refresh tokens for the same user
  - reject both old access tokens after revocation
  - reject both old refresh tokens after revocation

## 35. Recovery Codes

- Added recovery-code generation for authenticated users.
- Added one-time recovery-code login for browser sessions.
- Added an authenticated `POST /api/auth/recovery-codes/generate` route.
- Added a public `POST /api/auth/recover` route.
- Added CLI support for:
  - `burstflare auth recovery-generate`
  - `burstflare auth recover --email ... --code ...`
- Verified the live Worker can:
  - generate recovery codes
  - create a new browser session from a valid recovery code
  - reject reuse of the same recovery code

## 36. Turnstile Verification Path

- Added an optional Turnstile verification path in the Worker for:
  - registration
  - login
  - recovery-code login
  - device authorization start
- Added `turnstileEnabled` to `/api/health`.
- Added CLI request support for passing `--turnstile-token` on auth flows.
- Added a browser input field so the web app can send a Turnstile token when the secret is configured.
- Added mocked enforcement coverage in the Worker test suite.
- Verified the live Worker currently reports `turnstileEnabled: false` and remains backward-compatible until a `TURNSTILE_SECRET` is configured

## 37. Auth Session Listing And Targeted Revoke

- Added auth-session grouping so related access and refresh tokens are tracked as a single revocable session.
- Added authenticated session listing in the auth service.
- Added authenticated targeted session revoke in the auth service.
- Added `GET /api/auth/sessions`.
- Added `DELETE /api/auth/sessions/:authSessionId`.
- Added CLI support for:
  - `burstflare auth sessions`
  - `burstflare auth revoke-session <authSessionId>`
- Added test coverage across the service, Worker, and CLI suites.
- Verified the live Worker can:
  - list multiple active auth sessions for the same user
  - revoke a non-current auth session by `authSessionId`
  - reject the revoked session token while keeping the current session active

## 38. Browser Auth Session Controls

- Added a dedicated Auth Sessions card in the web app.
- Added browser controls to:
  - refresh the current auth-session list
  - revoke a non-current auth session
  - trigger `logout-all` from the browser shell
- Added UI state clearing so auth-session data is removed on logout, logout-all, or failed session restore.
- Added app-bundle coverage in the Worker test suite for the new auth-session UI wiring.
- Verified the live app now serves:
  - an `Auth Sessions` management card
  - a `Logout All Sessions` control
  - browser bundle wiring for `/api/auth/sessions`, targeted revoke, and `/api/auth/logout-all`

## 39. Deployment-Oriented Smoke Coverage

- Added a reusable smoke script at `scripts/smoke.mjs`.
- The smoke flow now covers:
  - health readiness
  - registration and secondary login
  - auth-session listing
  - template creation
  - template version enqueue and build processing
  - promotion
  - session creation and start
  - snapshot creation
  - admin report fetch
- Added `npm run smoke`.
- Updated GitHub Actions CI to boot the local dev server and run the smoke flow after lint, build, and tests.
- Verified the smoke flow passes:
  - locally against the dev server
  - remotely against the deployed Worker

## 40. Staging And Production Cloudflare Separation

- Added explicit Cloudflare environment selection through `CLOUDFLARE_ENVIRONMENT`.
- The Cloudflare tooling now supports:
  - `production` with the existing worker name and state file
  - `staging` with a separate worker name, separate state file, and separate resource-name prefix
- Added environment-aware worker naming in generated Wrangler output.
- Added environment-aware `BURSTFLARE_DATA_FILE` and `CLOUDFLARE_ENVIRONMENT` vars in generated Wrangler output.
- Added convenience scripts for:
  - `cf:generate:production`
  - `cf:generate:staging`
  - `cf:verify:staging`
  - `cf:provision:staging`
  - `cf:migrate:staging`
- Kept the current production deploy path backward-compatible with the existing `.local/cloudflare-state.json`.
- Verified:
  - production config generation still targets `burstflare`
  - staging config generation targets `burstflare-staging`
  - production deploy still succeeds
  - local and remote smoke flows still pass after the tooling change

## 41. Workspace Settings Rename Path

- Added service-layer workspace settings updates for workspace name changes.
- Added `PATCH /api/workspaces/current/settings`.
- Added CLI support for `burstflare workspace rename <name>`.
- Added browser UI controls for editing and saving the current workspace name.
- The browser shell now hydrates the workspace name input from the current authenticated workspace.
- Added test coverage across the service, Worker, and CLI suites.
- Verified the live Worker can:
  - rename a workspace through the new settings route
  - reflect the updated name on `/api/auth/me`
  - serve browser bundle wiring for `/api/workspaces/current/settings`

## 42. Runtime SSH WebSocket Bridge

- Replaced the plain-text SSH placeholder route with a real WebSocket upgrade path.
- `GET /runtime/sessions/:sessionId/ssh` now:
  - validates the runtime token before upgrading
  - returns `426` for plain HTTP requests without a WebSocket upgrade
  - returns `501` if WebSocket support is unavailable in the current runtime
  - upgrades to a live authenticated WebSocket bridge when supported
- The current bridge sends an attach banner and echoes client messages, which makes the path structurally correct even though it is not yet a full SSH tunnel to the container.
- Updated the Worker test suite to reflect the new `426` requirement for non-WebSocket requests.
- Verified on the live Worker that:
  - plain HTTP access now returns `426`
  - an authenticated WebSocket attach succeeds through `wscat`

## 43. Browser Terminal Panel

- Replaced the web app’s SSH alert action with an in-browser terminal panel.
- Added a terminal card to the main app shell with:
  - connection status
  - scrollable output
  - input field
  - send and close controls
- The browser client now:
  - requests an SSH runtime token
  - opens a WebSocket connection to the runtime SSH bridge
  - streams messages into the terminal panel
  - sends typed input over the live WebSocket
- Added UI cleanup so terminal state is reset on logout and logout-all.
- Added Worker test coverage for the terminal card and WebSocket client wiring in the served app bundle.
- Verified the live Worker now serves:
  - the `Browser Terminal` panel in the HTML shell
  - browser bundle wiring for `new WebSocket(...)` terminal attach

## 44. Web Snapshot Controls

- Expanded the browser shell snapshot card beyond create-only behavior.
- Added web UI controls for:
  - loading snapshots for the selected session
  - inline text upload when creating a snapshot
  - viewing stored snapshot content
  - deleting snapshots
- Added client-side snapshot refresh and raw-content fetch helpers.
- Added UI state cleanup for snapshot content and list state on logout.
- Added Worker test coverage for the served snapshot list/content UI wiring.
- Verified the live Worker now serves:
  - snapshot list and content preview panels in the HTML shell
  - browser bundle wiring for snapshot list refresh, content view, and delete actions

## 45. Persisted-Path Template Inputs

- Exposed template `persistedPaths` at the product edges instead of leaving it as backend-only manifest data.
- Added CLI support for `--persisted-paths /workspace,/home/dev/.cache` on `burstflare template upload`.
- Added a persisted-paths input to the web template version form.
- Added client-side parsing of comma-separated persisted paths in the browser shell.
- Added test coverage across the service, Worker, and CLI suites to ensure persisted paths pass through the manifest correctly.
- Verified the live Worker can:
  - serve the persisted-paths UI field in the web shell
  - accept persisted paths in template version creation
  - store the provided persisted paths in the returned manifest

## 46. Stuck Build Recovery During Reconcile

- Extended reconcile to recover stale builds left in `building`.
- Added a stuck-build threshold (5 minutes) for operator recovery logic.
- During reconcile, stale `building` builds now:
  - move back into retry flow when attempts remain
  - dead-letter when attempts are exhausted
  - emit audit entries for recovery or terminal dead-lettering
- Added `buildsBuilding` and `buildsStuck` to the admin report.
- Added `recoveredStuckBuilds` to the reconcile response.
- Added test coverage for:
  - positive stuck-build recovery in the service suite
  - the new report and reconcile fields in the Worker and CLI suites
- Verified the live Worker now returns:
  - `buildsBuilding` and `buildsStuck` in `/api/admin/report`
  - `recoveredStuckBuilds` in `/api/admin/reconcile`

## 47. Live Dashboard Auto-Refresh

- Added background polling in the browser shell while an authenticated session is active.
- The web app now starts a 15-second refresh loop after successful dashboard hydration.
- Added safeguards to:
  - avoid overlapping refreshes
  - stop polling on auth expiration
  - stop polling on logout and logout-all
- Added Worker test coverage for the served polling hooks in the browser bundle.
- Verified the live `app.js` bundle now includes:
  - `startAutoRefresh`
  - `stopAutoRefresh`
  - a `setInterval`-driven 15-second refresh loop

## 48. Bulk Dead-Letter Build Recovery

- Added an operator-facing bulk recovery path for dead-lettered builds.
- Added `POST /api/admin/builds/retry-dead-lettered`.
- Added CLI support for `burstflare build retry-dead-lettered`.
- The bulk recovery flow now:
  - finds dead-lettered builds in the current workspace
  - resets their attempt counter
  - moves them back into retry flow
  - re-enqueues them for build processing
- Added test coverage across the service, Worker, and CLI suites.
- Verified the live Worker can:
  - produce a dead-lettered build
  - recover it through the new bulk retry route
  - report the recovered build ID in the response

## 49. Browser Device Approval Controls

- Added in-app device-code approval controls to the browser shell.
- Added a browser input for device codes plus an `Approve Device` action.
- Surfaced the current `pendingDeviceCodes` count in the browser UI.
- Reused the existing device-approval API flow instead of introducing a parallel auth path.
- Added Worker test coverage for the served device-approval UI and client wiring.
- Verified the live Worker can:
  - serve the device approval controls in the browser shell
  - approve a real device code from a browser-authenticated session
  - complete the device exchange flow afterward

## 50. Dashboard Empty States And Last Sync

- Added a visible `Last refresh` indicator to the browser shell.
- The browser UI now records the last successful dashboard sync time.
- Added clearer empty-state rendering for:
  - members/invites
  - auth sessions
  - templates
  - sessions
  - snapshots
- Added Worker test coverage for the new last-refresh and empty-state bundle wiring.
- Verified the live shell now serves:
  - the `Last refresh: never` placeholder before initial sync
  - browser bundle wiring for `setLastRefresh(...)`
  - explicit empty-state text for no-session scenarios

## 51. Snapshot Restore Controls And Safety Checks

- Added `POST /api/sessions/:sessionId/snapshots/:snapshotId/restore`.
- Snapshot restore now rejects:
  - missing snapshot artifacts
  - deleted sessions
  - session states that are not restore-safe
- Restoring a snapshot now records:
  - `lastRestoredSnapshotId`
  - `lastRestoredAt`
  - a `restored` session event
  - a `snapshot.restored` audit entry
- Added CLI support for `burstflare snapshot restore <sessionId> <snapshotId>`.
- Added a browser `Restore` action in the snapshot list and surfaced the last restored snapshot ID on session cards.
- Expanded service, Worker, and CLI test coverage for the restore flow.
- Verified the live Worker can:
  - create a snapshot
  - upload snapshot content
  - restore that snapshot
  - return the restored snapshot ID on the updated session record

## 52. Container-Backed SSH Shell Proxy

- Replaced the old Worker-side echo bridge with container-backed SSH-route proxying when the session container binding is available.
- The Worker now:
  - starts the session container for SSH attach
  - rewrites `/runtime/sessions/:sessionId/ssh` to the container `/ssh` endpoint
  - forwards the WebSocket upgrade directly into the container runtime
- Added a real container-side WebSocket shell endpoint in the session runtime image.
- The container shell now returns session-scoped command responses for:
  - `help`
  - `pwd`
  - `ls`
  - `cd`
  - `whoami`
  - `env`
  - `uname -a`
  - `exit`
- Updated the emitted attach command to the truthful current runtime command:
  - `wscat --connect ...`
  - removed the misleading fake `ssh -o ProxyCommand=...` wrapper
- Added Worker test coverage to prove SSH upgrades are rewritten and forwarded into the container binding.
- Verified the live Worker can:
  - attach to the public SSH WebSocket route
  - receive the container shell welcome banner
  - return `/workspace` for `pwd`

## 53. Browser Recovery Code Controls

- Added browser-shell recovery-code controls to the auth panel.
- The web app now includes:
  - a recovery-code input
  - a `Recover` action
  - a `New Recovery Codes` action
  - an inline recovery-code output panel
- The browser bundle now calls:
  - `POST /api/auth/recover`
  - `POST /api/auth/recovery-codes/generate`
- Recovery actions reuse the existing auth cookie, refresh-token, and CSRF flow instead of introducing a parallel browser auth path.
- Added Worker test coverage for the new recovery UI markup and client-side wiring.
- Verified the live Worker can:
  - serve the recovery controls in the browser shell
  - expose the recovery endpoints in the live app bundle
  - generate recovery codes
  - complete a recovery-code login

## 54. Browser Turnstile Widget Wiring

- Added real browser-side Turnstile widget wiring to the web shell.
- The Worker now dynamically injects:
  - the Turnstile script tag when `TURNSTILE_SITE_KEY` is configured
  - the current `TURNSTILE_SITE_KEY` value into the served browser bundle
- The browser app now:
  - mounts the Turnstile widget when a site key is present
  - auto-fills the hidden/manual token field from widget callbacks
  - resets the challenge after register, login, and recovery attempts
  - keeps the manual token input as a fallback when Turnstile is unconfigured or unavailable
- The Wrangler generator now includes `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` in Worker vars when they are present in `.env`.
- Added Worker test coverage for:
  - script injection when Turnstile is configured
  - dynamic site-key injection in `/app.js`
- Verified the live Worker can:
  - serve the Turnstile widget container without leaking HTML placeholders
  - serve the dynamic Turnstile client wiring in the public app bundle
  - continue to accept auth flows in the no-key fallback mode

## 55. Durable Object Session Runtime Coordination

- Added real session-runtime coordination methods to the session container Durable Object.
- The session container now persists runtime coordination state, including:
  - `desiredState`
  - `status`
  - `runtimeState`
  - `bootCount`
  - last command / start / stop metadata
  - last error information
- Session lifecycle routes now coordinate with the session Durable Object:
  - `POST /api/sessions/:sessionId/start`
  - `POST /api/sessions/:sessionId/stop`
  - `POST /api/sessions/:sessionId/restart`
  - `DELETE /api/sessions/:sessionId`
- Session detail now includes the current runtime coordinator state when the container binding is present.
- Stop/restart/delete now wait for the container to finish tearing down before the next transition is reported complete, which removes the immediate restart race from the public API path.
- Added Worker test coverage for:
  - lifecycle-route coordination with a session container stub
  - runtime-state inclusion on session detail responses
- Verified the live Worker can:
  - start a session and report `runtime.status = running`
  - stop a session and report `runtime.status = sleeping`
  - restart that session immediately and report `runtime.status = running`
  - delete that session and report `runtime.status = deleted`

## 56. Session List Runtime State Surfacing

- Extended the session list API to include runtime coordinator state for each session when the container binding is present.
- Session detail now returns runtime state nested on the `session` object, matching the list shape.
- The browser dashboard now renders runtime status directly on session cards using the attached session-runtime metadata.
- Added Worker test coverage for:
  - runtime state on `GET /api/sessions`
  - runtime state on `GET /api/sessions/:sessionId`
- Verified the live Worker can:
  - return `runtime.status = running` in the session list after a session start
  - return the same runtime state in the session detail response

## 57. Stronger Synthetic Session Lifecycle Smoke Coverage

- Expanded the synthetic smoke script to cover more of the session lifecycle.
- The smoke flow now verifies:
  - session start
  - session list visibility after start
  - session stop
  - session restart
  - session detail after restart
- The smoke script now validates runtime coordinator state when it is present, while still working in local non-container mode.
- The smoke output now reports:
  - `stoppedState`
  - `restartedState`
  - `detailState`
- Verified locally by running the updated smoke flow against the dev server and confirming the stricter lifecycle assertions passed.

## 58. Normalized D1 Persistence Cutover

- Added a third D1 migration in `infra/migrations/0003_normalized_state.sql` for normalized state tables and indexes.
- Refactored the Cloudflare state store so the legacy `_burstflare_state` blob is no longer on the normal write path.
- The Cloudflare store now:
  - treats the legacy blob as a read fallback during cutover
  - promotes normalized D1 tables to the canonical persisted state after the first successful normalized save
  - performs row-level upserts and deletes for normalized collections instead of rewriting entire tables on every mutation
- Added a dedicated store test that verifies:
  - legacy-state loading
  - normalized-table projection on save
  - stable array ordering across the cutover
- Applied the new migration to the live D1 database.
- Verified the live Worker can:
  - complete the first post-deploy register call that triggers the normalized cutover
  - complete the public smoke flow after cutover
  - complete a traced end-to-end flow across auth, template creation, build completion, session lifecycle, snapshot creation, and admin reporting
