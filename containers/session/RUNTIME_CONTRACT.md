## BurstFlare Session Runtime Contract

This document is the compatibility contract for the session container runtime. The Go runtime agent is the active implementation, and any future replacements should preserve this contract unless the Worker contract changes intentionally.

### Control Routes

All routes are served from inside the session container:

- `GET /health`
- `GET /meta`
- `POST /runtime/bootstrap`
- `POST /runtime/lifecycle`
- `POST /snapshot/restore`
- `GET|POST /snapshot/export`
- `POST /common-state/restore`
- `GET|POST /common-state/export`
- `GET|POST /editor`
- `WS /shell`
- `WS /ssh`

The canonical route constants and payload builders live in [runtime-contract.mjs](./runtime-contract.mjs).

### Snapshot Envelope

- Format: `burstflare.snapshot.v2`
- Content-Type: `application/vnd.burstflare.snapshot+json; charset=utf-8`
- Restore accepts only files inside the configured `persistedPaths`.
- Export returns only files inside the current `persistedPaths`.

### Common State Envelope

- Format: `burstflare.common-state.v1`
- Content-Type: `application/vnd.burstflare.common-state+json; charset=utf-8`
- State is scoped to `/home/flare`.
- `/home/flare/.ssh/authorized_keys` is excluded from import/export.

### Custom Bootstrap Script

The bootstrap payload accepts an optional `bootstrapScript` field (string, max 64 KB). When present, the runtime agent:

1. Computes a SHA-256 hash of the script content.
2. Checks `/run/burstflare/bootstrap-user.done` — if the stored hash matches, execution is skipped (`"cached"`).
3. Otherwise writes the script to `/run/burstflare/bootstrap-user.sh`, executes it via `/bin/sh`, and records the hash on success.

The `BootstrapState` response includes `bootstrapScriptHash` and `bootstrapScriptStatus` (`"executed"`, `"cached"`, or `"failed"`).

### Runtime Metadata Files

The runtime writes these compatibility files:

- `/workspace/.burstflare/session.json`
- `/workspace/.burstflare/lifecycle.json`
- `/run/burstflare/secrets.env`
- `/run/burstflare/bootstrap-user.sh` (custom bootstrap script, when provided)
- `/run/burstflare/bootstrap-user.done` (hash marker for script caching)
- `/home/flare/.ssh/authorized_keys`
- `/workspace/.burstflare/last.snapshot`

The active Go runtime agent preserves these payload shapes and side effects. Future replacements should do the same until the Worker contract changes intentionally.
