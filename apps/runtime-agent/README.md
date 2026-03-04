# BurstFlare Go Runtime Agent

This workspace contains the active Go session container runtime.

PR 2 only covers the HTTP control-plane routes:

- `GET /health`
- `GET /meta`
- `POST /runtime/bootstrap`
- `POST /runtime/lifecycle`
- `POST /snapshot/restore`
- `GET|POST /snapshot/export`
- `POST /common-state/restore`
- `GET|POST /common-state/export`
- `GET|POST /editor`

The shell websocket, SSH websocket, and `sshd` lifecycle are intentionally left for the next PR so the migration stays trunk-safe.

PR 3 adds those runtime-adjacent pieces to the Go agent as well:

- `WS /shell`
- `WS /ssh`
- local `sshd` startup on `127.0.0.1:${BURSTFLARE_SSH_PORT:-2222}`
