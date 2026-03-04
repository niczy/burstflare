## BurstFlare Session Runtime Contract

This document is the compatibility contract that both the current Node runtime (`server.mjs`) and the planned Go runtime agent must implement.

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

### Runtime Metadata Files

The runtime writes these compatibility files:

- `/workspace/.burstflare/session.json`
- `/workspace/.burstflare/lifecycle.json`
- `/run/burstflare/secrets.env`
- `/home/flare/.ssh/authorized_keys`
- `/workspace/.burstflare/last.snapshot`

The Go runtime agent should preserve these payload shapes and side effects until the Worker contract changes intentionally.
