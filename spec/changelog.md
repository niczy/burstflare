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
- Implemented the `flare` CLI with auth and session-oriented commands.
- Finalized the CLI rename by switching the default config path to `~/.config/flare/config.json`, requiring `FLARE_CONFIG`, and renaming the workspace package to `@burstflare/flare`.
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
- Added CLI support for `flare export` with optional `--output`.
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
- Added CLI support for `flare auth logout-all`.
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
  - `flare auth recovery-generate`
  - `flare auth recover --email ... --code ...`
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
  - `flare auth sessions`
  - `flare auth revoke-session <authSessionId>`
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
- Added CLI support for `flare workspace rename <name>`.
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
- Added CLI support for `--persisted-paths /workspace,/home/dev/.cache` on `flare template upload`.
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
- Added CLI support for `flare build retry-dead-lettered`.
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
- Added CLI support for `flare snapshot restore <sessionId> <snapshotId>`.
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

## 59. Scoped Normalized D1 Transactions

- Added collection-scoped transactions to the shared store base so a store can load and save only the collections a service method actually needs.
- Extended the Cloudflare store with:
  - `loadCollections(...)` support for normalized D1 state
  - scoped normalized-table reads
  - scoped normalized-table saves that preserve unrelated tables
- Switched the hot control-plane service paths onto scoped collection sets, including:
  - auth and device flows
  - workspace membership and settings flows
  - template CRUD, versioning, build, and release flows
  - session and snapshot flows
  - admin reporting, export, and reconcile enqueue
- Added store coverage that verifies a scoped normalized save updates the targeted collection without wiping unrelated normalized rows.
- Verified the live Worker can:
  - pass the public smoke flow after the scoped-load refactor
  - complete a traced end-to-end flow across auth, templates, async builds, sessions, snapshots, and admin reporting with the new scoped transaction path

## 60. Legacy State Retirement And Schema Validation

- Added `packages/shared/src/cloudflare-schema.js` as the shared schema definition for normalized Cloudflare persistence.
- Removed the runtime legacy-row fallback from the Cloudflare store.
- The Worker now reads only from normalized D1 tables and will not read `_burstflare_state`.
- Added `infra/migrations/0004_drop_legacy_state.sql` to:
  - pin `bf_state_meta.schema_version`
  - drop the legacy `_burstflare_state` table
- Added `scripts/cloudflare-validate-schema.mjs` to validate the live D1 schema against the shared normalized schema definition.
- Updated `npm run cf:migrate` to run schema validation automatically after migrations.
- Added test coverage that confirms the Cloudflare store loads normalized state directly without any legacy fallback.
- Verified in the live Cloudflare environment that:
  - `0004_drop_legacy_state.sql` applied successfully
  - schema validation passes with no missing tables or indexes
  - `legacyTablePresent` is `false`
  - the public Worker still passes the end-to-end smoke flow after the breaking cutover

## 61. WebAuthn Passkeys And Richer Browser Auth Controls

- Added real passkey support across the control plane:
  - passkey registration start and finish routes
  - passkey login start and finish routes
  - passkey list and delete routes
- Added passkey storage on the user record, including:
  - credential id
  - label
  - public key
  - algorithm
  - transports
  - created / last-used metadata
- Added server-side WebAuthn challenge management for auth flows using KV when available and local fallback storage otherwise.
- Added server-side validation for:
  - WebAuthn client-data challenge matching
  - origin matching
  - passkey assertion signature verification for supported algorithms
- Added browser passkey controls in the web shell:
  - `Passkey Login`
  - `Register Passkey`
  - passkey inventory with delete actions
- Expanded the browser auth/device UX:
  - `auth/me` now returns passkey summaries
  - `auth/me` now returns pending device approvals as a list, not just a count
  - the web shell now renders pending device approvals with one-click approve buttons
- Sanitized user-shaped API responses so raw stored passkey material is not returned in normal auth and membership responses.
- Verified locally through CI and in the live Cloudflare deployment that:
  - the browser shell serves the new passkey controls
  - the live app bundle includes the WebAuthn browser code
  - a synthetic live passkey registration succeeds
  - a synthetic live passkey login succeeds and issues a browser token
  - the live deployment currently reports `turnstileEnabled: false`, so passkeys are fully verified but Turnstile enforcement is not active until real keys are configured

## 62. Workflow-Backed Build Orchestration

- Added a real Cloudflare Workflow binding for template builds:
  - `BUILD_WORKFLOW`
  - workflow name generation through the Wrangler config generator
  - `BurstFlareBuildWorkflow` execution in the Worker entrypoint
- Build dispatch now prefers Workflows over the build queue when the workflow binding is present.
- Added build-level workflow execution metadata, including:
  - `dispatchMode`
  - `executionSource`
  - `workflowName`
  - `workflowInstanceId`
  - `workflowStatus`
  - queued / started / finished timestamps
- Template-build retries from workflow-driven runs now re-dispatch through new workflow instances instead of relying only on the queue consumer path.
- Reconcile now preserves workflow-driven execution by re-dispatching queued and retrying builds through the workflow layer instead of bypassing it with direct in-process execution.
- Extended build logs to include workflow orchestration metadata for operator inspection.
- Added service and Worker test coverage for:
  - workflow dispatch metadata on newly queued builds
  - workflow-marked running state
  - workflow-driven successful build completion
  - workflow-enabled runtime health reporting
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - the Worker deploy now includes `workflow: burstflare-builds`
  - `/api/health` now reports `workflowEnabled: true` and `buildDispatchMode: workflow`
  - a live template build now reaches `succeeded` asynchronously with:
    - `dispatchMode = workflow`
    - `workflowStatus = succeeded`
    - `executionSource = workflow`

## 63. Runtime-First Session State Persistence

- Refactored session lifecycle state transitions behind a shared transition helper in the service layer.
- Session records now persist the last known runtime snapshot fields:
  - `runtimeDesiredState`
  - `runtimeStatus`
  - `runtimeState`
  - `runtimeUpdatedAt`
- Added a runtime-coupled session transition path in the service layer so a caller can:
  - execute the runtime transition first
  - persist the resulting session state and runtime snapshot in the same transaction
- Updated the session lifecycle routes to use the runtime-coupled transition path whenever the session container Durable Object binding is present.
- The Durable Object is now the source of truth for the route-level lifecycle result on:
  - start
  - stop
  - restart
  - delete
- Kept the previous non-container fallback behavior unchanged for local and non-runtime environments.
- Added test coverage for:
  - service-level persistence of runtime state from a runtime-driven transition callback
  - Worker lifecycle responses carrying the persisted `session.runtimeStatus` fields alongside live runtime data
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - a started session now returns `session.runtimeStatus = running` on the start response
  - `GET /api/sessions/:id` returns the persisted runtime snapshot fields and the live attached runtime object
  - the live session detail reports:
    - `session.state = running`
    - `session.runtimeStatus = running`
    - `session.runtimeState = healthy`

## 64. Container-Applied Snapshot Restore

- Added a container-side snapshot restore endpoint in the session runtime image.
- The session container now keeps a lightweight virtual restored-snapshot state, including:
  - `restoredSnapshotId`
  - `restoredAt`
  - restored content metadata
  - virtual file paths under `/workspace/.burstflare`
- Snapshot restore now applies to the active container runtime when:
  - the session is currently running
  - the session container binding is present
- Session start and restart now replay the most recently restored snapshot into the container runtime after the runtime comes up.
- The session container now surfaces restored snapshot state in:
  - preview HTML payload
  - `/meta`
  - shell commands such as `env`, `ls`, and `cat /workspace/.burstflare/last.snapshot`
- Added Worker test coverage that proves:
  - restoring a snapshot on a non-running session does not eagerly mutate the container
  - starting that session replays the stored snapshot into the container runtime
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - `POST /api/sessions/:id/snapshots/:snapshotId/restore` now returns `runtimeRestore` for running sessions
  - the live `runtimeRestore` payload includes:
    - `appliedPath`
    - `aliasPath`
    - `bytes`
    - `contentType`
  - the live preview HTML now includes the restored snapshot id after a running-session restore

## 65. Automatic Runtime Snapshot Capture

- Snapshot creation now auto-captures runtime state from the session container when:
  - the session is running
  - the session container binding is present
- Added a container-side snapshot export endpoint in the session runtime image.
- The session runtime now exports either:
  - the current restored snapshot payload
  - or a fallback JSON runtime snapshot if no restored snapshot has been applied yet
- `POST /api/sessions/:sessionId/snapshots` now:
  - creates the snapshot record
  - fetches runtime snapshot content from the running container
  - stores that content into snapshot storage automatically
  - returns `runtimeCapture` metadata in the API response
- Added Worker test coverage that proves:
  - creating a snapshot for a running session auto-populates snapshot content
  - the stored snapshot can be downloaded immediately afterward
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - snapshot creation on a running session now returns `runtimeCapture`
  - the live auto-captured snapshot content is persisted immediately
  - the captured snapshot content includes the running session id

## 66. Preview And SSH Snapshot Rehydration

- Added runtime snapshot hydration for non-lifecycle runtime entry paths.
- The Worker now reapplies the last restored snapshot before proxying into the container on:
  - `/runtime/sessions/:sessionId/preview`
  - `/runtime/sessions/:sessionId/ssh`
- Added runtime-token-safe snapshot reads in the service layer so the SSH path can rehydrate snapshot content without needing a browser auth token.
- This closes the gap where preview or SSH could boot a container outside the normal `session start` route and miss the restored snapshot state.
- Added Worker test coverage that proves:
  - a restored snapshot on a running session is rehydrated before preview proxying
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - restoring a snapshot on a non-running session does not apply it immediately
  - the first preview request can now boot the container and still render the restored snapshot id

## 67. Real Build Artifact Generation

- Added a real builder-output step to successful template builds.
- Successful builds now:
  - load the uploaded bundle when present
  - fall back to manifest-derived input when no bundle is uploaded
  - compute a SHA-256 digest of the build input
  - derive a structured build artifact with source metadata
  - store that artifact in `BUILD_BUCKET`
- Build records now persist artifact metadata, including:
  - `artifactKey`
  - `artifactSource`
  - `artifactDigest`
  - `artifactBytes`
  - `artifactBuiltAt`
- Build logs now include the persisted artifact metadata for operator inspection.
- Added `GET /api/template-builds/:buildId/artifact`.
- Added CLI support for `flare build artifact <buildId>`.
- Template deletion now also cleans up stored build artifacts.
- Added local test coverage across the service, Worker, and CLI flows for:
  - artifact generation from bundle-backed builds
  - artifact retrieval through the API
  - artifact retrieval through the CLI
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - a workflow-driven build now produces a stored artifact
  - the live artifact endpoint returns:
    - `source = bundle`
    - `sourceBytes`
    - `sourceSha256`
    - `lineCount`

## 68. Artifact-Backed Release Binding Manifests

- Template promotion now stores a concrete binding manifest on each release record.
- The release binding manifest is derived from the promoted template version and its build output, including:
  - image
  - features
  - persisted paths
  - bundle-upload presence
  - artifact source
  - artifact digest
  - artifact build timestamp
  - template name
- `GET /api/releases` now returns the persisted release binding payload and backfills it for older release records when needed.
- This makes template promotion the canonical source for the control-plane runtime binding description instead of only a tuple of ids.
- Added test coverage across the service, Worker, and CLI flows to prove promoted releases carry the artifact-backed binding manifest.
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - the live promote response now returns `release.binding`
  - the live releases list returns the same binding payload
  - the live binding payload includes `artifactSource`, `artifactDigest`, and `persistedPaths`

## 69. Release Rollback Automation

- Added service-layer rollback automation that can restore a template to a prior release.
- Added `POST /api/templates/:templateId/rollback`.
- Added CLI support for `flare template rollback <templateId> [<releaseId>]`.
- Rollback now:
  - selects a prior release automatically when no release id is provided
  - can target an explicit release id
  - moves the template's active version back to that release's template version
  - emits a new rollback release record with:
    - `mode = rollback`
    - `sourceReleaseId`
- Added `template.rolled_back` audit events with previous-version and release provenance.
- Added service, Worker, and CLI test coverage for rollback flows.
- Verified locally through `npm run ci`, in the local dev smoke flow, and in the live Cloudflare deployment that:
  - a template can be promoted from version 1 to version 2
  - a rollback can restore the active version back to version 1
  - the emitted rollback release preserves `mode = rollback` and `sourceReleaseId`

## 70. Release Validation Flow

- Added `scripts/release-validate.mjs`.
- Added `npm run release:validate`.
- The validation flow now:
  - provisions a fresh workspace through the public API
  - creates two template versions
  - waits for both builds to become ready
  - promotes version 1
  - promotes version 2
  - rolls back automatically to the prior release
  - verifies the release catalog and rollback provenance
- Updated GitHub Actions CI to run the release-validation flow against the local dev server after the existing smoke test.
- Verified the new validation flow both:
  - locally against `http://127.0.0.1:8787`
  - live against `https://burstflare.nicholas-zhaoyu.workers.dev`

## 71. Runtime-Aware Reconcile Persistence

- Added a shared `runReconcile(...)` path for background reconcile execution.
- Queue-driven and scheduled reconcile now stop running session containers through the runtime binding before the control-plane reconcile persists the sleep transition.
- Added internal service helpers so the system reconcile path can:
  - list non-deleted sessions
  - apply a runtime-backed session transition without a user token
- This keeps the persisted session record aligned with the Durable Object runtime during background reconcile, instead of only changing the control-plane state.
- Added Worker test coverage for runtime-aware reconcile.
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - enqueueing reconcile moves a running session to `sleeping`
  - the live session detail reports:
    - `session.state = sleeping`
    - `session.runtime.status = sleeping`
    - `session.runtimeStatus = sleeping`

## 72. Live Turnstile Production Enablement

- Added the real production Turnstile site key and secret to the local Cloudflare deploy configuration.
- Redeployed the live Worker so the public web shell now injects the Turnstile script and a non-empty site key.
- Verified in the live Cloudflare deployment that:
  - `/api/health` now reports `turnstileEnabled = true`
  - the root HTML now includes the Turnstile script loader
  - the browser bundle now contains a non-empty injected Turnstile site key
  - `POST /api/auth/register` without a Turnstile token now returns `400` with `Turnstile token is required`
  - `POST /api/auth/register` with a bogus token now returns `400` with `invalid-input-response`
- This closes the remaining PR 03 gap; Turnstile is now active in the production deployment rather than only wired in code.

## 73. Persisted-Path-Aware Runtime Snapshots

- Session records now persist the active template version's `persistedPaths` when the session is created.
- The session container now restores structured snapshot envelopes (`burstflare.snapshot.v2`) instead of treating every snapshot as an opaque runtime blob.
- Runtime snapshot restore now:
  - accepts `persistedPaths` from the Worker
  - filters restored files to only paths allowed by the session's persisted-path policy
  - drops files outside the allowed persisted paths
- Runtime snapshot export now emits a structured JSON envelope with:
  - `format = burstflare.snapshot.v2`
  - `persistedPaths`
  - `files`
- Running-session autosave now captures that structured envelope from the container, so stored snapshots preserve the persisted-path policy and file list.
- Added direct container-runtime test coverage for persisted-path filtering.
- Added Worker test coverage proving:
  - restore hydration forwards `persistedPaths`
  - autosave forwards the session's `persistedPaths`
  - autosaved snapshot content preserves the structured envelope
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - restoring a snapshot containing both allowed and disallowed file paths only rehydrates the allowed persisted file
  - preview HTML shows the allowed restored file path
  - preview HTML does not show the blocked file path
  - autosaved runtime snapshot content preserves both the `persistedPaths` list and the restored persisted file entry

## 74. Runtime Transition Version Guards

- Durable Object runtime transitions now carry monotonic operation versions and operation ids.
- Session records now persist:
  - `runtimeVersion`
  - `runtimeOperationId`
- The service layer now performs runtime-backed lifecycle transitions in two phases:
  - authorize and snapshot the target session
  - execute the runtime transition
  - reload the current session and reject the result if the runtime snapshot is stale
- This prevents an older runtime transition result from overwriting a newer persisted session state.
- Added service test coverage for stale runtime transition rejection.
- Expanded Worker lifecycle tests to assert runtime version tracking across start, restart, and stop.
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - runtime versions increment monotonically across session lifecycle transitions
  - the persisted session detail keeps the latest runtime version and operation id

## 75. SSHD-Backed Runtime Tunnel

- The browser terminal now uses a dedicated `/runtime/sessions/:id/terminal` shell route instead of sharing the raw SSH tunnel route.
- Session runtime images now install and start OpenSSH `sshd` on `127.0.0.1:2222`.
- The container `/ssh` endpoint now bridges raw TCP bytes between the websocket client and the in-container `sshd`, rather than routing through the old shell echo bridge.
- The runtime now waits for `sshd` to become ready before reporting the container as booted.
- SSH tunnel error paths now emit valid websocket close frames instead of invalid close payloads.
- CLI `flare ssh <session>` now emits a `wstunnel` plus native `ssh` attach command:
  - `wstunnel client -L tcp://127.0.0.1:2222:...`
  - `ssh -p 2222 dev@127.0.0.1`
- Added Worker and CLI test coverage for the dedicated browser terminal route and the new SSH attach command shape.
- Verified locally through `npm run ci`, in a local Docker container, and in the live Cloudflare deployment that:
  - the browser terminal websocket returns the container shell banner and `pwd` resolves to `/workspace`
  - the container `/ssh` route serves a real `SSH-2.0-OpenSSH_10.2` banner
  - the public Worker `/runtime/sessions/:id/ssh` route also serves a real `SSH-2.0-OpenSSH_10.2` banner through the runtime token-gated websocket path

## 76. Browser Runtime Editor

- Added a new container-native `/editor` route inside the session runtime image.
- The editor route now:
  - lists runtime files inside the session's configured persisted paths
  - opens a selected file directly from live runtime state
  - writes file edits back into the running container
  - preserves the session's persisted-path policy when saving
- Added new Worker proxy routes for:
  - `GET /runtime/sessions/:id/editor`
  - `POST /runtime/sessions/:id/editor`
- The editor proxy now:
  - authenticates with either bearer auth or browser session cookies
  - preserves CSRF protection for cookie-authenticated saves
  - forwards the session's persisted-path policy into the container editor
- Added a new browser `Editor` action on session cards so the web app can open the runtime editor in a new tab.
- Added `flare editor <sessionId>` to print the session editor URL from the CLI.
- Added direct container-runtime test coverage for editor path enforcement.
- Added Worker test coverage for editor proxy routing and save-body forwarding.
- Added CLI coverage for the new `editor` command.
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - the public editor route renders the workspace editor shell
  - saving `/workspace/project/notes.txt` through the public editor route updates the live runtime
  - a subsequent runtime-backed snapshot captures the saved editor content in the structured snapshot envelope

## 77. OCI-Style Build Metadata

- The build compiler now emits OCI-style image metadata instead of only raw source digests.
- Successful build artifacts now include:
  - `imageReference`
  - `imageDigest`
  - `configDigest`
  - `layerDigests`
  - `layerCount`
  - `buildStrategy = simulated-oci`
  - OCI-style labels for title, version, revision, and source
- Successful build records now persist the image metadata fields so they are available without re-reading the artifact blob.
- Build logs now include the persisted image metadata values.
- Promoted release bindings now carry the same image metadata so the runtime catalog has a stable image-oriented contract.
- Added service, Worker, and CLI test coverage for the new build metadata fields.
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - `GET /api/template-builds/:id/artifact` now returns OCI-style image metadata for a fresh build
  - `POST /api/templates/:id/promote` returns a release binding whose `imageReference` and `imageDigest` match the stored build artifact

## 78. Runtime Bootstrap And Lifecycle Hooks

- Added runtime bootstrap control requests so the Worker now pushes persisted session metadata into the live container after start and on runtime-driven attach paths.
- The container runtime now persists bootstrap metadata in:
  - in-memory runtime state
  - `/workspace/.burstflare/session.json`
- Added lifecycle hook control requests so stop, reconcile, restart, and delete now record runtime lifecycle transitions before the container changes state.
- The container runtime now persists the most recent lifecycle hook in:
  - in-memory runtime state
  - `/workspace/.burstflare/lifecycle.json`
- The session container Durable Object now records lifecycle analytics fields in its runtime state, including:
  - `lastBootstrapAt`
  - `lastBootstrapSnapshotId`
  - `lastBootstrapState`
  - `lastLifecyclePhase`
  - `lastLifecycleAt`
  - `lastLifecycleReason`
- Session detail and session list responses now inherit those runtime analytics fields through the existing runtime-state attachment path.
- Added direct container-runtime tests for bootstrap and lifecycle persistence.
- Added Worker tests for runtime bootstrap on start and lifecycle hooks on stop.
- Verified locally through `npm run ci` and in the live Cloudflare deployment that:
  - starting a public session records `lastBootstrapAt` and `lastBootstrapState = running`
  - preview now exposes the bootstrap file path in the runtime-rendered container HTML
  - stopping a public session records and persists `lastLifecyclePhase = sleep` and `lastLifecycleReason = session_stop`

## 79. Beta Runbook And Expanded Smoke Coverage

- Added `spec/runbook.md` as the current beta operations guide.
- The runbook now includes:
  - supported beta scope
  - daily operator checks
  - auth, build, runtime, and storage incident procedures
  - staging-to-production rollout checklist
  - limited beta onboarding guidance
  - recovery defaults
- Expanded `scripts/smoke.mjs` so the synthetic flow now also verifies:
  - build artifact OCI-style image metadata
  - release binding image metadata parity
  - SSH tunnel command shape
  - runtime lifecycle analytics when containers are enabled
  - preview and editor route availability when containers are enabled
- Verified the updated smoke flow locally against the dev server.

## 80. Dashboard Pulse And UI Smoke

- Added a `Dashboard Pulse` summary strip to the browser shell so the dashboard now shows live counts for:
  - templates
  - builds
  - sessions
  - snapshots
- Added `scripts/ui-smoke.mjs` to verify the browser shell surface without needing a full browser automation pass.
- The UI smoke flow now validates:
  - shell HTML markers
  - stylesheet markers
  - browser bundle markers
- Updated GitHub Actions so the local dev-server validation step now runs:
  - `npm run smoke`
  - `npm run ui:smoke`
  - `npm run release:validate`
- Verified locally that both `npm run smoke` and `npm run ui:smoke` pass against the dev server.
- Verified in the live Cloudflare deployment that the public shell serves:
  - the `Dashboard Pulse` card
  - the updated browser bundle markers for the dashboard pulse and editor action

## 81. Targeted Operator Reconcile Workflows

- Added targeted operator reconcile actions across the service layer, API, and `flare` CLI:
  - `reconcile preview`
  - `reconcile sleep-running`
  - `reconcile recover-builds`
  - `reconcile purge-sleeping`
  - `reconcile purge-deleted`
- Expanded the admin report payload with `reconcileCandidates` so operators can see pending running-session, stale-build, queued-build, stale-sleeping-session, and deleted-session counts without mutating state.
- Verified locally with new service, Worker, and CLI tests covering the targeted operator flows.
- Verified live on the public Cloudflare deployment that:
  - `GET /api/admin/reconcile/preview` returns the new preview shape
  - `POST /api/admin/reconcile/sleep-running` returns `sleptSessions` and `sessionIds`
  - `POST /api/admin/reconcile/recover-builds` returns `recoveredStuckBuilds` and `buildIds`
  - `POST /api/admin/reconcile/purge-sleeping` returns `purgedStaleSleepingSessions`
  - `POST /api/admin/reconcile/purge-deleted` returns `purgedDeletedSessions`

## 82. Quota Overrides And Storage Metering

- Expanded the plan model with enforceable limits for:
  - template count
  - running sessions
  - template versions per template
  - snapshots per session
  - total stored bytes
  - runtime minutes
  - template builds
- Usage responses now include:
  - current storage bytes for bundles, snapshots, and build artifacts
  - total stored bytes
  - current inventory counts for templates, template versions, sessions, and snapshots
- Added workspace quota overrides across the service layer, API, and `flare` CLI via `workspace quota-overrides`.
- Added hard enforcement on template creation, template version creation, session start/restart, snapshot creation, and bundle/snapshot uploads.
- Verified locally with new service, Worker, and CLI coverage for quota overrides and enforcement.
- Verified live on the public Cloudflare deployment that:
  - `POST /api/workspaces/current/quota-overrides` updates effective limits
  - `GET /api/usage` returns the override-aware limits and storage rollups
  - clearing the overrides restores the default plan limits

## 83. Security Hardening And Runtime Secret Controls

- Added workspace runtime secret management across the service layer, API, and `flare` CLI:
  - `GET /api/workspaces/current/secrets`
  - `POST /api/workspaces/current/secrets`
  - `DELETE /api/workspaces/current/secrets/:name`
  - `flare workspace secrets`
  - `flare workspace set-secret <NAME> --value <VALUE>`
  - `flare workspace delete-secret <NAME>`
- Runtime secret responses are now metadata-only and never return raw secret values after write.
- Runtime bootstrap now passes secret metadata and secret values into the session container so the container can materialize `/run/burstflare/secrets.env` at boot.
- Added explicit rate limiting on runtime-sensitive routes:
  - SSH token minting
  - preview
  - editor read/write
  - browser terminal
  - SSH upgrade
- Expanded audit coverage for:
  - usage views
  - audit-log reads
  - admin report reads
  - reconcile preview reads
  - admin exports
  - runtime secret create/list/delete
- Workspace exports now include:
  - artifact inventory for template bundles, build artifacts, and snapshots
  - redacted runtime secret metadata under `export.security.runtimeSecrets`
- Verified locally with updated service, Worker, CLI, and container-runtime tests covering:
  - redacted secret metadata
  - container bootstrap secret projection
  - runtime route authorization and rate limits
  - export redaction
- Verified live on the public Cloudflare deployment that:
  - runtime secret create/list/delete works end to end
  - secret list responses expose only metadata
  - admin export includes redacted runtime secret metadata and build artifact inventory
  - repeated `POST /api/sessions/:sessionId/ssh-token` requests now return `429` with `x-burstflare-rate-limit-limit: 12` after the configured threshold
