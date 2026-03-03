export const metadata = {
  title: "concepts.md — BurstFlare",
  description: "BurstFlare core concepts in plain Markdown — suitable for agents and LLMs.",
};

export default function DocsRawPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: rawStyles }} />
      <pre className="raw-markdown">{markdownContent}</pre>
    </>
  );
}

const rawStyles = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { min-height: 100%; }
body {
  background: #0f1419;
  color: #d4dde4;
  font-family: "IBM Plex Mono", "SFMono-Regular", "Fira Mono", monospace;
  font-size: 14px;
  line-height: 1.65;
}
.raw-markdown {
  display: block;
  padding: 32px clamp(16px, 4vw, 64px) 80px;
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 860px;
}
`;

export const markdownContent = `# BurstFlare — Core Concepts

Source: https://burstflare.dev/docs
Plain-text version: https://burstflare.dev/docs/raw

---

## Overview

BurstFlare is organized around four primary building blocks:

\`\`\`
Workspace
  ├── Members (roles: owner, admin, member, viewer)
  ├── Runtime secrets (env vars injected into all sessions)
  ├── Templates (versioned container environment specs)
  │     └── Versions → build pipeline → promoted → active
  └── Sessions (live container instances of a template)
        └── Snapshots (persisted-path archives, auto on sleep/stop)
\`\`\`

---

## Workspaces

A workspace is the **top-level organizational and billing boundary**. Everything
in BurstFlare — templates, sessions, members, secrets — belongs to exactly one
workspace.

### Key fields

| Field | Description |
|---|---|
| id | Unique workspace identifier |
| owner_user_id | User who created the workspace |
| plan | \`free\` / \`pro\` / \`enterprise\` |
| runtimeSecrets | Array of key-value env vars injected into all sessions |

### Plans and quotas

| Limit | Free | Pro | Enterprise |
|---|---|---|---|
| Templates | 10 | 100 | 1,000 |
| Running sessions | 3 | 20 | 200 |
| Versions / template | 25 | 250 | 2,500 |
| Snapshots / session | 25 | 250 | 2,500 |
| Storage | 25 MB | 250 MB | 2.5 GB |
| Runtime minutes / mo | 500 | 10,000 | 100,000 |
| Builds / mo | 100 | 2,000 | 20,000 |

### Roles

- **owner** — Full control: billing, members, all resources.
- **admin** — Manages templates, sessions, and workspace settings.
- **member** — Creates and manages sessions, views templates.
- **viewer** — Read-only access across the workspace.

### Key API routes

\`\`\`
GET  /api/workspaces                        List workspaces
GET  /api/workspaces/current/members        List members
POST /api/workspaces/current/invites        Create invite
POST /api/workspaces/current/invites/accept Accept invite
PUT  /api/workspaces/current/members/:id/role Update role
\`\`\`

### CLI reference

\`\`\`sh
flare workspace list
flare workspace members
flare workspace invite --email you@example.com --role member
\`\`\`

---

## Templates

A template is a **versioned, reusable environment specification**. It defines
the container image, opt-in features, file paths to persist between sessions,
and the idle-sleep timeout.

You build a template once and launch it as many sessions as you need.

### Manifest (inside the uploaded bundle)

\`\`\`json
{
  "image": "node:22-slim",
  "features": ["ssh", "browser", "snapshots"],
  "persistedPaths": ["/home/user/project"],
  "sleepTtlSeconds": 1800
}
\`\`\`

| Field | Type | Description |
|---|---|---|
| image | string (required) | Container image reference |
| features | string[] | Opt-in: \`ssh\`, \`browser\`, \`snapshots\` |
| persistedPaths | string[] | Up to 8 paths preserved between sessions |
| sleepTtlSeconds | number | Auto-sleep after idle (1 s – 604800 s / 7 days) |

### Version lifecycle

\`\`\`
queued → building → promotable → promoted
                 ↘ buildFailed
promoted → archived
\`\`\`

| State | Meaning |
|---|---|
| queued | Bundle uploaded, waiting for a build worker |
| building | Image being built and pushed to the registry |
| buildFailed | Build errored — check the build log |
| promotable | Build succeeded, ready to promote |
| promoted | Active version — used by all new sessions |
| archived | Retired — can be unarchived |

### Key API routes

\`\`\`
GET    /api/templates                              List templates
POST   /api/templates                              Create template
GET    /api/templates/:id                          Get template
POST   /api/templates/:id/versions                 Add version
PUT    /api/templates/:id/versions/:vid/bundle     Upload bundle
POST   /api/templates/:id/promote                  Promote version
POST   /api/templates/:id/rollback                 Rollback
DELETE /api/templates/:id                          Delete template
\`\`\`

### CLI reference

\`\`\`sh
flare template create node-dev
flare template upload <id> --version 1.0.0 --file bundle.tar.gz
flare template promote <id> <versionId>
flare template rollback <id>
flare template list
flare template delete <id>
\`\`\`

---

## Sessions

A session is a **live container instance** of a promoted template version. It
has a full lifecycle and exposes SSH, browser preview, and editor access.

### Session states

\`\`\`
created → starting → running → sleeping → stopping → stopped → deleted
                             ↘ failed
\`\`\`

| State | Meaning |
|---|---|
| created | Just created, not yet started |
| starting | Container initialising, bootstrap running |
| running | Container ready and accepting connections |
| sleeping | Idle timeout reached — dormant but recoverable |
| stopping | Transitioning to stopped or sleeping |
| stopped | Manually stopped, snapshot flushed |
| failed | Could not start or recover |
| deleted | Permanently removed |

### Key session fields

| Field | Description |
|---|---|
| id | Session identifier |
| workspaceId | Owner workspace |
| templateId | Template used to launch this session |
| name | User-friendly name (unique per workspace) |
| state | Current lifecycle state |
| persistedPaths | Paths preserved between runs |
| sleepTtlSeconds | Auto-sleep idle threshold (from template manifest) |
| sshAuthorizedKeys | Array of authorized SSH public keys |
| lastRestoredSnapshotId | Snapshot restored on last start |
| previewUrl | URL to the session's browser preview |

### Access methods

| Method | Description |
|---|---|
| SSH | Full native shell via WebSocket tunnel |
| Browser preview | HTTP proxy to app's running port |
| Editor / terminal | Code-server or ttyd in the browser |

### Auto-sleep

Sessions auto-sleep after \`sleepTtlSeconds\` of idle time. On sleep:

1. Persisted paths are archived as a snapshot.
2. The container goes dormant.
3. Waking is instant: call \`start\` and the snapshot is restored.

### Key API routes

\`\`\`
GET    /api/sessions                       List sessions
POST   /api/sessions                       Create session
GET    /api/sessions/:id                   Get session
POST   /api/sessions/:id/start             Start / wake
POST   /api/sessions/:id/stop              Stop
POST   /api/sessions/:id/restart           Restart
DELETE /api/sessions/:id                   Delete
GET    /api/sessions/:id/events            Event history
GET    /api/sessions/:id/ssh-token         SSH access token
PUT    /api/sessions/:id/ssh-key           Add authorized SSH key
\`\`\`

### CLI reference

\`\`\`sh
flare session up sandbox --template <id>
flare session start <id>
flare session stop <id>
flare session restart <id>
flare session delete <id>
flare session ssh <id>
flare session preview <id>
flare session editor <id>
flare session list
flare session status <id>
\`\`\`

---

## Snapshots

A snapshot is a **compressed archive of a session's persisted paths** at a
specific point in time, stored in object storage (R2). Snapshots enable state
persistence across container lifecycles.

### When snapshots are created

- **Automatically** on every sleep and stop.
- **Manually** on demand via API or CLI.

### Restore flow

1. Template manifest lists \`persistedPaths\`.
2. On snapshot creation those paths are compressed to \`.tar.gz\` and uploaded.
3. Session records \`lastRestoredSnapshotId\`.
4. On next start, the snapshot is downloaded and extracted in place.

### Key API routes

\`\`\`
POST   /api/sessions/:id/snapshots                           Create snapshot
GET    /api/sessions/:id/snapshots                           List snapshots
PUT    /api/sessions/:id/snapshots/:sid/content/upload       Upload content
GET    /api/sessions/:id/snapshots/:sid/content              Download content
POST   /api/sessions/:id/snapshots/:sid/restore              Restore
DELETE /api/sessions/:id/snapshots/:sid                      Delete
\`\`\`

### CLI reference

\`\`\`sh
flare snapshot save <sessionId> --label checkpoint
flare snapshot list <sessionId>
flare snapshot restore <sessionId> <snapshotId>
flare snapshot get <sessionId> <snapshotId> --output ./backup.tar.gz
flare snapshot delete <sessionId> <snapshotId>
\`\`\`

---

## Runtime secrets

Runtime secrets are **workspace-level environment variables** injected into
every session at container boot.

| Constraint | Value |
|---|---|
| Max secrets | 32 per workspace |
| Max size per secret | 4 KB |
| Injection point | Container bootstrap |

Common uses: API keys, database URLs, registry credentials, feature flags.

---

## Auth and access

### Token types

| Type | TTL | Description |
|---|---|---|
| Browser session | 30 days | Standard cookie after login |
| CLI refresh token | 30 days | Exchanged for access tokens |
| CLI access token | 7 days | Used for API calls |
| Runtime token | 15 minutes | Short-lived token issued to containers |

### CLI login (device code flow)

\`\`\`sh
flare auth login    # Opens browser approval page
flare auth status
flare auth logout
\`\`\`

API routes:

\`\`\`
POST /api/cli/device/start    Start device code flow
POST /api/cli/device/approve  Approve in browser
POST /api/cli/device/exchange Exchange code for tokens
\`\`\`

### SSH keys

Each session maintains its own authorized key list. Keys are stored in the
session record and validated on each SSH connection attempt.

\`\`\`sh
flare session ssh-key add <sessionId> --key "$(cat ~/.ssh/id_ed25519.pub)"
\`\`\`

---

## Infrastructure

BurstFlare runs entirely on Cloudflare primitives:

| Component | Used for |
|---|---|
| Workers | API edge layer, request routing |
| D1 (SQLite) | Durable state (workspaces, templates, sessions, snapshots) |
| R2 (object storage) | Template bundles, build logs, snapshot archives |
| Durable Objects | Session state machine, per-session coordination |
| Containers | Actual session runtime (the running container) |
| Queues | Build job dispatch |
| Workflows | Multi-step build pipeline orchestration |
| Analytics Engine | Real-time usage metering |

---

*Last updated: 2026-03-03*
*Rich documentation: https://burstflare.dev/docs*
`;
