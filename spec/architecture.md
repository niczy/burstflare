# BurstFlare Architecture

## Architecture Goal

BurstFlare is a Cloudflare-native full stack for managing ephemeral development environments. The architecture separates a durable multi-tenant control plane from a short-lived runtime plane, while using Cloudflare services for every core concern: delivery, compute, state, storage, orchestration, and analytics.

## Top-Level System

```text
Browser UI / CLI
    |
    v
Edge App Worker
  - Serves web assets
  - Exposes JSON API
  - Handles CLI auth/device flow
  - Issues session cookies and API tokens
    |
    +--> D1 (accounts, metadata, policy)
    +--> KV (session cache, rate limits, ephemeral tokens)
    +--> R2 (template bundles, workspace snapshots, exports)
    +--> Queues (async jobs)
    +--> Workflows (long-running orchestration)
    +--> Analytics Engine (usage + audit events)
    |
    v
Session Durable Objects
  - Per-session coordination
  - Locking and state transitions
  - Runtime routing
    |
    v
Cloudflare Containers
  - SSH daemon
  - WebSocket tunnel endpoint
  - Optional browser IDE / terminal
  - Workspace bootstrap + snapshot sync
```

## Component Breakdown

### 1. Edge App Worker

The main Worker is the single public entry point for the product.

Responsibilities:

- Serve the web application shell and static assets.
- Expose the authenticated API used by the web UI and CLI.
- Implement session cookies, API tokens, and device authorization for CLI login.
- Enforce authorization for all control-plane and runtime requests.
- Proxy HTTP and WebSocket traffic into the correct container session.
- Emit audit and usage events.

Implementation shape:

- One Worker codebase with route modules for `web`, `api`, `auth`, and `runtime`.
- Static frontend assets bundled with the Worker to avoid a split hosting model.
- Service-level middleware for auth, request tracing, and rate limiting.

### 2. Identity And Access

The account system is built into the platform instead of relying on Cloudflare Access as the end-user identity provider.

Authentication:

- WebAuthn passkeys as the primary login mechanism.
- Cloudflare Turnstile on registration, device authorization approval, and sensitive auth paths.
- Recovery codes stored as salted hashes in D1.

Sessioning:

- Signed, HTTP-only cookies for browser sessions.
- Short-lived bearer access tokens plus rotating refresh tokens for CLI/API use.
- KV-backed token/session index for revocation, replay defense, and fast lookups.

CLI auth:

- Device authorization flow.
- The CLI requests a device code, the user approves it in the web UI, and the Worker mints CLI tokens scoped to the selected workspace.

Authorization:

- Workspace-scoped RBAC stored in D1.
- Roles: `owner`, `admin`, `member`, `viewer`.
- Policy checks enforced in Worker middleware before any D1 mutation or runtime access.

### 3. Metadata Plane

D1 is the source of truth for durable application state.

Primary tables:

- `users`
- `passkeys`
- `recovery_codes`
- `workspaces`
- `workspace_memberships`
- `api_tokens`
- `templates`
- `template_versions`
- `template_builds`
- `sessions`
- `session_snapshots`
- `usage_events`
- `usage_rollups`
- `audit_logs`

D1 is used for durable correctness, not high-frequency coordination. Writes that need strict session serialization are delegated to Durable Objects.

### 4. Ephemeral State And Caching

KV holds fast-changing, non-authoritative data:

- Browser session revocation index
- CLI refresh token index
- Device authorization codes
- CSRF and nonce material
- Short-lived signed upload/download grants
- Basic rate-limit counters

KV is treated as a cache or coordination aid; any durable business state still lands in D1.

### 5. Template Storage And Build System

BurstFlare stores template source and metadata separately from runtime sessions.

R2 stores:

- Uploaded template source bundles (`tar.gz` or structured object layout)
- Normalized template manifests
- Build logs and build artifacts that need to be retained

D1 stores:

- Template ownership, visibility, and lifecycle status
- Version metadata
- Promotion state
- Mapping from a template version to a currently active container binding

Build execution:

- Template builds run inside a dedicated builder container class managed by the platform.
- The builder image contains a rootless build toolchain such as BuildKit or Kaniko plus policy checks for allowed base images and commands.
- Successful builds publish versioned images to the Cloudflare container registry before promotion updates the active binding catalog.

Queues and Workflows handle the asynchronous pipeline:

1. User or admin uploads a template bundle through a signed R2 upload URL.
2. The Worker validates manifest metadata and writes a `template_builds` record.
3. A Queue message starts a Workflow for build and promotion.
4. The Workflow runs the server-side build/promotion pipeline, tracks retries, persists logs, and advances state.
5. On success, the template version is marked promotable and the generated runtime binding config is updated for the next deploy.

### 6. Container Runtime Plane

Each active dev session is coordinated by a session-specific Durable Object and backed by a Cloudflare Container instance.

Container image contents:

- Base runtime and developer tooling for the template
- `sshd`
- `wstunnel` (or equivalent) to expose SSH over WebSocket
- Optional `code-server` or `ttyd` for browser access
- Bootstrap scripts for workspace hydration and secret injection
- Snapshot scripts for flushing persisted paths back to R2

Durable Object responsibilities:

- Own the canonical state machine for a session: `creating`, `starting`, `running`, `sleeping`, `stopping`, `failed`, `deleted`
- Ensure only one start/stop transition runs at a time
- Resolve the correct container binding and session ID
- Fan out status updates to D1 and Analytics Engine
- Gate runtime access when the session is expired, over quota, or unauthorized

### 7. Runtime Networking Model

Cloudflare Containers do not expose raw inbound TCP to end users, so all runtime traffic enters through the Worker.

Supported access patterns:

- SSH over WebSocket: the CLI opens a WebSocket tunnel to the Worker, which proxies the connection into the container's tunnel endpoint.
- Browser IDE / terminal: the browser uses HTTP and WebSocket to connect through the same Worker to `code-server` or `ttyd`.
- Preview ports: the Worker can proxy additional HTTP ports from the container under authenticated subpaths.

This preserves a single policy and audit layer for all runtime access.

### 8. Workspace Persistence

Container disk is treated as ephemeral.

Persistence strategy:

- A template defines which paths are persistent, such as `/workspace`, `.cache/pip`, or project metadata.
- On session start, the container bootstrap script downloads the latest workspace snapshot from R2 into the ephemeral filesystem.
- During runtime, the session DO schedules periodic snapshot jobs or explicit save events.
- On sleep/stop, the container flushes persistent paths back to R2 and writes a snapshot record to D1.

This model keeps compute stateless while preserving user work between sessions.

### 9. Usage Metering And Observability

Analytics Engine captures append-only operational and product events:

- Session starts/stops
- Active runtime duration
- Template build outcomes
- Auth events
- Proxy connection counts
- Error classes

Rollups are periodically written to D1 for:

- quota enforcement
- billing readiness
- workspace and user usage views in the web app

Operational visibility should also include:

- Workers logs for request and exception tracing
- per-workflow build logs stored in R2
- audit logs in D1 for high-value user actions

## Key Request Flows

### A. Browser Sign-Up And Login

1. User loads the web app from the Edge App Worker.
2. Turnstile challenge is completed.
3. The browser registers or authenticates a passkey with WebAuthn.
4. The Worker stores credentials in D1 and issues a signed session cookie.

### B. CLI Login

1. CLI requests a device code from the API.
2. User signs in on the web UI and approves the device request.
3. The Worker issues scoped access and refresh tokens.
4. CLI stores encrypted credentials locally and reuses them for API and SSH flows.

### C. Start Session

1. User calls `burstflare up` or clicks "Start Session".
2. The Worker validates quota and authorization, creates a D1 session record, and signals the session DO.
3. The session DO acquires the lock, resolves the template binding, starts or wakes the container, and hydrates the workspace from R2.
4. The DO marks the session `running` and publishes usage events.

### D. SSH Attach

1. CLI requests a short-lived runtime token.
2. CLI opens a WebSocket tunnel to `/runtime/sessions/:id/ssh`.
3. The Worker validates the token and forwards the WebSocket stream to the container.
4. The container's tunnel forwards traffic to local `sshd`.

### E. Template Upload And Promotion

1. A privileged user uploads a template bundle to R2.
2. The Worker creates a template version and build record in D1.
3. A Workflow runs validation, build, promotion, and config generation.
4. The platform updates the generated container binding manifest and triggers a deploy so the new image is routable.

## Template Binding Constraint

Cloudflare Containers currently require container bindings to be declared in Worker configuration. That means a newly promoted template version cannot become runnable until the Worker is deployed with an updated binding map.

BurstFlare treats this as a first-class architectural constraint:

- Template promotion is asynchronous and ends with config generation plus deploy.
- The control plane stores template source and metadata immediately, but runtime activation happens only after promotion completes.
- The platform maintains a bounded catalog of active template bindings per environment.

This keeps the system honest about how the underlying platform works while still supporting centralized template management.

## Deployment Topology

Recommended environments:

- `local`: developer sandbox with fake auth and reduced template catalog
- `staging`: end-to-end validation with production-like data model and selected templates
- `production`: customer-facing system

Each environment uses:

- one primary Worker deployment
- one D1 database
- one R2 bucket namespace
- one KV namespace group
- one Queue set
- one Workflow namespace
- one Analytics Engine dataset
- one container binding catalog for active template versions

## Non-Functional Targets

- P95 authenticated API latency under 250 ms excluding container cold start.
- P95 session creation under 15 s for common warm images.
- Safe restart and retry semantics for all async template and session workflows.
- No direct public access to containers outside the Worker policy layer.
- Full audit trail for account, template, and session mutations.
