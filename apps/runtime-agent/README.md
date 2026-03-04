# BurstFlare Go Runtime Agent

This workspace contains the staged Go replacement for the current session container runtime in `containers/session/server.mjs`.

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
